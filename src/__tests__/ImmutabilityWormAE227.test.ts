/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  generateHmacSeal,
  verifyHmacSeal,
  getHmacSecret,
  serializeBindingMetadata,
} from '../utils/hmacStorage';
import immutableStorageService, { ImmutableStorageService } from '../services/ImmutableStorageService';
import { HttpError } from '../lib/errors';
import { IBindingMetadata } from '../models/Batch';

describe('AE-227: Immutability and WORM Enforcement for Sealed Assets', () => {
  const testStorageDir = path.join(process.cwd(), 'data', 'test_worm_originals');
  let originalStoragePath: string | undefined;
  let originalSecret: string | undefined;
  let originalKeyId: string | undefined;
  let originalV2Secret: string | undefined;

  beforeEach(async () => {
    originalStoragePath = process.env.ORIGINAL_STORAGE_PATH;
    originalSecret = process.env.ORIGINAL_STORAGE_HMAC_SECRET;
    originalKeyId = process.env.ORIGINAL_STORAGE_KEY_ID;
    originalV2Secret = process.env.ORIGINAL_STORAGE_HMAC_SECRET_V2;

    process.env.ORIGINAL_STORAGE_PATH = testStorageDir;
    process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'test-top-secret-hmac-worm-key-32bytes!';
    process.env.ORIGINAL_STORAGE_KEY_ID = 'v1';

    await fs.promises.mkdir(testStorageDir, { recursive: true });
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
      // Historical key 'v99' has no environment variable configured
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
});
