/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AE-076 Ingestion Review Dashboard Tests
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Exam, { ExamStatus } from '../models/Exam';
import Course from '../models/Course';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import AnswerScript from '../models/AnswerScript';
import AuditLog from '../models/AuditLog';
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

describe('AE-076 Review Dashboard Summary & Counts', () => {
    let replSet: MongoMemoryReplSet;
    let ingestionSummaryGET: any;

    const professorId = new mongoose.Types.ObjectId().toString();
    const otherProfessorId = new mongoose.Types.ObjectId().toString();

    beforeAll(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }

        replSet = await MongoMemoryReplSet.create({
            replSet: { storageEngine: 'wiredTiger' }
        });
        const uri = replSet.getUri();
        await mongoose.connect(uri);

        ingestionSummaryGET = (await import('../app/api/exams/[id]/ingestion-summary/route')).GET;
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
        await User.deleteMany({});
        await Course.deleteMany({});
        await AuditLog.deleteMany({});
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

    function makeRequest(category?: string) {
        const url = category 
            ? `http://localhost/api?category=${category}` 
            : 'http://localhost/api';
        return new Request(url, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
    }

    function makeContext(id: string) {
        return { params: Promise.resolve({ id }) };
    }

    // ─── Tests ──────────────────────────────────────────────────────────────────

    it('1. correct total script count', async () => {
        const exam = await createExam(professorId);

        // Create 3 active scripts
        await AnswerScript.create([
            { exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, identificationStatus: 'IDENTIFIED', student: new mongoose.Types.ObjectId(), isActive: true },
            { exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 2, endPageNumber: 2, pageCount: 1, identificationStatus: 'IDENTIFIED', student: new mongoose.Types.ObjectId(), isActive: true },
            { exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 3, endPageNumber: 3, pageCount: 1, identificationStatus: 'IDENTIFIED', student: new mongoose.Types.ObjectId(), isActive: true }
        ]);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        const res = await ingestionSummaryGET(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.counts.totalScripts).toBe(3);
    });

    it('2. unmatched/manual-ID count: detects student is null or needsManualId is true', async () => {
        const exam = await createExam(professorId);

        await AnswerScript.create([
            // script 1: student is set, needsManualId is false -> identified/matched
            { exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, identificationStatus: 'IDENTIFIED', student: new mongoose.Types.ObjectId(), needsManualId: false, isActive: true },
            // script 2: student is null -> unmatched
            { exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 2, endPageNumber: 2, pageCount: 1, identificationStatus: 'UNIDENTIFIED', student: null, needsManualId: false, isActive: true },
            // script 3: student is set but needsManualId is true -> unmatched
            { exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 3, endPageNumber: 3, pageCount: 1, identificationStatus: 'UNIDENTIFIED', student: new mongoose.Types.ObjectId(), needsManualId: true, isActive: true }
        ]);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        const res = await ingestionSummaryGET(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.data.counts.totalScripts).toBe(3);
        expect(body.data.counts.unmatched).toBe(2);
    });

    it('3. blank script semantics: all pages near blank = blank script', async () => {
        const exam = await createExam(professorId);

        // Script 1: 2 pages, all are near blank
        const script1 = await AnswerScript.create({
            exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 2, pageCount: 2, isActive: true
        });
        const dummyJobId = new mongoose.Types.ObjectId();
        await IngestionPage.create([
            { batchId: 'b1', fileId: 'f1', pageNumber: 1, fileIndex: 0, job: dummyJobId, storageKey: 'batches/b1/derived/f1/1/page.png', status: PageProcessingStatus.PROCESSED, answerScript: script1._id, nearBlank: true },
            { batchId: 'b1', fileId: 'f1', pageNumber: 2, fileIndex: 0, job: dummyJobId, storageKey: 'batches/b1/derived/f1/2/page.png', status: PageProcessingStatus.PROCESSED, answerScript: script1._id, nearBlank: true }
        ]);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        const res = await ingestionSummaryGET(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.data.counts.blank).toBe(1);
    });

    it('4. mixed blank/non-blank pages = not blank script', async () => {
        const exam = await createExam(professorId);

        // Script 1: 2 pages, only 1 is near blank
        const script1 = await AnswerScript.create({
            exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 2, pageCount: 2, isActive: true
        });
        const dummyJobId = new mongoose.Types.ObjectId();
        await IngestionPage.create([
            { batchId: 'b1', fileId: 'f1', pageNumber: 1, fileIndex: 0, job: dummyJobId, storageKey: 'batches/b1/derived/f1/1/page.png', status: PageProcessingStatus.PROCESSED, answerScript: script1._id, nearBlank: true },
            { batchId: 'b1', fileId: 'f1', pageNumber: 2, fileIndex: 0, job: dummyJobId, storageKey: 'batches/b1/derived/f1/2/page.png', status: PageProcessingStatus.PROCESSED, answerScript: script1._id, nearBlank: false }
        ]);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        const res = await ingestionSummaryGET(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.data.counts.blank).toBe(0);
    });

    it('5. duplicate count: duplicate manualIdReason or contains duplicate pages', async () => {
        const exam = await createExam(professorId);

        // Script 1: marked manualIdReason DUPLICATE_STUDENT
        await AnswerScript.create({
            exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, manualIdReason: 'DUPLICATE_STUDENT', isActive: true
        });

        // Script 2: has page with isDuplicate true
        const script2 = await AnswerScript.create({
            exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 2, endPageNumber: 2, pageCount: 1, isActive: true
        });
        const dummyJobId = new mongoose.Types.ObjectId();
        await IngestionPage.create({
            batchId: 'b1', fileId: 'f1', pageNumber: 2, fileIndex: 0, job: dummyJobId, storageKey: 'batches/b1/derived/f1/2/page.png', status: PageProcessingStatus.PROCESSED, answerScript: script2._id, isDuplicate: true
        });

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        const res = await ingestionSummaryGET(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.data.counts.duplicate).toBe(2);
    });

    it('6. conflict count: script has hasIdentificationConflict true', async () => {
        const exam = await createExam(professorId);

        await AnswerScript.create([
            { exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, hasIdentificationConflict: true, isActive: true },
            { exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 2, endPageNumber: 2, pageCount: 1, hasIdentificationConflict: false, isActive: true }
        ]);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        const res = await ingestionSummaryGET(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(body.data.counts.conflict).toBe(1);
    });

    it('7. owner scoping: unauthorized access', async () => {
        const exam = await createExam(professorId);

        // Set role to PROFESSOR but a different user id
        mockSessionUser = { id: otherProfessorId, email: 'other@test.com', name: 'Other', role: UserRole.PROFESSOR };
        
        const res = await ingestionSummaryGET(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(body.success).toBe(false);
    });

    it('8. empty exam / no scripts', async () => {
        const exam = await createExam(professorId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        const res = await ingestionSummaryGET(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.data.counts.totalScripts).toBe(0);
        expect(body.data.counts.unmatched).toBe(0);
        expect(body.data.counts.blank).toBe(0);
        expect(body.data.counts.duplicate).toBe(0);
        expect(body.data.counts.conflict).toBe(0);
    });

    it('9. dashboard/API uses persisted state rather than client-side invented state', async () => {
        const exam = await createExam(professorId);
        
        const spySummary = vi.spyOn(mongoose.Model, 'aggregate');

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        const res = await ingestionSummaryGET(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(spySummary).toHaveBeenCalled();
        
        spySummary.mockRestore();
    });

    it('10. drill-down lists scripts of unmatched category correctly', async () => {
        const exam = await createExam(professorId);

        const s1 = await AnswerScript.create({
            exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, student: null, needsManualId: true, isActive: true
        });
        const dummyJobId = new mongoose.Types.ObjectId();
        await IngestionPage.create({
            batchId: 'b1', fileId: 'f1', pageNumber: 1, fileIndex: 0, job: dummyJobId, storageKey: 'batches/b1/derived/f1/1/page.png', status: PageProcessingStatus.PROCESSED, answerScript: s1._id
        });

        const s2 = await AnswerScript.create({
            exam: exam._id, batchId: 'b1', fileIndex: 0, startPageNumber: 2, endPageNumber: 2, pageCount: 1, student: new mongoose.Types.ObjectId(), needsManualId: false, isActive: true
        });
        await IngestionPage.create({
            batchId: 'b1', fileId: 'f1', pageNumber: 2, fileIndex: 0, job: dummyJobId, storageKey: 'batches/b1/derived/f1/2/page.png', status: PageProcessingStatus.PROCESSED, answerScript: s2._id
        });

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        const res = await ingestionSummaryGET(makeRequest('unmatched'), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.data.scripts).toBeDefined();
        expect(body.data.scripts.length).toBe(1);
        expect(body.data.scripts[0]._id.toString()).toBe(s1._id.toString());
        expect(body.data.scripts[0].pages[0].pageNumber).toBe(1);
    });
});
