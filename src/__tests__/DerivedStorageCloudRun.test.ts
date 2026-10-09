import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const storageMocks = vi.hoisted(() => ({
    bucket: vi.fn(),
    file: vi.fn(),
    save: vi.fn(),
    download: vi.fn(),
    getMetadata: vi.fn(),
    createReadStream: vi.fn(),
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
            download: storageMocks.download,
            getMetadata: storageMocks.getMetadata,
            createReadStream: storageMocks.createReadStream,
        });
        storageMocks.save.mockResolvedValue(undefined);
        storageMocks.download.mockResolvedValue([Buffer.from('stored-page')]);
        storageMocks.getMetadata.mockResolvedValue([{ size: '11' }]);
        storageMocks.createReadStream.mockReturnValue(Readable.from([Buffer.from('stored-page')]));
        storageMocks.deleteFiles.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        vi.clearAllMocks();
    });

    it('writes derived pages to the configured Cloud Run bucket using the canonical key', async () => {
        const service = new DerivedStorageService();
        const buffer = Buffer.from('page-bytes');
        const key = 'batches/batch-1/derived/file-1/2/page.png';
        const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});

        const stored = await service.storeDerivedPage({
            batchId: 'batch-1',
            fileId: 'file-1',
            pageNumber: 2,
            buffer
        });

        expect(stored).toEqual({
            storageKey: key,
            storagePath: `gs://configured-test-bucket/${key}`,
            size: buffer.length
        });
        expect(storageMocks.bucket).toHaveBeenCalledWith('configured-test-bucket');
        expect(storageMocks.file).toHaveBeenCalledWith(key);
        expect(storageMocks.save).toHaveBeenCalledWith(buffer, {
            resumable: false,
            metadata: { contentType: 'image/png' }
        });
        expect(debugSpy).toHaveBeenCalledWith(
            '[DerivedStorageService] Writing derived page to GCS',
            {
                bucket: 'configured-test-bucket',
                storageKey: key,
                bufferSize: buffer.length,
                status: 'started',
            }
        );
        expect(debugSpy).toHaveBeenCalledWith(
            '[DerivedStorageService] Wrote derived page to GCS',
            {
                bucket: 'configured-test-bucket',
                storageKey: key,
                bufferSize: buffer.length,
                success: true,
            }
        );
        await expect(service.readDerivedPage(stored.storageKey)).resolves.toEqual(Buffer.from('stored-page'));
        const opened = await service.openDerivedPage(stored.storageKey);
        expect(opened.size).toBe(11);
        expect(storageMocks.file.mock.calls.map(([objectKey]) => objectKey)).toEqual([
            key,
            key,
            key
        ]);
        const chunks: Buffer[] = [];
        for await (const chunk of opened.stream) {
            chunks.push(Buffer.from(chunk));
        }
        expect(Buffer.concat(chunks)).toEqual(Buffer.from('stored-page'));

        await service.cleanupDerivedBatch('batch-1');
        expect(storageMocks.deleteFiles).toHaveBeenCalledWith({ prefix: 'batches/batch-1/derived/' });
    });

    it('stores and opens local derived pages at the established path when no bucket is configured', async () => {
        vi.stubEnv('K_SERVICE', '');
        vi.stubEnv('DERIVED_PAGE_STORAGE_BUCKET', '');
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'derived-storage-local-'));
        const storageRoot = path.join(tempRoot, 'derived');
        vi.stubEnv('DERIVED_STORAGE_PATH', storageRoot);
        const service = new DerivedStorageService();
        const buffer = Buffer.from('local-page-bytes');

        try {
            const stored = await service.storeDerivedPage({
                batchId: 'batch-local',
                fileId: 'file-local',
                pageNumber: 1,
                buffer,
            });
            const expectedKey = 'batches/batch-local/derived/file-local/1/page.png';
            const expectedPath = path.join(
                storageRoot,
                'batch-local',
                'derived',
                'file-local',
                '1',
                'page.png'
            );

            expect(stored.storageKey).toBe(expectedKey);
            expect(stored.storagePath).toBe(expectedPath);
            expect(await fs.readFile(expectedPath)).toEqual(buffer);

            const opened = await service.openDerivedPage(stored.storageKey);
            expect(opened.size).toBe(buffer.length);
            const chunks: Buffer[] = [];
            for await (const chunk of opened.stream) {
                chunks.push(Buffer.from(chunk));
            }
            expect(Buffer.concat(chunks)).toEqual(buffer);
            expect(storageMocks.bucket).not.toHaveBeenCalled();
        } finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('falls back to the mounted legacy path when the canonical GCS object is missing', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'derived-storage-legacy-'));
        const storageRoot = path.join(tempRoot, 'derived');
        const storageKey = 'batches/legacy-batch/derived/legacy-file/3/page.png';
        const legacyPath = path.join(
            storageRoot,
            'legacy-batch',
            'derived',
            'legacy-file',
            '3',
            'page.png'
        );
        const legacyBytes = Buffer.from('legacy-mounted-page');
        const notFound = Object.assign(new Error('No such object'), { code: 404 });
        vi.stubEnv('DERIVED_STORAGE_PATH', storageRoot);
        storageMocks.download.mockRejectedValue(notFound);
        storageMocks.getMetadata.mockRejectedValue(notFound);
        await fs.mkdir(path.dirname(legacyPath), { recursive: true });
        await fs.writeFile(legacyPath, legacyBytes);

        try {
            const service = new DerivedStorageService();

            await expect(service.readDerivedPage(storageKey)).resolves.toEqual(legacyBytes);
            const opened = await service.openDerivedPage(storageKey);
            expect(opened.size).toBe(legacyBytes.length);
            const chunks: Buffer[] = [];
            for await (const chunk of opened.stream) {
                chunks.push(Buffer.from(chunk));
            }
            expect(Buffer.concat(chunks)).toEqual(legacyBytes);
            expect(storageMocks.file).toHaveBeenCalledWith(storageKey);
            expect(storageMocks.download).toHaveBeenCalledOnce();
            expect(storageMocks.getMetadata).toHaveBeenCalledOnce();
        } finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('does not fall back to mounted storage for non-404 GCS read failures', async () => {
        const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'derived-storage-gcs-error-'));
        vi.stubEnv('DERIVED_STORAGE_PATH', tempRoot);
        const permissionError = Object.assign(new Error('Permission denied'), { code: 403 });
        storageMocks.download.mockRejectedValue(permissionError);

        try {
            await expect(new DerivedStorageService().readDerivedPage(
                'batches/private/derived/file/1/page.png'
            )).rejects.toBe(permissionError);
        } finally {
            await fs.rm(tempRoot, { recursive: true, force: true });
        }
    });

    it('logs GCS write failures with the original error and rethrows them', async () => {
        const service = new DerivedStorageService();
        const buffer = Buffer.from('page-bytes');
        const error = new Error('GCS write failed');
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        storageMocks.save.mockRejectedValueOnce(error);

        await expect(service.storeDerivedPage({
            batchId: 'batch-1',
            fileId: 'file-1',
            pageNumber: 2,
            buffer
        })).rejects.toBe(error);

        expect(errorSpy).toHaveBeenCalledWith(
            '[DerivedStorageService] Failed to write derived page to GCS',
            {
                bucket: 'configured-test-bucket',
                storageKey: 'batches/batch-1/derived/file-1/2/page.png',
                bufferSize: buffer.length,
                success: false,
                error: { name: error.name, message: error.message, stack: error.stack },
            }
        );
    });

    it('fails with a clear configuration error when Cloud Run has no derived bucket configured', async () => {
        vi.stubEnv('DERIVED_PAGE_STORAGE_BUCKET', '');

        await expect(new DerivedStorageService().readDerivedPage('batches/batch-1/page.png'))
            .rejects.toBeInstanceOf(DerivedStorageConfigurationError);
        await expect(new DerivedStorageService().readDerivedPage('batches/batch-1/page.png'))
            .rejects.toThrow('DERIVED_PAGE_STORAGE_BUCKET');
        await expect(new DerivedStorageService().openDerivedPage('batches/batch-1/page.png'))
            .rejects.toThrow('DERIVED_PAGE_STORAGE_BUCKET');
        expect(storageMocks.bucket).not.toHaveBeenCalled();
    });
});
