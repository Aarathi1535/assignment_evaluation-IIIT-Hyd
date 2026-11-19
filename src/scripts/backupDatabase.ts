import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import zlib from 'zlib';
import mongoose from 'mongoose';
import { connectDB } from '../lib/db';

export interface CollectionBackupMeta {
  name: string;
  count: number;
  sha256: string;
  fileName: string;
}

export interface BackupManifest {
  version: string;
  timestamp: string;
  database: string;
  collections: Record<string, CollectionBackupMeta>;
  totalDocuments: number;
  manifestSha256?: string;
}

export interface BackupOptions {
  targetDir?: string;
  collections?: string[];
  compress?: boolean;
  connection?: mongoose.Connection;
}

export async function createDatabaseBackup(options: BackupOptions = {}): Promise<{
  backupDir: string;
  manifest: BackupManifest;
}> {
  let conn = options.connection;
  if (!conn) {
    const mongooseInstance = await connectDB();
    conn = mongooseInstance.connection;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = options.targetDir || path.join(process.cwd(), 'backups', `backup-${timestamp}`);
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const db = conn.db;
  if (!db) {
    throw new Error('Database connection is not ready or has no active db instance');
  }

  // Enumerate collections
  const collectionsList = await db.listCollections().toArray();
  const availableCollectionNames = collectionsList
    .map((c) => c.name)
    .filter((name) => !name.startsWith('system.'));

  const targetCollections = options.collections && options.collections.length > 0
    ? availableCollectionNames.filter((c) => options.collections!.includes(c))
    : availableCollectionNames;

  const manifest: BackupManifest = {
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    database: db.databaseName,
    collections: {},
    totalDocuments: 0,
  };

  for (const colName of targetCollections) {
    const col = db.collection(colName);
    const docs = await col.find({}).sort({ _id: 1 }).toArray();
    const serialized = JSON.stringify(docs, null, 2);

    const hash = crypto.createHash('sha256').update(serialized).digest('hex');
    const isCompressed = options.compress ?? false;
    const fileName = isCompressed ? `${colName}.json.gz` : `${colName}.json`;
    const filePath = path.join(backupDir, fileName);

    if (isCompressed) {
      const gzipped = zlib.gzipSync(Buffer.from(serialized, 'utf8'));
      fs.writeFileSync(filePath, gzipped);
    } else {
      fs.writeFileSync(filePath, serialized, 'utf8');
    }

    manifest.collections[colName] = {
      name: colName,
      count: docs.length,
      sha256: hash,
      fileName,
    };
    manifest.totalDocuments += docs.length;
  }

  // Compute overall manifest hash (excluding manifestSha256 property itself)
  const manifestRaw = JSON.stringify(manifest, Object.keys(manifest).sort(), 2);
  const manifestHash = crypto.createHash('sha256').update(manifestRaw).digest('hex');
  manifest.manifestSha256 = manifestHash;

  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  return { backupDir, manifest };
}

// CLI execution helper
if (require.main === module) {
  createDatabaseBackup({ compress: true })
    .then(({ backupDir, manifest }) => {
      console.log(`✅ Backup successfully created at: ${backupDir}`);
      console.log(`📦 Total documents: ${manifest.totalDocuments} across ${Object.keys(manifest.collections).length} collections`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Backup failed:', err);
      process.exit(1);
    });
}
