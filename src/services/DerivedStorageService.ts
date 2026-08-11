import fs from 'fs';
import path from 'path';

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
    readDerivedPage?(storageKey: string): Promise<Buffer>;
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
     * Resolves the full disk path for a derived page key.
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
     * Reads a stored derived page image from disk.
     */
    async readDerivedPage(storageKey: string): Promise<Buffer> {
        const filePath = this.getDerivedDiskPath(storageKey);
        return await fs.promises.readFile(filePath);
    }

    /**
     * Cleans up derived files for a batch.
     */
    async cleanupDerivedBatch(batchId: string): Promise<void> {
        const storageRoot = this.getStorageRoot();
        const batchDir = path.join(storageRoot, batchId);
        if (fs.existsSync(batchDir)) {
            await fs.promises.rm(batchDir, { recursive: true, force: true });
        }
    }
}

const derivedStorageService = new DerivedStorageService();
export default derivedStorageService;
