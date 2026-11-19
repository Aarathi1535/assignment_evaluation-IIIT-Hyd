import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import mongoose from 'mongoose';
import { connectDB } from '../lib/db';
import { BackupManifest } from './backupDatabase';

export interface RestoreOptions {
  backupDir: string;
  dryRun?: boolean;
  dropExisting?: boolean;
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
  const { backupDir, dryRun = false, dropExisting = false } = options;
  const manifestPath = path.join(backupDir, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Backup manifest not found at: ${manifestPath}`);
  }

  const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
  const manifest: BackupManifest = JSON.parse(manifestRaw);

  let conn = options.connection;
  if (!conn) {
    const mongooseInstance = await connectDB();
    conn = mongooseInstance.connection;
  }

  const db = conn.db;
  if (!db) {
    throw new Error('Database connection is not ready or has no active db instance');
  }

  const targetCollectionNames = options.collections && options.collections.length > 0
    ? Object.keys(manifest.collections).filter((c) => options.collections!.includes(c))
    : Object.keys(manifest.collections);

  const restoredCollections: Record<string, { count: number; verifiedSha256: boolean }> = {};
  let totalDocs = 0;
  const errors: string[] = [];

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
      const docs = JSON.parse(uncompressedContent);
      if (!Array.isArray(docs)) {
        errors.push(`File for collection '${colName}' does not contain a JSON array of documents`);
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
      errors.push(`Failed to parse JSON for collection '${colName}': ${msg}`);
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

  // Step 3: Execution / Restore into Database
  for (const colName of targetCollectionNames) {
    const docs = parsedDataPerCollection[colName];
    const col = db.collection(colName);

    if (dropExisting) {
      await col.deleteMany({});
    }

    if (docs.length > 0) {
      // Restore documents in batches of 500
      const batchSize = 500;
      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = docs.slice(i, i + batchSize);
        await col.insertMany(batch, { ordered: false });
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
  const backupDirArg = args.find((a) => !a.startsWith('--'));

  if (!backupDirArg) {
    console.error('Usage: tsx src/scripts/restoreDatabase.ts <backup-directory> [--dry-run]');
    process.exit(1);
  }

  restoreDatabase({ backupDir: backupDirArg, dryRun: isDryRun, dropExisting: true })
    .then((res) => {
      if (res.success) {
        console.log(`✅ ${res.dryRun ? '[DRY RUN] ' : ''}Restore completed successfully!`);
        console.log(`📦 Restored ${res.totalDocuments} documents across ${Object.keys(res.restoredCollections).length} collections`);
        process.exit(0);
      } else {
        console.error('❌ Restore failed with integrity errors:', res.errors);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('❌ Restore failed:', err);
      process.exit(1);
    });
}
