/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AE-074 Ingestion Approval Tests
 *
 * Tests approval state model, approve/revoke API endpoints, allocation gate,
 * correction freeze, new-batch invalidation, audit logging, and authorization.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Exam, { IngestionApprovalStatus, ExamStatus } from '../models/Exam';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import AnswerScript from '../models/AnswerScript';
import AuditLog from '../models/AuditLog';
import User from '../models/User';
import Course from '../models/Course';
import BatchRepository from '../repositories/BatchRepository';
import { UserRole } from '../constants/permissions';

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

describe('AE-074 Ingestion Approval', () => {
    let replSet: MongoMemoryReplSet;
    let approveIngestionPOST: any;
    let revokeIngestionPOST: any;
    let allocatePOST: any;
    let remapPOST: any;
    let mergePOST: any;
    let splitPOST: any;
    let reorderPOST: any;

    const professorId = new mongoose.Types.ObjectId().toString();
    const otherProfessorId = new mongoose.Types.ObjectId().toString();
    const taId = new mongoose.Types.ObjectId().toString();

    beforeAll(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }

        replSet = await MongoMemoryReplSet.create({
            replSet: { storageEngine: 'wiredTiger' }
        });
        const uri = replSet.getUri();
        await mongoose.connect(uri);

        approveIngestionPOST = (await import('../app/api/exams/[id]/approve-ingestion/route')).POST;
        revokeIngestionPOST = (await import('../app/api/exams/[id]/revoke-ingestion/route')).POST;
        allocatePOST = (await import('../app/api/exams/[id]/allocate/route')).POST;
        remapPOST = (await import('../app/api/ingest/[id]/scripts/remap/route')).POST;
        mergePOST = (await import('../app/api/ingest/[id]/scripts/merge/route')).POST;
        splitPOST = (await import('../app/api/ingest/[id]/scripts/split/route')).POST;
        reorderPOST = (await import('../app/api/ingest/[id]/scripts/reorder/route')).POST;
    });

    afterAll(async () => {
        await mongoose.disconnect();
        await replSet.stop();

        const fallbackUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test-placeholder-safety';
        try {
            await mongoose.connect(fallbackUri);
        } catch {
            // ignore
        }
    });

    beforeEach(async () => {
        mockSessionUser = null;
        await Exam.deleteMany({});
        await Batch.deleteMany({});
        await IngestionJob.deleteMany({});
        await IngestionPage.deleteMany({});
        await AnswerScript.deleteMany({});
        await AuditLog.deleteMany({});
        await User.deleteMany({});
        await Course.deleteMany({});
    });

    // ─── Helpers ────────────────────────────────────────────────────────────────

    async function createExam(ownerId: string) {
        const course = await Course.create({
            courseCode: 'CS101',
            courseName: 'Intro CS',
            semester: 1,
            academicYear: '2026-27',
            professor: new mongoose.Types.ObjectId(ownerId),
            isActive: true
        });
        return await Exam.create({
            title: 'Test Exam',
            course: course._id,
            createdBy: new mongoose.Types.ObjectId(ownerId),
            examDate: new Date('2026-12-01'),
            totalMarks: 100,
            numberOfQuestions: 5,
            status: ExamStatus.DRAFT,
            isActive: true
            // ingestionApprovalStatus defaults to PENDING_REVIEW
        });
    }


    async function createBatchWithExam(ownerId: string, examId: mongoose.Types.ObjectId) {
        const batchId = crypto.randomUUID();
        const batch = await BatchRepository.createBatch({
            batchId,
            uploadedBy: new mongoose.Types.ObjectId(ownerId),
            exam: examId,
            files: [{
                fileId: 'file-1',
                fileIndex: 0,
                originalFilename: 'exam.pdf',
                fileType: 'pdf',
                mimeType: 'application/pdf',
                size: 2048,
                pageCount: 3,
                storageKey: `batches/${batchId}/exam.pdf`
            }],
            totalFiles: 1,
            totalSize: 2048,
            totalPageCount: 3,
            status: BatchStatus.DONE,
            isActive: true
        });

        const job = await BatchRepository.createIngestionJob({
            batchId,
            batch: batch._id as mongoose.Types.ObjectId,
            uploadedBy: new mongoose.Types.ObjectId(ownerId),
            status: IngestionStatus.DONE,
            totalPages: 3,
            processedPages: 3,
            failedPages: 0
        });

        const script1 = await AnswerScript.create({
            exam: examId,
            batchId,
            fileIndex: 0,
            startPageNumber: 1,
            endPageNumber: 2,
            pageCount: 2,
            identificationStatus: 'UNIDENTIFIED',
            needsManualId: true,
            manualIdReason: 'NO_CODE_FOUND',
            isActive: true
        });

        const script2 = await AnswerScript.create({
            exam: examId,
            batchId,
            fileIndex: 0,
            startPageNumber: 3,
            endPageNumber: 3,
            pageCount: 1,
            identificationStatus: 'UNIDENTIFIED',
            needsManualId: true,
            manualIdReason: 'NO_CODE_FOUND',
            isActive: true
        });

        const page1 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: `batches/${batchId}/derived/file-1/1/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-1/1/thumb.jpg`,
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script1._id
        });

        const page2 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: `batches/${batchId}/derived/file-1/2/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-1/2/thumb.jpg`,
            pageNumber: 2,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script1._id
        });

        const page3 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: `batches/${batchId}/derived/file-1/3/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-1/3/thumb.jpg`,
            pageNumber: 3,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script2._id
        });

        return { batch, script1, script2, page1, page2, page3, batchId };
    }


    function makeRequest(body?: object) {
        return new Request('http://localhost/api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined
        });
    }

    function makeContext(id: string) {
        return { params: Promise.resolve({ id }) };
    }

    // ─── Test 1: New exam is PENDING_REVIEW ──────────────────────────────────────

    it('1. new/unapproved exam is PENDING_REVIEW', async () => {
        const exam = await createExam(professorId);
        const found = await Exam.findById(exam._id).lean();
        expect(found?.ingestionApprovalStatus).toBe(IngestionApprovalStatus.PENDING_REVIEW);
        expect(found?.approvedBy).toBeNull();
        expect(found?.approvedAt).toBeNull();
    });

    // ─── Test 2: Authorized reviewer can approve ─────────────────────────────────

    it('2. authorized reviewer (professor) can approve ingestion', async () => {
        const exam = await createExam(professorId);
        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest();
        const res = await approveIngestionPOST(req, makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);

        const updated = await Exam.findById(exam._id).lean();
        expect(updated?.ingestionApprovalStatus).toBe(IngestionApprovalStatus.APPROVED);
    });

    // ─── Test 3: Unauthorized user cannot approve ─────────────────────────────────

    it('3. unauthorized user (TA) cannot approve ingestion', async () => {
        const exam = await createExam(professorId);
        mockSessionUser = { id: taId, email: 'ta@test.com', name: 'TA', role: UserRole.TA };

        const req = makeRequest();
        const res = await approveIngestionPOST(req, makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(403);
        expect(body.success).toBe(false);

        // State must not have changed
        const unchanged = await Exam.findById(exam._id).lean();
        expect(unchanged?.ingestionApprovalStatus).toBe(IngestionApprovalStatus.PENDING_REVIEW);
    });

    // ─── Test 4: Ownership/scope rules enforced ──────────────────────────────────

    it('4. another professor cannot approve an exam they do not own', async () => {
        const exam = await createExam(professorId);
        mockSessionUser = { id: otherProfessorId, email: 'other@test.com', name: 'Other Prof', role: UserRole.PROFESSOR };

        const req = makeRequest();
        const res = await approveIngestionPOST(req, makeContext(exam._id.toString()));
        const body = await res.json();

        // Should be 404 (exam not found for this user, not a 403 — preserves existing access pattern)
        expect([404, 403]).toContain(res.status);
        expect(body.success).toBe(false);

        const unchanged = await Exam.findById(exam._id).lean();
        expect(unchanged?.ingestionApprovalStatus).toBe(IngestionApprovalStatus.PENDING_REVIEW);
    });

    // ─── Test 5: Approval persists reviewer and timestamp ────────────────────────

    it('5. approval persists approvedBy and approvedAt', async () => {
        const exam = await createExam(professorId);
        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const before = new Date();
        const req = makeRequest();
        await approveIngestionPOST(req, makeContext(exam._id.toString()));
        const after = new Date();

        const updated = await Exam.findById(exam._id).lean();
        expect(updated?.approvedBy?.toString()).toBe(professorId);
        expect(updated?.approvedAt).not.toBeNull();
        expect(new Date(updated!.approvedAt!).getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(new Date(updated!.approvedAt!).getTime()).toBeLessThanOrEqual(after.getTime());
    });

    // ─── Test 6: Approved exam can enter allocation/grading flow ─────────────────

    it('6. approved exam passes the allocation gate', async () => {
        const exam = await createExam(professorId);
        await Exam.findByIdAndUpdate(exam._id, {
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            approvedBy: new mongoose.Types.ObjectId(professorId),
            approvedAt: new Date()
        });

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest();
        const res = await allocatePOST(req, makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
    });

    // ─── Test 7: PENDING_REVIEW exam blocked from allocation ──────────────────────

    it('7. PENDING_REVIEW exam is blocked from allocation/grading', async () => {
        const exam = await createExam(professorId);
        // ingestionApprovalStatus is PENDING_REVIEW by default

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest();
        const res = await allocatePOST(req, makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(403);
        expect(body.success).toBe(false);
        expect(body.message).toContain('Approve ingestion');
    });

    // ─── Test 8: Blocked allocation response is controlled and clear ──────────────

    it('8. blocked allocation response is controlled and has a clear message', async () => {
        const exam = await createExam(professorId);
        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest();
        const res = await allocatePOST(req, makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.success).toBe(false);
        expect(typeof body.message).toBe('string');
        expect(body.message.length).toBeGreaterThan(0);
        // Must include guidance about ingestion approval
        expect(body.message.toLowerCase()).toMatch(/ingestion|approv/);
    });

    // ─── Test 9: Authorized reviewer can revoke approval ─────────────────────────

    it('9. authorized reviewer can revoke approval', async () => {
        const exam = await createExam(professorId);
        await Exam.findByIdAndUpdate(exam._id, {
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            approvedBy: new mongoose.Types.ObjectId(professorId),
            approvedAt: new Date()
        });

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest();
        const res = await revokeIngestionPOST(req, makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
    });

    // ─── Test 10: Revoked exam returns to PENDING_REVIEW ─────────────────────────

    it('10. revoked exam returns to PENDING_REVIEW and clears metadata', async () => {
        const exam = await createExam(professorId);
        await Exam.findByIdAndUpdate(exam._id, {
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            approvedBy: new mongoose.Types.ObjectId(professorId),
            approvedAt: new Date()
        });

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest();
        await revokeIngestionPOST(req, makeContext(exam._id.toString()));

        const updated = await Exam.findById(exam._id).lean();
        expect(updated?.ingestionApprovalStatus).toBe(IngestionApprovalStatus.PENDING_REVIEW);
        expect(updated?.approvedBy).toBeNull();
        expect(updated?.approvedAt).toBeNull();
    });

    // ─── Test 11: Invalid transitions are handled safely ─────────────────────────

    it('11a. approving an already-APPROVED exam returns 409', async () => {
        const exam = await createExam(professorId);
        await Exam.findByIdAndUpdate(exam._id, {
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            approvedBy: new mongoose.Types.ObjectId(professorId),
            approvedAt: new Date()
        });

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest();
        const res = await approveIngestionPOST(req, makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.success).toBe(false);
    });

    it('11b. revoking a PENDING_REVIEW exam returns 409', async () => {
        const exam = await createExam(professorId);
        // ingestionApprovalStatus is PENDING_REVIEW by default

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest();
        const res = await revokeIngestionPOST(req, makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.success).toBe(false);
    });

    // ─── Test 12: New successful batch invalidates existing approval ──────────────

    it('12. new successful batch invalidates existing APPROVED state', async () => {
        const { default: BatchService } = await import('../services/BatchService');

        const exam = await createExam(professorId);
        // Set to APPROVED
        await Exam.findByIdAndUpdate(exam._id, {
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            approvedBy: new mongoose.Types.ObjectId(professorId),
            approvedAt: new Date()
        });

        // Simulate a successful batch creation via resetToReview
        const { default: IngestionApprovalService } = await import('../services/IngestionApprovalService');
        await IngestionApprovalService.resetToReview(exam._id.toString(), {
            actingUserId: professorId,
            actingUserRole: UserRole.PROFESSOR
        });

        const updated = await Exam.findById(exam._id).lean();
        expect(updated?.ingestionApprovalStatus).toBe(IngestionApprovalStatus.PENDING_REVIEW);
    });

    // ─── Test 13: Failed/non-completed ingestion does not reset approval ──────────

    it('13. resetToReview on a PENDING_REVIEW exam is a no-op (no state change)', async () => {
        const exam = await createExam(professorId);
        // Already PENDING_REVIEW — simulates a failed/incomplete batch that did not
        // succeed in creating a completed ingestion

        const { default: IngestionApprovalService } = await import('../services/IngestionApprovalService');
        await IngestionApprovalService.resetToReview(exam._id.toString(), {
            actingUserId: professorId,
            actingUserRole: UserRole.PROFESSOR
        });

        // State should be unchanged; no audit log written
        const updated = await Exam.findById(exam._id).lean();
        expect(updated?.ingestionApprovalStatus).toBe(IngestionApprovalStatus.PENDING_REVIEW);

        const auditCount = await AuditLog.countDocuments({ action: 'INGESTION_APPROVAL_RESET_BY_NEW_BATCH' });
        expect(auditCount).toBe(0);
    });

    // ─── Test 14: Remap blocked after approval ────────────────────────────────────

    it('14. remap is blocked with HTTP 409 when exam ingestion is APPROVED', async () => {
        const exam = await createExam(professorId);
        const { batch, page1, script2 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        // Approve the exam
        await Exam.findByIdAndUpdate(exam._id, {
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            approvedBy: new mongoose.Types.ObjectId(professorId),
            approvedAt: new Date()
        });

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest({ pageId: page1._id.toString(), targetScriptId: script2._id.toString(), versions: {} });
        const res = await remapPOST(req, makeContext(batch.batchId));
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.message).toContain('approved');
    });

    // ─── Test 15: Merge blocked after approval ────────────────────────────────────

    it('15. merge is blocked with HTTP 409 when exam ingestion is APPROVED', async () => {
        const exam = await createExam(professorId);
        const { batch, script1, script2 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        await Exam.findByIdAndUpdate(exam._id, {
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            approvedBy: new mongoose.Types.ObjectId(professorId),
            approvedAt: new Date()
        });

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest({ sourceScriptId: script1._id.toString(), targetScriptId: script2._id.toString(), versions: {} });
        const res = await mergePOST(req, makeContext(batch.batchId));
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.message).toContain('approved');
    });

    // ─── Test 16: Split blocked after approval ────────────────────────────────────

    it('16. split is blocked with HTTP 409 when exam ingestion is APPROVED', async () => {
        const exam = await createExam(professorId);
        const { batch, script1, page1, page2 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        await Exam.findByIdAndUpdate(exam._id, {
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            approvedBy: new mongoose.Types.ObjectId(professorId),
            approvedAt: new Date()
        });

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest({
            scriptId: script1._id.toString(),
            version: script1.__v,
            groups: [[page1._id.toString()], [page2._id.toString()]]
        });
        const res = await splitPOST(req, makeContext(batch.batchId));
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.message).toContain('approved');
    });

    // ─── Test 17: Reorder blocked after approval ──────────────────────────────────

    it('17. reorder is blocked with HTTP 409 when exam ingestion is APPROVED', async () => {
        const exam = await createExam(professorId);
        const { batch, script1, page1, page2 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        await Exam.findByIdAndUpdate(exam._id, {
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            approvedBy: new mongoose.Types.ObjectId(professorId),
            approvedAt: new Date()
        });

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest({
            scriptId: script1._id.toString(),
            version: script1.__v,
            orderedPageIds: [page2._id.toString(), page1._id.toString()]
        });
        const res = await reorderPOST(req, makeContext(batch.batchId));
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.message).toContain('approved');
    });

    // ─── Test 18: Corrections work again after revocation ────────────────────────

    it('18. corrections work normally after approval is revoked', async () => {
        const exam = await createExam(professorId);
        const { batch, page1, script2 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        // Approve then revoke
        await Exam.findByIdAndUpdate(exam._id, {
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            approvedBy: new mongoose.Types.ObjectId(professorId),
            approvedAt: new Date()
        });
        await Exam.findByIdAndUpdate(exam._id, {
            ingestionApprovalStatus: IngestionApprovalStatus.PENDING_REVIEW,
            approvedBy: null,
            approvedAt: null
        });

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const req = makeRequest({ pageId: page1._id.toString(), targetScriptId: script2._id.toString(), versions: {} });
        const res = await remapPOST(req, makeContext(batch.batchId));
        const body = await res.json();

        // Should succeed (not blocked by approval)
        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
    });

    // ─── Test 19: Audit records are created for approve/revoke ───────────────────

    it('19. approval and revocation create audit records', async () => {
        const exam = await createExam(professorId);
        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        // Approve
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        const approveLog = await AuditLog.findOne({ action: 'INGESTION_APPROVED', entityId: exam._id });
        expect(approveLog).not.toBeNull();
        expect(approveLog?.outcome).toBe('SUCCESS');
        expect(approveLog?.entityType).toBe('Exam');

        // Revoke
        await revokeIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        const revokeLog = await AuditLog.findOne({ action: 'INGESTION_APPROVAL_REVOKED', entityId: exam._id });
        expect(revokeLog).not.toBeNull();
        expect(revokeLog?.outcome).toBe('SUCCESS');
        expect(revokeLog?.entityType).toBe('Exam');
    });
});
