/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import BatchRepository from '../repositories/BatchRepository';
import BatchService from '../services/BatchService';
import { isValidIngestionTransition, sanitizeFailureReason } from '../validations/ingestionValidation';
import mongoose from 'mongoose';
import defaultIngestionWorker from '../services/IngestionWorker';

let mockSessionUser: any = null;

// Mock next-auth to allow dynamic control of session users in testing
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

describe('Ingestion Status Tracking and Status API (AE-045)', () => {
    let ingestStatusGET: any;
    const professorId = new mongoose.Types.ObjectId().toString();
    const otherProfessorId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();
    const studentId = new mongoose.Types.ObjectId().toString();
    const taId = new mongoose.Types.ObjectId().toString();

    beforeAll(async () => {
        ingestStatusGET = (await import('../app/api/ingest/[id]/route')).GET;
    });

    beforeEach(() => {
        defaultIngestionWorker.stop();
        mockSessionUser = null;
    });

    async function createTestBatchAndJob(
        ownerId: string,
        status: IngestionStatus = IngestionStatus.QUEUED,
        totalPages = 10
    ) {
        const batchId = crypto.randomUUID();
        const batch = await BatchRepository.createBatch({
            batchId,
            uploadedBy: new mongoose.Types.ObjectId(ownerId),
            files: [
                {
                    fileId: crypto.randomUUID(),
                    fileIndex: 0,
                    originalFilename: 'exam1.pdf',
                    fileType: 'pdf',
                    mimeType: 'application/pdf',
                    size: 1024,
                    pageCount: totalPages,
                    storageKey: `batches/${batchId}/file.pdf`
                }
            ],
            totalFiles: 1,
            totalSize: 1024,
            totalPageCount: totalPages,
            status: status as unknown as BatchStatus,
            isActive: true
        });

        const job = await BatchRepository.createIngestionJob({
            batchId,
            batch: batch._id as mongoose.Types.ObjectId,
            uploadedBy: new mongoose.Types.ObjectId(ownerId),
            status,
            totalPages,
            processedPages: 0,
            failedPages: 0
        });

        return { batch, job, batchId };
    }

    describe('1. Model Persistence & Supported States', () => {
        it('should create and persist an ingestion job in queued state with timestamps and page counts', async () => {
            const { job, batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 5);

            expect(job).not.toBeNull();
            expect(job.status).toBe('queued');
            expect(job.totalPages).toBe(5);
            expect(job.processedPages).toBe(0);
            expect(job.failedPages).toBe(0);
            expect(job.createdAt).toBeInstanceOf(Date);
            expect(job.updatedAt).toBeInstanceOf(Date);
            expect(job.startedAt).toBeUndefined();
            expect(job.completedAt).toBeUndefined();

            const persisted = await IngestionJob.findOne({ batchId });
            expect(persisted).not.toBeNull();
            expect(persisted!.status).toBe('queued');
        });

        it('should support processing, done, and failed states', async () => {
            const processingJob = await IngestionJob.create({
                batchId: crypto.randomUUID(),
                batch: new mongoose.Types.ObjectId(),
                uploadedBy: new mongoose.Types.ObjectId(professorId),
                status: IngestionStatus.PROCESSING,
                totalPages: 10,
                processedPages: 3,
                failedPages: 0,
                startedAt: new Date()
            });
            expect(processingJob.status).toBe('processing');

            const doneJob = await IngestionJob.create({
                batchId: crypto.randomUUID(),
                batch: new mongoose.Types.ObjectId(),
                uploadedBy: new mongoose.Types.ObjectId(professorId),
                status: IngestionStatus.DONE,
                totalPages: 10,
                processedPages: 10,
                failedPages: 0,
                completedAt: new Date()
            });
            expect(doneJob.status).toBe('done');

            const failedJob = await IngestionJob.create({
                batchId: crypto.randomUUID(),
                batch: new mongoose.Types.ObjectId(),
                uploadedBy: new mongoose.Types.ObjectId(professorId),
                status: IngestionStatus.FAILED,
                totalPages: 10,
                processedPages: 5,
                failedPages: 5,
                completedAt: new Date(),
                failureReason: 'Corrupted image slice'
            });
            expect(failedJob.status).toBe('failed');
            expect(failedJob.failureReason).toBe('Corrupted image slice');
        });
    });

    describe('2. State Transitions & Timestamps', () => {
        it('should enforce valid state transitions and reject invalid/backward transitions in helper', () => {
            // Valid forward transitions
            expect(isValidIngestionTransition(IngestionStatus.QUEUED, IngestionStatus.PROCESSING)).toBe(true);
            expect(isValidIngestionTransition(IngestionStatus.PROCESSING, IngestionStatus.DONE)).toBe(true);
            expect(isValidIngestionTransition(IngestionStatus.PROCESSING, IngestionStatus.FAILED)).toBe(true);

            // Same state transitions (valid)
            expect(isValidIngestionTransition(IngestionStatus.QUEUED, IngestionStatus.QUEUED)).toBe(true);
            expect(isValidIngestionTransition(IngestionStatus.PROCESSING, IngestionStatus.PROCESSING)).toBe(true);
            expect(isValidIngestionTransition(IngestionStatus.DONE, IngestionStatus.DONE)).toBe(true);
            expect(isValidIngestionTransition(IngestionStatus.FAILED, IngestionStatus.FAILED)).toBe(true);

            // Invalid/backward transitions
            expect(isValidIngestionTransition(IngestionStatus.QUEUED, IngestionStatus.DONE)).toBe(false);
            expect(isValidIngestionTransition(IngestionStatus.QUEUED, IngestionStatus.FAILED)).toBe(false);
            expect(isValidIngestionTransition(IngestionStatus.DONE, IngestionStatus.PROCESSING)).toBe(false);
            expect(isValidIngestionTransition(IngestionStatus.DONE, IngestionStatus.QUEUED)).toBe(false);
            expect(isValidIngestionTransition(IngestionStatus.FAILED, IngestionStatus.PROCESSING)).toBe(false);
            expect(isValidIngestionTransition(IngestionStatus.FAILED, IngestionStatus.QUEUED)).toBe(false);
        });

        it('should set startedAt when transitioning from queued to processing in service layer', async () => {
            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 10);

            const updated = await BatchService.updateIngestionStatus(
                batchId,
                { status: IngestionStatus.PROCESSING, processedPages: 2 },
                professorId,
                'PROFESSOR'
            );

            expect(updated.status).toBe('processing');
            expect(updated.startedAt).toBeInstanceOf(Date);
            expect(updated.completedAt).toBeUndefined();
            expect(updated.processedPages).toBe(2);

            // Verify Batch status was synced
            const batchInDb = await Batch.findOne({ batchId });
            expect(batchInDb!.status).toBe('processing');
        });

        it('should set completedAt when transitioning from processing to done in service layer', async () => {
            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 10);

            await BatchService.updateIngestionStatus(
                batchId,
                { status: IngestionStatus.PROCESSING },
                professorId,
                'PROFESSOR'
            );

            const doneJob = await BatchService.updateIngestionStatus(
                batchId,
                { status: IngestionStatus.DONE, processedPages: 10 },
                professorId,
                'PROFESSOR'
            );

            expect(doneJob.status).toBe('done');
            expect(doneJob.startedAt).toBeInstanceOf(Date);
            expect(doneJob.completedAt).toBeInstanceOf(Date);
            expect(doneJob.processedPages).toBe(10);
            expect(doneJob.failedPages).toBe(0);
        });

        it('should set completedAt and record failure reason when transitioning to failed', async () => {
            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 10);

            await BatchService.updateIngestionStatus(
                batchId,
                { status: IngestionStatus.PROCESSING },
                professorId,
                'PROFESSOR'
            );

            const failedJob = await BatchService.updateIngestionStatus(
                batchId,
                {
                    status: IngestionStatus.FAILED,
                    processedPages: 4,
                    failedPages: 6,
                    failureReason: 'Page rendering error\n at Parser.parse (/app/parser.ts:45)\n at Worker.run (/app/worker.ts:12)'
                },
                professorId,
                'PROFESSOR'
            );

            expect(failedJob.status).toBe('failed');
            expect(failedJob.completedAt).toBeInstanceOf(Date);
            expect(failedJob.processedPages).toBe(4);
            expect(failedJob.failedPages).toBe(6);
            // Verify stack trace lines were stripped
            expect(failedJob.failureReason).not.toContain('at Parser.parse');
            expect(failedJob.failureReason).toBe('Page rendering error');
        });

        it('should reject invalid backward state transitions with HttpError 400', async () => {
            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 10);

            // Attempt queued -> done directly
            await expect(
                BatchService.updateIngestionStatus(
                    batchId,
                    { status: IngestionStatus.DONE },
                    professorId,
                    'PROFESSOR'
                )
            ).rejects.toMatchObject({
                statusCode: 400,
                message: expect.stringContaining('Invalid status transition from queued to done')
            });
        });
    });

    describe('3. Failure Reason Sanitization', () => {
        it('should strip stack traces and internal file paths in sanitizeFailureReason helper', () => {
            const raw = `Corrupt PDF stream encountered
                at PDFParser.readStream (C:\\Users\\app\\node_modules\\pdf\\parser.js:123:45)
                at async Worker.processJob (/var/task/worker.js:89:12)`;

            const sanitized = sanitizeFailureReason(raw);
            expect(sanitized).toBe('Corrupt PDF stream encountered');
            expect(sanitized).not.toContain('PDFParser.readStream');
            expect(sanitized).not.toContain('at async');
        });

        it('should return fallback if raw reason consists solely of stack traces', () => {
            const raw = `at PDFParser.readStream (/parser.js:1:1)`;
            const sanitized = sanitizeFailureReason(raw);
            expect(sanitized).toBe('Ingestion processing failed');
        });
    });

    describe('4. Repository Authorization & Deny-by-Default', () => {
        it('should allow owner professor and admin to retrieve ingestion job and batch', async () => {
            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 8);

            const ownerJob = await BatchRepository.getIngestionJobByBatchId(batchId, professorId, 'PROFESSOR');
            expect(ownerJob).not.toBeNull();
            expect(ownerJob!.batchId).toBe(batchId);

            const adminJob = await BatchRepository.getIngestionJobByBatchId(batchId, adminId, 'ADMIN');
            expect(adminJob).not.toBeNull();
            expect(adminJob!.batchId).toBe(batchId);
        });

        it('should return null (deny) for a different professor', async () => {
            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 8);

            const otherProfJob = await BatchRepository.getIngestionJobByBatchId(batchId, otherProfessorId, 'PROFESSOR');
            expect(otherProfJob).toBeNull();
        });

        it('should return null (deny) for STUDENT and TA roles', async () => {
            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 8);

            const studentJob = await BatchRepository.getIngestionJobByBatchId(batchId, studentId, 'STUDENT');
            expect(studentJob).toBeNull();

            const taJob = await BatchRepository.getIngestionJobByBatchId(batchId, taId, 'TA');
            expect(taJob).toBeNull();
        });

        it('should return null (deny-by-default) for unknown roles and unauthenticated callers', async () => {
            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 8);

            const unknownRoleJob = await BatchRepository.getIngestionJobByBatchId(batchId, 'some-user', 'UNKNOWN_ROLE');
            expect(unknownRoleJob).toBeNull();

            const unauthJob = await BatchRepository.getIngestionJobByBatchId(batchId, undefined, undefined);
            expect(unauthJob).toBeNull();
        });
    });

    describe('5. GET /api/ingest/{id} Status API Endpoint', () => {
        it('should return 401 when unauthenticated', async () => {
            mockSessionUser = null;
            const req = new Request('http://localhost:3000/api/ingest/test-batch-id');
            const res = await ingestStatusGET(req as any, { params: Promise.resolve({ id: 'test-batch-id' }) });

            expect(res.status).toBe(401);
            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.message).toBe('Unauthorized');
        });

        it('should return 200 OK with full status data for batch owner professor', async () => {
            mockSessionUser = {
                id: professorId,
                email: 'prof@university.edu',
                name: 'Professor User',
                role: 'PROFESSOR'
            };

            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 15);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}`);
            const res = await ingestStatusGET(req as any, { params: Promise.resolve({ id: batchId }) });

            expect(res.status).toBe(200);
            const resBody = await res.json();
            expect(resBody.success).toBe(true);
            expect(resBody.data.batchId).toBe(batchId);
            expect(resBody.data.status).toBe('queued');
            expect(resBody.data.totalPages).toBe(15);
            expect(resBody.data.processedPages).toBe(0);
            expect(resBody.data.failedPages).toBe(0);
            expect(resBody.data.createdAt).toBeDefined();
            expect(resBody.data.updatedAt).toBeDefined();
        });

        it('should return 200 OK for ADMIN accessing any batch', async () => {
            mockSessionUser = {
                id: adminId,
                email: 'admin@university.edu',
                name: 'Admin User',
                role: 'ADMIN'
            };

            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 12);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}`);
            const res = await ingestStatusGET(req as any, { params: Promise.resolve({ id: batchId }) });

            expect(res.status).toBe(200);
            const resBody = await res.json();
            expect(resBody.success).toBe(true);
            expect(resBody.data.batchId).toBe(batchId);
        });

        it('should return 404 (not 403) when a second professor attempts to access someone else’s batch', async () => {
            mockSessionUser = {
                id: otherProfessorId,
                email: 'other_prof@university.edu',
                name: 'Other Professor',
                role: 'PROFESSOR'
            };

            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 10);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}`);
            const res = await ingestStatusGET(req as any, { params: Promise.resolve({ id: batchId }) });

            // Must return 404 so existence is not disclosed
            expect(res.status).toBe(404);
            const resBody = await res.json();
            expect(resBody.success).toBe(false);
            expect(resBody.message).toContain('Batch not found or access denied');
        });

        it('should return 403 for STUDENT and TA callers lacking VIEW_BATCH permission', async () => {
            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 10);

            // Student check (no VIEW_BATCH permission -> 403)
            mockSessionUser = {
                id: studentId,
                email: 'student@university.edu',
                name: 'Student User',
                role: 'STUDENT'
            };
            const studentReq = new Request(`http://localhost:3000/api/ingest/${batchId}`);
            const studentRes = await ingestStatusGET(studentReq as any, { params: Promise.resolve({ id: batchId }) });
            expect(studentRes.status).toBe(403);

            // TA check (no VIEW_BATCH permission -> 403)
            mockSessionUser = {
                id: taId,
                email: 'ta@university.edu',
                name: 'TA User',
                role: 'TA'
            };
            const taReq = new Request(`http://localhost:3000/api/ingest/${batchId}`);
            const taRes = await ingestStatusGET(taReq as any, { params: Promise.resolve({ id: batchId }) });
            expect(taRes.status).toBe(403);
        });

        it('should return 404 for unknown/nonexistent batch ID', async () => {
            mockSessionUser = {
                id: professorId,
                email: 'prof@university.edu',
                name: 'Professor User',
                role: 'PROFESSOR'
            };

            const req = new Request('http://localhost:3000/api/ingest/nonexistent-id');
            const res = await ingestStatusGET(req as any, { params: Promise.resolve({ id: 'nonexistent-id' }) });

            expect(res.status).toBe(404);
            const resBody = await res.json();
            expect(resBody.success).toBe(false);
        });

        it('should expose sanitized failureReason in response for failed batch without stack traces', async () => {
            mockSessionUser = {
                id: professorId,
                email: 'prof@university.edu',
                name: 'Professor User',
                role: 'PROFESSOR'
            };

            const { batchId } = await createTestBatchAndJob(professorId, IngestionStatus.QUEUED, 10);
            await BatchService.updateIngestionStatus(batchId, { status: IngestionStatus.PROCESSING }, professorId, 'PROFESSOR');
            await BatchService.updateIngestionStatus(
                batchId,
                {
                    status: IngestionStatus.FAILED,
                    processedPages: 2,
                    failedPages: 8,
                    failureReason: 'Invalid image format detected\n at ImageDecoder.decode (/app/decoder.ts:20)'
                },
                professorId,
                'PROFESSOR'
            );

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}`);
            const res = await ingestStatusGET(req as any, { params: Promise.resolve({ id: batchId }) });

            expect(res.status).toBe(200);
            const resBody = await res.json();
            expect(resBody.data.status).toBe('failed');
            expect(resBody.data.failureReason).toBe('Invalid image format detected');
            expect(resBody.data.failureReason).not.toContain('ImageDecoder.decode');
        });
    });
});
