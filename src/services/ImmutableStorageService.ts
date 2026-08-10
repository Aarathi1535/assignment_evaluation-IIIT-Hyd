import fs from 'fs';
import path from 'path';
import { IBatch, IBatchFile, IBindingMetadata } from '../models/Batch';
import BatchRepository from '../repositories/BatchRepository';
import { generateHmacSeal, verifyHmacSeal, HmacSealResult } from '../utils/hmacStorage';
import { writeAuditLog } from '../lib/audit';
import { HttpError } from '../lib/errors';

export interface AuditContext {
    actingUserId?: string;
    actingUserRole?: string;
    ipAddress?: string;
}

export interface StoreOriginalInput {
    batchId: string;
    fileId: string;
    sequenceNumber: number;
    uploader: string;
    timestamp?: number;
    buffer: Buffer;
    originalFilename: string;
    fileExtension: string;
    context?: AuditContext;
}

export interface StoredOriginalResult {
    fileId: string;
    storageKey: string;
    storagePath: string;
    hmac: string;
    keyId: string;
    sequenceNumber: number;
    integrityMetadata: IBindingMetadata;
    size: number;
}

export class ImmutableStorageService {
    getStorageRoot(): string {
        return process.env.ORIGINAL_STORAGE_PATH || path.join(process.cwd(), 'data', 'originals');
    }

    /**
     * Stores an original file immutably on disk, computes its HMAC integrity seal with metadata binding,
     * and guarantees that previously stored originals cannot be overwritten.
     */
    async storeOriginal(input: StoreOriginalInput): Promise<StoredOriginalResult> {
        const {
            batchId,
            fileId,
            sequenceNumber,
            uploader,
            timestamp = Date.now(),
            buffer,
            fileExtension,
            context
        } = input;

        const storageRoot = this.getStorageRoot();
        const batchDir = path.join(storageRoot, batchId);
        const fileName = `${fileId}.${fileExtension}`;
        const filePath = path.join(batchDir, fileName);
        const storageKey = `batches/${batchId}/${fileName}`;

        // Reject if target file already exists (application-layer immutability)
        if (fs.existsSync(filePath)) {
            throw new HttpError(
                `Original file with key "${storageKey}" already exists and cannot be overwritten (immutable storage).`,
                409
            );
        }

        // Ensure target directory exists
        await fs.promises.mkdir(batchDir, { recursive: true });

        try {
            // Step 1: Write file with 'wx' flag to guarantee non-overwrite at filesystem level
            await fs.promises.writeFile(filePath, buffer, { flag: 'wx' });

            // Step 2: Generate HMAC seal covering file bytes + binding metadata
            const metadata: IBindingMetadata = {
                batchId,
                sequenceNumber,
                uploader,
                timestamp
            };

            const sealResult: HmacSealResult = generateHmacSeal(buffer, metadata);

            // Step 3: Record audit log for storage operation
            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'STORAGE_ORIGINAL_WRITTEN',
                    outcome: 'SUCCESS',
                    entityType: 'OriginalStorage',
                    details: {
                        batchId,
                        fileId,
                        storageKey,
                        size: buffer.length,
                        keyId: sealResult.keyId
                    },
                    ipAddress: context.ipAddress
                });
            }

            return {
                fileId,
                storageKey,
                storagePath: filePath,
                hmac: sealResult.hmac,
                keyId: sealResult.keyId,
                sequenceNumber,
                integrityMetadata: metadata,
                size: buffer.length
            };
        } catch (error) {
            // Partial failure cleanup: remove partially written file from disk
            try {
                if (fs.existsSync(filePath)) {
                    await fs.promises.unlink(filePath);
                }
            } catch (cleanupErr) {
                console.error(`Failed to cleanup partial file at "${filePath}":`, cleanupErr);
            }

            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'STORAGE_ORIGINAL_WRITTEN',
                    outcome: 'FAILURE',
                    entityType: 'OriginalStorage',
                    details: {
                        batchId,
                        fileId,
                        storageKey,
                        error: error instanceof Error ? error.message : 'Unknown storage error'
                    },
                    ipAddress: context.ipAddress
                });
            }

            throw error;
        }
    }

    /**
     * Reads a stored original file and verifies its cryptographic HMAC tamper-evidence seal.
     * Enforces repository-level ownership scoping.
     */
    async readOriginal(
        storageKey: string,
        actingUserId?: string,
        actingUserRole?: string
    ): Promise<{ buffer: Buffer; file: IBatchFile; batch: IBatch }> {
        // Enforce repository-level authorization
        const result = await BatchRepository.getBatchByStorageKey(storageKey, actingUserId, actingUserRole);
        if (!result) {
            throw new HttpError('Original file not found or access denied', 404);
        }

        const { batch, file } = result;

        // Resolve disk location
        const storageRoot = this.getStorageRoot();
        const filePath = path.join(storageRoot, file.storageKey.replace(/^batches\//, ''));

        let buffer: Buffer;
        try {
            buffer = await fs.promises.readFile(filePath);
        } catch {
            throw new HttpError('Original file content not found on storage backend', 404);
        }

        // Verify HMAC integrity if seal metadata is present
        if (file.hmac && file.integrityMetadata) {
            const verification = verifyHmacSeal(
                buffer,
                file.integrityMetadata,
                file.hmac,
                file.keyId
            );

            if (!verification.valid) {
                throw new HttpError(
                    `Original file integrity verification failed: ${verification.reason}`,
                    500
                );
            }
        }

        return { buffer, file, batch };
    }

    /**
     * Internal integrity verification utility without public API exposure.
     */
    verifyOriginalIntegrity(
        buffer: Buffer,
        file: IBatchFile,
        customSecret?: string
    ): { valid: boolean; reason?: string } {
        if (!file.hmac || !file.integrityMetadata) {
            return { valid: false, reason: 'HMAC seal or integrity metadata missing on record' };
        }

        return verifyHmacSeal(
            buffer,
            file.integrityMetadata,
            file.hmac,
            file.keyId,
            customSecret
        );
    }

    /**
     * Helper to clean up batch files in case of complete batch failure or test teardown.
     */
    async cleanupBatch(batchId: string): Promise<void> {
        const batchDir = path.join(this.getStorageRoot(), batchId);
        try {
            if (fs.existsSync(batchDir)) {
                await fs.promises.rm(batchDir, { recursive: true, force: true });
            }
        } catch (err) {
            console.error(`Failed to cleanup batch directory at "${batchDir}":`, err);
        }
    }
}

const immutableStorageService = new ImmutableStorageService();
export default immutableStorageService;
