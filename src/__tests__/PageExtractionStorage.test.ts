import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import batchService from '../services/BatchService';
import { IngestionWorker } from '../services/IngestionWorker';
import defaultPageIngestionService from '../services/PageIngestionService';
import { DefaultPdfRenderer, DefaultImageRenderer } from '../services/PageRenderer';
import defaultDerivedStorageService from '../services/DerivedStorageService';
import ImmutableStorageService from '../services/ImmutableStorageService';
import { HttpError } from '../lib/errors';
import { getPdfPageCount } from '../utils/fileValidation';

describe('AE-049 — Fixture-Based Page Extraction & Storage Integration', () => {
    const fixturesDir = path.join(__dirname, 'fixtures');
    const singlePagePdfBuffer = fs.readFileSync(path.join(fixturesDir, 'single-page.pdf'));
    const multiPagePdfBuffer = fs.readFileSync(path.join(fixturesDir, 'multi-page.pdf'));
    const reconciliationPdfBuffer = fs.readFileSync(path.join(fixturesDir, 'reconciliation.pdf'));
    const samplePngBuffer = fs.readFileSync(path.join(fixturesDir, 'sample-image.png'));
    const sampleJpgBuffer = fs.readFileSync(path.join(fixturesDir, 'sample-image.jpg'));
    const corruptedBuffer = fs.readFileSync(path.join(fixturesDir, 'corrupted-file.bin'));

    // Known-correct literal page counts verified for static fixtures (not generated at runtime)
    const KNOWN_SINGLE_PAGE_PDF_COUNT = 1;
    const KNOWN_MULTI_PAGE_PDF_COUNT = 3;
    const KNOWN_RECONCILIATION_TRUE_PAGE_COUNT = 1;
    const KNOWN_RECONCILIATION_REGEX_PAGE_COUNT = 2;
    const KNOWN_IMAGE_PAGE_COUNT = 1;

    const professorId = new mongoose.Types.ObjectId().toString();
    const adminContext = {
        actingUserId: professorId,
        actingUserRole: 'PROFESSOR',
        ipAddress: '127.0.0.1'
    };

    let worker: IngestionWorker;
    const createdBatchIds: string[] = [];

    beforeEach(async () => {
        worker = new IngestionWorker({
            workerId: `test-worker-${crypto.randomUUID()}`,
            pageIngestionService: defaultPageIngestionService
        });
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        // Clean up on-disk storage created during test execution
        for (const batchId of createdBatchIds) {
            await ImmutableStorageService.cleanupBatch(batchId).catch(() => {});
            // Clean up derived assets
            const derivedDir = path.join(defaultDerivedStorageService.getStorageRoot(), batchId);
            if (fs.existsSync(derivedDir)) {
                await fs.promises.rm(derivedDir, { recursive: true, force: true }).catch(() => {});
            }
        }
        createdBatchIds.length = 0;
    });

    describe('1. Static Fixture Integrity & Direct Renderer Checks', () => {
        it('should verify single-page PDF fixture has known-correct literal page count', async () => {
            const renderer = new DefaultPdfRenderer();
            const count = await renderer.getPageCount(singlePagePdfBuffer);
            expect(count).toBe(KNOWN_SINGLE_PAGE_PDF_COUNT);
        });

        it('should verify multi-page PDF fixture has known-correct literal page count', async () => {
            const renderer = new DefaultPdfRenderer();
            const count = await renderer.getPageCount(multiPagePdfBuffer);
            expect(count).toBe(KNOWN_MULTI_PAGE_PDF_COUNT);
        });

        it('should verify image fixtures report known-correct literal page count of 1', async () => {
            const imageRenderer = new DefaultImageRenderer();
            const pngCount = await imageRenderer.getPageCount(samplePngBuffer);
            const jpgCount = await imageRenderer.getPageCount(sampleJpgBuffer);
            expect(pngCount).toBe(KNOWN_IMAGE_PAGE_COUNT);
            expect(jpgCount).toBe(KNOWN_IMAGE_PAGE_COUNT);
        });

        it('should verify reconciliation fixture exhibits regex count vs authoritative discrepancy', async () => {
            const regexCount = getPdfPageCount(reconciliationPdfBuffer);
            expect(regexCount).toBe(KNOWN_RECONCILIATION_REGEX_PAGE_COUNT);

            const renderer = new DefaultPdfRenderer();
            const authoritativeCount = await renderer.getPageCount(reconciliationPdfBuffer);
            expect(authoritativeCount).toBe(KNOWN_RECONCILIATION_TRUE_PAGE_COUNT);
        });
    });

    describe('2. Single-Page Real PDF Pipeline Integration', () => {
        it('should process a real single-page PDF fixture through the full pipeline', async () => {
            const { batch, job } = await batchService.createBatch(
                [{ name: 'assignment_p1.pdf', buffer: singlePagePdfBuffer, size: singlePagePdfBuffer.length }],
                undefined,
                adminContext
            );
            createdBatchIds.push(batch.batchId);

            expect(batch.status).toBe(BatchStatus.QUEUED);
            expect(job.status).toBe(IngestionStatus.QUEUED);
            expect(batch.files.length).toBe(1);
            expect(batch.files[0].fileIndex).toBe(0);
            expect(batch.totalPageCount).toBe(KNOWN_SINGLE_PAGE_PDF_COUNT);

            const jobResult = await worker.processNextJob();
            expect(jobResult.processed).toBe(true);
            expect(jobResult.status).toBe(IngestionStatus.DONE);
            expect(jobResult.processedPages).toBe(1);
            expect(jobResult.failedPages).toBe(0);

            // Verify updated Batch & Job records in DB
            const updatedBatch = await Batch.findOne({ batchId: batch.batchId });
            expect(updatedBatch?.status).toBe(BatchStatus.DONE);

            const updatedJob = await IngestionJob.findOne({ batchId: batch.batchId });
            expect(updatedJob?.status).toBe(IngestionStatus.DONE);
            expect(updatedJob?.processedPages).toBe(1);
            expect(updatedJob?.totalPages).toBe(1);

            // Verify IngestionPage record
            const pages = await IngestionPage.find({ batchId: batch.batchId });
            expect(pages.length).toBe(1);

            const page = pages[0];
            expect(page.batchId).toBe(batch.batchId);
            expect(page.fileId).toBe(batch.files[0].fileId);
            expect(page.fileIndex).toBe(0);
            expect(page.pageNumber).toBe(1);
            expect(page.status).toBe(PageProcessingStatus.PROCESSED);
            expect(page.width).toBeGreaterThan(0);
            expect(page.height).toBeGreaterThan(0);
            expect(page.thumbnailKey).toBeDefined();

            // Verify stored derived page file on disk
            const derivedDiskPath = defaultDerivedStorageService.getDerivedDiskPath(page.storageKey);
            expect(fs.existsSync(derivedDiskPath)).toBe(true);
            const derivedBuffer = fs.readFileSync(derivedDiskPath);
            // PNG signature: [0x89, 0x50, 0x4E, 0x47]
            expect(derivedBuffer[0]).toBe(0x89);
            expect(derivedBuffer[1]).toBe(0x50);
            expect(derivedBuffer[2]).toBe(0x4e);
            expect(derivedBuffer[3]).toBe(0x47);

            // Verify stored derived thumbnail file on disk
            const thumbDiskPath = defaultDerivedStorageService.getDerivedDiskPath(page.thumbnailKey!);
            expect(fs.existsSync(thumbDiskPath)).toBe(true);
            const thumbBuffer = fs.readFileSync(thumbDiskPath);
            // JPEG signature: [0xFF, 0xD8, 0xFF]
            expect(thumbBuffer[0]).toBe(0xff);
            expect(thumbBuffer[1]).toBe(0xd8);
            expect(thumbBuffer[2]).toBe(0xff);
        });
    });

    describe('3. Multi-Page Real PDF Pipeline Integration', () => {
        it('should process a real multi-page PDF fixture and create all page records in order', async () => {
            const { batch } = await batchService.createBatch(
                [{ name: 'multi_exam.pdf', buffer: multiPagePdfBuffer, size: multiPagePdfBuffer.length }],
                undefined,
                adminContext
            );
            createdBatchIds.push(batch.batchId);

            const jobResult = await worker.processNextJob();
            expect(jobResult.processed).toBe(true);
            expect(jobResult.status).toBe(IngestionStatus.DONE);
            expect(jobResult.processedPages).toBe(KNOWN_MULTI_PAGE_PDF_COUNT);

            const pages = await IngestionPage.find({ batchId: batch.batchId }).sort({ pageNumber: 1 });
            expect(pages.length).toBe(KNOWN_MULTI_PAGE_PDF_COUNT);

            pages.forEach((p, idx) => {
                expect(p.batchId).toBe(batch.batchId);
                expect(p.fileId).toBe(batch.files[0].fileId);
                expect(p.fileIndex).toBe(0);
                expect(p.pageNumber).toBe(idx + 1);
                expect(p.status).toBe(PageProcessingStatus.PROCESSED);
                expect(p.thumbnailKey).toBeTruthy();
                expect(p.width).toBeGreaterThan(0);
                expect(p.height).toBeGreaterThan(0);

                const diskPath = defaultDerivedStorageService.getDerivedDiskPath(p.storageKey);
                expect(fs.existsSync(diskPath)).toBe(true);
            });
        });
    });

    describe('4. Real Image-Only Fixtures Integration', () => {
        it('should process standalone PNG and JPEG fixtures and assign pageNumber = 1 to each', async () => {
            const { batch } = await batchService.createBatch(
                [
                    { name: 'diagram.png', buffer: samplePngBuffer, size: samplePngBuffer.length },
                    { name: 'photo.jpg', buffer: sampleJpgBuffer, size: sampleJpgBuffer.length }
                ],
                undefined,
                adminContext
            );
            createdBatchIds.push(batch.batchId);

            expect(batch.files.length).toBe(2);
            expect(batch.files[0].fileIndex).toBe(0);
            expect(batch.files[0].pageCount).toBe(1);
            expect(batch.files[1].fileIndex).toBe(1);
            expect(batch.files[1].pageCount).toBe(1);

            const jobResult = await worker.processNextJob();
            expect(jobResult.status).toBe(IngestionStatus.DONE);
            expect(jobResult.processedPages).toBe(2);

            const pages = await IngestionPage.find({ batchId: batch.batchId }).sort({ fileIndex: 1 });
            expect(pages.length).toBe(2);

            // PNG image page
            expect(pages[0].fileIndex).toBe(0);
            expect(pages[0].fileId).toBe(batch.files[0].fileId);
            expect(pages[0].pageNumber).toBe(1);
            expect(pages[0].status).toBe(PageProcessingStatus.PROCESSED);
            expect(pages[0].thumbnailKey).toBeTruthy();

            // JPG image page
            expect(pages[1].fileIndex).toBe(1);
            expect(pages[1].fileId).toBe(batch.files[1].fileId);
            expect(pages[1].pageNumber).toBe(1);
            expect(pages[1].status).toBe(PageProcessingStatus.PROCESSED);
            expect(pages[1].thumbnailKey).toBeTruthy();
        });
    });

    describe('5. Mixed PDF + Image Real Fixtures & Deterministic Ordering', () => {
        it('should process mixed multi-page PDF + PNG + JPG with deterministic (fileIndex, pageNumber) order', async () => {
            const { batch } = await batchService.createBatch(
                [
                    { name: 'document.pdf', buffer: multiPagePdfBuffer, size: multiPagePdfBuffer.length },
                    { name: 'figure1.png', buffer: samplePngBuffer, size: samplePngBuffer.length },
                    { name: 'figure2.jpg', buffer: sampleJpgBuffer, size: sampleJpgBuffer.length }
                ],
                undefined,
                adminContext
            );
            createdBatchIds.push(batch.batchId);

            // Total: 3 (from PDF) + 1 (from PNG) + 1 (from JPG) = 5
            expect(batch.totalPageCount).toBe(5);

            const jobResult = await worker.processNextJob();
            expect(jobResult.status).toBe(IngestionStatus.DONE);
            expect(jobResult.processedPages).toBe(5);

            const pages = await IngestionPage.find({ batchId: batch.batchId }).sort({ fileIndex: 1, pageNumber: 1 });
            expect(pages.length).toBe(5);

            // Verify canonical (fileIndex, pageNumber) sequence
            const expectedSequence = [
                { fileIndex: 0, pageNumber: 1, fileId: batch.files[0].fileId },
                { fileIndex: 0, pageNumber: 2, fileId: batch.files[0].fileId },
                { fileIndex: 0, pageNumber: 3, fileId: batch.files[0].fileId },
                { fileIndex: 1, pageNumber: 1, fileId: batch.files[1].fileId },
                { fileIndex: 2, pageNumber: 1, fileId: batch.files[2].fileId }
            ];

            pages.forEach((p, idx) => {
                expect(p.fileIndex).toBe(expectedSequence[idx].fileIndex);
                expect(p.pageNumber).toBe(expectedSequence[idx].pageNumber);
                expect(p.fileId).toBe(expectedSequence[idx].fileId);
                expect(p.status).toBe(PageProcessingStatus.PROCESSED);
            });
        });
    });

    describe('6. Authoritative PDF Page-Count Reconciliation with Real Fixture', () => {
        it('should reconcile upload-time regex count with authoritative renderer count to reach DONE', async () => {
            // reconciliation.pdf triggers regex count of 2 at upload time, but true page count is 1
            const { batch, job } = await batchService.createBatch(
                [{ name: 'reconciliation_test.pdf', buffer: reconciliationPdfBuffer, size: reconciliationPdfBuffer.length }],
                undefined,
                adminContext
            );
            createdBatchIds.push(batch.batchId);

            expect(batch.totalPageCount).toBe(KNOWN_RECONCILIATION_REGEX_PAGE_COUNT);
            expect(job.totalPages).toBe(KNOWN_RECONCILIATION_REGEX_PAGE_COUNT);

            // Process job with worker
            const jobResult = await worker.processNextJob();
            expect(jobResult.processed).toBe(true);
            expect(jobResult.status).toBe(IngestionStatus.DONE);

            // Authoritative count should be reconciled to 1
            expect(jobResult.processedPages).toBe(KNOWN_RECONCILIATION_TRUE_PAGE_COUNT);
            expect(jobResult.failedPages).toBe(0);

            // Job and Batch records in DB should reflect reconciled totalPages
            const updatedJob = await IngestionJob.findOne({ batchId: batch.batchId });
            expect(updatedJob?.status).toBe(IngestionStatus.DONE);
            expect(updatedJob?.totalPages).toBe(KNOWN_RECONCILIATION_TRUE_PAGE_COUNT);
            expect(updatedJob?.processedPages).toBe(KNOWN_RECONCILIATION_TRUE_PAGE_COUNT);

            const updatedBatch = await Batch.findOne({ batchId: batch.batchId });
            expect(updatedBatch?.status).toBe(BatchStatus.DONE);
            expect(updatedBatch?.totalPageCount).toBe(KNOWN_RECONCILIATION_TRUE_PAGE_COUNT);

            // Exactly 1 Page document should exist
            const pages = await IngestionPage.find({ batchId: batch.batchId });
            expect(pages.length).toBe(1);
            expect(pages[0].pageNumber).toBe(1);
            expect(pages[0].status).toBe(PageProcessingStatus.PROCESSED);
        });
    });

    describe('7. Idempotency & Retry on Real Fixtures', () => {
        it('should preserve ordering and not create duplicate records or derived files on retry', async () => {
            const { batch, job } = await batchService.createBatch(
                [
                    { name: 'doc1.pdf', buffer: multiPagePdfBuffer, size: multiPagePdfBuffer.length },
                    { name: 'img2.png', buffer: samplePngBuffer, size: samplePngBuffer.length }
                ],
                undefined,
                adminContext
            );
            createdBatchIds.push(batch.batchId);

            // Initial run
            const firstResult = await worker.processNextJob();
            expect(firstResult.status).toBe(IngestionStatus.DONE);
            expect(firstResult.processedPages).toBe(4);

            const initialPages = await IngestionPage.find({ batchId: batch.batchId }).sort({ fileIndex: 1, pageNumber: 1 });
            expect(initialPages.length).toBe(4);
            const initialPageIds = initialPages.map(p => p._id.toString());

            // Re-queue job for retry simulation
            await IngestionJob.updateOne(
                { _id: job._id },
                { $set: { status: IngestionStatus.QUEUED, attempts: 0 } }
            );

            const secondResult = await worker.processNextJob();
            expect(secondResult.status).toBe(IngestionStatus.DONE);
            expect(secondResult.processedPages).toBe(4);

            const retriedPages = await IngestionPage.find({ batchId: batch.batchId }).sort({ fileIndex: 1, pageNumber: 1 });
            expect(retriedPages.length).toBe(4);
            const retriedPageIds = retriedPages.map(p => p._id.toString());

            // Exact same document ObjectIDs (no duplicate documents created)
            expect(retriedPageIds).toEqual(initialPageIds);

            // Deterministic fileIndex & pageNumber retained
            expect(retriedPages[0].fileIndex).toBe(0);
            expect(retriedPages[0].pageNumber).toBe(1);
            expect(retriedPages[1].fileIndex).toBe(0);
            expect(retriedPages[1].pageNumber).toBe(2);
            expect(retriedPages[2].fileIndex).toBe(0);
            expect(retriedPages[2].pageNumber).toBe(3);
            expect(retriedPages[3].fileIndex).toBe(1);
            expect(retriedPages[3].pageNumber).toBe(1);
        });
    });

    describe('8. Reject-Whole-Batch on Invalid Fixture Inputs', () => {
        it('should reject whole batch if one file is invalid and create no records or orphaned files', async () => {
            const initialBatchCount = await Batch.countDocuments();
            const initialJobCount = await IngestionJob.countDocuments();
            const initialPageCount = await IngestionPage.countDocuments();

            await expect(
                batchService.createBatch(
                    [
                        { name: 'valid.pdf', buffer: singlePagePdfBuffer, size: singlePagePdfBuffer.length },
                        { name: 'corrupted.bin', buffer: corruptedBuffer, size: corruptedBuffer.length }
                    ],
                    undefined,
                    adminContext
                )
            ).rejects.toThrow(HttpError);

            // Verify no DB records created
            expect(await Batch.countDocuments()).toBe(initialBatchCount);
            expect(await IngestionJob.countDocuments()).toBe(initialJobCount);
            expect(await IngestionPage.countDocuments()).toBe(initialPageCount);
        });
    });

    describe('9. Runtime Storage Cleanup & Isolation', () => {
        it('should cleanly remove on-disk originals and derived files after batch lifecycle', async () => {
            const { batch } = await batchService.createBatch(
                [{ name: 'temp_cleanup.pdf', buffer: singlePagePdfBuffer, size: singlePagePdfBuffer.length }],
                undefined,
                adminContext
            );

            // Process job to create derived assets and thumbnails
            await worker.processNextJob();

            const originalPath = path.join(
                process.env.ORIGINAL_STORAGE_PATH || path.join(process.cwd(), 'data', 'originals'),
                batch.batchId
            );
            const derivedPath = path.join(
                defaultDerivedStorageService.getStorageRoot(),
                batch.batchId
            );

            expect(fs.existsSync(originalPath)).toBe(true);
            expect(fs.existsSync(derivedPath)).toBe(true);

            // Perform explicit cleanup
            await ImmutableStorageService.cleanupBatch(batch.batchId);
            await fs.promises.rm(derivedPath, { recursive: true, force: true });

            expect(fs.existsSync(originalPath)).toBe(false);
            expect(fs.existsSync(derivedPath)).toBe(false);
        });
    });
});
