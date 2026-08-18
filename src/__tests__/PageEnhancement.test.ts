import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import AuditLog from '../models/AuditLog';
import { connectDB } from '../lib/db';
import pageIngestionService from '../services/PageIngestionService';
import { IDerivedStorageService } from '../services/DerivedStorageService';
import { defaultImageEnhancer } from '../services/ImageEnhancer';
import { createCanvas } from '@napi-rs/canvas';
import fs from 'fs';
import path from 'path';

// Note: Test setup should run sequential execution for DB operations
describe('AE-068 Page Enhancement Update Workflow', () => {
    let mockDerivedStorage: { storeDerivedPage: unknown, storeDerivedThumbnail: unknown, readDerivedPage: unknown, getDerivedPageKey: unknown, getDerivedThumbnailKey: unknown };
    let originalStorageRoot: string;
    const testBatchId = 'test-batch-068';
    const testUserId = new mongoose.Types.ObjectId();

    beforeEach(async () => {
        await connectDB();

        originalStorageRoot = path.join(process.cwd(), 'data', 'originals');
        if (!fs.existsSync(originalStorageRoot)) {
            fs.mkdirSync(originalStorageRoot, { recursive: true });
        }
        process.env.ORIGINAL_STORAGE_PATH = originalStorageRoot;

        mockDerivedStorage = {
            storeDerivedPage: vi.fn().mockResolvedValue({ storageKey: 'mock-derived-key' }),
            storeDerivedThumbnail: vi.fn().mockResolvedValue({ storageKey: 'mock-thumbnail-key' }),
            readDerivedPage: vi.fn(),
            getDerivedPageKey: vi.fn(),
            getDerivedThumbnailKey: vi.fn()
        };

        pageIngestionService.setDerivedStorage(mockDerivedStorage as unknown as IDerivedStorageService);
    });

    afterEach(async () => {
        vi.restoreAllMocks();
    });

    function createSyntheticBuffer() {
        const canvas = createCanvas(100, 100);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, 100, 100);
        ctx.fillStyle = '#000000';
        ctx.fillText('Test Page', 10, 50);
        return canvas.toBuffer('image/png');
    }

    it('should initially process page and store enhancementParams', async () => {
        const buffer = createSyntheticBuffer();
        const originalStorageKey = `batches/${testBatchId}/original.png`;
        const diskPath = path.join(originalStorageRoot, testBatchId, 'original.png');
        fs.mkdirSync(path.dirname(diskPath), { recursive: true });
        fs.writeFileSync(diskPath, buffer);

        const result = await pageIngestionService.processPage({
            batchId: testBatchId,
            jobId: new mongoose.Types.ObjectId(),
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: originalStorageKey,
            pageNumber: 1,
            fileType: 'image/png',
            fileBuffer: buffer
        });

        expect(result.success).toBe(true);
        expect(result.pageRecord?.enhancementParams).toBeDefined();
        // Since it's a synthetic clean image, orientation/deskew will be 0.
        expect(result.pageRecord?.enhancementParams?.orientation).toBe(0);
        expect(result.pageRecord?.enhancementParams?.deskewAngle).toBe(0);
        expect(result.pageRecord?.status).toBe(PageProcessingStatus.PROCESSED);
    });

    it('should update enhancementParams on-the-fly and generate a new derived asset', async () => {
        const buffer = createSyntheticBuffer();
        const originalStorageKey = `batches/${testBatchId}/original.png`;
        const diskPath = path.join(originalStorageRoot, testBatchId, 'original.png');
        fs.mkdirSync(path.dirname(diskPath), { recursive: true });
        fs.writeFileSync(diskPath, buffer);

        // 1. Setup existing PROCESSED page
        const page = await IngestionPage.create({
            batchId: testBatchId,
            job: new mongoose.Types.ObjectId(),
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: 'old-derived-key',
            thumbnailKey: 'old-thumbnail-key',
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED,
            enhancementParams: { deskewAngle: 0, orientation: 0 },
            metadata: {
                originalStorageKey,
                derivedStorageKey: 'old-derived-key'
            }
        });

        const explicitParams = {
            deskewAngle: 5,
            orientation: 90,
            brightness: 1.5,
            contrast: 1.2
        };

        const enhanceSpy = vi.spyOn(defaultImageEnhancer, 'enhancePage');

        // 2. Perform the update
        const updateResult = await pageIngestionService.updateEnhancementParams(
            page._id as mongoose.Types.ObjectId,
            explicitParams,
            testUserId,
            '127.0.0.1'
        );

        expect(updateResult.success).toBe(true);
        expect(updateResult.pageRecord?.enhancementParams?.deskewAngle).toBe(5);
        expect(updateResult.pageRecord?.enhancementParams?.orientation).toBe(90);
        expect(updateResult.pageRecord?.enhancementParams?.brightness).toBe(1.5);
        expect(updateResult.pageRecord?.enhancementParams?.contrast).toBe(1.2);

        // 3. Verify it passed params explicitly to ImageEnhancer (bypassing auto-detection)
        expect(enhanceSpy).toHaveBeenCalled();
        const enhanceCallArgs = enhanceSpy.mock.calls[0];
        expect(enhanceCallArgs[2]).toEqual(explicitParams); // 3rd arg is params

        // 4. Verify derived asset was restrored
        expect(mockDerivedStorage.storeDerivedPage).toHaveBeenCalled();
        expect(mockDerivedStorage.storeDerivedThumbnail).toHaveBeenCalled();

        // 5. Verify Audit Log was generated
        const logs = await AuditLog.find({ entityId: page._id });
        expect(logs).toHaveLength(1);
        expect(logs[0].action).toBe('UPDATE_ENHANCEMENT_PARAMS');
        expect(logs[0].user.toString()).toBe(testUserId.toString());
        const details = logs[0].details as Record<string, unknown>;
        const newParams = details?.newParams as Record<string, unknown>;
        expect(newParams?.deskewAngle).toBe(5);
    });

    it('should fail if originalStorageKey is missing', async () => {
        // Setup existing PROCESSED page with NO originalStorageKey
        const page = await IngestionPage.create({
            batchId: testBatchId,
            job: new mongoose.Types.ObjectId(),
            fileId: 'file-2',
            fileIndex: 1,
            storageKey: 'old-derived-key',
            thumbnailKey: 'old-thumbnail-key',
            pageNumber: 2,
            status: PageProcessingStatus.PROCESSED,
            metadata: {} // Missing originalStorageKey
        });

        await expect(pageIngestionService.updateEnhancementParams(
            page._id as mongoose.Types.ObjectId,
            { deskewAngle: 5 },
            testUserId
        )).rejects.toThrow('Original storage key not found');
    });

    it('should fail if page is not PROCESSED', async () => {
        const page = await IngestionPage.create({
            batchId: testBatchId,
            job: new mongoose.Types.ObjectId(),
            fileId: 'file-3',
            fileIndex: 2,
            storageKey: 'some-key',
            pageNumber: 3,
            status: PageProcessingStatus.FAILED
        });

        await expect(pageIngestionService.updateEnhancementParams(
            page._id as mongoose.Types.ObjectId,
            { deskewAngle: 5 },
            testUserId
        )).rejects.toThrow('Cannot update enhancement parameters for an unprocessed or failed page');
    });

    it('should be perfectly deterministic when applying the same parameters repeatedly (AE-069)', async () => {
        const buffer = createSyntheticBuffer();
        const originalStorageKey = `batches/${testBatchId}/original.png`;
        const diskPath = path.join(originalStorageRoot, testBatchId, 'original.png');
        fs.mkdirSync(path.dirname(diskPath), { recursive: true });
        fs.writeFileSync(diskPath, buffer);

        const page = await IngestionPage.create({
            batchId: testBatchId,
            job: new mongoose.Types.ObjectId(),
            fileId: 'file-4',
            fileIndex: 3,
            storageKey: 'old-derived-key',
            thumbnailKey: 'old-thumbnail-key',
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED,
            enhancementParams: { deskewAngle: 0, orientation: 0 },
            metadata: {
                originalStorageKey,
                derivedStorageKey: 'old-derived-key',
                fileType: 'png'
            }
        });

        const explicitParams = {
            deskewAngle: 5,
            orientation: 90,
            brightness: 1.5,
            contrast: 1.2
        };

        await pageIngestionService.updateEnhancementParams(
            page._id as mongoose.Types.ObjectId,
            explicitParams,
            testUserId,
            '127.0.0.1'
        );

        // Capture the buffer passed to derived storage
        const call1Args = (mockDerivedStorage.storeDerivedPage as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as { buffer: Buffer };

        // Call again with same params
        await pageIngestionService.updateEnhancementParams(
            page._id as mongoose.Types.ObjectId,
            explicitParams,
            testUserId,
            '127.0.0.1'
        );

        const call2Args = (mockDerivedStorage.storeDerivedPage as unknown as { mock: { calls: unknown[][] } }).mock.calls[1][0] as { buffer: Buffer };

        // 1. Outputs must be byte-identical (AE-069 Determinism)
        expect(call1Args.buffer.equals(call2Args.buffer)).toBe(true);

        // 2. The original immutable source MUST NOT have changed
        const diskBufferAfter = fs.readFileSync(diskPath);
        expect(diskBufferAfter.equals(buffer)).toBe(true);
    });
});
