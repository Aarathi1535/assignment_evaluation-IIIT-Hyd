import { describe, it, expect, beforeAll } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import mongoose from 'mongoose';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import pageIngestionService from '../services/PageIngestionService';
import { connectDB } from '../lib/db';

function createBlankPageBuffer(width = 200, height = 200): Buffer {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    return canvas.toBuffer('image/png');
}

function createNearBlankPageBuffer(width = 200, height = 200): Buffer {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000000';
    ctx.fillRect(100, 100, 2, 2); // 4 pixels non-white (~0.01%)
    return canvas.toBuffer('image/png');
}

function createPageWithEdgeNoiseBuffer(width = 200, height = 200): Buffer {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    // Draw thick dark border/shadow inside the 5% margin (e.g. at x = 2, width = 6)
    ctx.fillStyle = '#111111';
    ctx.fillRect(2, 0, 6, height);
    return canvas.toBuffer('image/png');
}

function createNormalPageBuffer(width = 200, height = 200): Buffer {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#111111';
    ctx.font = '10px sans-serif';
    ctx.fillText('Student Answer details', 20, 40);
    ctx.fillText('Question 1: Solution code text', 20, 80);
    ctx.fillText('Line 2 of written content', 20, 120);
    return canvas.toBuffer('image/png');
}

describe('AE-065 Duplicate / Blank Page Detection tests', () => {
    beforeAll(async () => {
        await connectDB();
    });

    describe('1. Near-Blank Detection tests', () => {
        it('should flag a clearly blank page as near-blank', async () => {
            const buf = createBlankPageBuffer();
            const result = await pageIngestionService.detectBlankAndHash({
                buffer: buf,
                batchId: 'batch-blank',
                fileIndex: 0,
                pageNumber: 1
            });
            expect(result.nearBlank).toBe(true);
        });

        it('should flag a page with minimal pixels as near-blank', async () => {
            const buf = createNearBlankPageBuffer();
            const result = await pageIngestionService.detectBlankAndHash({
                buffer: buf,
                batchId: 'batch-blank',
                fileIndex: 0,
                pageNumber: 1
            });
            expect(result.nearBlank).toBe(true);
        });

        it('should NOT flag a page with normal written content as near-blank', async () => {
            const buf = createNormalPageBuffer();
            const result = await pageIngestionService.detectBlankAndHash({
                buffer: buf,
                batchId: 'batch-normal',
                fileIndex: 0,
                pageNumber: 1
            });
            expect(result.nearBlank).toBe(false);
        });

        it('should exclude edge scanner noise from near-blank calculations', async () => {
            const buf = createPageWithEdgeNoiseBuffer();
            const result = await pageIngestionService.detectBlankAndHash({
                buffer: buf,
                batchId: 'batch-edge',
                fileIndex: 0,
                pageNumber: 1
            });
            // Border is inside the 5% margin, so it should be excluded, leaving the rest blank
            expect(result.nearBlank).toBe(true);
        });
    });

    describe('2. Duplicate Detection tests', () => {
        it('should detect identical pages as duplicates within the same batch', async () => {
            const batchId = crypto.randomUUID();
            const job = await IngestionJob.create({
                batchId,
                batch: new mongoose.Types.ObjectId(),
                uploadedBy: new mongoose.Types.ObjectId(),
                status: IngestionStatus.PROCESSING,
                totalPages: 2,
                processedPages: 0,
                failedPages: 0
            });

            const buf = createNormalPageBuffer();

            // Process first page
            const page1Result = await pageIngestionService.processPage({
                batchId,
                jobId: job._id as mongoose.Types.ObjectId,
                fileId: 'file-x',
                fileIndex: 0,
                storageKey: 'key-1',
                pageNumber: 1,
                fileType: 'image/png',
                fileBuffer: buf
            });

            // Process second page (identical buffer)
            const page2Result = await pageIngestionService.processPage({
                batchId,
                jobId: job._id as mongoose.Types.ObjectId,
                fileId: 'file-y',
                fileIndex: 1,
                storageKey: 'key-2',
                pageNumber: 1,
                fileType: 'image/png',
                fileBuffer: buf
            });

            if (!page1Result.success) console.log('PAGE 1 FAILURE:', page1Result.failureReason);
            if (!page2Result.success) console.log('PAGE 2 FAILURE:', page2Result.failureReason);
            expect(page1Result.success).toBe(true);
            expect(page2Result.success).toBe(true);

            const p1 = page1Result.pageRecord!;
            const p2 = page2Result.pageRecord!;

            expect(p1.isDuplicate).toBe(false);
            expect(p2.isDuplicate).toBe(true);
            expect(p2.duplicateOf?.toString()).toBe(p1._id.toString());
        });

        it('should detect visually identical pages with different encoding/compression as duplicates', async () => {
            const batchId = crypto.randomUUID();
            const job = await IngestionJob.create({
                batchId,
                batch: new mongoose.Types.ObjectId(),
                uploadedBy: new mongoose.Types.ObjectId(),
                status: IngestionStatus.PROCESSING,
                totalPages: 2,
                processedPages: 0,
                failedPages: 0
            });

            // Create canvas and write normal text
            const canvas = createCanvas(200, 200);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, 200, 200);
            ctx.fillStyle = '#000000';
            ctx.fillText('Visually identical text content', 30, 80);

            // Compress one as PNG and one as JPEG
            const pngBuf = canvas.toBuffer('image/png');
            const jpegBuf = canvas.toBuffer('image/jpeg');

            const page1Result = await pageIngestionService.processPage({
                batchId,
                jobId: job._id as mongoose.Types.ObjectId,
                fileId: 'file-1',
                fileIndex: 0,
                storageKey: 'key-1',
                pageNumber: 1,
                fileType: 'image/png',
                fileBuffer: pngBuf
            });

            const page2Result = await pageIngestionService.processPage({
                batchId,
                jobId: job._id as mongoose.Types.ObjectId,
                fileId: 'file-2',
                fileIndex: 1,
                storageKey: 'key-2',
                pageNumber: 1,
                fileType: 'image/jpeg',
                fileBuffer: jpegBuf
            });

            if (!page1Result.success) console.log('PAGE 1 FAILURE:', page1Result.failureReason);
            if (!page2Result.success) console.log('PAGE 2 FAILURE:', page2Result.failureReason);
            expect(page1Result.success).toBe(true);
            expect(page2Result.success).toBe(true);

            expect(page1Result.pageRecord!.isDuplicate).toBe(false);
            expect(page2Result.pageRecord!.isDuplicate).toBe(true);
            expect(page2Result.pageRecord!.duplicateOf?.toString()).toBe(page1Result.pageRecord!._id.toString());
        });

        it('should NOT flag visually different pages as duplicates', async () => {
            const batchId = crypto.randomUUID();
            const job = await IngestionJob.create({
                batchId,
                batch: new mongoose.Types.ObjectId(),
                uploadedBy: new mongoose.Types.ObjectId(),
                status: IngestionStatus.PROCESSING,
                totalPages: 2,
                processedPages: 0,
                failedPages: 0
            });

            const canvas1 = createCanvas(200, 200);
            const ctx1 = canvas1.getContext('2d');
            ctx1.fillStyle = '#FFFFFF';
            ctx1.fillRect(0, 0, 200, 200);
            ctx1.fillStyle = '#000000';
            ctx1.fillText('Page 1 Content', 30, 80);
            const buf1 = canvas1.toBuffer('image/png');

            const canvas2 = createCanvas(200, 200);
            const ctx2 = canvas2.getContext('2d');
            ctx2.fillStyle = '#FFFFFF';
            ctx2.fillRect(0, 0, 200, 200);
            ctx2.fillStyle = '#000000';
            ctx2.fillText('Completely different Page 2', 30, 80);
            const buf2 = canvas2.toBuffer('image/png');

            const page1Result = await pageIngestionService.processPage({
                batchId,
                jobId: job._id as mongoose.Types.ObjectId,
                fileId: 'file-1',
                fileIndex: 0,
                storageKey: 'key-1',
                pageNumber: 1,
                fileType: 'image/png',
                fileBuffer: buf1
            });

            const page2Result = await pageIngestionService.processPage({
                batchId,
                jobId: job._id as mongoose.Types.ObjectId,
                fileId: 'file-2',
                fileIndex: 1,
                storageKey: 'key-2',
                pageNumber: 1,
                fileType: 'image/png',
                fileBuffer: buf2
            });

            if (!page1Result.success) console.log('PAGE 1 FAILURE:', page1Result.failureReason);
            if (!page2Result.success) console.log('PAGE 2 FAILURE:', page2Result.failureReason);
            expect(page1Result.success).toBe(true);
            expect(page2Result.success).toBe(true);

            expect(page1Result.pageRecord!.isDuplicate).toBe(false);
            expect(page2Result.pageRecord!.isDuplicate).toBe(false);
        });

        it('should only compare duplicates within the same batch (isolation)', async () => {
            const batchId1 = crypto.randomUUID();
            const batchId2 = crypto.randomUUID();
            const job1 = await IngestionJob.create({
                batchId: batchId1,
                batch: new mongoose.Types.ObjectId(),
                uploadedBy: new mongoose.Types.ObjectId(),
                totalPages: 1,
                processedPages: 0,
                failedPages: 0
            });
            const job2 = await IngestionJob.create({
                batchId: batchId2,
                batch: new mongoose.Types.ObjectId(),
                uploadedBy: new mongoose.Types.ObjectId(),
                totalPages: 1,
                processedPages: 0,
                failedPages: 0
            });

            const buf = createNormalPageBuffer();

            const pageBatch1 = await pageIngestionService.processPage({
                batchId: batchId1,
                jobId: job1._id as mongoose.Types.ObjectId,
                fileId: 'file-1',
                fileIndex: 0,
                storageKey: 'key-1',
                pageNumber: 1,
                fileType: 'image/png',
                fileBuffer: buf
            });

            const pageBatch2 = await pageIngestionService.processPage({
                batchId: batchId2,
                jobId: job2._id as mongoose.Types.ObjectId,
                fileId: 'file-2',
                fileIndex: 0,
                storageKey: 'key-2',
                pageNumber: 1,
                fileType: 'image/png',
                fileBuffer: buf
            });

            expect(pageBatch1.success).toBe(true);
            expect(pageBatch2.success).toBe(true);

            // Even though images are identical, different batches must remain isolated!
            expect(pageBatch1.pageRecord!.isDuplicate).toBe(false);
            expect(pageBatch2.pageRecord!.isDuplicate).toBe(false);
        });
    });

    describe('3. Safety & Flow Integrity tests', () => {
        it('should NOT delete flagged pages and preserve status & relations', async () => {
            const batchId = crypto.randomUUID();
            const job = await IngestionJob.create({
                batchId,
                batch: new mongoose.Types.ObjectId(),
                uploadedBy: new mongoose.Types.ObjectId(),
                totalPages: 2,
                processedPages: 0,
                failedPages: 0
            });

            const bufBlank = createBlankPageBuffer();
            const result = await pageIngestionService.processPage({
                batchId,
                jobId: job._id as mongoose.Types.ObjectId,
                fileId: 'file-1',
                fileIndex: 0,
                storageKey: 'key-1',
                pageNumber: 1,
                fileType: 'image/png',
                fileBuffer: bufBlank
            });

            expect(result.success).toBe(true);
            const page = await IngestionPage.findById(result.pageRecord!._id);
            expect(page).not.toBeNull();
            expect(page!.nearBlank).toBe(true);
            expect(page!.status).toBe(PageProcessingStatus.PROCESSED);
        });

        it('should propagate a critical rendering error correctly without silently ignoring it', async () => {
            const batchId = crypto.randomUUID();
            const job = await IngestionJob.create({
                batchId,
                batch: new mongoose.Types.ObjectId(),
                uploadedBy: new mongoose.Types.ObjectId(),
                totalPages: 1,
                processedPages: 0,
                failedPages: 0
            });

            // Invalid empty buffer to force error
            const result = await pageIngestionService.processPage({
                batchId,
                jobId: job._id as mongoose.Types.ObjectId,
                fileId: 'file-1',
                fileIndex: 0,
                storageKey: 'key-1',
                pageNumber: 1,
                fileType: 'image/png',
                fileBuffer: Buffer.alloc(0)
            });

            expect(result.success).toBe(false);
            const page = await IngestionPage.findOne({ batchId, pageNumber: 1 });
            expect(page).not.toBeNull();
            expect(page!.status).toBe(PageProcessingStatus.FAILED);
        });
    });
});
