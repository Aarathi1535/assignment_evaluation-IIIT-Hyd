import mongoose from 'mongoose';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import batchService from '../services/BatchService';
import { IngestionWorker } from '../services/IngestionWorker';
import { DefaultImageRenderer } from '../services/PageRenderer';

function createValidPdfBuffer(pageCount = 1, widthPt = 612, heightPt = 792): Buffer {
    let pdfStr = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [`;
    for (let i = 1; i <= pageCount; i++) {
        pdfStr += `${i + 2} 0 R `;
    }
    pdfStr += `] /Count ${pageCount} >>\nendobj\n`;

    for (let i = 1; i <= pageCount; i++) {
        pdfStr += `${i + 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] >>\nendobj\n`;
    }
    pdfStr += `xref\n0 ${pageCount + 3}\ntrailer\n<< /Size ${pageCount + 3} /Root 1 0 R >>\nstartxref\n500\n%%EOF`;
    return Buffer.from(pdfStr, 'utf-8');
}

function createValidImageBuffer(format: 'png' | 'jpeg', width = 200, height = 300): Buffer {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = format === 'jpeg' ? '#FF5733' : '#33FF57';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    ctx.fillText('Test Image', 10, 50);
    return format === 'jpeg' ? canvas.toBuffer('image/jpeg') : canvas.toBuffer('image/png');
}

describe('AE-048 — Mixed Inputs (Image-Only, Multi-PDF, Mixed Batches)', () => {
    const professorId = new mongoose.Types.ObjectId().toString();
    const adminContext = {
        actingUserId: professorId,
        actingUserRole: 'PROFESSOR',
        ipAddress: '127.0.0.1'
    };

    afterEach(async () => {
        vi.restoreAllMocks();
    });

    describe('1. DefaultImageRenderer Unit Tests', () => {
        it('should report authoritative page count of exactly 1 for images', async () => {
            const renderer = new DefaultImageRenderer();
            const pngBuf = createValidImageBuffer('png');
            const pageCount = await renderer.getPageCount(pngBuf);
            expect(pageCount).toBe(1);
        });

        it('should normalize a PNG image to the canonical RenderedPageImage contract', async () => {
            const renderer = new DefaultImageRenderer();
            const pngBuf = createValidImageBuffer('png', 400, 600);

            const result = await renderer.renderPage({
                batchId: 'b-img-1',
                fileId: 'f-img-1',
                pageNumber: 1,
                fileType: 'image',
                fileBuffer: pngBuf
            });

            expect(result.success).toBe(true);
            expect(result.pageNumber).toBe(1);
            expect(result.image).toBeDefined();
            expect(result.image!.format).toBe('png');
            expect(result.image!.width).toBe(400);
            expect(result.image!.height).toBe(600);
            expect(result.image!.dpi).toBe(150);
            expect(result.image!.pageNumber).toBe(1);
            expect(result.image!.sizeBytes).toBeGreaterThan(0);

            // PNG magic bytes
            expect(result.image!.buffer[0]).toBe(0x89);
            expect(result.image!.buffer[1]).toBe(0x50);
            expect(result.image!.buffer[2]).toBe(0x4e);
            expect(result.image!.buffer[3]).toBe(0x47);
        });

        it('should normalize a JPEG image and enforce safety limits on large images', async () => {
            const renderer = new DefaultImageRenderer();
            const largeJpg = createValidImageBuffer('jpeg', 3000, 2000);

            const result = await renderer.renderPage({
                batchId: 'b-img-2',
                fileId: 'f-img-2',
                pageNumber: 1,
                fileType: 'image',
                fileBuffer: largeJpg
            });

            expect(result.success).toBe(true);
            expect(result.pageNumber).toBe(1);
            expect(result.image!.width).toBeLessThanOrEqual(2048);
            expect(result.image!.height).toBeLessThanOrEqual(2048);

            const ratio = result.image!.width / result.image!.height;
            expect(ratio).toBeCloseTo(3000 / 2000, 1);
        });

        it('should reject pageNumber > 1 for standalone image inputs', async () => {
            const renderer = new DefaultImageRenderer();
            const pngBuf = createValidImageBuffer('png');

            const result = await renderer.renderPage({
                batchId: 'b-img-3',
                fileId: 'f-img-3',
                pageNumber: 2,
                fileType: 'image',
                fileBuffer: pngBuf
            });

            expect(result.success).toBe(false);
            expect(result.failureReason).toContain('Requested page 2 is out of bounds for standalone image');
        });

        it('should return a clean failure when image buffer is missing or empty', async () => {
            const renderer = new DefaultImageRenderer();
            const result = await renderer.renderPage({
                batchId: 'b-img-4',
                fileId: 'f-img-4',
                pageNumber: 1,
                fileType: 'image',
                fileBuffer: Buffer.alloc(0)
            });

            expect(result.success).toBe(false);
            expect(result.failureReason).toContain('missing or empty');
        });
    });

    describe('2. Batch Creation & Persisted fileIndex Ordering', () => {
        it('should assign zero-based sequential fileIndex matching receipt order', async () => {
            const pdfBuf = createValidPdfBuffer(2);
            const pngBuf = createValidImageBuffer('png');
            const jpgBuf = createValidImageBuffer('jpeg');

            const { batch, job } = await batchService.createBatch(
                [
                    { name: 'first.pdf', buffer: pdfBuf, size: pdfBuf.length },
                    { name: 'second.png', buffer: pngBuf, size: pngBuf.length },
                    { name: 'third.jpg', buffer: jpgBuf, size: jpgBuf.length }
                ],
                undefined,
                adminContext
            );

            expect(batch.files.length).toBe(3);
            expect(batch.files[0].fileIndex).toBe(0);
            expect(batch.files[0].originalFilename).toBe('first.pdf');
            expect(batch.files[0].fileType).toBe('pdf');
            expect(batch.files[0].pageCount).toBe(2);

            expect(batch.files[1].fileIndex).toBe(1);
            expect(batch.files[1].originalFilename).toBe('second.png');
            expect(batch.files[1].fileType).toBe('image');
            expect(batch.files[1].pageCount).toBe(1);

            expect(batch.files[2].fileIndex).toBe(2);
            expect(batch.files[2].originalFilename).toBe('third.jpg');
            expect(batch.files[2].fileType).toBe('image');
            expect(batch.files[2].pageCount).toBe(1);

            expect(batch.totalPageCount).toBe(4);
            expect(job.totalPages).toBe(4);
        });
    });

    describe('3. Image-Only Batch Ingestion', () => {
        it('should process an image-only batch with multiple images end-to-end', async () => {
            const pngBuf1 = createValidImageBuffer('png', 300, 400);
            const jpgBuf2 = createValidImageBuffer('jpeg', 500, 600);

            const { batch, job } = await batchService.createBatch(
                [
                    { name: 'page1.png', buffer: pngBuf1, size: pngBuf1.length },
                    { name: 'page2.jpg', buffer: jpgBuf2, size: jpgBuf2.length }
                ],
                undefined,
                adminContext
            );

            const worker = new IngestionWorker();
            const result = await worker.processNextJob();

            expect(result.processed).toBe(true);
            expect(result.status).toBe(IngestionStatus.DONE);
            expect(result.processedPages).toBe(2);
            expect(result.failedPages).toBe(0);

            // Verify IngestionPages in DB
            const pages = await IngestionPage.find({ batchId: batch.batchId }).sort({ fileIndex: 1, pageNumber: 1 });
            expect(pages.length).toBe(2);

            // Page 0 (from first image)
            expect(pages[0].fileIndex).toBe(0);
            expect(pages[0].fileId).toBe(batch.files[0].fileId);
            expect(pages[0].pageNumber).toBe(1);
            expect(pages[0].status).toBe(PageProcessingStatus.PROCESSED);
            expect(pages[0].thumbnailKey).toBe(`batches/${batch.batchId}/derived/${batch.files[0].fileId}/1/thumb.jpg`);
            expect(pages[0].storageKey).toBe(`batches/${batch.batchId}/derived/${batch.files[0].fileId}/1/page.png`);
            expect(pages[0].width).toBe(300);
            expect(pages[0].height).toBe(400);

            // Page 1 (from second image)
            expect(pages[1].fileIndex).toBe(1);
            expect(pages[1].fileId).toBe(batch.files[1].fileId);
            expect(pages[1].pageNumber).toBe(1);
            expect(pages[1].status).toBe(PageProcessingStatus.PROCESSED);
            expect(pages[1].thumbnailKey).toBe(`batches/${batch.batchId}/derived/${batch.files[1].fileId}/1/thumb.jpg`);
            expect(pages[1].storageKey).toBe(`batches/${batch.batchId}/derived/${batch.files[1].fileId}/1/page.png`);
            expect(pages[1].width).toBe(500);
            expect(pages[1].height).toBe(600);

            // Verify batch and job statuses
            const updatedBatch = await Batch.findOne({ batchId: batch.batchId });
            expect(updatedBatch!.status).toBe(BatchStatus.DONE);

            const updatedJob = await IngestionJob.findById(job._id);
            expect(updatedJob!.status).toBe(IngestionStatus.DONE);
            expect(updatedJob!.processedPages).toBe(2);
        });
    });

    describe('4. Multiple PDFs in a Single Batch', () => {
        it('should process multiple PDF files in receipt order with canonical (fileIndex, pageNumber)', async () => {
            const pdf1 = createValidPdfBuffer(2);
            const pdf2 = createValidPdfBuffer(3);

            const { batch } = await batchService.createBatch(
                [
                    { name: 'exam_part1.pdf', buffer: pdf1, size: pdf1.length },
                    { name: 'exam_part2.pdf', buffer: pdf2, size: pdf2.length }
                ],
                undefined,
                adminContext
            );

            const worker = new IngestionWorker();
            const result = await worker.processNextJob();

            expect(result.status).toBe(IngestionStatus.DONE);
            expect(result.processedPages).toBe(5);

            const pages = await IngestionPage.find({ batchId: batch.batchId }).sort({ fileIndex: 1, pageNumber: 1 });
            expect(pages.length).toBe(5);

            // Verify deterministic ordering: (0,1), (0,2), (1,1), (1,2), (1,3)
            expect(pages.map((p) => ({ fileIndex: p.fileIndex, pageNumber: p.pageNumber, fileId: p.fileId }))).toEqual([
                { fileIndex: 0, pageNumber: 1, fileId: batch.files[0].fileId },
                { fileIndex: 0, pageNumber: 2, fileId: batch.files[0].fileId },
                { fileIndex: 1, pageNumber: 1, fileId: batch.files[1].fileId },
                { fileIndex: 1, pageNumber: 2, fileId: batch.files[1].fileId },
                { fileIndex: 1, pageNumber: 3, fileId: batch.files[1].fileId }
            ]);

            for (const page of pages) {
                expect(page.status).toBe(PageProcessingStatus.PROCESSED);
                expect(page.thumbnailKey).toBeDefined();
                expect(page.storageKey).toContain('/derived/');
            }
        });
    });

    describe('5. Mixed PDF + Image Batch', () => {
        it('should process a mixed batch of PDF and PNG/JPG images maintaining deterministic order', async () => {
            const pdfBuf = createValidPdfBuffer(2);
            const pngBuf = createValidImageBuffer('png', 400, 500);
            const jpgBuf = createValidImageBuffer('jpeg', 600, 700);

            const { batch } = await batchService.createBatch(
                [
                    { name: 'answers.pdf', buffer: pdfBuf, size: pdfBuf.length },
                    { name: 'diagram1.png', buffer: pngBuf, size: pngBuf.length },
                    { name: 'diagram2.jpg', buffer: jpgBuf, size: jpgBuf.length }
                ],
                undefined,
                adminContext
            );

            const worker = new IngestionWorker();
            const result = await worker.processNextJob();

            expect(result.status).toBe(IngestionStatus.DONE);
            expect(result.processedPages).toBe(4);

            const pages = await IngestionPage.find({ batchId: batch.batchId }).sort({ fileIndex: 1, pageNumber: 1 });
            expect(pages.length).toBe(4);

            // Canonical sequence: (0,1), (0,2), (1,1), (2,1)
            expect(pages[0].fileIndex).toBe(0);
            expect(pages[0].pageNumber).toBe(1);
            expect(pages[0].fileId).toBe(batch.files[0].fileId);

            expect(pages[1].fileIndex).toBe(0);
            expect(pages[1].pageNumber).toBe(2);
            expect(pages[1].fileId).toBe(batch.files[0].fileId);

            expect(pages[2].fileIndex).toBe(1);
            expect(pages[2].pageNumber).toBe(1);
            expect(pages[2].fileId).toBe(batch.files[1].fileId);
            expect(pages[2].width).toBe(400);
            expect(pages[2].height).toBe(500);

            expect(pages[3].fileIndex).toBe(2);
            expect(pages[3].pageNumber).toBe(1);
            expect(pages[3].fileId).toBe(batch.files[2].fileId);
            expect(pages[3].width).toBe(600);
            expect(pages[3].height).toBe(700);
        });
    });

    describe('6. Idempotency & Retry on Mixed Batches', () => {
        it('should preserve identical (fileIndex, pageNumber) ordering and not duplicate records or assets on retry', async () => {
            const pdfBuf = createValidPdfBuffer(1);
            const pngBuf = createValidImageBuffer('png', 200, 200);

            const { batch, job } = await batchService.createBatch(
                [
                    { name: 'part1.pdf', buffer: pdfBuf, size: pdfBuf.length },
                    { name: 'part2.png', buffer: pngBuf, size: pngBuf.length }
                ],
                undefined,
                adminContext
            );

            const worker = new IngestionWorker();

            // Run 1: Process completely
            const run1 = await worker.processNextJob();
            expect(run1.status).toBe(IngestionStatus.DONE);
            expect(run1.processedPages).toBe(2);

            const pagesRun1 = await IngestionPage.find({ batchId: batch.batchId }).sort({ fileIndex: 1, pageNumber: 1 });
            expect(pagesRun1.length).toBe(2);

            // Re-queue job for retry simulation
            await IngestionJob.updateOne(
                { _id: job._id },
                { $set: { status: IngestionStatus.QUEUED, attempts: 0 } }
            );

            // Run 2: Retry processing
            const run2 = await worker.processNextJob();
            expect(run2.status).toBe(IngestionStatus.DONE);

            const pagesRun2 = await IngestionPage.find({ batchId: batch.batchId }).sort({ fileIndex: 1, pageNumber: 1 });
            expect(pagesRun2.length).toBe(2);

            // IDs and storageKeys must remain identical
            expect(pagesRun2[0]._id.toString()).toBe(pagesRun1[0]._id.toString());
            expect(pagesRun2[1]._id.toString()).toBe(pagesRun1[1]._id.toString());
            expect(pagesRun2[0].storageKey).toBe(pagesRun1[0].storageKey);
            expect(pagesRun2[1].storageKey).toBe(pagesRun1[1].storageKey);
            expect(pagesRun2[0].thumbnailKey).toBe(pagesRun1[0].thumbnailKey);
            expect(pagesRun2[1].thumbnailKey).toBe(pagesRun1[1].thumbnailKey);
        });
    });

    describe('7. Reject-Whole-Batch Semantics', () => {
        it('should reject the entire batch when any file fails validation without creating partial files', async () => {
            const validPdf = createValidPdfBuffer(1);
            const invalidFile = Buffer.from('CORRUPT_NOT_A_VALID_MAGIC_NUMBER_FILE');

            await expect(
                batchService.createBatch(
                    [
                        { name: 'valid.pdf', buffer: validPdf, size: validPdf.length },
                        { name: 'corrupt.bin', buffer: invalidFile, size: invalidFile.length }
                    ],
                    undefined,
                    adminContext
                )
            ).rejects.toThrow(/Unsupported or invalid file content/);

            // Verify no Batch document created
            const batchesInDb = await Batch.find({ uploadedBy: new mongoose.Types.ObjectId(professorId) });
            expect(batchesInDb.length).toBe(0);

            // Verify no IngestionPage records created
            const pagesInDb = await IngestionPage.find({});
            expect(pagesInDb.length).toBe(0);
        });

        it('should reject whole batch if a single PDF exceeds page limits without partially ingesting other files', async () => {
            const validPdf = createValidPdfBuffer(1);
            // PDF exceeding MAX_PDF_PAGE_COUNT (200)
            const hugePdf = createValidPdfBuffer(201);

            await expect(
                batchService.createBatch(
                    [
                        { name: 'valid.pdf', buffer: validPdf, size: validPdf.length },
                        { name: 'too_large.pdf', buffer: hugePdf, size: hugePdf.length }
                    ],
                    undefined,
                    adminContext
                )
            ).rejects.toThrow(/PDF page count limit exceeded/);

            const batchesInDb = await Batch.find({ uploadedBy: new mongoose.Types.ObjectId(professorId) });
            expect(batchesInDb.length).toBe(0);
        });
    });
});
