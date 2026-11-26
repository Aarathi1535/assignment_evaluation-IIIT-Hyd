import { describe, it, expect, afterAll, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import { createDatabaseBackup } from '../scripts/backupDatabase';
import { restoreDatabase } from '../scripts/restoreDatabase';

describe('AE-233: Backup and Disaster Recovery Engine', () => {
  const testOutputDir = path.join(process.cwd(), 'backups', 'test-run-ae233');
  const originalEnv = process.env.NODE_ENV;

  beforeEach(async () => {
    Object.assign(process.env, { NODE_ENV: 'test' });
    if (mongoose.connection.db) {
      const collections = await mongoose.connection.db.listCollections().toArray();
      for (const col of collections) {
        if (!col.name.startsWith('system.')) {
          await mongoose.connection.db.collection(col.name).deleteMany({});
        }
      }
    }

    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    Object.assign(process.env, { NODE_ENV: originalEnv });
  });

  afterAll(async () => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  describe('1. Backup Engine & Canonical EJSON Serialization', () => {
    it('generates backup with BSON type preservation and SHA-256 sealed manifest', async () => {
      const db = mongoose.connection.db!;
      const coursesCol = db.collection('courses');
      const testDate = new Date('2026-03-15T10:00:00.000Z');
      const testId = new ObjectId();

      await coursesCol.insertOne({
        _id: testId,
        courseCode: 'CS101',
        courseName: 'Intro to CS',
        createdAt: testDate,
        rawPayload: Buffer.from('binary-data-sample'),
      });

      const { backupDir, manifest } = await createDatabaseBackup({
        targetDir: path.join(testOutputDir, 'uncompressed'),
        compress: false,
        connection: mongoose.connection,
      });

      expect(fs.existsSync(backupDir)).toBe(true);
      expect(fs.existsSync(path.join(backupDir, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(backupDir, 'courses.json'))).toBe(true);

      expect(manifest.version).toBe('2.0.0');
      expect(manifest.totalDocuments).toBe(1);
      expect(manifest.collections['courses'].count).toBe(1);
      expect(manifest.manifestSha256).toBeDefined();

      // Read raw courses.json and assert Canonical EJSON representations
      const rawContent = fs.readFileSync(path.join(backupDir, 'courses.json'), 'utf8');
      expect(rawContent).toContain('$oid');
      expect(rawContent).toContain('$date');
    });

    it('generates compressed (.json.gz) backup archive', async () => {
      const db = mongoose.connection.db!;
      const coursesCol = db.collection('courses');

      await coursesCol.insertMany([
        { courseCode: 'CS301', courseName: 'Algorithms' },
        { courseCode: 'CS401', courseName: 'Operating Systems' },
      ]);

      const { backupDir, manifest } = await createDatabaseBackup({
        targetDir: path.join(testOutputDir, 'compressed'),
        compress: true,
        connection: mongoose.connection,
      });

      expect(fs.existsSync(path.join(backupDir, 'courses.json.gz'))).toBe(true);
      expect(manifest.collections['courses'].fileName).toBe('courses.json.gz');
      expect(manifest.collections['courses'].count).toBe(2);
    });
  });

  describe('2. Safety Guards & Integrity Verification in Restoration', () => {
    it('blocks restoration when NODE_ENV === production without explicit override', async () => {
      Object.assign(process.env, { NODE_ENV: 'production' });

      const backupDir = path.join(testOutputDir, 'prod-guard-test');
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({ collections: {} }), 'utf8');

      await expect(
        restoreDatabase({
          backupDir,
          connection: mongoose.connection,
        })
      ).rejects.toThrow(/CRITICAL SAFETY ERROR: Direct database restoration is blocked/);
    });

    it('blocks restoration when targetDb is omitted or does not match connected database', async () => {
      Object.assign(process.env, { NODE_ENV: 'production' });

      const backupDir = path.join(testOutputDir, 'target-db-guard-test');
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({ collections: {} }), 'utf8');

      await expect(
        restoreDatabase({
          backupDir,
          allowProductionRestore: true,
          targetDb: 'wrong_database_name',
          connection: mongoose.connection,
        })
      ).rejects.toThrow(/TARGET DATABASE MISMATCH/);
    });

    it('rejects dropExisting without explicit confirmDestructive flag', async () => {
      const backupDir = path.join(testOutputDir, 'confirm-destructive-test');
      fs.mkdirSync(backupDir, { recursive: true });
      fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify({ collections: {} }), 'utf8');

      await expect(
        restoreDatabase({
          backupDir,
          dropExisting: true,
          confirmDestructive: false,
          connection: mongoose.connection,
        })
      ).rejects.toThrow(/DESTRUCTIVE OPERATION BLOCKED/);
    });

    it('fails restore if manifest.json integrity seal is missing or tampered', async () => {
      const db = mongoose.connection.db!;
      const coursesCol = db.collection('courses');
      await coursesCol.insertOne({ courseCode: 'CS101' });

      const { backupDir } = await createDatabaseBackup({
        targetDir: path.join(testOutputDir, 'manifest-tamper-test'),
        compress: false,
        connection: mongoose.connection,
      });

      // Tamper with manifestSha256
      const manifestPath = path.join(backupDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.manifestSha256 = '0000000000000000000000000000000000000000000000000000000000000000';
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');

      const restoreRes = await restoreDatabase({
        backupDir,
        dryRun: true,
        connection: mongoose.connection,
      });

      expect(restoreRes.success).toBe(false);
      expect(restoreRes.errors).toBeDefined();
      expect(restoreRes.errors![0]).toContain('Manifest integrity hash mismatch');
    });

    it('fails restore if collection file data is tampered with', async () => {
      const db = mongoose.connection.db!;
      const coursesCol = db.collection('courses');
      await coursesCol.insertOne({ courseCode: 'CS101' });

      const { backupDir } = await createDatabaseBackup({
        targetDir: path.join(testOutputDir, 'file-tamper-test'),
        compress: false,
        connection: mongoose.connection,
      });

      // Tamper with courses.json
      const coursesFilePath = path.join(backupDir, 'courses.json');
      fs.writeFileSync(coursesFilePath, JSON.stringify([{ courseCode: 'TAMPERED' }]), 'utf8');

      const restoreRes = await restoreDatabase({
        backupDir,
        dryRun: false,
        connection: mongoose.connection,
      });

      expect(restoreRes.success).toBe(false);
      expect(restoreRes.errors).toBeDefined();
      expect(restoreRes.errors![0]).toContain('SHA-256 integrity checksum mismatch');
    });

    it('dry-run mode validates checksums without modifying collections', async () => {
      const db = mongoose.connection.db!;
      const coursesCol = db.collection('courses');
      await coursesCol.insertOne({ courseCode: 'CS101' });

      const { backupDir } = await createDatabaseBackup({
        targetDir: path.join(testOutputDir, 'dry-run-test'),
        compress: false,
        connection: mongoose.connection,
      });

      await coursesCol.deleteMany({});
      expect(await coursesCol.countDocuments()).toBe(0);

      const restoreRes = await restoreDatabase({
        backupDir,
        dryRun: true,
        connection: mongoose.connection,
      });

      expect(restoreRes.success).toBe(true);
      expect(restoreRes.dryRun).toBe(true);
      expect(restoreRes.totalDocuments).toBe(1);
      expect(await coursesCol.countDocuments()).toBe(0);
    });
  });

  describe('3. Faithful BSON Type Restoration', () => {
    it('restores documents with native ObjectId and Date instances (not plain strings)', async () => {
      const db = mongoose.connection.db!;
      const coursesCol = db.collection('courses');
      const testDate = new Date('2026-05-20T14:30:00.000Z');
      const testId = new ObjectId();

      await coursesCol.insertOne({
        _id: testId,
        courseCode: 'CS201',
        createdAt: testDate,
      });

      const { backupDir } = await createDatabaseBackup({
        targetDir: path.join(testOutputDir, 'type-restore-test'),
        compress: false,
        connection: mongoose.connection,
      });

      // Wipe collection
      await coursesCol.deleteMany({});
      expect(await coursesCol.countDocuments()).toBe(0);

      const restoreRes = await restoreDatabase({
        backupDir,
        dryRun: false,
        dropExisting: true,
        confirmDestructive: true,
        connection: mongoose.connection,
      });

      expect(restoreRes.success).toBe(true);
      expect(restoreRes.totalDocuments).toBe(1);

      // Verify the restored document in MongoDB has real ObjectId and Date instances (not plain strings)
      const restoredDoc = await coursesCol.findOne({ courseCode: 'CS201' });
      expect(restoredDoc).toBeDefined();
      expect(typeof restoredDoc!._id).toBe('object');
      expect(ObjectId.isValid(restoredDoc!._id)).toBe(true);
      expect(restoredDoc!._id.toString()).toBe(testId.toHexString());
      expect(restoredDoc!.createdAt).toBeInstanceOf(Date);
      expect((restoredDoc!.createdAt as Date).toISOString()).toBe(testDate.toISOString());
    });
  });
});
