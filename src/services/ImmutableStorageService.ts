import fs from 'fs';
import path from 'path';
import { IBatch, IBatchFile, IBindingMetadata } from '../models/Batch';
import BatchRepository from '../repositories/BatchRepository';
import { generateHmacSeal, verifyHmacSeal, HmacSealResult } from '../utils/hmacStorage';
import { writeAuditLog } from '../lib/audit';
import { HttpError } from '../lib/errors';
import { getConfiguredStorageBucket } from '../lib/cloudStorage';

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
     * Stores an original file immutably, computes its HMAC integrity seal with metadata binding,
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

        const fileName = `${fileId}.${fileExtension}`;
        const storageKey = `batches/${batchId}/${fileName}`;
        const bucket = getConfiguredStorageBucket();
        const storageRoot = bucket ? null : this.getStorageRoot();
        const batchDir = storageRoot ? path.join(storageRoot, batchId) : null;
        const filePath = batchDir ? path.join(batchDir, fileName) : null;
        const cloudFile = bucket?.file(storageKey);
        let cloudObjectWritten = false;

        if (filePath && fs.existsSync(filePath)) {
            throw new HttpError(
                `Original file with key "${storageKey}" already exists and cannot be overwritten (immutable storage).`,
                409
            );
        }

        try {
            const metadata: IBindingMetadata = {
                batchId,
                sequenceNumber,
                uploader,
                timestamp
            };

            const sealResult: HmacSealResult = generateHmacSeal(buffer, metadata);

            if (cloudFile) {
                await cloudFile.save(buffer, {
                    resumable: false,
                    preconditionOpts: { ifGenerationMatch: 0 },
                    metadata: { contentType: this.getContentType(fileExtension) }
                });
                cloudObjectWritten = true;
            } else if (batchDir && filePath) {
                await fs.promises.mkdir(batchDir, { recursive: true });
                await fs.promises.writeFile(filePath, buffer, { flag: 'wx' });
            }

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
                storagePath: bucket ? `gs://${bucket.name}/${storageKey}` : filePath!,
                hmac: sealResult.hmac,
                keyId: sealResult.keyId,
                sequenceNumber,
                integrityMetadata: metadata,
                size: buffer.length
            };
        } catch (error) {
            const errorCode = (error as { code?: number | string })?.code;
            if (errorCode === 412 || errorCode === '412') {
                throw new HttpError(
                    `Original file with key "${storageKey}" already exists and cannot be overwritten (immutable storage).`,
                    409
                );
            }

            try {
                if (filePath && fs.existsSync(filePath)) {
                    await fs.promises.unlink(filePath);
                }
            } catch (cleanupErr) {
                console.error(`Failed to cleanup partial file at "${filePath}":`, cleanupErr);
            }
            if (cloudObjectWritten && cloudFile) {
                try {
                    await cloudFile.delete({ ignoreNotFound: true });
                } catch (cleanupErr) {
                    console.error(`Failed to cleanup partial GCS object at "${storageKey}":`, cleanupErr);
                }
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

        let buffer: Buffer;
        try {
            buffer = await this.readOriginalContent(file.storageKey);
        } catch (error) {
            const errorCode = (error as { code?: number | string })?.code;
            if (errorCode === 404 || errorCode === '404' || errorCode === 'ENOENT') {
                throw new HttpError('Original file content not found on storage backend', 404);
            }
            throw error;
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

    async readOriginalContent(storageKey: string): Promise<Buffer> {
        const bucket = getConfiguredStorageBucket();
        if (bucket) {
            const [buffer] = await bucket.file(storageKey).download();
            return buffer;
        }

        const filePath = path.join(this.getStorageRoot(), storageKey.replace(/^batches\//, ''));
        return fs.promises.readFile(filePath);
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

    private getContentType(extension: string): string {
        switch (extension.toLowerCase()) {
            case 'pdf':
                return 'application/pdf';
            case 'png':
                return 'image/png';
            case 'jpg':
            case 'jpeg':
                return 'image/jpeg';
            case 'webp':
                return 'image/webp';
            default:
                return 'application/octet-stream';
        }
    }
}

const immutableStorageService = new ImmutableStorageService();
export default immutableStorageService;
