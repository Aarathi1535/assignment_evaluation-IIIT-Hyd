/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog';
import BatchRepository from '../repositories/BatchRepository';
import ImmutableStorageService from '../services/ImmutableStorageService';
import {
    generateHmacSeal,
    verifyHmacSeal,
    getHmacSecret,
    serializeBindingMetadata
} from '../utils/hmacStorage';

describe('Immutable Original Storage & HMAC Tamper Evidence (AE-043)', () => {
    const testStorageDir = path.join(process.cwd(), 'data', 'test_originals');
    const professorId = new mongoose.Types.ObjectId().toString();
    const otherProfessorId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();
    const studentId = new mongoose.Types.ObjectId().toString();
    const taId = new mongoose.Types.ObjectId().toString();

    const originalSecret = process.env.ORIGINAL_STORAGE_HMAC_SECRET;
    const originalKeyId = process.env.ORIGINAL_STORAGE_KEY_ID;

    beforeEach(async () => {
        process.env.ORIGINAL_STORAGE_PATH = testStorageDir;
        process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'test-secure-hmac-secret-32-chars-long';
        process.env.ORIGINAL_STORAGE_KEY_ID = 'v1';

        await fs.promises.mkdir(testStorageDir, { recursive: true });
    });

    afterEach(async () => {
        process.env.ORIGINAL_STORAGE_HMAC_SECRET = originalSecret;
        process.env.ORIGINAL_STORAGE_KEY_ID = originalKeyId;

        try {
            if (fs.existsSync(testStorageDir)) {
                await fs.promises.rm(testStorageDir, { recursive: true, force: true });
            }
        } catch {
            // ignore
        }
    });

    describe('1. Configuration & Startup Safety', () => {
        it('should fail when HMAC secret is missing or empty', () => {
            delete process.env.ORIGINAL_STORAGE_HMAC_SECRET;

            expect(() => getHmacSecret()).toThrow(
                'ORIGINAL_STORAGE_HMAC_SECRET is missing or not configured'
            );
        });

        it('should load HMAC secret and key ID from environment configuration', () => {
            process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'custom-configured-secret-123';
            process.env.ORIGINAL_STORAGE_KEY_ID = 'v2-prod';

            const config = getHmacSecret();
            expect(config.secret).toBe('custom-configured-secret-123');
            expect(config.keyId).toBe('v2-prod');
        });

        it('should support key rotation lookup for older key IDs', () => {
            process.env.ORIGINAL_STORAGE_KEY_ID = 'v2';
            process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'v2-active-secret-key';
            process.env.ORIGINAL_STORAGE_HMAC_SECRET_V1 = 'v1-legacy-secret-key';

            // Lookup v1 should resolve the rotated legacy key
            const legacy = getHmacSecret('v1');
            expect(legacy.secret).toBe('v1-legacy-secret-key');
            expect(legacy.keyId).toBe('v1');

            // Lookup active v2
            const active = getHmacSecret('v2');
            expect(active.secret).toBe('v2-active-secret-key');
        });

        it('should throw key-unavailable error when historical key ID secret is not configured rather than falling back to active secret', () => {
            process.env.ORIGINAL_STORAGE_KEY_ID = 'v2';
            process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'v2-active-secret-key';
            delete process.env.ORIGINAL_STORAGE_HMAC_SECRET_V1;

            expect(() => getHmacSecret('v1')).toThrow(
                'HMAC secret for key ID "v1" is unavailable or not configured (ORIGINAL_STORAGE_HMAC_SECRET_V1)'
            );
        });

        it('should fail verification when verifying an original sealed with an unavailable historical key ID', () => {
            process.env.ORIGINAL_STORAGE_KEY_ID = 'v2';
            process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'v2-active-secret-key';
            delete process.env.ORIGINAL_STORAGE_HMAC_SECRET_V0;

            const content = Buffer.from('Historical file bytes', 'utf-8');
            const metadata = {
                batchId: 'batch-hist',
                sequenceNumber: 1,
                uploader: professorId,
                timestamp: 1500000000000
            };

            const verification = verifyHmacSeal(content, metadata, 'some-hmac-seal', 'v0');
            expect(verification.valid).toBe(false);
            expect(verification.reason).toContain('HMAC secret for key ID "v0" is unavailable or not configured');
        });
    });

    describe('2. HMAC Generation & Binding Metadata', () => {
        it('should generate HMAC seal covering file content and all required binding metadata', () => {
            const content = Buffer.from('Original student answer script content', 'utf-8');
            const metadata = {
                batchId: 'batch-abc-123',
                sequenceNumber: 1,
                uploader: professorId,
                timestamp: 1700000000000
            };

            const sealResult = generateHmacSeal(content, metadata, 'v1', 'test-secret');

            expect(sealResult.hmac).toBeDefined();
            expect(typeof sealResult.hmac).toBe('string');
            expect(sealResult.hmac.length).toBe(64); // SHA-256 hex
            expect(sealResult.keyId).toBe('v1');
            expect(sealResult.metadata).toEqual(metadata);
        });

        it('should produce deterministic serialization of metadata', () => {
            const metadata = {
                batchId: 'batch-xyz',
                sequenceNumber: 2,
                uploader: 'user-123',
                timestamp: 1690000000000
            };

            const serialized1 = serializeBindingMetadata(metadata);
            const serialized2 = serializeBindingMetadata(metadata);

            expect(serialized1).toBe(serialized2);
            expect(serialized1).toBe('batchId=batch-xyz&seq=2&uploader=user-123&ts=1690000000000');
        });

        it('should verify successfully when content and metadata match', () => {
            const content = Buffer.from('Untampered PDF bytes', 'utf-8');
            const metadata = {
                batchId: 'batch-101',
                sequenceNumber: 1,
                uploader: professorId,
                timestamp: 1700000000000
            };

            const { hmac, keyId } = generateHmacSeal(content, metadata, 'v1', 'test-secret');
            const result = verifyHmacSeal(content, metadata, hmac, keyId, 'test-secret');

            expect(result.valid).toBe(true);
            expect(result.reason).toBeUndefined();
        });

        it('should fail verification when file content is modified (tamper detection)', () => {
            const originalContent = Buffer.from('Legitimate exam marks: 95', 'utf-8');
            const tamperedContent = Buffer.from('Forged exam marks: 100', 'utf-8');

            const metadata = {
                batchId: 'batch-101',
                sequenceNumber: 1,
                uploader: professorId,
                timestamp: 1700000000000
            };

            const { hmac, keyId } = generateHmacSeal(originalContent, metadata, 'v1', 'test-secret');
            const result = verifyHmacSeal(tamperedContent, metadata, hmac, keyId, 'test-secret');

            expect(result.valid).toBe(false);
            expect(result.reason).toContain('tamper detected');
        });

        it('should fail verification when batch ID is modified', () => {
            const content = Buffer.from('Document bytes', 'utf-8');
            const metadata = {
                batchId: 'original-batch-id',
                sequenceNumber: 1,
                uploader: professorId,
                timestamp: 1700000000000
            };

            const { hmac, keyId } = generateHmacSeal(content, metadata, 'v1', 'test-secret');

            const tamperedMeta = { ...metadata, batchId: 'swapped-batch-id' };
            const result = verifyHmacSeal(content, tamperedMeta, hmac, keyId, 'test-secret');

            expect(result.valid).toBe(false);
            expect(result.reason).toContain('tamper detected');
        });

        it('should fail verification when sequence number is modified', () => {
            const content = Buffer.from('Document bytes', 'utf-8');
            const metadata = {
                batchId: 'batch-1',
                sequenceNumber: 1,
                uploader: professorId,
                timestamp: 1700000000000
            };

            const { hmac, keyId } = generateHmacSeal(content, metadata, 'v1', 'test-secret');

            const tamperedMeta = { ...metadata, sequenceNumber: 2 };
            const result = verifyHmacSeal(content, tamperedMeta, hmac, keyId, 'test-secret');

            expect(result.valid).toBe(false);
            expect(result.reason).toContain('tamper detected');
        });

        it('should fail verification when uploader is modified', () => {
            const content = Buffer.from('Document bytes', 'utf-8');
            const metadata = {
                batchId: 'batch-1',
                sequenceNumber: 1,
                uploader: professorId,
                timestamp: 1700000000000
            };

            const { hmac, keyId } = generateHmacSeal(content, metadata, 'v1', 'test-secret');

            const tamperedMeta = { ...metadata, uploader: otherProfessorId };
            const result = verifyHmacSeal(content, tamperedMeta, hmac, keyId, 'test-secret');

            expect(result.valid).toBe(false);
            expect(result.reason).toContain('tamper detected');
        });

        it('should fail verification when timestamp is modified', () => {
            const content = Buffer.from('Document bytes', 'utf-8');
            const metadata = {
                batchId: 'batch-1',
                sequenceNumber: 1,
                uploader: professorId,
                timestamp: 1700000000000
            };

            const { hmac, keyId } = generateHmacSeal(content, metadata, 'v1', 'test-secret');

            const tamperedMeta = { ...metadata, timestamp: 1700000099999 };
            const result = verifyHmacSeal(content, tamperedMeta, hmac, keyId, 'test-secret');

            expect(result.valid).toBe(false);
            expect(result.reason).toContain('tamper detected');
        });

        it('should fail verification when seals are swapped between two valid originals', () => {
            const contentA = Buffer.from('File A content', 'utf-8');
            const metaA = { batchId: 'batch-A', sequenceNumber: 1, uploader: professorId, timestamp: 1000 };
            const sealA = generateHmacSeal(contentA, metaA, 'v1', 'test-secret');

            const contentB = Buffer.from('File B content', 'utf-8');
            const metaB = { batchId: 'batch-B', sequenceNumber: 1, uploader: professorId, timestamp: 2000 };

            // Attempt to verify File B using File A's seal
            const result = verifyHmacSeal(contentB, metaB, sealA.hmac, 'v1', 'test-secret');
            expect(result.valid).toBe(false);
        });
    });

    describe('3. Immutable Storage Layer & Overwrite Prevention', () => {
        it('should store an original file on disk with HMAC seal and metadata', async () => {
            const batchId = crypto.randomUUID();
            const fileId = crypto.randomUUID();
            const buffer = Buffer.from('%PDF-1.4 sample file content', 'utf-8');

            const stored = await ImmutableStorageService.storeOriginal({
                batchId,
                fileId,
                sequenceNumber: 1,
                uploader: professorId,
                buffer,
                originalFilename: 'scan.pdf',
                fileExtension: 'pdf',
                context: { actingUserId: professorId, actingUserRole: 'PROFESSOR' }
            });

            expect(stored.fileId).toBe(fileId);
            expect(stored.storageKey).toBe(`batches/${batchId}/${fileId}.pdf`);
            expect(stored.hmac).toBeDefined();
            expect(stored.keyId).toBe('v1');
            expect(stored.sequenceNumber).toBe(1);
            expect(stored.integrityMetadata.batchId).toBe(batchId);
            expect(fs.existsSync(stored.storagePath)).toBe(true);

            const fileBytes = await fs.promises.readFile(stored.storagePath);
            expect(fileBytes.equals(buffer)).toBe(true);

            // Audit log check
            const auditLog = await AuditLog.findOne({
                action: 'STORAGE_ORIGINAL_WRITTEN',
                outcome: 'SUCCESS',
                user: new mongoose.Types.ObjectId(professorId)
            });
            expect(auditLog).not.toBeNull();
            expect(auditLog!.details).toMatchObject({
                batchId,
                fileId,
                keyId: 'v1'
            });
        });

        it('should reject application-layer overwrite attempts against an existing original', async () => {
            const batchId = crypto.randomUUID();
            const fileId = crypto.randomUUID();
            const buffer = Buffer.from('Original content', 'utf-8');

            await ImmutableStorageService.storeOriginal({
                batchId,
                fileId,
                sequenceNumber: 1,
                uploader: professorId,
                buffer,
                originalFilename: 'scan.pdf',
                fileExtension: 'pdf'
            });

            // Second store attempt with identical fileId/path must be rejected
            await expect(
                ImmutableStorageService.storeOriginal({
                    batchId,
                    fileId,
                    sequenceNumber: 1,
                    uploader: professorId,
                    buffer: Buffer.from('Modified overwrite attempt', 'utf-8'),
                    originalFilename: 'scan.pdf',
                    fileExtension: 'pdf'
                })
            ).rejects.toMatchObject({
                statusCode: 409,
                message: expect.stringContaining('cannot be overwritten (immutable storage)')
            });
        });

        it('should clean up partially written file if a later stage fails', async () => {
            const batchId = crypto.randomUUID();
            const fileId = crypto.randomUUID();
            const buffer = Buffer.from('Content to fail', 'utf-8');

            // Force failure during storage by deleting the HMAC secret
            delete process.env.ORIGINAL_STORAGE_HMAC_SECRET;

            await expect(
                ImmutableStorageService.storeOriginal({
                    batchId,
                    fileId,
                    sequenceNumber: 1,
                    uploader: professorId,
                    buffer,
                    originalFilename: 'scan.pdf',
                    fileExtension: 'pdf',
                    context: { actingUserId: professorId }
                })
            ).rejects.toThrow();

            // Verify the file was cleaned up and does not remain on disk
            const expectedPath = path.join(testStorageDir, batchId, `${fileId}.pdf`);
            expect(fs.existsSync(expectedPath)).toBe(false);

            // Verify FAILURE audit log was recorded
            const failAudit = await AuditLog.findOne({
                action: 'STORAGE_ORIGINAL_WRITTEN',
                outcome: 'FAILURE'
            });
            expect(failAudit).not.toBeNull();
        });
    });

    describe('4. Repository-Level Authorization & Read Scoping', () => {
        async function setupBatchWithStoredOriginal(ownerId: string) {
            const batchId = crypto.randomUUID();
            const fileId = crypto.randomUUID();
            const buffer = Buffer.from('%PDF-1.4 test original script', 'utf-8');

            const stored = await ImmutableStorageService.storeOriginal({
                batchId,
                fileId,
                sequenceNumber: 1,
                uploader: ownerId,
                buffer,
                originalFilename: 'student_answer.pdf',
                fileExtension: 'pdf'
            });

            const batch = await BatchRepository.createBatch({
                batchId,
                uploadedBy: new mongoose.Types.ObjectId(ownerId),
                files: [
                    {
                        fileId,
                        fileIndex: 0,
                        originalFilename: 'student_answer.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: buffer.length,
                        pageCount: 1,
                        storageKey: stored.storageKey,
                        hmac: stored.hmac,
                        keyId: stored.keyId,
                        sequenceNumber: stored.sequenceNumber,
                        integrityMetadata: stored.integrityMetadata
                    }
                ],
                totalFiles: 1,
                totalSize: buffer.length,
                totalPageCount: 1,
                status: 'queued' as any,
                isActive: true
            });

            return { batch, stored, buffer, storageKey: stored.storageKey };
        }

        it('should allow owner professor to read stored original and verify integrity', async () => {
            const { storageKey, buffer } = await setupBatchWithStoredOriginal(professorId);

            const result = await ImmutableStorageService.readOriginal(storageKey, professorId, 'PROFESSOR');
            expect(result).not.toBeNull();
            expect(result.buffer.equals(buffer)).toBe(true);
            expect(result.file.storageKey).toBe(storageKey);
        });

        it('should allow ADMIN to read any stored original', async () => {
            const { storageKey } = await setupBatchWithStoredOriginal(professorId);

            const result = await ImmutableStorageService.readOriginal(storageKey, adminId, 'ADMIN');
            expect(result).not.toBeNull();
            expect(result.file.storageKey).toBe(storageKey);
        });

        it('should deny a second professor access to someone else’s original (returns 404)', async () => {
            const { storageKey } = await setupBatchWithStoredOriginal(professorId);

            await expect(
                ImmutableStorageService.readOriginal(storageKey, otherProfessorId, 'PROFESSOR')
            ).rejects.toMatchObject({
                statusCode: 404,
                message: expect.stringContaining('Original file not found or access denied')
            });
        });

        it('should deny STUDENT and TA access to stored originals (returns 404)', async () => {
            const { storageKey } = await setupBatchWithStoredOriginal(professorId);

            await expect(
                ImmutableStorageService.readOriginal(storageKey, studentId, 'STUDENT')
            ).rejects.toMatchObject({
                statusCode: 404,
                message: expect.stringContaining('Original file not found or access denied')
            });

            await expect(
                ImmutableStorageService.readOriginal(storageKey, taId, 'TA')
            ).rejects.toMatchObject({
                statusCode: 404,
                message: expect.stringContaining('Original file not found or access denied')
            });
        });

        it('should deny unauthenticated and unknown role access (deny-by-default)', async () => {
            const { storageKey } = await setupBatchWithStoredOriginal(professorId);

            await expect(
                ImmutableStorageService.readOriginal(storageKey, undefined, undefined)
            ).rejects.toMatchObject({
                statusCode: 404
            });

            await expect(
                ImmutableStorageService.readOriginal(storageKey, 'unknown-user', 'GUEST')
            ).rejects.toMatchObject({
                statusCode: 404
            });
        });

        it('should detect on-disk tampering when readOriginal is invoked', async () => {
            const { storageKey, stored } = await setupBatchWithStoredOriginal(professorId);

            // Tamper directly with the file on disk
            await fs.promises.writeFile(stored.storagePath, Buffer.from('Tampered content on disk', 'utf-8'));

            await expect(
                ImmutableStorageService.readOriginal(storageKey, professorId, 'PROFESSOR')
            ).rejects.toMatchObject({
                statusCode: 500,
                message: expect.stringContaining('tamper detected')
            });
        });
    });
});
