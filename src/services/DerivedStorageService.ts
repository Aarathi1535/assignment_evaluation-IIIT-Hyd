import fs from 'fs';
import path from 'path';
import { Readable } from 'node:stream';
import { getConfiguredStorageBucket } from '../lib/cloudStorage';

export { CloudStorageConfigurationError as DerivedStorageConfigurationError } from '../lib/cloudStorage';

export interface StoreDerivedPageInput {
    batchId: string;
    fileId: string;
    pageNumber: number;
    buffer: Buffer;
    format?: string;
}

export interface StoredDerivedPageResult {
    storageKey: string;
    storagePath: string;
    size: number;
}

export interface IDerivedStorageService {
    storeDerivedPage(input: StoreDerivedPageInput): Promise<StoredDerivedPageResult>;
    getDerivedPageKey(batchId: string, fileId: string, pageNumber: number, format?: string): string;
    storeDerivedThumbnail(input: StoreDerivedPageInput): Promise<StoredDerivedPageResult>;
    getDerivedThumbnailKey(batchId: string, fileId: string, pageNumber: number, format?: string): string;
    readDerivedPage?(storageKey: string): Promise<Buffer>;
    openDerivedPage?(storageKey: string): Promise<{ stream: Readable; size: number }>;
}

export class DerivedStorageService implements IDerivedStorageService {
    getStorageRoot(): string {
        return process.env.DERIVED_STORAGE_PATH || path.join(process.cwd(), 'data', 'derived');
    }

    /**
     * Deterministic storage key for a derived page image:
     * batches/{batchId}/derived/{fileId}/{pageNumber}/page.{format}
     */
    getDerivedPageKey(batchId: string, fileId: string, pageNumber: number, format = 'png'): string {
        return `batches/${batchId}/derived/${fileId}/${pageNumber}/page.${format}`;
    }

    /**
     * Deterministic storage key for a derived thumbnail:
     * batches/{batchId}/derived/{fileId}/{pageNumber}/thumb.{format}
     */
    getDerivedThumbnailKey(batchId: string, fileId: string, pageNumber: number, format = 'jpg'): string {
        return `batches/${batchId}/derived/${fileId}/${pageNumber}/thumb.${format}`;
    }

    /**
     * Resolves the full disk path for a derived asset key.
     */
    getDerivedDiskPath(storageKey: string): string {
        const storageRoot = this.getStorageRoot();
        const relative = storageKey.replace(/^batches\//, '');
        return path.join(storageRoot, relative);
    }

    /**
     * Stores a derived normalized page image mutably on disk with deterministic keying.
     * Retries idempotently overwrite the existing asset without WORM or HMAC locking.
     */
    async storeDerivedPage(input: StoreDerivedPageInput): Promise<StoredDerivedPageResult> {
        const { batchId, fileId, pageNumber, buffer, format = 'png' } = input;
        const storageKey = this.getDerivedPageKey(batchId, fileId, pageNumber, format);
        const bucket = getConfiguredStorageBucket();
        if (bucket) {
            const file = bucket.file(storageKey);
            console.info('[DerivedStorageService] Writing derived page to GCS', {
                bucket: bucket.name,
                storageKey,
                bufferSize: buffer.length,
                status: 'started',
            });
            try {
                await file.save(buffer, {
                    resumable: false,
                    metadata: { contentType: this.getContentType(format) }
                });
            } catch (error) {
                console.error('[DerivedStorageService] Failed to write derived page to GCS', {
                    bucket: bucket.name,
                    storageKey,
                    bufferSize: buffer.length,
                    success: false,
                    error: error instanceof Error
                        ? { name: error.name, message: error.message, stack: error.stack }
                        : error,
                });
                throw error;
            }
            console.info('[DerivedStorageService] Wrote derived page to GCS', {
                bucket: bucket.name,
                storageKey,
                bufferSize: buffer.length,
                success: true,
            });
            return {
                storageKey,
                storagePath: `gs://${bucket.name}/${storageKey}`,
                size: buffer.length
            };
        }

        const filePath = this.getDerivedDiskPath(storageKey);
        const dir = path.dirname(filePath);

        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(filePath, buffer);

        return {
            storageKey,
            storagePath: filePath,
            size: buffer.length
        };
    }

    /**
     * Stores a derived thumbnail mutably on disk with deterministic keying:
     * batches/{batchId}/derived/{fileId}/{pageNumber}/thumb.{format}
     */
    async storeDerivedThumbnail(input: StoreDerivedPageInput): Promise<StoredDerivedPageResult> {
        const { batchId, fileId, pageNumber, buffer, format = 'jpg' } = input;
        const storageKey = this.getDerivedThumbnailKey(batchId, fileId, pageNumber, format);
        const bucket = getConfiguredStorageBucket();
        if (bucket) {
            await bucket.file(storageKey).save(buffer, {
                resumable: false,
                metadata: { contentType: this.getContentType(format) }
            });
            return {
                storageKey,
                storagePath: `gs://${bucket.name}/${storageKey}`,
                size: buffer.length
            };
        }

        const filePath = this.getDerivedDiskPath(storageKey);
        const dir = path.dirname(filePath);

        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(filePath, buffer);

        return {
            storageKey,
            storagePath: filePath,
            size: buffer.length
        };
    }

    /**
     * Reads a stored derived page image or thumbnail from disk.
     */
    async readDerivedPage(storageKey: string): Promise<Buffer> {
        const bucket = getConfiguredStorageBucket();
        if (bucket) {
            const [buffer] = await bucket.file(storageKey).download();
            return buffer;
        }

        const filePath = this.getDerivedDiskPath(storageKey);
        return await fs.promises.readFile(filePath);
    }

    async openDerivedPage(storageKey: string): Promise<{ stream: Readable; size: number }> {
        const bucket = getConfiguredStorageBucket();
        if (bucket) {
            const file = bucket.file(storageKey);
            const [metadata] = await file.getMetadata();
            return {
                stream: file.createReadStream(),
                size: Number(metadata.size),
            };
        }

        const filePath = this.getDerivedDiskPath(storageKey);
        const metadata = await fs.promises.stat(filePath);
        return {
            stream: fs.createReadStream(filePath),
            size: metadata.size,
        };
    }

    /**
     * Cleans up derived assets for a batch.
     */
    async cleanupDerivedBatch(batchId: string): Promise<void> {
        const bucket = getConfiguredStorageBucket();
        if (bucket) {
            await bucket.deleteFiles({ prefix: `batches/${batchId}/derived/` });
            return;
        }

        const storageRoot = this.getStorageRoot();
        const batchDir = path.join(storageRoot, batchId);
        if (fs.existsSync(batchDir)) {
            await fs.promises.rm(batchDir, { recursive: true, force: true });
        }
    }

    private getContentType(format: string): string {
        return `image/${format.toLowerCase() === 'jpg' ? 'jpeg' : format.toLowerCase()}`;
    }
}

const derivedStorageService = new DerivedStorageService();
export default derivedStorageService;
