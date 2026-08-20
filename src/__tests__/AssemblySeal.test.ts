/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AE-075 Ingestion Assembly Seal Tests
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

describe('AE-075 Ingestion Assembly Seal', () => {
    let replSet: MongoMemoryReplSet;
    let approveIngestionPOST: any;
    let revokeIngestionPOST: any;
    let verifyAssemblyPOST: any;
    let remapPOST: any;

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
        verifyAssemblyPOST = (await import('../app/api/exams/[id]/verify-assembly/route')).POST;
        remapPOST = (await import('../app/api/ingest/[id]/scripts/remap/route')).POST;
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

    // ─── Tests ──────────────────────────────────────────────────────────────────

    it('1. approval generates an assembly seal', async () => {
        const exam = await createExam(professorId);
        await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const res = await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));
        expect(res.status).toBe(200);

        const updated = await Exam.findById(exam._id).lean();
        expect(updated?.ingestionApprovalStatus).toBe(IngestionApprovalStatus.APPROVED);
        expect(updated?.assemblySeal).toBeDefined();
        expect(typeof updated?.assemblySeal).toBe('string');
        expect(updated?.assemblySeal?.length).toBeGreaterThan(10);
    });

    it('2. seal metadata is persisted correctly on the Exam model', async () => {
        const exam = await createExam(professorId);
        await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        const updated = await Exam.findById(exam._id).lean();
        expect(updated?.assemblySealKeyId).toBeDefined();
        expect(updated?.assemblySealAt).toBeDefined();
        expect(updated?.assemblySealBy?.toString()).toBe(professorId);
    });

    it('3. canonical serialization is deterministic', async () => {
        const { default: IngestionApprovalService } = await import('../services/IngestionApprovalService');

        const exam = await createExam(professorId);
        await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        const canonical1 = await (IngestionApprovalService as any).buildCanonicalAssemblyString(exam._id.toString());
        const canonical2 = await (IngestionApprovalService as any).buildCanonicalAssemblyString(exam._id.toString());

        expect(canonical1).toBe(canonical2);
    });

    it('4. same unchanged assembly verifies successfully', async () => {
        const exam = await createExam(professorId);
        await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.valid).toBe(true);
        expect(body.data.status).toBe('INTACT');
    });

    it('5. changing script page membership causes verification failure', async () => {
        const exam = await createExam(professorId);
        const { page1 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        // Disassociate page1 from script1 (move script page membership)
        await IngestionPage.findByIdAndUpdate(page1._id, { answerScript: null });

        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.data.valid).toBe(false);
        expect(body.data.status).toBe('MISMATCH');
    });

    it('6. changing page order causes verification failure', async () => {
        const exam = await createExam(professorId);
        const { page1, page2 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        // Swap pageNumber order
        await IngestionPage.findByIdAndUpdate(page1._id, { pageNumber: 2 });
        await IngestionPage.findByIdAndUpdate(page2._id, { pageNumber: 1 });

        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.data.valid).toBe(false);
        expect(body.data.status).toBe('MISMATCH');
    });

    it('7. changing student binding causes verification failure', async () => {
        const exam = await createExam(professorId);
        const { script1 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        // Change student binding on script
        await AnswerScript.findByIdAndUpdate(script1._id, { student: new mongoose.Types.ObjectId() });

        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.data.valid).toBe(false);
        expect(body.data.status).toBe('MISMATCH');
    });

    it('8. changing identification source causes verification failure', async () => {
        const exam = await createExam(professorId);
        const { script1 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        // Change identification source
        await AnswerScript.findByIdAndUpdate(script1._id, { identificationSource: 'OPERATOR' });

        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.data.valid).toBe(false);
        expect(body.data.status).toBe('MISMATCH');
    });

    it('9. relevant included blank/duplicate/review flags cause mismatch when changed', async () => {
        const exam = await createExam(professorId);
        const { page1 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        // Modify a page review flag (nearBlank)
        await IngestionPage.findByIdAndUpdate(page1._id, { nearBlank: true });

        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.data.valid).toBe(false);
        expect(body.data.status).toBe('MISMATCH');
    });

    it('10. derived preview/enhanced asset changes do NOT affect verification', async () => {
        const exam = await createExam(professorId);
        const { page1 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        // Modify derived fields that should NOT be part of the canonical seal
        await IngestionPage.findByIdAndUpdate(page1._id, {
            thumbnailKey: 'changed-thumb-key.jpg',
            enhancementParams: { brightness: 1.2 }
        });

        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.data.valid).toBe(true);
        expect(body.data.status).toBe('INTACT');
    });

    it('11. original source identity is represented rather than derived asset identity', async () => {
        const { default: IngestionApprovalService } = await import('../services/IngestionApprovalService');

        const exam = await createExam(professorId);
        await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        const canonical = await (IngestionApprovalService as any).buildCanonicalAssemblyString(exam._id.toString());
        // Verify that the canonical payload mentions original batch, file, and num
        expect(canonical).toContain('batch:');
        expect(canonical).toContain('file:');
        expect(canonical).toContain('num:');
        // And does NOT contain derived png key reference
        expect(canonical).not.toContain('page.png');
    });

    it('12. seal creation failure prevents successful approval', async () => {
        const activeSecret = process.env.ORIGINAL_STORAGE_HMAC_SECRET;
        try {
            // Temporarily empty HMAC secret key to force key generation error
            process.env.ORIGINAL_STORAGE_HMAC_SECRET = '';

            const exam = await createExam(professorId);
            await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

            mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
            const res = await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));
            const body = await res.json();

            // Status is 500 or 400
            expect([500, 400]).toContain(res.status);
            expect(body.success).toBe(false);

            // DB record must not be APPROVED
            const unchanged = await Exam.findById(exam._id).lean();
            expect(unchanged?.ingestionApprovalStatus).toBe(IngestionApprovalStatus.PENDING_REVIEW);
        } finally {
            process.env.ORIGINAL_STORAGE_HMAC_SECRET = activeSecret;
        }
    });

    it('13. missing historical HMAC key fails safely', async () => {
        const exam = await createExam(professorId);
        await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        // Change key ID to a non-existent key to simulate key rotation historical secret missing
        await Exam.findByIdAndUpdate(exam._id, { assemblySealKeyId: 'v-nonexistent' });

        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.success).toBe(true);
        expect(body.data.valid).toBe(false);
        expect(body.data.status).toBe('ERROR');
        expect(body.data.reason).toContain('v-nonexistent');
    });

    it('14. unauthorized users cannot verify', async () => {
        const exam = await createExam(professorId);
        await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: taId, email: 'ta@test.com', name: 'TA', role: UserRole.TA };

        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(403);
        expect(body.success).toBe(false);
    });

    it('15. ownership/scope rules are enforced for verification', async () => {
        const exam = await createExam(professorId);
        await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: otherProfessorId, email: 'other@test.com', name: 'Other Prof', role: UserRole.PROFESSOR };

        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        // 404/403 due to ownership restriction
        expect([404, 403]).toContain(res.status);
        expect(body.success).toBe(false);
    });

    it('16. verification on an unapproved/unsealed exam returns controlled failure', async () => {
        const exam = await createExam(professorId);
        await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };

        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.valid).toBe(false);
        expect(body.data.status).toBe('UNAPPROVED');
    });

    it('17. revocation makes the old seal non-active', async () => {
        const exam = await createExam(professorId);
        await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));
        await revokeIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        // Verification should return unapproved
        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.data.valid).toBe(false);
        expect(body.data.status).toBe('UNAPPROVED');

        const updated = await Exam.findById(exam._id).lean();
        expect(updated?.assemblySeal).toBeNull();
    });

    it('18. new successful batch invalidates the active seal', async () => {
        const { default: IngestionApprovalService } = await import('../services/IngestionApprovalService');

        const exam = await createExam(professorId);
        await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        // Simulate a new batch invalidation
        await IngestionApprovalService.resetToReview(exam._id.toString(), {
            actingUserId: professorId,
            actingUserRole: UserRole.PROFESSOR
        });

        const updated = await Exam.findById(exam._id).lean();
        expect(updated?.ingestionApprovalStatus).toBe(IngestionApprovalStatus.PENDING_REVIEW);
        expect(updated?.assemblySeal).toBeNull();
    });

    it('19. re-approval after corrections creates a fresh valid seal', async () => {
        const exam = await createExam(professorId);
        const { page1 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        const firstExam = await Exam.findById(exam._id).lean();
        const firstSeal = firstExam?.assemblySeal;

        // Revoke
        await revokeIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        // Apply correction (nearBlank)
        await IngestionPage.findByIdAndUpdate(page1._id, { nearBlank: true });

        // Re-approve
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        const secondExam = await Exam.findById(exam._id).lean();
        const secondSeal = secondExam?.assemblySeal;

        expect(secondSeal).toBeDefined();
        expect(secondSeal).not.toBe(firstSeal);

        // Verification of the new assembly should be INTACT
        const res = await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();
        expect(body.data.valid).toBe(true);
    });

    it('20. seal creation and verification events are audited', async () => {
        const exam = await createExam(professorId);
        await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));
        await verifyAssemblyPOST(makeRequest(), makeContext(exam._id.toString()));

        const approveLog = await AuditLog.findOne({ action: 'INGESTION_APPROVED', entityId: exam._id });
        expect(approveLog).not.toBeNull();
        expect(approveLog?.details?.assemblySeal).toBeDefined();

        const verifyLog = await AuditLog.findOne({ action: 'INGESTION_ASSEMBLY_VERIFIED', entityId: exam._id });
        expect(verifyLog).not.toBeNull();
        expect(verifyLog?.outcome).toBe('SUCCESS');
    });

    it('21. existing AE-074 correction blocking remains intact', async () => {
        const exam = await createExam(professorId);
        const { batch, page1, script2 } = await createBatchWithExam(professorId, exam._id as mongoose.Types.ObjectId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(makeRequest(), makeContext(exam._id.toString()));

        // Try correction (remap) -> should be blocked by AE-074 logic with 409
        const req = makeRequest({ pageId: page1._id.toString(), targetScriptId: script2._id.toString(), versions: {} });
        const res = await remapPOST(req, makeContext(batch.batchId));
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.message).toContain('approved');
    });
});
