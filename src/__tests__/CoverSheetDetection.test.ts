import { describe, it, expect, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { createCanvas } from '@napi-rs/canvas';
import * as zxing from '@zxing/library';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import { PageIngestionService } from '../services/PageIngestionService';
import { CoverSheetDetector } from '../services/CoverSheetDetector';
import { IngestionWorker } from '../services/IngestionWorker';
import batchService from '../services/BatchService';
import { IngestionStatus } from '../models/IngestionJob';
import { UserRole } from '../models/User';

function createQrCodeImageBuffer(text: string, width = 300, height = 300): Buffer {
    const writer = new zxing.QRCodeWriter();
    const qrMatrix = writer.encode(text, zxing.BarcodeFormat.QR_CODE, 120, 120, new Map());

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#000000';
    for (let x = 0; x < qrMatrix.getWidth(); x++) {
        for (let y = 0; y < qrMatrix.getHeight(); y++) {
            if (qrMatrix.get(x, y)) {
                ctx.fillRect(30 + x, 30 + y, 1, 1);
            }
        }
    }

    return canvas.toBuffer('image/png');
}

function createMultipleQrCodeImageBuffer(texts: string[], width = 600, height = 400): Buffer {
    const writer = new zxing.QRCodeWriter();
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const positions = [
        { x: 30, y: 30 },
        { x: 350, y: 30 },
        { x: 30, y: 220 },
        { x: 350, y: 220 }
    ];

    texts.forEach((text, i) => {
        const qrMatrix = writer.encode(text, zxing.BarcodeFormat.QR_CODE, 100, 100, new Map());
        const pos = positions[i % positions.length];
        for (let x = 0; x < qrMatrix.getWidth(); x++) {
            for (let y = 0; y < qrMatrix.getHeight(); y++) {
                if (qrMatrix.get(x, y)) {
                    ctx.fillStyle = '#000000';
                    ctx.fillRect(pos.x + x, pos.y + y, 1, 1);
                }
            }
        }
    });

    return canvas.toBuffer('image/png');
}

function createBlankImageBuffer(width = 300, height = 300): Buffer {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#333333';
    ctx.font = '16px sans-serif';
    ctx.fillText('Plain assignment page without barcode', 20, 50);
    return canvas.toBuffer('image/png');
}

function createMinimalPdfBuffer(pageCount = 1): Buffer {
    let pdfStr = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [`;
    for (let i = 1; i <= pageCount; i++) {
        pdfStr += `${i + 2} 0 R `;
    }
    pdfStr += `] /Count ${pageCount} >>\nendobj\n`;

    for (let i = 1; i <= pageCount; i++) {
        pdfStr += `${i + 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n`;
    }
    pdfStr += `xref\n0 ${pageCount + 3}\ntrailer\n<< /Size ${pageCount + 3} /Root 1 0 R >>\nstartxref\n500\n%%EOF`;
    return Buffer.from(pdfStr, 'utf-8');
}

describe('AE-050 — QR/Barcode Cover-Sheet Detection', () => {
    const adminContext = {
        actingUserId: new mongoose.Types.ObjectId().toString(),
        actingUserRole: UserRole.ADMIN,
        actingUserEmail: 'admin@evaluator.edu'
    };

    afterEach(async () => {
        vi.restoreAllMocks();
    });

    describe('1. Direct CoverSheetDetector Unit Tests', () => {
        it('should detect a valid QR code containing a known student identifier', async () => {
            const detector = new CoverSheetDetector();
            const studentId = 'STU-2026-98765';
            const qrBuffer = createQrCodeImageBuffer(studentId);

            const result = await detector.detectCoverSheet(qrBuffer, 1);

            expect(result.isCoverPage).toBe(true);
            expect(result.decodeOutcome).toBe('found');
            expect(result.candidateStudentId).toBe(studentId);
        });

        it('should return not_found when image contains no readable QR or barcode', async () => {
            const detector = new CoverSheetDetector();
            const blankBuffer = createBlankImageBuffer();

            const result = await detector.detectCoverSheet(blankBuffer, 1);

            expect(result.isCoverPage).toBe(true);
            expect(result.decodeOutcome).toBe('not_found');
            expect(result.candidateStudentId).toBeNull();
        });

        it('should detect multiple distinct QR codes and return decodeOutcome: multiple', async () => {
            const detector = new CoverSheetDetector();
            const multiBuffer = createMultipleQrCodeImageBuffer(['STU-001', 'STU-002']);

            const result = await detector.detectCoverSheet(multiBuffer, 1);

            expect(result.isCoverPage).toBe(true);
            expect(result.decodeOutcome).toBe('multiple');
            expect(result.candidateStudentId).toBeNull();
        });

        it('should not scan non-cover pages (pageNumber > 1) and return isCoverPage: false', async () => {
            const detector = new CoverSheetDetector();
            const qrBuffer = createQrCodeImageBuffer('STU-SHOULD-NOT-BE-READ');

            const result = await detector.detectCoverSheet(qrBuffer, 2);

            expect(result.isCoverPage).toBe(false);
            expect(result.decodeOutcome).toBeNull();
            expect(result.candidateStudentId).toBeNull();
        });

        it('should gracefully handle empty or invalid buffers with not_found without throwing', async () => {
            const detector = new CoverSheetDetector();
            const corruptBuffer = Buffer.from('not an image', 'utf-8');

            const result = await detector.detectCoverSheet(corruptBuffer, 1);

            expect(result.isCoverPage).toBe(true);
            expect(result.decodeOutcome).toBe('not_found');
            expect(result.candidateStudentId).toBeNull();
        });
    });

    describe('2. PageIngestionService Cover-Sheet Detection Flow', () => {
        it('should scan page 1, persist candidateStudentId and decodeOutcome: found for valid QR', async () => {
            const service = new PageIngestionService();
            const batchId = crypto.randomUUID();
            const fileId = crypto.randomUUID();
            const jobId = new mongoose.Types.ObjectId();
            const studentId = 'STU-CS-101';
            const qrBuffer = createQrCodeImageBuffer(studentId);

            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey: `batches/${batchId}/${fileId}.png`,
                pageNumber: 1,
                fileType: 'image/png',
                fileBuffer: qrBuffer
            });

            expect(result.success).toBe(true);
            expect(result.pageRecord).toBeDefined();
            expect(result.pageRecord!.isCoverPage).toBe(true);
            expect(result.pageRecord!.decodeOutcome).toBe('found');
            expect(result.pageRecord!.candidateStudentId).toBe(studentId);

            // Verify persistence in MongoDB
            const saved = await IngestionPage.findOne({ batchId, fileIndex: 0, pageNumber: 1 });
            expect(saved).not.toBeNull();
            expect(saved!.isCoverPage).toBe(true);
            expect(saved!.decodeOutcome).toBe('found');
            expect(saved!.candidateStudentId).toBe(studentId);
            expect(saved!.status).toBe(PageProcessingStatus.PROCESSED);
        });

        it('should persist decodeOutcome: not_found when cover page has no barcode and not fail ingestion', async () => {
            const service = new PageIngestionService();
            const batchId = crypto.randomUUID();
            const fileId = crypto.randomUUID();
            const jobId = new mongoose.Types.ObjectId();
            const blankBuffer = createBlankImageBuffer();

            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey: `batches/${batchId}/${fileId}.png`,
                pageNumber: 1,
                fileType: 'image/png',
                fileBuffer: blankBuffer
            });

            expect(result.success).toBe(true);
            expect(result.pageRecord!.isCoverPage).toBe(true);
            expect(result.pageRecord!.decodeOutcome).toBe('not_found');
            expect(result.pageRecord!.candidateStudentId).toBeNull();
            expect(result.pageRecord!.status).toBe(PageProcessingStatus.PROCESSED);
        });

        it('should persist decodeOutcome: multiple when cover page has multiple barcodes', async () => {
            const service = new PageIngestionService();
            const batchId = crypto.randomUUID();
            const fileId = crypto.randomUUID();
            const jobId = new mongoose.Types.ObjectId();
            const multiBuffer = createMultipleQrCodeImageBuffer(['STU-A', 'STU-B']);

            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey: `batches/${batchId}/${fileId}.png`,
                pageNumber: 1,
                fileType: 'image/png',
                fileBuffer: multiBuffer
            });

            expect(result.success).toBe(true);
            expect(result.pageRecord!.isCoverPage).toBe(true);
            expect(result.pageRecord!.decodeOutcome).toBe('multiple');
            expect(result.pageRecord!.candidateStudentId).toBeNull();
        });

        it('should never invoke detector on non-cover pages (pageNumber > 1)', async () => {
            const detector = new CoverSheetDetector();
            const detectSpy = vi.spyOn(detector, 'detectCoverSheet');
            const service = new PageIngestionService(undefined, undefined, undefined, undefined, detector);

            const batchId = crypto.randomUUID();
            const fileId = crypto.randomUUID();
            const jobId = new mongoose.Types.ObjectId();
            const pdfBuffer = createMinimalPdfBuffer(2);

            // Process Page 2
            const result = await service.processPage({
                batchId,
                jobId,
                fileId,
                fileIndex: 0,
                storageKey: `batches/${batchId}/${fileId}.pdf`,
                pageNumber: 2,
                fileType: 'pdf',
                fileBuffer: pdfBuffer
            });

            expect(result.success).toBe(true);
            expect(result.pageRecord!.isCoverPage).toBe(false);
            expect(result.pageRecord!.decodeOutcome).toBeNull();
            expect(result.pageRecord!.candidateStudentId).toBeNull();

            // Assert that detector was NOT invoked for page 2
            expect(detectSpy).not.toHaveBeenCalled();
        });
    });

    describe('3. End-to-End Batch Ingestion with IngestionWorker', () => {
        it('should process image input through the normalized pipeline and detect cover QR', async () => {
            const studentId = 'STU-E2E-IMAGE-01';
            const qrImage = createQrCodeImageBuffer(studentId);

            const { batch } = await batchService.createBatch(
                [{ name: 'cover_sheet.png', buffer: qrImage, size: qrImage.length }],
                undefined,
                adminContext
            );

            const worker = new IngestionWorker();
            const jobResult = await worker.processNextJob();

            expect(jobResult.status).toBe(IngestionStatus.DONE);
            expect(jobResult.processedPages).toBe(1);

            const pageRecord = await IngestionPage.findOne({
                batchId: batch.batchId,
                fileIndex: 0,
                pageNumber: 1
            });

            expect(pageRecord).not.toBeNull();
            expect(pageRecord!.isCoverPage).toBe(true);
            expect(pageRecord!.decodeOutcome).toBe('found');
            expect(pageRecord!.candidateStudentId).toBe(studentId);
            expect(pageRecord!.status).toBe(PageProcessingStatus.PROCESSED);
            expect(pageRecord!.storageKey).toContain('/derived/');
        });

        it('should process multi-file mixed batch and assign cover status only to page 1 of each file', async () => {
            const studentId1 = 'STU-FILE1-001';
            const img1 = createQrCodeImageBuffer(studentId1);
            const img2 = createBlankImageBuffer();

            const { batch } = await batchService.createBatch(
                [
                    { name: 'student1_sub.png', buffer: img1, size: img1.length },
                    { name: 'student2_sub.png', buffer: img2, size: img2.length }
                ],
                undefined,
                adminContext
            );

            const worker = new IngestionWorker();
            const jobResult = await worker.processNextJob();

            expect(jobResult.status).toBe(IngestionStatus.DONE);
            expect(jobResult.processedPages).toBe(2);

            const file1Cover = await IngestionPage.findOne({
                batchId: batch.batchId,
                fileIndex: 0,
                pageNumber: 1
            });
            const file2Cover = await IngestionPage.findOne({
                batchId: batch.batchId,
                fileIndex: 1,
                pageNumber: 1
            });

            expect(file1Cover!.isCoverPage).toBe(true);
            expect(file1Cover!.decodeOutcome).toBe('found');
            expect(file1Cover!.candidateStudentId).toBe(studentId1);

            expect(file2Cover!.isCoverPage).toBe(true);
            expect(file2Cover!.decodeOutcome).toBe('not_found');
            expect(file2Cover!.candidateStudentId).toBeNull();
        });
    });
});
