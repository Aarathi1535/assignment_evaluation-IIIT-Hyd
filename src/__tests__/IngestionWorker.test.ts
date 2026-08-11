/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'fs';
import path from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import BatchRepository from '../repositories/BatchRepository';
import defaultPageIngestionService, { PageIngestionService } from '../services/PageIngestionService';
import { IPageRenderer } from '../services/PageRenderer';
import defaultIngestionWorker, { IngestionWorker } from '../services/IngestionWorker';
import { initBackgroundWorker } from '../lib/workerInit';

let mockSessionUser: any = null;

vi.mock('next-auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('next-auth')>();
    return {
        ...original,
        getServerSession: vi.fn().mockImplementation(() => {
            if (!mockSessionUser) return Promise.resolve(null);
            return Promise.resolve({ user: mockSessionUser });
        }),
    };
});

describe('Ingestion Background Worker & Recovery (AE-044)', () => {
    let ingestPOST: any;
    const professorId = new mongoose.Types.ObjectId().toString();

    beforeEach(async () => {
        ingestPOST = (await import('../app/api/ingest/route')).POST;
        mockSessionUser = {
            id: professorId,
            email: 'prof@university.edu',
            name: 'Professor User',
            role: 'PROFESSOR'
        };
    });

    afterEach(async () => {
        defaultIngestionWorker.stop();
        vi.restoreAllMocks();
    });

    function createValidPdfBuffer(pageCount = 3): Buffer {
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

    function toFile(buffer: Buffer, filename: string, type: string) {
        return new File([new Uint8Array(buffer)], filename, { type });
    }

    async function createTestBatchAndJob(totalPages = 3, maxRetries = 3) {
        const batchId = crypto.randomUUID();
        const fileId = crypto.randomUUID();

        // Write real valid PDF fixture to disk storage so real DefaultPdfRenderer can read and render it
        const pdfBuffer = createValidPdfBuffer(totalPages);
        const storageRoot = process.env.ORIGINAL_STORAGE_PATH || path.join(process.cwd(), 'data', 'originals');
        const batchDir = path.join(storageRoot, batchId);
        await fs.promises.mkdir(batchDir, { recursive: true });
        await fs.promises.writeFile(path.join(batchDir, `${fileId}.pdf`), pdfBuffer);

        const batch = await BatchRepository.createBatch({
            batchId,
            uploadedBy: new mongoose.Types.ObjectId(professorId),
            files: [
                {
                    fileId,
                    fileIndex: 0,
                    originalFilename: 'exam_paper.pdf',
                    fileType: 'pdf',
                    mimeType: 'application/pdf',
                    size: pdfBuffer.length,
                    pageCount: totalPages,
                    storageKey: `batches/${batchId}/${fileId}.pdf`,
                    sequenceNumber: 1
                }
            ],
            totalFiles: 1,
            totalSize: pdfBuffer.length,
            totalPageCount: totalPages,
            status: BatchStatus.QUEUED,
            isActive: true
        });

        const job = await BatchRepository.createIngestionJob({
            batchId,
            batch: batch._id as mongoose.Types.ObjectId,
            uploadedBy: new mongoose.Types.ObjectId(professorId),
            status: IngestionStatus.QUEUED,
            totalPages,
            processedPages: 0,
            failedPages: 0,
            attempts: 0,
            maxRetries
        });

        return { batch, job, batchId, fileId };
    }

    describe('1. Upload Returns Asynchronously in Queued State', () => {
        it('should return immediately with 201 Created and queued job without waiting for worker', async () => {
            const pdfBuffer = createValidPdfBuffer(2);
            const formData = new FormData();
            formData.append('file', toFile(pdfBuffer, 'script.pdf', 'application/pdf'));

            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST',
                body: formData
            });

            const res = await ingestPOST(req as any);
            expect(res.status).toBe(201);

            const resBody = await res.json();
            expect(resBody.success).toBe(true);
            expect(resBody.data.batchId).toBeDefined();
            expect(resBody.data.job.status).toBe('queued');
            expect(resBody.data.job.processedPages).toBe(0);

            // Verify in DB that job was persisted in queued state
            const persistedJob = await IngestionJob.findOne({ batchId: resBody.data.batchId });
            expect(persistedJob).not.toBeNull();
            expect(persistedJob!.status).toBe('queued');
            expect(persistedJob!.attempts).toBe(0);
        });
    });

    describe('2. Atomic Job Claiming & Concurrent Safety', () => {
        it('should atomically claim one queued job and increment attempts', async () => {
            const { job } = await createTestBatchAndJob(2);

            const worker = new IngestionWorker({ workerId: 'worker-1' });
            const claimed = await BatchRepository.claimNextQueuedJob(worker.workerId);

            expect(claimed).not.toBeNull();
            expect(claimed!._id.toString()).toBe(job._id.toString());
            expect(claimed!.status).toBe('processing');
            expect(claimed!.workerId).toBe('worker-1');
            expect(claimed!.attempts).toBe(1);
            expect(claimed!.heartbeatAt).toBeDefined();
            expect(claimed!.startedAt).toBeDefined();

            // Verify DB reflects processing state
            const inDb = await IngestionJob.findById(job._id);
            expect(inDb!.status).toBe('processing');
            expect(inDb!.workerId).toBe('worker-1');
        });

        it('should ensure two concurrent workers cannot claim the same job', async () => {
            const { job } = await createTestBatchAndJob(2);

            const worker1 = new IngestionWorker({ workerId: 'worker-alpha' });
            const worker2 = new IngestionWorker({ workerId: 'worker-beta' });

            // Run simultaneous claim attempts
            const [claim1, claim2] = await Promise.all([
                BatchRepository.claimNextQueuedJob(worker1.workerId),
                BatchRepository.claimNextQueuedJob(worker2.workerId)
            ]);

            // Exactly one worker must claim the job; the other receives null
            const claims = [claim1, claim2].filter((c) => c !== null);
            expect(claims.length).toBe(1);
            expect(claims[0]!._id.toString()).toBe(job._id.toString());
            expect(claims[0]!.attempts).toBe(1);
        });

        it('should ensure two concurrent workers cannot simultaneously reclaim the same stale job', async () => {
            const { job } = await createTestBatchAndJob(2, 3);

            // Set job to stale processing state
            job.status = IngestionStatus.PROCESSING;
            job.attempts = 1;
            job.heartbeatAt = new Date(Date.now() - 120000); // 2 minutes ago
            job.workerId = 'crashed-worker';
            await job.save();

            const worker1 = new IngestionWorker({ workerId: 'worker-gamma' });
            const worker2 = new IngestionWorker({ workerId: 'worker-delta' });

            // Concurrent reclaim attempts
            const [claim1, claim2] = await Promise.all([
                BatchRepository.claimNextQueuedJob(worker1.workerId, 60000),
                BatchRepository.claimNextQueuedJob(worker2.workerId, 60000)
            ]);

            const claims = [claim1, claim2].filter((c) => c !== null);
            expect(claims.length).toBe(1);
            expect(claims[0]!._id.toString()).toBe(job._id.toString());
            expect(claims[0]!.attempts).toBe(2);
        });

        it('should prevent claiming a job when attempts has reached maxRetries', async () => {
            const { job } = await createTestBatchAndJob(2, 2);

            // Set job with attempts equal to maxRetries
            job.status = IngestionStatus.PROCESSING;
            job.attempts = 2;
            job.maxRetries = 2;
            job.heartbeatAt = new Date(Date.now() - 120000);
            await job.save();

            const worker = new IngestionWorker({ workerId: 'worker-epsilon' });
            const claimed = await BatchRepository.claimNextQueuedJob(worker.workerId, 60000);

            expect(claimed).toBeNull();
        });
    });

    describe('3. Successful Ingestion & Pipeline Invocation', () => {
        it('should process all pages and mark job/batch as done, invoking PageIngestionService', async () => {
            const { batchId } = await createTestBatchAndJob(3);
            const worker = new IngestionWorker({ workerId: 'worker-main' });

            const processPageSpy = vi.spyOn(defaultPageIngestionService, 'processPage');

            const result = await worker.processNextJob();

            expect(result.processed).toBe(true);
            expect(result.status).toBe('done');
            expect(result.processedPages).toBe(3);
            expect(result.failedPages).toBe(0);

            // Verifies PageIngestionService was actually invoked for each page
            expect(processPageSpy).toHaveBeenCalledTimes(3);

            // Check IngestionJob in DB
            const jobInDb = await IngestionJob.findOne({ batchId });
            expect(jobInDb!.status).toBe('done');
            expect(jobInDb!.completedAt).toBeDefined();
            expect(jobInDb!.processedPages).toBe(3);
            expect(jobInDb!.failedPages).toBe(0);

            // Check Batch in DB
            const batchInDb = await Batch.findOne({ batchId });
            expect(batchInDb!.status).toBe('done');

            // Check IngestionPage records
            const pageRecords = await IngestionPage.find({ batchId });
            expect(pageRecords.length).toBe(3);
            expect(pageRecords.every((p) => p.status === 'processed')).toBe(true);
        });

        it('should maintain association between batch, job, and page records', async () => {
            const { batch, job, batchId } = await createTestBatchAndJob(2);
            const worker = new IngestionWorker();

            await worker.processNextJob();

            const pages = await IngestionPage.find({ batchId });
            expect(pages.length).toBe(2);
            expect(pages[0].job.toString()).toBe(job._id.toString());
            expect(pages[0].batchId).toBe(batchId);
            expect(pages[0].fileId).toBe(batch.files[0].fileId);
        });
    });

    describe('4. Failure Handling, Retries & Max Retry Limit', () => {
        it('should return to queued state on transient failure when attempts < maxRetries', async () => {
            const { batchId } = await createTestBatchAndJob(2, 3);
            const failingRenderer: IPageRenderer = {
                renderPage: vi.fn().mockRejectedValue(new Error('Corrupted page data on page 1\n at InternalParser.parse (/app/parser.ts:20)'))
            };
            const pageService = new PageIngestionService(failingRenderer);
            const worker = new IngestionWorker({ workerId: 'worker-retry', pageIngestionService: pageService });

            const result = await worker.processNextJob();

            expect(result.processed).toBe(true);
            expect(result.status).toBe('queued'); // re-queued for retry

            const jobInDb = await IngestionJob.findOne({ batchId });
            expect(jobInDb!.status).toBe('queued');
            expect(jobInDb!.attempts).toBe(1);
            expect(jobInDb!.failureReason).toContain('Corrupted page data');
            // Cleaned/sanitized failureReason without stack trace
            expect(jobInDb!.failureReason).not.toContain('at InternalParser');

            const batchInDb = await Batch.findOne({ batchId });
            expect(batchInDb!.status).toBe('queued');
        });

        it('should mark job/batch as permanently failed when maximum retry count is reached', async () => {
            const { batchId } = await createTestBatchAndJob(2, 2);
            const failingRenderer: IPageRenderer = {
                renderPage: vi.fn().mockRejectedValue(new Error('Corrupted page data'))
            };
            const pageService = new PageIngestionService(failingRenderer);
            const worker = new IngestionWorker({ workerId: 'worker-max-retry', pageIngestionService: pageService });

            // Attempt 1: transient failure -> queued
            const attempt1 = await worker.processNextJob();
            expect(attempt1.status).toBe('queued');

            // Attempt 2: max retries reached -> failed
            const attempt2 = await worker.processNextJob();
            expect(attempt2.status).toBe('failed');
            expect(attempt2.failedPages).toBeGreaterThan(0);

            const jobInDb = await IngestionJob.findOne({ batchId });
            expect(jobInDb!.status).toBe('failed');
            expect(jobInDb!.attempts).toBe(2);
            expect(jobInDb!.completedAt).toBeDefined();

            const batchInDb = await Batch.findOne({ batchId });
            expect(batchInDb!.status).toBe('failed');
        });

        it('should sanitize raw error stack traces in failed state', async () => {
            await createTestBatchAndJob(1, 1);
            const failingRenderer: IPageRenderer = {
                renderPage: vi.fn().mockRejectedValue(new Error('Corrupted page data on page 1\n at PdfEngine.renderPage (/engine/pdf.ts:40)\n at async processTicksAndRejections'))
            };
            const pageService = new PageIngestionService(failingRenderer);
            const worker = new IngestionWorker({ pageIngestionService: pageService });

            const result = await worker.processNextJob();
            expect(result.status).toBe('failed');
            expect(result.failureReason).toBe('Corrupted page data on page 1');
            expect(result.failureReason).not.toContain('at PdfEngine');
        });
    });

    describe('5. Stale Processing Job Recovery', () => {
        it('should reclaim and process a job stuck in processing beyond stale timeout', async () => {
            const { job, batchId } = await createTestBatchAndJob(2);

            // Simulate a job left in processing from a crashed worker 2 minutes ago
            job.status = IngestionStatus.PROCESSING;
            job.attempts = 1;
            job.heartbeatAt = new Date(Date.now() - 120000); // 2 minutes ago
            job.workerId = 'dead-worker-99';
            await job.save();

            const recoveryWorker = new IngestionWorker({
                workerId: 'recovery-worker-1',
                staleTimeoutMs: 60000 // 1 minute threshold
            });

            // Process to completion (worker claims the stale job and completes it)
            const result = await recoveryWorker.processNextJob();
            expect(result.processed).toBe(true);
            expect(result.status).toBe('done');
            expect(result.processedPages).toBe(2);

            const jobInDb = await IngestionJob.findOne({ batchId });
            expect(jobInDb!.status).toBe('done');
            expect(jobInDb!.attempts).toBe(2);
            expect(jobInDb!.workerId).toBe('recovery-worker-1');
        });

        it('should NOT reclaim a currently active job whose heartbeat is fresh', async () => {
            const { job } = await createTestBatchAndJob(2);

            // Active worker with fresh heartbeat (5 seconds ago)
            job.status = IngestionStatus.PROCESSING;
            job.attempts = 1;
            job.heartbeatAt = new Date(Date.now() - 5000);
            job.workerId = 'live-worker-1';
            await job.save();

            const otherWorker = new IngestionWorker({
                workerId: 'worker-other',
                staleTimeoutMs: 60000
            });

            const claimed = await BatchRepository.claimNextQueuedJob(otherWorker.workerId, 60000);
            expect(claimed).toBeNull();
        });
    });

    describe('6. Idempotency & Reconciliation on Retries', () => {
        it('should not duplicate page records when retrying a partially processed job', async () => {
            const { batch, job, batchId } = await createTestBatchAndJob(3, 3);
            const fileId = batch.files[0].fileId;

            // Pre-create Page 1 as already PROCESSED
            await IngestionPage.create({
                batchId,
                job: job._id,
                fileId,
                fileIndex: 0,
                storageKey: batch.files[0].storageKey,
                pageNumber: 1,
                status: PageProcessingStatus.PROCESSED,
                processedAt: new Date()
            });

            const worker = new IngestionWorker();
            const result = await worker.processNextJob();

            expect(result.status).toBe('done');
            expect(result.processedPages).toBe(3);

            // Verify total page records in DB is exactly 3 (no duplicate page 1 created)
            const pagesInDb = await IngestionPage.find({ batchId });
            expect(pagesInDb.length).toBe(3);

            const page1Records = await IngestionPage.find({ batchId, fileId, pageNumber: 1 });
            expect(page1Records.length).toBe(1);
        });
    });

    describe('7. Per-Page Timeout Protection', () => {
        it('should timeout an individual hung page without blocking the worker permanently', async () => {
            const { batchId } = await createTestBatchAndJob(1, 1);
            const hungRenderer: IPageRenderer = {
                renderPage: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 5000)))
            };
            const pageService = new PageIngestionService(hungRenderer);
            const worker = new IngestionWorker({ pageIngestionService: pageService });

            const result = await worker.processNextJob({
                pageTimeoutMs: 50 // small timeout for test speed
            });

            expect(result.status).toBe('failed');
            expect(result.failedPages).toBe(1);
            expect(result.failureReason).toContain('timed out after 50ms');

            const pageRecord = await IngestionPage.findOne({ batchId, pageNumber: 1 });
            expect(pageRecord).not.toBeNull();
            expect(pageRecord!.status).toBe('failed');
            expect(pageRecord!.failureReason).toContain('timed out');
        });
    });

    describe('8. Server Lifecycle & Worker Startup Integration', () => {
        it('should do nothing when NODE_ENV is test', () => {
            const startSpy = vi.spyOn(defaultIngestionWorker, 'start');
            initBackgroundWorker();
            expect(startSpy).not.toHaveBeenCalled();
        });

        it('should start worker once and avoid duplicate intervals in dev/prod environment', () => {
            const originalEnv = process.env.NODE_ENV;
            const originalInit = (global as any).isIngestionWorkerInitialized;
            (global as any).isIngestionWorkerInitialized = false;

            try {
                (process.env as any).NODE_ENV = 'development';
                const startSpy = vi.spyOn(defaultIngestionWorker, 'start').mockImplementation(() => {});

                // First call: starts worker
                initBackgroundWorker();
                expect(startSpy).toHaveBeenCalledTimes(1);
                expect((global as any).isIngestionWorkerInitialized).toBe(true);

                // Second call (e.g. Next.js HMR or multiple connectDB calls): does NOT start duplicate
                initBackgroundWorker();
                expect(startSpy).toHaveBeenCalledTimes(1);
            } finally {
                defaultIngestionWorker.stop();
                (process.env as any).NODE_ENV = originalEnv;
                (global as any).isIngestionWorkerInitialized = originalInit;
            }
        });
    });

    describe('9. Authoritative Renderer Page-Count Reconciliation (AE-046 Step 5)', () => {
        it('should process a single-page PDF where pre-flight estimate and renderer count agree', async () => {
            const { batchId } = await createTestBatchAndJob(1);
            const worker = new IngestionWorker();

            const result = await worker.processNextJob();

            expect(result.processed).toBe(true);
            expect(result.status).toBe('done');
            expect(result.processedPages).toBe(1);

            const jobInDb = await IngestionJob.findOne({ batchId });
            expect(jobInDb!.totalPages).toBe(1);
            expect(jobInDb!.processedPages).toBe(1);
            expect(jobInDb!.status).toBe('done');
        });

        it('should reconcile and adjust totalPages when pre-flight regex overestimated page count', async () => {
            // Pre-flight estimated 5 pages, but disk PDF actually contains only 2 pages
            const { batch, job, batchId, fileId } = await createTestBatchAndJob(2);

            // Force simulated overestimate on batch and job records
            job.totalPages = 5;
            await job.save();

            batch.totalPageCount = 5;
            batch.files[0].pageCount = 5;
            await batch.save();

            const worker = new IngestionWorker();
            const result = await worker.processNextJob();

            expect(result.processed).toBe(true);
            expect(result.status).toBe('done');
            expect(result.processedPages).toBe(2);

            // Verifies job totalPages was reconciled down to 2
            const reconciledJob = await IngestionJob.findOne({ batchId });
            expect(reconciledJob!.totalPages).toBe(2);
            expect(reconciledJob!.processedPages).toBe(2);
            expect(reconciledJob!.status).toBe('done');

            // Verifies batch totalPageCount was reconciled down to 2
            const reconciledBatch = await Batch.findOne({ batchId });
            expect(reconciledBatch!.totalPageCount).toBe(2);
            expect(reconciledBatch!.files[0].pageCount).toBe(2);
            expect(reconciledBatch!.status).toBe('done');

            // Verifies exactly 2 IngestionPage records were processed
            const pages = await IngestionPage.find({ batchId, fileId });
            expect(pages.length).toBe(2);
            expect(pages.every((p) => p.status === 'processed')).toBe(true);
        });

        it('should reconcile and adjust totalPages when pre-flight regex underestimated page count', async () => {
            // Pre-flight estimated 1 page, but disk PDF actually contains 3 pages
            const { batch, job, batchId, fileId } = await createTestBatchAndJob(3);

            // Force simulated underestimate on batch and job records
            job.totalPages = 1;
            await job.save();

            batch.totalPageCount = 1;
            batch.files[0].pageCount = 1;
            await batch.save();

            const worker = new IngestionWorker();
            const result = await worker.processNextJob();

            expect(result.processed).toBe(true);
            expect(result.status).toBe('done');
            expect(result.processedPages).toBe(3);

            // Verifies job totalPages was reconciled up to 3
            const reconciledJob = await IngestionJob.findOne({ batchId });
            expect(reconciledJob!.totalPages).toBe(3);
            expect(reconciledJob!.processedPages).toBe(3);
            expect(reconciledJob!.status).toBe('done');

            // Verifies exactly 3 IngestionPage records were processed
            const pages = await IngestionPage.find({ batchId, fileId });
            expect(pages.length).toBe(3);
            expect(pages.every((p) => p.status === 'processed')).toBe(true);
        });

        it('should handle authoritative page count discovery failure cleanly', async () => {
            const { batchId } = await createTestBatchAndJob(1, 1);

            const failingRenderer: IPageRenderer = {
                getPageCount: vi.fn().mockRejectedValue(new Error('Corrupted trailer dictionary\n at PdfStream.read (/pdf/stream.ts:12)')),
                renderPage: vi.fn().mockResolvedValue({ success: true, pageNumber: 1 })
            };
            const pageService = new PageIngestionService(failingRenderer);
            const worker = new IngestionWorker({ pageIngestionService: pageService });

            const result = await worker.processNextJob();

            expect(result.status).toBe('failed');
            expect(result.failureReason).toBe('Corrupted trailer dictionary');
            expect(result.failureReason).not.toContain('at PdfStream');

            const jobInDb = await IngestionJob.findOne({ batchId });
            expect(jobInDb!.status).toBe('failed');
            expect(jobInDb!.failureReason).toBe('Corrupted trailer dictionary');
        });
    });
});
