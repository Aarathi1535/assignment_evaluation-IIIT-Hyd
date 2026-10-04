import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageMock = vi.hoisted(() => {
    const objects = new Map<string, Buffer>();
    const file = vi.fn((key: string) => ({
        name: key,
        save: vi.fn(async (buffer: Buffer) => {
            objects.set(key, Buffer.from(buffer));
        }),
        download: vi.fn(async () => {
            const object = objects.get(key);
            if (!object) {
                const error = new Error(`No such object: ${key}`) as Error & { code: number };
                error.code = 404;
                throw error;
            }
            return [Buffer.from(object)];
        }),
        delete: vi.fn(async () => {
            objects.delete(key);
        })
    }));
    const bucket = vi.fn(() => ({ name: 'configured-test-bucket', file }));
    return { objects, file, bucket };
});

vi.mock('@google-cloud/storage', () => ({
    Storage: vi.fn(function StorageMock() {
        return { bucket: storageMock.bucket };
    })
}));

import { ImmutableStorageService } from '../services/ImmutableStorageService';

describe('ImmutableStorageService on Cloud Run', () => {
    const hmacSecret = process.env.ORIGINAL_STORAGE_HMAC_SECRET;

    beforeEach(() => {
        vi.stubEnv('K_SERVICE', 'assignment-evaluator');
        vi.stubEnv('DERIVED_PAGE_STORAGE_BUCKET', 'configured-test-bucket');
        vi.stubEnv('ORIGINAL_STORAGE_HMAC_SECRET', 'test-secure-hmac-secret-32-chars-long');
        storageMock.objects.clear();
    });

    afterEach(() => {
        if (hmacSecret === undefined) {
            delete process.env.ORIGINAL_STORAGE_HMAC_SECRET;
        } else {
            process.env.ORIGINAL_STORAGE_HMAC_SECRET = hmacSecret;
        }
        vi.unstubAllEnvs();
        vi.clearAllMocks();
        storageMock.objects.clear();
    });

    it('uploads and reads original content from the configured GCS bucket using the canonical key', async () => {
        const service = new ImmutableStorageService();
        const buffer = Buffer.from('%PDF-1.7 production original');
        const batchId = 'batch-cloud';
        const fileId = 'file-cloud';
        const key = `batches/${batchId}/${fileId}.pdf`;

        const stored = await service.storeOriginal({
            batchId,
            fileId,
            sequenceNumber: 1,
            uploader: 'user-1',
            buffer,
            originalFilename: 'answers.pdf',
            fileExtension: 'pdf'
        });

        expect(stored.storageKey).toBe(key);
        expect(stored.storagePath).toBe(`gs://configured-test-bucket/${key}`);
        expect(storageMock.bucket).toHaveBeenCalledWith('configured-test-bucket');
        expect(storageMock.file).toHaveBeenCalledWith(key);
        expect(storageMock.file.mock.results[0].value.save).toHaveBeenCalledWith(buffer, {
            resumable: false,
            preconditionOpts: { ifGenerationMatch: 0 },
            metadata: { contentType: 'application/pdf' }
        });
        expect(await service.readOriginalContent(stored.storageKey)).toEqual(buffer);
        expect(storageMock.objects.get(key)).toEqual(buffer);
    });
});
