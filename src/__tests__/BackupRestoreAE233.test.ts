import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { createDatabaseBackup } from '../scripts/backupDatabase';
import { restoreDatabase } from '../scripts/restoreDatabase';

describe('AE-233: Backup and Disaster Recovery Engine', () => {
  const testOutputDir = path.join(process.cwd(), 'backups', 'test-run');
  const docsPath = path.join(process.cwd(), 'docs', 'BACKUP_RESTORE.md');

  afterAll(async () => {
    if (fs.existsSync(testOutputDir)) {
      fs.rmSync(testOutputDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
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

  describe('Backup Engine (createDatabaseBackup)', () => {
    it('should generate uncompressed JSON backup with SHA-256 sealed manifest', async () => {
      const db = mongoose.connection.db!;
      const coursesCol = db.collection('courses');
      const auditCol = db.collection('auditlogs');

      await coursesCol.insertMany([
        { courseCode: 'CS101', courseName: 'Intro to CS', credits: 4 },
        { courseCode: 'CS201', courseName: 'Data Structures', credits: 4 },
      ]);
      await auditCol.insertOne({
        action: 'EXAM_CREATED',
        userId: 'admin-1',
        timestamp: new Date().toISOString(),
      });

      const { backupDir, manifest } = await createDatabaseBackup({
        targetDir: path.join(testOutputDir, 'uncompressed'),
        compress: false,
        connection: mongoose.connection,
      });

      expect(fs.existsSync(backupDir)).toBe(true);
      expect(fs.existsSync(path.join(backupDir, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(backupDir, 'courses.json'))).toBe(true);
      expect(fs.existsSync(path.join(backupDir, 'auditlogs.json'))).toBe(true);

      expect(manifest.version).toBe('1.0.0');
      expect(manifest.totalDocuments).toBe(3);
      expect(manifest.collections['courses'].count).toBe(2);
      expect(manifest.collections['auditlogs'].count).toBe(1);
      expect(manifest.manifestSha256).toBeDefined();
    });

    it('should generate compressed (.json.gz) backup archive', async () => {
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

  describe('Restore Engine (restoreDatabase)', () => {
    it('dry-run mode should validate checksums without modifying database records', async () => {
      const db = mongoose.connection.db!;
      const coursesCol = db.collection('courses');

      await coursesCol.insertOne({ courseCode: 'CS101', courseName: 'Intro to CS' });

      const { backupDir } = await createDatabaseBackup({
        targetDir: path.join(testOutputDir, 'dry-run-test'),
        compress: false,
        connection: mongoose.connection,
      });

      // Clear the collection to verify dry-run does NOT write
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
      expect(restoreRes.restoredCollections['courses'].verifiedSha256).toBe(true);

      // Verify db is still empty after dry-run
      expect(await coursesCol.countDocuments()).toBe(0);
    });

    it('should fail restore if backup data is tampered with', async () => {
      const db = mongoose.connection.db!;
      const coursesCol = db.collection('courses');

      await coursesCol.insertOne({ courseCode: 'CS101', courseName: 'Intro to CS' });

      const { backupDir } = await createDatabaseBackup({
        targetDir: path.join(testOutputDir, 'tamper-test'),
        compress: false,
        connection: mongoose.connection,
      });

      // Tamper with courses.json
      const coursesFilePath = path.join(backupDir, 'courses.json');
      fs.writeFileSync(coursesFilePath, JSON.stringify([{ code: 'TAMPERED' }]), 'utf8');

      const restoreRes = await restoreDatabase({
        backupDir,
        dryRun: false,
        connection: mongoose.connection,
      });

      expect(restoreRes.success).toBe(false);
      expect(restoreRes.errors).toBeDefined();
      expect(restoreRes.errors![0]).toContain('SHA-256 integrity checksum mismatch');
    });

    it('live restore should repopulate database collections and match counts', async () => {
      const db = mongoose.connection.db!;
      const coursesCol = db.collection('courses');

      await coursesCol.insertMany([
        { courseCode: 'CS101', courseName: 'Intro to CS' },
        { courseCode: 'CS201', courseName: 'Data Structures' },
      ]);

      const { backupDir } = await createDatabaseBackup({
        targetDir: path.join(testOutputDir, 'live-restore'),
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
        connection: mongoose.connection,
      });

      expect(restoreRes.success).toBe(true);
      expect(restoreRes.dryRun).toBe(false);
      expect(restoreRes.totalDocuments).toBe(2);

      // Verify records are back in database
      const count = await coursesCol.countDocuments();
      expect(count).toBe(2);
    });
  });

  describe('Disaster Recovery Documentation (docs/BACKUP_RESTORE.md)', () => {
    it('should document RPO, RTO, retention schedules, and step-by-step drill runbooks', () => {
      expect(fs.existsSync(docsPath)).toBe(true);
      const content = fs.readFileSync(docsPath, 'utf8');

      expect(content).toContain('RPO');
      expect(content).toContain('< 1 hour');
      expect(content).toContain('RTO');
      expect(content).toContain('< 30 minutes');
      expect(content).toContain('backupDatabase.ts');
      expect(content).toContain('restoreDatabase.ts');
      expect(content).toContain('--dry-run');
      expect(content).toContain('Disaster Recovery Drill Runbook');
    });
  });
});
