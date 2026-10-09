import { afterEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import AnswerScript from '../models/AnswerScript';
import Allocation from '../models/Allocation';
import Batch, { BatchStatus } from '../models/Batch';
import Grade from '../models/Grade';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import { DerivedPageRepairService } from '../services/DerivedPageRepairService';
import { PageIngestionService } from '../services/PageIngestionService';
import type { IPageRenderer } from '../services/PageRenderer';
import type { IDerivedStorageService } from '../services/DerivedStorageService';
import type { IImageEnhancer } from '../services/ImageEnhancer';

const originalStorageKey = 'batches/repair-batch/file-1.pdf';
const derivedStorageKey = 'batches/repair-batch/derived/file-1/1/page.png';

async function createRepairFixture() {
    const batchId = 'repair-batch';
    const fileId = 'file-1';
    const professor = new mongoose.Types.ObjectId();
    const script = await AnswerScript.create({
        exam: new mongoose.Types.ObjectId(),
        batchId,
        fileIndex: 0,
        startPageNumber: 1,
        endPageNumber: 1,
        pageCount: 1,
        isActive: true
    });
    const batch = await Batch.create({
        batchId,
        uploadedBy: professor,
        files: [{
            fileId,
            fileIndex: 0,
            originalFilename: 'answers.pdf',
            fileType: 'pdf',
            mimeType: 'application/pdf',
            size: 128,
            pageCount: 1,
            storageKey: originalStorageKey
        }],
        totalFiles: 1,
        totalSize: 128,
        totalPageCount: 1,
        status: BatchStatus.DONE,
        isActive: true
    });
    const page = await IngestionPage.create({
        batchId,
        job: new mongoose.Types.ObjectId(),
        fileId,
        fileIndex: 0,
        storageKey: originalStorageKey,
        pageNumber: 1,
        status: PageProcessingStatus.PROCESSED,
        metadata: { originalStorageKey, fileType: 'pdf' }
    });
    const allocation = await Allocation.create({
        exam: script.exam,
        ta: new mongoose.Types.ObjectId(),
        answerScript: script._id,
        allocatedBy: professor
    });
    const grade = await Grade.create({
        answerScript: script._id,
        rubric: new mongoose.Types.ObjectId(),
        gradedBy: professor,
        marksAwarded: [{ criterionName: 'Accuracy', score: 7 }],
        totalScore: 7,
        isFinal: true
    });
    return { batch, script, page, allocation, grade };
}

function makeRepairService(overrides?: {
    exists?: boolean;
    storedKey?: string;
    regenerateError?: Error;
}) {
    const exists = vi.fn().mockResolvedValue(overrides?.exists ?? false);
    const readOriginal = vi.fn(async () => Buffer.from('original-pdf'));
    const regenerate = vi.fn(async () => {
        if (overrides?.regenerateError) throw overrides.regenerateError;
        return {
            storageKey: overrides?.storedKey || derivedStorageKey,
            storagePath: `gs://repair-bucket/${derivedStorageKey}`,
            size: 32,
            width: 800,
            height: 1100
        };
    });
    const service = new DerivedPageRepairService(
        { readOriginalContent: readOriginal },
        {
            getDerivedPageKey: vi.fn().mockReturnValue(derivedStorageKey),
            derivedPageExists: exists,
            storeDerivedPage: vi.fn(async () => ({
                storageKey: derivedStorageKey,
                storagePath: `gs://repair-bucket/${derivedStorageKey}`,
                size: 32
            }))
        },
        { regenerateDerivedPage: regenerate }
    );
    return { service, exists, readOriginal, regenerate };
}

describe('DerivedPageRepairService', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('skips an existing derived object and only repairs its page pointer', async () => {
        const { script, page, allocation, grade } = await createRepairFixture();
        const scriptBefore = script.toObject();
        const allocationBefore = allocation.toObject();
        const gradeBefore = grade.toObject();
        const { service, readOriginal, regenerate } = makeRepairService({ exists: true });

        const result = await service.repair({ scriptIds: [script._id.toString()] });

        expect(result).toMatchObject({ checked: 1, skipped: 1, repaired: 0, failed: [] });
        expect(readOriginal).not.toHaveBeenCalled();
        expect(regenerate).not.toHaveBeenCalled();
        expect((await IngestionPage.findById(page._id))?.storageKey).toBe(derivedStorageKey);
        expect((await AnswerScript.findById(script._id))?.toObject()).toEqual(scriptBefore);
        expect((await Allocation.findById(allocation._id))?.toObject()).toEqual(allocationBefore);
        expect((await Grade.findById(grade._id))?.toObject()).toEqual(gradeBefore);
    });

    it('regenerates a missing object and updates only the page storage key', async () => {
        const { script, page, allocation, grade } = await createRepairFixture();
        const scriptBefore = script.toObject();
        const allocationBefore = allocation.toObject();
        const gradeBefore = grade.toObject();
        const { service, readOriginal, regenerate } = makeRepairService();

        const result = await service.repair({ scriptIds: [script._id.toString()] });

        expect(result).toMatchObject({ checked: 1, skipped: 0, repaired: 1, failed: [] });
        expect(readOriginal).toHaveBeenCalledWith(originalStorageKey);
        expect(regenerate).toHaveBeenCalledWith(expect.objectContaining({
            batchId: 'repair-batch',
            fileId: 'file-1',
            pageNumber: 1,
            fileType: 'pdf',
            originalStorageKey,
            fileBuffer: Buffer.from('original-pdf')
        }));
        const repairedPage = await IngestionPage.findById(page._id);
        expect(repairedPage?.storageKey).toBe(derivedStorageKey);
        expect(repairedPage?.width).toBe(800);
        expect(repairedPage?.height).toBe(1100);
        expect(repairedPage?.metadata?.width).toBe(800);
        expect(repairedPage?.metadata?.height).toBe(1100);
        expect(repairedPage?.metadata?.derivedStorageKey).toBe(derivedStorageKey);
        expect((await AnswerScript.findById(script._id))?.toObject()).toEqual(scriptBefore);
        expect((await Allocation.findById(allocation._id))?.toObject()).toEqual(allocationBefore);
        expect((await Grade.findById(grade._id))?.toObject()).toEqual(gradeBefore);
    });

    it('uses the existing PageIngestionService renderer and derived storage for regeneration', async () => {
        const rendered = Buffer.from('rendered-png');
        const renderer: IPageRenderer = {
            renderPage: vi.fn().mockResolvedValue({
                success: true,
                pageNumber: 1,
                image: {
                    buffer: rendered,
                    format: 'png',
                    width: 100,
                    height: 100,
                    dpi: 150,
                    pageNumber: 1,
                    sizeBytes: rendered.length
                }
            })
        };
        const derivedStorage: IDerivedStorageService = {
            getDerivedPageKey: vi.fn().mockReturnValue(derivedStorageKey),
            derivedPageExists: vi.fn().mockResolvedValue(false),
            storeDerivedPage: vi.fn().mockResolvedValue({
                storageKey: derivedStorageKey,
                storagePath: `gs://repair-bucket/${derivedStorageKey}`,
                size: rendered.length
            }),
            storeDerivedThumbnail: vi.fn(),
            getDerivedThumbnailKey: vi.fn().mockReturnValue('unused')
        };
        const enhancer: IImageEnhancer = {
            enhancePage: vi.fn().mockResolvedValue({
                buffer: rendered,
                deskewAngle: 0,
                orientation: 0,
                applied: false
            })
        };
        const pageService = new PageIngestionService(
            renderer,
            derivedStorage,
            undefined,
            undefined,
            undefined,
            enhancer
        );

        await expect(pageService.regenerateDerivedPage({
            batchId: 'repair-batch',
            fileId: 'file-1',
            pageNumber: 1,
            fileType: 'pdf',
            originalStorageKey,
            fileBuffer: Buffer.from('original-pdf')
        })).resolves.toMatchObject({ storageKey: derivedStorageKey });

        expect(renderer.renderPage).toHaveBeenCalledWith(expect.objectContaining({
            storageKey: originalStorageKey,
            fileBuffer: Buffer.from('original-pdf'),
            config: { outputFormat: 'png' }
        }));
        expect(derivedStorage.storeDerivedPage).toHaveBeenCalledWith({
            batchId: 'repair-batch',
            fileId: 'file-1',
            pageNumber: 1,
            buffer: rendered,
            format: 'png',
            ifGenerationMatch: 0
        });
    });

    it('leaves storageKey unchanged when page rendering fails', async () => {
        const { script, page } = await createRepairFixture();
        const renderError = new Error('PDF rendering failed');
        const { service, regenerate } = makeRepairService({ regenerateError: renderError });

        const result = await service.repair({ scriptIds: [script._id.toString()] });

        expect(result.repaired).toBe(0);
        expect(result.failed).toEqual([expect.objectContaining({
            pageId: page._id.toString(),
            reason: 'PDF rendering failed'
        })]);
        expect(regenerate).toHaveBeenCalledOnce();
        expect((await IngestionPage.findById(page._id))?.storageKey).toBe(originalStorageKey);
    });

    it('leaves storageKey unchanged when derived storage fails after rendering', async () => {
        const { script, page } = await createRepairFixture();
        const writeError = new Error('GCS write failed');
        const { service } = makeRepairService({ regenerateError: writeError });

        const result = await service.repair({ scriptIds: [script._id.toString()] });

        expect(result.failed[0]?.reason).toBe('GCS write failed');
        expect((await IngestionPage.findById(page._id))?.storageKey).toBe(originalStorageKey);
    });

    it('reports missing objects without changing storage or database in dry-run mode', async () => {
        const { script, page } = await createRepairFixture();
        const { service, readOriginal, regenerate } = makeRepairService();

        const result = await service.repair({ scriptIds: [script._id.toString()], dryRun: true });

        expect(result).toMatchObject({
            checked: 1,
            wouldRepair: 1,
            repaired: 0,
            wouldRepairPages: [{
                pageId: page._id.toString(),
                storageKey: derivedStorageKey
            }]
        });
        expect(readOriginal).not.toHaveBeenCalled();
        expect(regenerate).not.toHaveBeenCalled();
        expect((await IngestionPage.findById(page._id))?.storageKey).toBe(originalStorageKey);
    });
});
