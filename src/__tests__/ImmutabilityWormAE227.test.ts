/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectDB } from '../lib/db';
import {
  generateHmacSeal,
  verifyHmacSeal,
  getHmacSecret,
  serializeBindingMetadata,
} from '../utils/hmacStorage';
import immutableStorageService, { ImmutableStorageService } from '../services/ImmutableStorageService';
import { HttpError } from '../lib/errors';
import Batch, { IBindingMetadata, BatchStatus } from '../models/Batch';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import Course from '../models/Course';

const auditCalls: any[] = [];
vi.mock('../lib/audit', () => ({
  writeAuditLog: vi.fn().mockImplementation(async (entry: any) => {
    auditCalls.push(entry);
    return Promise.resolve({ success: true, id: 'mock-audit-id' });
  }),
}));

describe('AE-227: Immutability and WORM Enforcement for Sealed Assets', () => {
  const testStorageDir = path.join(process.cwd(), 'data', 'test_worm_originals');
  let originalStoragePath: string | undefined;
  let originalSecret: string | undefined;
  let originalKeyId: string | undefined;
  let originalV2Secret: string | undefined;

  beforeAll(async () => {
    await connectDB();
  });

  beforeEach(async () => {
    auditCalls.length = 0;
    originalStoragePath = process.env.ORIGINAL_STORAGE_PATH;
    originalSecret = process.env.ORIGINAL_STORAGE_HMAC_SECRET;
    originalKeyId = process.env.ORIGINAL_STORAGE_KEY_ID;
    originalV2Secret = process.env.ORIGINAL_STORAGE_HMAC_SECRET_V2;

    process.env.ORIGINAL_STORAGE_PATH = testStorageDir;
    process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'test-top-secret-hmac-worm-key-32bytes!';
    process.env.ORIGINAL_STORAGE_KEY_ID = 'v1';

    await fs.promises.mkdir(testStorageDir, { recursive: true });

    await Promise.all([
      Batch.deleteMany({}),
      Exam.deleteMany({}),
      Course.deleteMany({}),
      User.deleteMany({}),
    ]);
  });

  afterEach(async () => {
    if (originalStoragePath === undefined) delete process.env.ORIGINAL_STORAGE_PATH;
    else process.env.ORIGINAL_STORAGE_PATH = originalStoragePath;

    if (originalSecret === undefined) delete process.env.ORIGINAL_STORAGE_HMAC_SECRET;
    else process.env.ORIGINAL_STORAGE_HMAC_SECRET = originalSecret;

    if (originalKeyId === undefined) delete process.env.ORIGINAL_STORAGE_KEY_ID;
    else process.env.ORIGINAL_STORAGE_KEY_ID = originalKeyId;

    if (originalV2Secret === undefined) delete process.env.ORIGINAL_STORAGE_HMAC_SECRET_V2;
    else process.env.ORIGINAL_STORAGE_HMAC_SECRET_V2 = originalV2Secret;

    try {
      if (fs.existsSync(testStorageDir)) {
        await fs.promises.rm(testStorageDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  describe('1. WORM Immutability: Write-Once Overwrite Prevention', () => {
    it('successfully stores an original file and creates a sealed record', async () => {
      const storageService = new ImmutableStorageService();
      const content = Buffer.from('%PDF-1.4 Mock Exam Answer Sheet Content', 'utf-8');
      const input = {
        batchId: 'batch-worm-001',
        fileId: 'file-original-1',
        sequenceNumber: 1,
        uploader: 'prof-raman',
        timestamp: 1700000000000,
        buffer: content,
        originalFilename: 'student_1.pdf',
        fileExtension: 'pdf',
      };

      const result = await storageService.storeOriginal(input);

      expect(result.fileId).toBe('file-original-1');
      expect(result.keyId).toBe('v1');
      expect(result.hmac).toBeDefined();
      expect(result.hmac.length).toBe(64); // SHA-256 hex length
      expect(result.size).toBe(content.length);

      // Verify physical presence on storage backend
      const expectedPath = path.join(testStorageDir, 'batch-worm-001', 'file-original-1.pdf');
      expect(fs.existsSync(expectedPath)).toBe(true);
      const storedContent = await fs.promises.readFile(expectedPath);
      expect(storedContent.equals(content)).toBe(true);
    });

    it('rejects attempt to overwrite an existing original file with 409 Conflict', async () => {
      const storageService = new ImmutableStorageService();
      const contentOriginal = Buffer.from('Original Sealed Scan Content', 'utf-8');
      const inputOriginal = {
        batchId: 'batch-worm-002',
        fileId: 'file-sealed-1',
        sequenceNumber: 1,
        uploader: 'prof-raman',
        timestamp: 1700000000000,
        buffer: contentOriginal,
        originalFilename: 'scan.pdf',
        fileExtension: 'pdf',
      };

      // Store initial original file
      await storageService.storeOriginal(inputOriginal);

      // Attempt second store targeting the exact same fileId and batchId
      const contentTampered = Buffer.from('Malicious Modified Content', 'utf-8');
      const inputTampered = {
        ...inputOriginal,
        buffer: contentTampered,
      };

      await expect(storageService.storeOriginal(inputTampered)).rejects.toThrow(HttpError);
      try {
        await storageService.storeOriginal(inputTampered);
      } catch (err: any) {
        expect(err.statusCode).toBe(409);
        expect(err.message).toMatch(/cannot be overwritten/i);
      }

      // Verify that original disk file remained unmodified
      const expectedPath = path.join(testStorageDir, 'batch-worm-002', 'file-sealed-1.pdf');
      const preservedContent = await fs.promises.readFile(expectedPath);
      expect(preservedContent.equals(contentOriginal)).toBe(true);
      expect(preservedContent.equals(contentTampered)).toBe(false);
    });

    it('verifies singleton instance access also enforces WORM semantics', async () => {
      expect(immutableStorageService).toBeInstanceOf(ImmutableStorageService);
      const content = Buffer.from('Singleton Test Content', 'utf-8');
      const input = {
        batchId: 'batch-worm-003',
        fileId: 'file-singleton-1',
        sequenceNumber: 1,
        uploader: 'prof-raman',
        timestamp: 1700000000000,
        buffer: content,
        originalFilename: 'single.pdf',
        fileExtension: 'pdf',
      };

      const result = await immutableStorageService.storeOriginal(input);
      expect(result.fileId).toBe('file-singleton-1');
      await expect(immutableStorageService.storeOriginal(input)).rejects.toThrow(HttpError);
    });
  });

  describe('2. Canonical Metadata Binding & HMAC Sealing', () => {
    it('produces deterministic canonical serialization format', () => {
      const meta: IBindingMetadata = {
        batchId: 'batch-100',
        sequenceNumber: 42,
        uploader: 'user-prof-1',
        timestamp: 1700000000000,
      };

      const serialized = serializeBindingMetadata(meta);
      expect(serialized).toBe('batchId=batch-100&seq=42&uploader=user-prof-1&ts=1700000000000');
    });

    it('generates reproducible HMAC seals for identical content and metadata', () => {
      const buffer = Buffer.from('Authentic Student Response Bytes', 'utf-8');
      const meta: IBindingMetadata = {
        batchId: 'batch-101',
        sequenceNumber: 1,
        uploader: 'prof-1',
        timestamp: 1700000000000,
      };

      const seal1 = generateHmacSeal(buffer, meta);
      const seal2 = generateHmacSeal(buffer, meta);

      expect(seal1.hmac).toBe(seal2.hmac);
      expect(seal1.keyId).toBe('v1');
    });

    it('validates authentic content and metadata using verifyHmacSeal', () => {
      const buffer = Buffer.from('Valid Page Content', 'utf-8');
      const meta: IBindingMetadata = {
        batchId: 'batch-102',
        sequenceNumber: 2,
        uploader: 'prof-1',
        timestamp: 1700000000000,
      };

      const seal = generateHmacSeal(buffer, meta);
      const verification = verifyHmacSeal(buffer, meta, seal.hmac, seal.keyId);

      expect(verification.valid).toBe(true);
      expect(verification.reason).toBeUndefined();
    });
  });

  describe('3. Cryptographic Tamper Detection & Sensitivity', () => {
    const originalBuffer = Buffer.from('Original Clean Untampered Scan', 'utf-8');
    const originalMeta: IBindingMetadata = {
      batchId: 'batch-tamper-test',
      sequenceNumber: 10,
      uploader: 'prof-raman',
      timestamp: 1700000000000,
    };

    it('detects a single-byte modification in file content', () => {
      const seal = generateHmacSeal(originalBuffer, originalMeta);

      // Modify 1 byte in content
      const tamperedBuffer = Buffer.from(originalBuffer);
      tamperedBuffer[0] = tamperedBuffer[0] ^ 0x01; // flip 1 bit

      const result = verifyHmacSeal(tamperedBuffer, originalMeta, seal.hmac, seal.keyId);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('HMAC signature verification failed (tamper detected)');
    });

    it('detects metadata tampering: modified batchId', () => {
      const seal = generateHmacSeal(originalBuffer, originalMeta);
      const tamperedMeta = { ...originalMeta, batchId: 'batch-transplanted' };

      const result = verifyHmacSeal(originalBuffer, tamperedMeta, seal.hmac, seal.keyId);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('HMAC signature verification failed (tamper detected)');
    });

    it('detects metadata tampering: modified sequenceNumber', () => {
      const seal = generateHmacSeal(originalBuffer, originalMeta);
      const tamperedMeta = { ...originalMeta, sequenceNumber: 11 };

      const result = verifyHmacSeal(originalBuffer, tamperedMeta, seal.hmac, seal.keyId);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('HMAC signature verification failed (tamper detected)');
    });

    it('detects metadata tampering: modified uploader identity', () => {
      const seal = generateHmacSeal(originalBuffer, originalMeta);
      const tamperedMeta = { ...originalMeta, uploader: 'malicious-user' };

      const result = verifyHmacSeal(originalBuffer, tamperedMeta, seal.hmac, seal.keyId);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('HMAC signature verification failed (tamper detected)');
    });

    it('detects metadata tampering: modified timestamp', () => {
      const seal = generateHmacSeal(originalBuffer, originalMeta);
      const tamperedMeta = { ...originalMeta, timestamp: 1700000000001 };

      const result = verifyHmacSeal(originalBuffer, tamperedMeta, seal.hmac, seal.keyId);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('HMAC signature verification failed (tamper detected)');
    });
  });

  describe('4. Key Rotation & Secret Isolation Boundaries', () => {
    it('supports rotating to historical keys when historical secret is present', () => {
      process.env.ORIGINAL_STORAGE_HMAC_SECRET_V2 = 'historical-v2-secret-32-chars-long!';

      const resolvedV2 = getHmacSecret('v2');
      expect(resolvedV2.secret).toBe('historical-v2-secret-32-chars-long!');
      expect(resolvedV2.keyId).toBe('v2');

      const resolvedV1 = getHmacSecret('v1');
      expect(resolvedV1.secret).toBe('test-top-secret-hmac-worm-key-32bytes!');
      expect(resolvedV1.keyId).toBe('v1');
    });

    it('throws error and strictly avoids silent fallback when historical key secret is missing', () => {
      expect(() => getHmacSecret('v99')).toThrow(
        /HMAC secret for key ID "v99" is unavailable or not configured/i
      );
    });

    it('rejects verification safely when expected HMAC is missing or corrupted', () => {
      const buffer = Buffer.from('Content', 'utf-8');
      const meta: IBindingMetadata = {
        batchId: 'b-1',
        sequenceNumber: 1,
        uploader: 'u-1',
        timestamp: 100,
      };

      expect(verifyHmacSeal(buffer, meta, '').valid).toBe(false);
      expect(verifyHmacSeal(buffer, meta, null as any).valid).toBe(false);
      expect(verifyHmacSeal(buffer, meta, 'malformed-non-hex-length').valid).toBe(false);
    });
  });

  describe('5. Model-Level WORM Immutability Hooks (Batch & Exam)', () => {
    it('blocks deletion of a Batch containing sealed original files', async () => {
      const prof = await User.create({
        name: 'Prof. Raman',
        email: 'raman@test.edu',
        password: 'Pass',
        role: UserRole.PROFESSOR,
      });

      const sealedBatch = await Batch.create({
        batchId: 'SEALED-BATCH-001',
        uploadedBy: prof._id,
        files: [
          {
            fileId: 'file-1',
            fileIndex: 0,
            originalFilename: 'scan.pdf',
            fileType: 'pdf',
            mimeType: 'application/pdf',
            size: 1024,
            pageCount: 2,
            storageKey: 'batches/SEALED-BATCH-001/file-1.pdf',
            hmac: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
            keyId: 'v1',
            sequenceNumber: 1,
            integrityMetadata: {
              batchId: 'SEALED-BATCH-001',
              sequenceNumber: 1,
              uploader: prof._id.toString(),
              timestamp: Date.now(),
            },
          },
        ],
        status: BatchStatus.DONE,
        isActive: true,
      });

      // 1. deleteOne hook throws
      await expect(Batch.deleteOne({ _id: sealedBatch._id })).rejects.toThrow(
        /Cannot delete batch "SEALED-BATCH-001" containing sealed original files \(WORM immutability enforcement\)/i
      );

      // 2. deleteMany hook throws
      await expect(Batch.deleteMany({ _id: sealedBatch._id })).rejects.toThrow(
        /Cannot delete batch "SEALED-BATCH-001" containing sealed original files \(WORM immutability enforcement\)/i
      );

      // 3. findOneAndDelete hook throws
      await expect(Batch.findOneAndDelete({ _id: sealedBatch._id })).rejects.toThrow(
        /Cannot delete batch "SEALED-BATCH-001" containing sealed original files \(WORM immutability enforcement\)/i
      );

      // Verify batch still exists intact
      expect(await Batch.findById(sealedBatch._id)).not.toBeNull();
    });

    it('blocks modification of sealed files in a Batch', async () => {
      const prof = await User.create({
        name: 'Prof. Raman',
        email: 'raman2@test.edu',
        password: 'Pass',
        role: UserRole.PROFESSOR,
      });

      const sealedBatch = await Batch.create({
        batchId: 'SEALED-BATCH-002',
        uploadedBy: prof._id,
        files: [
          {
            fileId: 'file-2',
            fileIndex: 0,
            originalFilename: 'scan2.pdf',
            fileType: 'pdf',
            mimeType: 'application/pdf',
            size: 2048,
            pageCount: 3,
            storageKey: 'batches/SEALED-BATCH-002/file-2.pdf',
            hmac: 'b1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90',
            keyId: 'v1',
            sequenceNumber: 1,
          },
        ],
        status: BatchStatus.DONE,
        isActive: true,
      });

      // Attempt to clear or overwrite files array
      await expect(
        Batch.updateOne({ _id: sealedBatch._id }, { $set: { files: [] } })
      ).rejects.toThrow(
        /Cannot modify sealed files in batch "SEALED-BATCH-002" \(WORM immutability enforcement\)/i
      );

      // Verify files remained intact
      const fresh = await Batch.findById(sealedBatch._id);
      expect(fresh?.files).toHaveLength(1);
    });

    it('allows deleting an unsealed batch without sealed files', async () => {
      const prof = await User.create({
        name: 'Prof. Raman',
        email: 'raman3@test.edu',
        password: 'Pass',
        role: UserRole.PROFESSOR,
      });

      const unsealedBatch = await Batch.create({
        batchId: 'UNSEALED-BATCH-001',
        uploadedBy: prof._id,
        files: [],
        status: BatchStatus.QUEUED,
        isActive: true,
      });

      await expect(Batch.deleteOne({ _id: unsealedBatch._id })).resolves.toBeDefined();
      expect(await Batch.findById(unsealedBatch._id)).toBeNull();
    });

    it('blocks deletion of a PUBLISHED exam', async () => {
      const prof = await User.create({
        name: 'Prof. Raman',
        email: 'raman4@test.edu',
        password: 'Pass',
        role: UserRole.PROFESSOR,
      });

      const course = await Course.create({
        courseCode: 'CS303-WORM',
        courseName: 'WORM Testing',
        professor: prof._id,
        semester: 1,
        academicYear: '2026-2027',
      });

      const publishedExam = await Exam.create({
        title: 'Final Examination 2026',
        course: course._id,
        createdBy: prof._id,
        examDate: new Date(),
        numberOfQuestions: 3,
        totalMarks: 30,
        status: ExamStatus.PUBLISHED,
        isActive: true,
      });

      // deleteOne hook throws
      await expect(Exam.deleteOne({ _id: publishedExam._id })).rejects.toThrow(
        /Cannot delete published exam "Final Examination 2026" \(WORM immutability enforcement\)/i
      );

      // findOneAndDelete hook throws
      await expect(Exam.findOneAndDelete({ _id: publishedExam._id })).rejects.toThrow(
        /Cannot delete published exam "Final Examination 2026" \(WORM immutability enforcement\)/i
      );

      // Verify exam still exists
      expect(await Exam.findById(publishedExam._id)).not.toBeNull();
    });

    it('blocks altering course or totalMarks on a PUBLISHED exam', async () => {
      const prof = await User.create({
        name: 'Prof. Raman',
        email: 'raman5@test.edu',
        password: 'Pass',
        role: UserRole.PROFESSOR,
      });

      const courseA = await Course.create({
        courseCode: 'CS404-A',
        courseName: 'Course A',
        professor: prof._id,
        semester: 1,
        academicYear: '2026-2027',
      });

      const courseB = await Course.create({
        courseCode: 'CS404-B',
        courseName: 'Course B',
        professor: prof._id,
        semester: 1,
        academicYear: '2026-2027',
      });

      const publishedExam = await Exam.create({
        title: 'Sealed Grade Exam',
        course: courseA._id,
        createdBy: prof._id,
        examDate: new Date(),
        numberOfQuestions: 2,
        totalMarks: 20,
        status: ExamStatus.PUBLISHED,
        isActive: true,
      });

      // Altering course is rejected
      await expect(
        Exam.updateOne({ _id: publishedExam._id }, { $set: { course: courseB._id } })
      ).rejects.toThrow(
        /Cannot alter course of published exam "Sealed Grade Exam" \(WORM immutability enforcement\)/i
      );

      // Altering totalMarks is rejected
      await expect(
        Exam.updateOne({ _id: publishedExam._id }, { $set: { totalMarks: 100 } })
      ).rejects.toThrow(
        /Cannot update totalMarks on published exam "Sealed Grade Exam" \(WORM immutability enforcement\)/i
      );
    });
  });

  describe('6. Ingestion Read-Path Integrity Verification & INTEGRITY_MISMATCH Auditing', () => {
    it('readOriginalContent verifies HMAC seal and throws with INTEGRITY_MISMATCH on file tamper', async () => {
      const storageService = new ImmutableStorageService();
      const content = Buffer.from('Original Sealed Batch Scan Bytes', 'utf-8');

      const prof = await User.create({
        name: 'Prof. Raman',
        email: 'raman6@test.edu',
        password: 'Pass',
        role: UserRole.PROFESSOR,
      });

      const stored = await storageService.storeOriginal({
        batchId: 'BATCH-READ-VERIFY',
        fileId: 'file-read-1',
        sequenceNumber: 1,
        uploader: prof._id.toString(),
        timestamp: 1700000000000,
        buffer: content,
        originalFilename: 'page.pdf',
        fileExtension: 'pdf',
      });

      // Record in Batch document in MongoDB (as Ingestion worker expects)
      await Batch.create({
        batchId: 'BATCH-READ-VERIFY',
        uploadedBy: prof._id,
        files: [
          {
            fileId: stored.fileId,
            fileIndex: 0,
            originalFilename: 'page.pdf',
            fileType: 'pdf',
            mimeType: 'application/pdf',
            size: stored.size,
            pageCount: 1,
            storageKey: stored.storageKey,
            hmac: stored.hmac,
            keyId: stored.keyId,
            sequenceNumber: stored.sequenceNumber,
            integrityMetadata: stored.integrityMetadata,
          },
        ],
        status: BatchStatus.PROCESSING,
        isActive: true,
      });

      // 1. Untampered read succeeds via readOriginalContent
      const cleanBuffer = await storageService.readOriginalContent(stored.storageKey);
      expect(cleanBuffer.equals(content)).toBe(true);

      // 2. Tamper with the physical file on disk (flip 1 byte)
      const diskPath = path.join(testStorageDir, 'BATCH-READ-VERIFY', 'file-read-1.pdf');
      const tamperedBytes = Buffer.from(content);
      tamperedBytes[0] = tamperedBytes[0] ^ 0xFF;
      await fs.promises.writeFile(diskPath, tamperedBytes);

      // 3. readOriginalContent detects tamper, throws 500, and logs INTEGRITY_MISMATCH
      auditCalls.length = 0;
      await expect(storageService.readOriginalContent(stored.storageKey)).rejects.toThrow(
        /Original file integrity verification failed: HMAC signature verification failed/i
      );

      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0]).toMatchObject({
        action: 'INTEGRITY_MISMATCH',
        outcome: 'FAILURE',
        entityType: 'OriginalStorage',
        details: {
          storageKey: stored.storageKey,
          batchId: 'BATCH-READ-VERIFY',
          fileId: 'file-read-1',
        },
      });

      // 4. readOriginal also throws and logs INTEGRITY_MISMATCH
      auditCalls.length = 0;
      await expect(
        storageService.readOriginal(stored.storageKey, prof._id.toString(), 'PROFESSOR')
      ).rejects.toThrow(/Original file integrity verification failed/i);

      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0].action).toBe('INTEGRITY_MISMATCH');
    });
  });
});
