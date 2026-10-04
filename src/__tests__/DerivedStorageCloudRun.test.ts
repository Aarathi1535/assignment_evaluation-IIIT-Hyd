import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storageMocks = vi.hoisted(() => ({
    bucket: vi.fn(),
    file: vi.fn(),
    save: vi.fn(),
    download: vi.fn(),
    deleteFiles: vi.fn()
}));

vi.mock('@google-cloud/storage', () => ({
    Storage: vi.fn(function StorageMock() {
        return { bucket: storageMocks.bucket };
    })
}));

import { DerivedStorageConfigurationError, DerivedStorageService } from '../services/DerivedStorageService';

describe('DerivedStorageService on Cloud Run', () => {
    beforeEach(() => {
        vi.stubEnv('K_SERVICE', 'assignment-evaluator');
        vi.stubEnv('DERIVED_PAGE_STORAGE_BUCKET', 'configured-test-bucket');
        storageMocks.bucket.mockReturnValue({
            name: 'configured-test-bucket',
            file: storageMocks.file,
            deleteFiles: storageMocks.deleteFiles
        });
        storageMocks.file.mockReturnValue({
            save: storageMocks.save,
            download: storageMocks.download
        });
        storageMocks.save.mockResolvedValue(undefined);
        storageMocks.download.mockResolvedValue([Buffer.from('stored-page')]);
        storageMocks.deleteFiles.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.clearAllMocks();
    });

    it('stores and reads derived pages at their existing object keys using the configured bucket', async () => {
        const service = new DerivedStorageService();
        const buffer = Buffer.from('page-bytes');

        const stored = await service.storeDerivedPage({
            batchId: 'batch-1',
            fileId: 'file-1',
            pageNumber: 2,
            buffer,
            format: 'jpeg'
        });
        const key = 'batches/batch-1/derived/file-1/2/page.jpeg';

        expect(stored).toEqual({
            storageKey: key,
            storagePath: `gs://configured-test-bucket/${key}`,
            size: buffer.length
        });
        expect(storageMocks.bucket).toHaveBeenCalledWith('configured-test-bucket');
        expect(storageMocks.file).toHaveBeenCalledWith(key);
        expect(storageMocks.save).toHaveBeenCalledWith(buffer, {
            resumable: false,
            metadata: { contentType: 'image/jpeg' }
        });
        await expect(service.readDerivedPage(key)).resolves.toEqual(Buffer.from('stored-page'));

        await service.cleanupDerivedBatch('batch-1');
        expect(storageMocks.deleteFiles).toHaveBeenCalledWith({ prefix: 'batches/batch-1/derived/' });
    });

    it('fails with a clear configuration error when Cloud Run has no derived bucket configured', async () => {
        vi.stubEnv('DERIVED_PAGE_STORAGE_BUCKET', '');

        await expect(new DerivedStorageService().readDerivedPage('batches/batch-1/page.png'))
            .rejects.toBeInstanceOf(DerivedStorageConfigurationError);
        await expect(new DerivedStorageService().readDerivedPage('batches/batch-1/page.png'))
            .rejects.toThrow('DERIVED_PAGE_STORAGE_BUCKET');
        expect(storageMocks.bucket).not.toHaveBeenCalled();
    });
});
