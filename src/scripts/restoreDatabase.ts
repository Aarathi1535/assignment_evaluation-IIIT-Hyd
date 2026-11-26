import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import { BSON } from 'mongodb';
import mongoose from 'mongoose';
import { connectDB, isTransactionCapable } from '../lib/db';
import { BackupManifest, computeManifestHash } from './backupDatabase';

const { EJSON } = BSON;

export interface RestoreOptions {
  backupDir: string;
  dryRun?: boolean;
  dropExisting?: boolean;
  confirmDestructive?: boolean;
  allowProductionRestore?: boolean;
  targetDb?: string;
  collections?: string[];
  connection?: mongoose.Connection;
}

export interface RestoreResult {
  success: boolean;
  dryRun: boolean;
  restoredCollections: Record<string, { count: number; verifiedSha256: boolean }>;
  totalDocuments: number;
  errors?: string[];
}

export async function restoreDatabase(options: RestoreOptions): Promise<RestoreResult> {
  const { backupDir, dryRun = false, dropExisting = false, confirmDestructive = false } = options;

  let conn = options.connection;
  if (!conn) {
    const mongooseInstance = await connectDB();
    conn = mongooseInstance.connection;
  }

  const db = conn.db;
  if (!db) {
    throw new Error('Database connection is not ready or has no active db instance');
  }

  // Safety Guard 1: Guard against accidental restore on remote or production databases
  const host = conn.host || '';
  const isLocalHost = /^(localhost|127\.0\.0\.1|::1|mongodb)$/i.test(host) ||
    host.includes('localhost') ||
    host.includes('127.0.0.1');

  if (process.env.NODE_ENV === 'production' || !isLocalHost) {
    if (!options.allowProductionRestore) {
      throw new Error(
        `CRITICAL SAFETY ERROR: Direct database restoration is blocked for host "${host}" ` +
        `(NODE_ENV="${process.env.NODE_ENV}"). Remote/production restore is prohibited without explicit authorization. ` +
        `Use MongoDB Atlas Point-in-Time Recovery (PITR) for production disaster recovery, ` +
        `or pass allowProductionRestore: true along with matching targetDb for verified recovery drills.`
      );
    }

    if (!options.targetDb || options.targetDb !== db.databaseName) {
      throw new Error(
        `TARGET DATABASE MISMATCH: Target database on host "${host}" is "${db.databaseName}", ` +
        `but targetDb is "${options.targetDb || '<omitted>'}". ` +
        `To prevent accidental restoration into the wrong database, targetDb must explicitly match the connected database name.`
      );
    }
  }

  // Safety Guard 2: Require explicit confirmation for destructive collection drop
  if (dropExisting && !confirmDestructive && !dryRun) {
    throw new Error(
      'DESTRUCTIVE OPERATION BLOCKED: dropExisting requires explicit confirmDestructive: true'
    );
  }

  const manifestPath = path.join(backupDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Backup manifest not found at: ${manifestPath}`);
  }

  const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(manifestRaw);
  } catch (err) {
    throw new Error(`Invalid manifest JSON format: ${err instanceof Error ? err.message : String(err)}`);
  }

  const errors: string[] = [];

  // Safety Guard 3: Verify manifest integrity seal before processing
  if (!manifest.manifestSha256) {
    errors.push('Backup manifest is missing manifestSha256 integrity seal');
  } else {
    const { manifestSha256, ...manifestWithoutHash } = manifest;
    const expectedManifestHash = computeManifestHash(manifestWithoutHash);
    if (manifestSha256 !== expectedManifestHash) {
      errors.push(`Manifest integrity hash mismatch: expected ${expectedManifestHash}, got ${manifestSha256}`);
    }
  }

  const targetCollectionNames = options.collections && options.collections.length > 0
    ? Object.keys(manifest.collections).filter((c) => options.collections!.includes(c))
    : Object.keys(manifest.collections);

  const restoredCollections: Record<string, { count: number; verifiedSha256: boolean }> = {};
  let totalDocs = 0;

  // Step 1: Pre-flight Integrity & Checksum Verification
  const parsedDataPerCollection: Record<string, Record<string, unknown>[]> = {};

  for (const colName of targetCollectionNames) {
    const meta = manifest.collections[colName];
    if (!meta) {
      errors.push(`Collection '${colName}' not found in backup manifest`);
      continue;
    }

    const filePath = path.join(backupDir, meta.fileName);
    if (!fs.existsSync(filePath)) {
      errors.push(`Backup file '${meta.fileName}' for collection '${colName}' does not exist on disk`);
      continue;
    }

    let uncompressedContent: string;
    if (meta.fileName.endsWith('.gz')) {
      const gzipped = fs.readFileSync(filePath);
      uncompressedContent = zlib.gunzipSync(gzipped).toString('utf8');
    } else {
      uncompressedContent = fs.readFileSync(filePath, 'utf8');
    }

    // Verify SHA-256 against manifest checksum
    const computedHash = crypto.createHash('sha256').update(uncompressedContent).digest('hex');
    if (computedHash !== meta.sha256) {
      errors.push(
        `SHA-256 integrity checksum mismatch for collection '${colName}': expected ${meta.sha256}, got ${computedHash}`
      );
      continue;
    }

    try {
      // Deserialize with Canonical EJSON to faithfully restore ObjectIds, Dates, and Binary
      const docs = EJSON.parse(uncompressedContent) as Record<string, unknown>[];
      if (!Array.isArray(docs)) {
        errors.push(`File for collection '${colName}' does not contain an array of documents`);
        continue;
      }
      parsedDataPerCollection[colName] = docs;
      restoredCollections[colName] = {
        count: docs.length,
        verifiedSha256: true,
      };
      totalDocs += docs.length;
    } catch (parseErr: unknown) {
      const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      errors.push(`Failed to parse EJSON for collection '${colName}': ${msg}`);
    }
  }

  if (errors.length > 0) {
    return {
      success: false,
      dryRun,
      restoredCollections,
      totalDocuments: 0,
      errors,
    };
  }

  // Step 2: Dry Run Check
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      restoredCollections,
      totalDocuments: totalDocs,
    };
  }

  // Step 3: Transactional Execution (if replica set supports transactions)
  const supportsTransactions = isTransactionCapable(conn);

  if (supportsTransactions) {
    const session = await conn.startSession();
    try {
      await session.withTransaction(async () => {
        for (const colName of targetCollectionNames) {
          const docs = parsedDataPerCollection[colName];
          const col = db.collection(colName);

          if (dropExisting) {
            await col.deleteMany({}, { session });
          }

          if (docs.length > 0) {
            await col.insertMany(docs, { ordered: false, session });
          }
        }
      });
    } finally {
      await session.endSession();
    }
  } else {
    // Standalone fallback: Require an empty target collection if not dropping existing
    if (!dropExisting) {
      for (const colName of targetCollectionNames) {
        const col = db.collection(colName);
        const count = await col.countDocuments();
        if (count > 0) {
          throw new Error(
            `NON-TRANSACTIONAL RESTORE BLOCKED: Target collection "${colName}" already contains ${count} documents. ` +
            `Without replica set transactions, restoring into a non-empty collection can result in partial or duplicate records if interrupted. ` +
            `Either use a replica set with transaction support, pass dropExisting: true (with confirmDestructive: true), or restore into an empty database.`
          );
        }
      }
    }

    for (const colName of targetCollectionNames) {
      const docs = parsedDataPerCollection[colName];
      const col = db.collection(colName);

      if (dropExisting) {
        await col.deleteMany({});
      }

      if (docs.length > 0) {
        await col.insertMany(docs, { ordered: false });
      }
    }
  }

  return {
    success: true,
    dryRun: false,
    restoredCollections,
    totalDocuments: totalDocs,
  };
}

// CLI execution helper
if (require.main === module) {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const dropExisting = args.includes('--drop-existing');
  const confirmDestructive = args.includes('--confirm-destructive');
  const allowProd = args.includes('--allow-production-restore');
  const targetDbIndex = args.indexOf('--target-db');
  const targetDb = targetDbIndex !== -1 && args[targetDbIndex + 1] ? args[targetDbIndex + 1] : undefined;
  const backupDirArg = args.find((a) => !a.startsWith('--') && a !== targetDb);

  if (!backupDirArg) {
    console.error('Usage: tsx src/scripts/restoreDatabase.ts <backup-directory> [--dry-run] [--drop-existing --confirm-destructive] [--target-db <name>] [--allow-production-restore]');
    process.exit(1);
  }

  restoreDatabase({
    backupDir: backupDirArg,
    dryRun: isDryRun,
    dropExisting,
    confirmDestructive,
    allowProductionRestore: allowProd,
    targetDb,
  })
    .then((res) => {
      if (res.success) {
        console.log(`✅ ${res.dryRun ? '[DRY RUN] ' : ''}Restore completed successfully!`);
        console.log(`📦 Restored ${res.totalDocuments} documents across ${Object.keys(res.restoredCollections).length} collections`);
        process.exit(0);
      } else {
        console.error('❌ Restore failed with integrity errors:');
        res.errors?.forEach((e) => console.error(`  - ${e}`));
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('❌ Restore error:', err.message);
      process.exit(1);
    });
}
