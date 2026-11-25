import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { Readable } from 'stream';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import RegradeRequest, { RegradeDecisionOutcome, RegradeStatus } from '../models/RegradeRequest';
import Rubric from '../models/Rubric';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import DerivedStorageService from '../services/DerivedStorageService';

let mockSessionUser: { id: string; role: UserRole } | null = null;

vi.mock('next-auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('next-auth')>();
    return {
        ...original,
        getServerSession: vi.fn().mockImplementation(() => (
            mockSessionUser ? { user: mockSessionUser } : null
        ))
    };
});

describe('AE-219 regrade access policy', () => {
    let getRequests: typeof import('../app/api/professor/regrade-requests/route').GET;
    let assignReviewer: typeof import('../app/api/professor/regrade-requests/[id]/assignment/route').PATCH;
    let patchDecision: typeof import('../app/api/professor/regrade-requests/[id]/route').PATCH;
    let getScriptPages: typeof import('../app/api/scripts/[id]/pages/route').GET;
    let getAnalytics: typeof import('../app/api/analytics/exams/[id]/route').GET;
    let getGraders: typeof import('../app/api/analytics/exams/[id]/graders/route').GET;
    let getExport: typeof import('../app/api/analytics/exams/[id]/export/route').GET;
    let getLmsExport: typeof import('../app/api/analytics/exams/[id]/export/lms/route').GET;
    let getLtiPassback: typeof import('../app/api/analytics/exams/[id]/lti/passback/route').GET;
    let getAuditExport: typeof import('../app/api/audit-logs/export/route').GET;
    let getImage: typeof import('../app/api/ingest/[id]/pages/[pageId]/image/route').GET;
    let getThumbnail: typeof import('../app/api/ingest/[id]/pages/[pageId]/thumbnail/route').GET;
    let getExam: typeof import('../app/api/exams/[id]/route').GET;
    let getProgress: typeof import('../app/api/exams/[id]/progress/route').GET;

    beforeAll(async () => {
        getRequests = (await import('../app/api/professor/regrade-requests/route')).GET;
        assignReviewer = (await import('../app/api/professor/regrade-requests/[id]/assignment/route')).PATCH;
        patchDecision = (await import('../app/api/professor/regrade-requests/[id]/route')).PATCH;
        getScriptPages = (await import('../app/api/scripts/[id]/pages/route')).GET;
        getAnalytics = (await import('../app/api/analytics/exams/[id]/route')).GET;
        getGraders = (await import('../app/api/analytics/exams/[id]/graders/route')).GET;
        getExport = (await import('../app/api/analytics/exams/[id]/export/route')).GET;
        getLmsExport = (await import('../app/api/analytics/exams/[id]/export/lms/route')).GET;
        getLtiPassback = (await import('../app/api/analytics/exams/[id]/lti/passback/route')).GET;
        getAuditExport = (await import('../app/api/audit-logs/export/route')).GET;
        getImage = (await import('../app/api/ingest/[id]/pages/[pageId]/image/route')).GET;
        getThumbnail = (await import('../app/api/ingest/[id]/pages/[pageId]/thumbnail/route')).GET;
        getExam = (await import('../app/api/exams/[id]/route')).GET;
        getProgress = (await import('../app/api/exams/[id]/progress/route')).GET;
        await RegradeRequest.init();

        vi.spyOn(DerivedStorageService, 'openDerivedPage').mockResolvedValue({
            stream: Readable.from([Buffer.from('fake-derived-image')]),
            size: 19
        });
        vi.spyOn(DerivedStorageService, 'readDerivedPage').mockResolvedValue(Buffer.from('fake-thumb-data'));
    });

    afterEach(() => {
        mockSessionUser = null;
    });

    async function createFixture() {
        const suffix = `${Date.now()}-${Math.random()}`;

        // Professor who currently teaches the course but did NOT create the exam
        const courseProfessor = await User.create({
            name: 'Course Professor',
            email: `prof-course-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        // Professor who created the exam but is NOT the course professor
        const examCreator = await User.create({
            name: 'Exam Creator',
            email: `prof-creator-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        // Unrelated professor
        const unrelatedProfessor = await User.create({
            name: 'Unrelated Professor',
            email: `prof-unrelated-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        const ta = await User.create({
            name: 'Course TA',
            email: `ta-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });

        const student = await User.create({
            name: 'Student One',
            email: `student-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true
        });

        const admin = await User.create({
            name: 'System Admin',
            email: `admin-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.ADMIN,
            isActive: true
        });

        const course = await Course.create({
            courseCode: `CS-AE219-${suffix}`,
            courseName: 'Access Policy Verification',
            academicYear: '2026',
            semester: 1,
            professor: courseProfessor._id,
            teachingAssistants: [ta._id],
            enrolledStudents: [student._id],
            isActive: true
        });

        const exam = await Exam.create({
            title: 'AE-219 Midterm',
            course: course._id,
            createdBy: examCreator._id, // created by examCreator, NOT courseProfessor
            examDate: new Date(),
            totalMarks: 20,
            numberOfQuestions: 1,
            status: ExamStatus.PUBLISHED,
            isActive: true
        });

        const rubric = await Rubric.create({
            exam: exam._id,
            createdBy: examCreator._id,
            scoreStep: 0.5,
            questions: [{
                questionNumber: 1,
                maxMarks: 20,
                criteria: [{ criterionName: 'Correctness', points: 20 }]
            }],
            isActive: true
        });
        await Exam.updateOne({ _id: exam._id }, { $set: { rubric: rubric._id } });

        const script = await AnswerScript.create({
            exam: exam._id,
            student: student._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        await Grade.create({
            answerScript: script._id,
            rubric: rubric._id,
            gradedBy: examCreator._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Correctness', score: 12 }],
            totalScore: 12,
            isFinal: true
        });

        const regrade = await RegradeRequest.create({
            exam: exam._id,
            answerScript: script._id,
            questionNumber: 1,
            student: student._id,
            reason: 'Question was graded too strictly.',
            status: RegradeStatus.OPEN
        });

        const batch = await Batch.create({
            batchId: `batch-${suffix}`,
            exam: exam._id,
            uploadedBy: examCreator._id,
            totalFiles: 1,
            status: BatchStatus.DONE
        });

        const page = await IngestionPage.create({
            batchId: batch.batchId,
            job: new mongoose.Types.ObjectId(),
            fileId: `file-${suffix}`,
            pageNumber: 1,
            fileIndex: 0,
            storageKey: `derived/pages/${batch.batchId}/p1.png`,
            thumbnailKey: `derived/pages/${batch.batchId}/p1_thumb.png`,
            answerScript: script._id,
            status: PageProcessingStatus.PROCESSED
        });

        return {
            courseProfessor,
            examCreator,
            unrelatedProfessor,
            admin,
            ta,
            student,
            course,
            exam,
            rubric,
            script,
            regrade,
            batch,
            page
        };
    }

    function callGetQueue(examId?: string) {
        const url = examId
            ? `http://localhost:3000/api/professor/regrade-requests?examId=${examId}`
            : 'http://localhost:3000/api/professor/regrade-requests';
        return getRequests(new NextRequest(url, { method: 'GET' }));
    }

    function callAssign(regradeId: string, reviewerId: string | null) {
        return assignReviewer(
            new NextRequest(`http://localhost:3000/api/professor/regrade-requests/${regradeId}/assignment`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ reviewerId })
            }),
            { params: Promise.resolve({ id: regradeId }) }
        );
    }

    function callDecide(regradeId: string, body: Record<string, unknown>) {
        return patchDecision(
            new NextRequest(`http://localhost:3000/api/professor/regrade-requests/${regradeId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body)
            }),
            { params: Promise.resolve({ id: regradeId }) }
        );
    }

    function callScriptPages(scriptId: string) {
        return getScriptPages(
            new NextRequest(`http://localhost:3000/api/scripts/${scriptId}/pages`, { method: 'GET' }),
            { params: Promise.resolve({ id: scriptId }) }
        );
    }

    function callImage(batchId: string, pageId: string) {
        return getImage(
            new NextRequest(`http://localhost:3000/api/ingest/${batchId}/pages/${pageId}/image`, { method: 'GET' }),
            { params: Promise.resolve({ id: batchId, pageId }) }
        );
    }

    function callThumbnail(batchId: string, pageId: string) {
        return getThumbnail(
            new NextRequest(`http://localhost:3000/api/ingest/${batchId}/pages/${pageId}/thumbnail`, { method: 'GET' }),
            { params: Promise.resolve({ id: batchId, pageId }) }
        );
    }

    function callExamGet(examId: string) {
        return getExam(
            new NextRequest(`http://localhost:3000/api/exams/${examId}`, { method: 'GET' }),
            { params: Promise.resolve({ id: examId }) }
        );
    }

    function callProgressGet(examId: string) {
        return getProgress(
            new NextRequest(`http://localhost:3000/api/exams/${examId}/progress`, { method: 'GET' }),
            { params: Promise.resolve({ id: examId }) }
        );
    }

    it('allows the course professor who did not create the exam to list, assign, and decide regrades', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };

        // 1. Can view in queue
        const queueRes = await callGetQueue(fixture.exam._id.toString());
        expect(queueRes.status).toBe(200);
        const queueData = await queueRes.json();
        expect(queueData.data.requests).toHaveLength(1);
        expect(queueData.data.requests[0].id).toBe(fixture.regrade._id.toString());

        // 2. Can assign reviewer
        const assignRes = await callAssign(fixture.regrade._id.toString(), fixture.ta._id.toString());
        expect(assignRes.status).toBe(200);
        const assignData = await assignRes.json();
        expect(assignData.data.assignedTo.id).toBe(fixture.ta._id.toString());

        // 3. Can decide regrade
        const decideRes = await callDecide(fixture.regrade._id.toString(), {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'Course professor approved the regrade.',
            revisedScore: 18
        });
        expect(decideRes.status).toBe(200);

        const updated = await RegradeRequest.findById(fixture.regrade._id);
        expect(updated?.status).toBe(RegradeStatus.RESOLVED);
        expect(updated?.decision?.revisedScore).toBe(18);
    });

    it('denies access to an exam creator who is no longer the course professor', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.examCreator._id.toString(), role: UserRole.PROFESSOR };

        // 1. Queue returns 404 when querying specific exam, or empty list on general queue
        const queueRes = await callGetQueue(fixture.exam._id.toString());
        expect(queueRes.status).toBe(404);

        const generalQueueRes = await callGetQueue();
        expect(generalQueueRes.status).toBe(200);
        const generalQueueData = await generalQueueRes.json();
        expect(generalQueueData.data.requests).toHaveLength(0);

        // 2. Assignment returns 404
        const assignRes = await callAssign(fixture.regrade._id.toString(), fixture.ta._id.toString());
        expect(assignRes.status).toBe(404);

        // 3. Decision returns 404
        const decideRes = await callDecide(fixture.regrade._id.toString(), {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'Creator trying to decide without course professor role.',
            revisedScore: 18
        });
        expect(decideRes.status).toBe(404);
    });

    it('rejects assigning an exam creator who lacks course-professor membership as a reviewer', async () => {
        const fixture = await createFixture();
        // Course professor attempts to assign the exam creator (who is not on the course)
        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };

        const assignRes = await callAssign(fixture.regrade._id.toString(), fixture.examCreator._id.toString());
        expect(assignRes.status).toBe(400);
        const body = await assignRes.json();
        expect(body.message).toContain('Reviewer must be an active TA assigned to the course or the course professor');

        const saved = await RegradeRequest.findById(fixture.regrade._id);
        expect(saved?.assignedTo).toBeNull();
    });

    it('allows assigning the course professor as a reviewer', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };

        const assignRes = await callAssign(fixture.regrade._id.toString(), fixture.courseProfessor._id.toString());
        expect(assignRes.status).toBe(200);
        const body = await assignRes.json();
        expect(body.data.assignedTo.id).toBe(fixture.courseProfessor._id.toString());

        const saved = await RegradeRequest.findById(fixture.regrade._id);
        expect(saved?.assignedTo?.toString()).toBe(fixture.courseProfessor._id.toString());
    });

    it('denies an unrelated professor from accessing queue, assignment, or decisions', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.unrelatedProfessor._id.toString(), role: UserRole.PROFESSOR };

        // 1. Queue returns 404 for specific exam or empty list on general queue
        const queueRes = await callGetQueue(fixture.exam._id.toString());
        expect(queueRes.status).toBe(404);

        const generalQueueRes = await callGetQueue();
        expect(generalQueueRes.status).toBe(200);
        const generalQueueData = await generalQueueRes.json();
        expect(generalQueueData.data.requests).toHaveLength(0);

        // 2. Assignment is 404
        const assignRes = await callAssign(fixture.regrade._id.toString(), fixture.ta._id.toString());
        expect(assignRes.status).toBe(404);

        // 3. Decision is 404
        const decideRes = await callDecide(fixture.regrade._id.toString(), {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'Unrelated professor attempt.',
            revisedScore: 18
        });
        expect(decideRes.status).toBe(404);
    });

    it('allows an admin to list, assign, and decide regrades, and view script pages', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };

        // 1. Can list in queue
        const queueRes = await callGetQueue(fixture.exam._id.toString());
        expect(queueRes.status).toBe(200);
        const queueData = await queueRes.json();
        expect(queueData.data.requests).toHaveLength(1);

        // 2. Can assign reviewer
        const assignRes = await callAssign(fixture.regrade._id.toString(), fixture.ta._id.toString());
        expect(assignRes.status).toBe(200);

        // 3. Can decide regrade
        const decideRes = await callDecide(fixture.regrade._id.toString(), {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'Admin approved the regrade.',
            revisedScore: 18
        });
        expect(decideRes.status).toBe(200);

        // 4. Can view script pages
        const pagesRes = await callScriptPages(fixture.script._id.toString());
        expect(pagesRes.status).toBe(200);
    });

    it('allows course professor to view script pages while denying the former exam creator', async () => {
        const fixture = await createFixture();

        // Course professor gets 200 on script pages
        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        const profPagesRes = await callScriptPages(fixture.script._id.toString());
        expect(profPagesRes.status).toBe(200);

        // Former creator (no longer course professor) gets 404 on script pages
        mockSessionUser = { id: fixture.examCreator._id.toString(), role: UserRole.PROFESSOR };
        const creatorPagesRes = await callScriptPages(fixture.script._id.toString());
        expect(creatorPagesRes.status).toBe(404);
    });

    it('uniformly denies queue, assignment, decision, and script pages when course is inactive', async () => {
        const fixture = await createFixture();
        await Course.updateOne({ _id: fixture.course._id }, { $set: { isActive: false } });

        // For Course Professor:
        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await callGetQueue(fixture.exam._id.toString())).status).toBe(404);
        expect((await callAssign(fixture.regrade._id.toString(), fixture.ta._id.toString())).status).toBe(404);
        expect((await callDecide(fixture.regrade._id.toString(), { outcome: RegradeDecisionOutcome.REJECTED, reason: 'test' })).status).toBe(404);
        expect((await callScriptPages(fixture.script._id.toString())).status).toBe(404);

        // For Admin:
        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await callGetQueue(fixture.exam._id.toString())).status).toBe(404);
        expect((await callAssign(fixture.regrade._id.toString(), fixture.ta._id.toString())).status).toBe(404);
        expect((await callDecide(fixture.regrade._id.toString(), { outcome: RegradeDecisionOutcome.REJECTED, reason: 'test' })).status).toBe(404);
        expect((await callScriptPages(fixture.script._id.toString())).status).toBe(404);
    });

    it('uniformly denies queue, assignment, decision, and script pages when exam is inactive', async () => {
        const fixture = await createFixture();
        await Exam.updateOne({ _id: fixture.exam._id }, { $set: { isActive: false } }, { bypassWorm: true } as unknown as Parameters<typeof Exam.updateOne>[2]);

        // For Course Professor:
        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await callGetQueue(fixture.exam._id.toString())).status).toBe(404);
        expect((await callAssign(fixture.regrade._id.toString(), fixture.ta._id.toString())).status).toBe(404);
        expect((await callDecide(fixture.regrade._id.toString(), { outcome: RegradeDecisionOutcome.REJECTED, reason: 'test' })).status).toBe(404);
        expect((await callScriptPages(fixture.script._id.toString())).status).toBe(404);

        // For Admin:
        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await callGetQueue(fixture.exam._id.toString())).status).toBe(404);
        expect((await callAssign(fixture.regrade._id.toString(), fixture.ta._id.toString())).status).toBe(404);
        expect((await callDecide(fixture.regrade._id.toString(), { outcome: RegradeDecisionOutcome.REJECTED, reason: 'test' })).status).toBe(404);
        expect((await callScriptPages(fixture.script._id.toString())).status).toBe(404);
    });

    it('allows course professor and admin to access analytics, export, LMS, LTI, and audit routes; denies former creator', async () => {
        const fixture = await createFixture();
        // Set exam to PUBLISHED so published-only checks pass
        await Exam.updateOne({ _id: fixture.exam._id }, { $set: { status: ExamStatus.PUBLISHED } });

        const examIdStr = fixture.exam._id.toString();
        const makeContext = (id: string) => ({ params: Promise.resolve({ id }) });

        // Course professor access:
        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        const profAnalytics = await getAnalytics(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}`), makeContext(examIdStr));
        expect(profAnalytics.status).toBe(200);

        const profGraders = await getGraders(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/graders`), makeContext(examIdStr));
        expect(profGraders.status).toBe(200);

        const profExport = await getExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export?format=csv`), makeContext(examIdStr));
        expect(profExport.status).toBe(200);

        const profLms = await getLmsExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export/lms`), makeContext(examIdStr));
        expect(profLms.status).toBe(200);

        const profLti = await getLtiPassback(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/lti/passback`), makeContext(examIdStr));
        expect(profLti.status).toBe(200);

        const profAudit = await getAuditExport(new NextRequest(`http://localhost:3000/api/audit-logs/export?examId=${examIdStr}`));
        expect(profAudit.status).toBe(200);

        // Former creator (no longer course professor) is denied with exact 404:
        mockSessionUser = { id: fixture.examCreator._id.toString(), role: UserRole.PROFESSOR };
        expect((await getAnalytics(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}`), makeContext(examIdStr))).status).toBe(404);
        expect((await getExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export?format=csv`), makeContext(examIdStr))).status).toBe(404);
        expect((await getLmsExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export/lms`), makeContext(examIdStr))).status).toBe(404);
        expect((await getLtiPassback(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/lti/passback`), makeContext(examIdStr))).status).toBe(404);
        expect((await getAuditExport(new NextRequest(`http://localhost:3000/api/audit-logs/export?examId=${examIdStr}`))).status).toBe(404);

        // Admin is allowed:
        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await getExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export?format=csv`), makeContext(examIdStr))).status).toBe(200);
        expect((await getAuditExport(new NextRequest(`http://localhost:3000/api/audit-logs/export?examId=${examIdStr}`))).status).toBe(200);
    });

    it('uniformly returns 404 for analytics, export, LMS, LTI, and audit routes when course is inactive', async () => {
        const fixture = await createFixture();
        await Exam.updateOne({ _id: fixture.exam._id }, { $set: { status: ExamStatus.PUBLISHED } });
        const examIdStr = fixture.exam._id.toString();
        const makeContext = (id: string) => ({ params: Promise.resolve({ id }) });

        // Deactivate course
        await Course.updateOne({ _id: fixture.course._id }, { $set: { isActive: false } });

        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await getAnalytics(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}`), makeContext(examIdStr))).status).toBe(404);
        expect((await getExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export?format=csv`), makeContext(examIdStr))).status).toBe(404);
        expect((await getLmsExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export/lms`), makeContext(examIdStr))).status).toBe(404);
        expect((await getLtiPassback(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/lti/passback`), makeContext(examIdStr))).status).toBe(404);
        expect((await getAuditExport(new NextRequest(`http://localhost:3000/api/audit-logs/export?examId=${examIdStr}`))).status).toBe(404);

        // Admin also gets 404 when course is inactive
        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await getAnalytics(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}`), makeContext(examIdStr))).status).toBe(404);
        expect((await getExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export?format=csv`), makeContext(examIdStr))).status).toBe(404);
        expect((await getAuditExport(new NextRequest(`http://localhost:3000/api/audit-logs/export?examId=${examIdStr}`))).status).toBe(404);
    });

    it('uniformly returns 404 for analytics, export, LMS, LTI, and audit routes when exam is inactive', async () => {
        const fixture = await createFixture();
        await Exam.updateOne({ _id: fixture.exam._id }, { $set: { status: ExamStatus.PUBLISHED, isActive: false } }, { bypassWorm: true } as unknown as Parameters<typeof Exam.updateOne>[2]);
        const examIdStr = fixture.exam._id.toString();
        const makeContext = (id: string) => ({ params: Promise.resolve({ id }) });

        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await getAnalytics(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}`), makeContext(examIdStr))).status).toBe(404);
        expect((await getExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export?format=csv`), makeContext(examIdStr))).status).toBe(404);
        expect((await getLmsExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export/lms`), makeContext(examIdStr))).status).toBe(404);
        expect((await getLtiPassback(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/lti/passback`), makeContext(examIdStr))).status).toBe(404);
        expect((await getAuditExport(new NextRequest(`http://localhost:3000/api/audit-logs/export?examId=${examIdStr}`))).status).toBe(404);

        // Admin also gets 404 when exam is inactive
        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await getAnalytics(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}`), makeContext(examIdStr))).status).toBe(404);
        expect((await getExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export?format=csv`), makeContext(examIdStr))).status).toBe(404);
        expect((await getAuditExport(new NextRequest(`http://localhost:3000/api/audit-logs/export?examId=${examIdStr}`))).status).toBe(404);
    });

    it('enforces canManageExam on batch page image and thumbnail routes; denies former uploader and handles inactive course/exam across roles', async () => {
        const fixture = await createFixture();

        // Course professor gets 200
        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        const profImageRes = await callImage(fixture.batch.batchId, fixture.page._id.toString());
        expect(profImageRes.status).toBe(200);
        const profThumbRes = await callThumbnail(fixture.batch.batchId, fixture.page._id.toString());
        expect(profThumbRes.status).toBe(200);

        // Admin gets 200
        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        const adminImageRes = await callImage(fixture.batch.batchId, fixture.page._id.toString());
        expect(adminImageRes.status).toBe(200);
        const adminThumbRes = await callThumbnail(fixture.batch.batchId, fixture.page._id.toString());
        expect(adminThumbRes.status).toBe(200);

        // Former creator/uploader (no longer course professor) gets 404
        mockSessionUser = { id: fixture.examCreator._id.toString(), role: UserRole.PROFESSOR };
        const creatorImageRes = await callImage(fixture.batch.batchId, fixture.page._id.toString());
        expect(creatorImageRes.status).toBe(404);
        const creatorThumbRes = await callThumbnail(fixture.batch.batchId, fixture.page._id.toString());
        expect(creatorThumbRes.status).toBe(404);

        // When course is deactivated, both professor and admin receive 404
        await Course.updateOne({ _id: fixture.course._id }, { $set: { isActive: false } });

        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await callImage(fixture.batch.batchId, fixture.page._id.toString())).status).toBe(404);
        expect((await callThumbnail(fixture.batch.batchId, fixture.page._id.toString())).status).toBe(404);

        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await callImage(fixture.batch.batchId, fixture.page._id.toString())).status).toBe(404);
        expect((await callThumbnail(fixture.batch.batchId, fixture.page._id.toString())).status).toBe(404);
    });

    it('excludes inactive courses and inactive exams from TA regrade queue', async () => {
        const fixture = await createFixture();
        // Assign regrade request to TA
        await RegradeRequest.updateOne({ _id: fixture.regrade._id }, { $set: { assignedTo: fixture.ta._id } });

        mockSessionUser = { id: fixture.ta._id.toString(), role: UserRole.TA };
        const activeRes = await callGetQueue();
        expect(activeRes.status).toBe(200);
        const activeData = await activeRes.json();
        expect(activeData.data.requests).toHaveLength(1);

        // Deactivate course -> TA queue excludes requests from inactive course
        await Course.updateOne({ _id: fixture.course._id }, { $set: { isActive: false } });
        const inactiveCourseRes = await callGetQueue();
        expect(inactiveCourseRes.status).toBe(200);
        const inactiveCourseData = await inactiveCourseRes.json();
        expect(inactiveCourseData.data.requests).toHaveLength(0);

        // Reactivate course, deactivate exam -> TA queue excludes requests from inactive exam
        await Course.updateOne({ _id: fixture.course._id }, { $set: { isActive: true } });
        await Exam.updateOne({ _id: fixture.exam._id }, { $set: { isActive: false } }, { bypassWorm: true } as unknown as Parameters<typeof Exam.updateOne>[2]);
        const inactiveExamRes = await callGetQueue();
        expect(inactiveExamRes.status).toBe(200);
        const inactiveExamData = await inactiveExamRes.json();
        expect(inactiveExamData.data.requests).toHaveLength(0);
    });

    it('denies both admin and professor from exam details and progress when course is inactive', async () => {
        const fixture = await createFixture();
        const examIdStr = fixture.exam._id.toString();

        // Active course: admin and professor both get 200
        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await callExamGet(examIdStr)).status).toBe(200);
        expect((await callProgressGet(examIdStr)).status).toBe(200);

        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await callExamGet(examIdStr)).status).toBe(200);
        expect((await callProgressGet(examIdStr)).status).toBe(200);

        // Inactive course: both get 404
        await Course.updateOne({ _id: fixture.course._id }, { $set: { isActive: false } });

        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await callExamGet(examIdStr)).status).toBe(404);
        expect((await callProgressGet(examIdStr)).status).toBe(404);

        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await callExamGet(examIdStr)).status).toBe(404);
        expect((await callProgressGet(examIdStr)).status).toBe(404);
    });

    it('verifies canManageExam check order: unrelated professor receives identical 404 and error message for active and archived courses (no info leak)', async () => {
        const { canManageExam } = await import('../lib/apiAuth');
        const fixture = await createFixture();
        const unrelatedProf = { id: fixture.unrelatedProfessor._id.toString(), role: UserRole.PROFESSOR };

        // 1. With active course:
        const activeResult = await canManageExam(unrelatedProf, fixture.exam._id);
        expect(activeResult.canManage).toBe(false);
        expect(activeResult.errorStatus).toBe(404);
        expect(activeResult.errorMessage).toBe('Exam not found');
        expect(activeResult.exam).toBeNull();
        expect(activeResult.course).toBeNull();

        // HTTP route response with active course:
        mockSessionUser = { id: fixture.unrelatedProfessor._id.toString(), role: UserRole.PROFESSOR };
        const activeHttpRes = await callExamGet(fixture.exam._id.toString());
        expect(activeHttpRes.status).toBe(404);
        const activeHttpBody = await activeHttpRes.json();

        // 2. Archive course (isActive = false):
        await Course.updateOne({ _id: fixture.course._id }, { $set: { isActive: false } });

        const archivedResult = await canManageExam(unrelatedProf, fixture.exam._id);
        expect(archivedResult.canManage).toBe(false);
        expect(archivedResult.errorStatus).toBe(404);
        expect(archivedResult.errorMessage).toBe('Exam not found');
        expect(archivedResult.exam).toBeNull();
        expect(archivedResult.course).toBeNull();

        // HTTP route response with archived course:
        const archivedHttpRes = await callExamGet(fixture.exam._id.toString());
        expect(archivedHttpRes.status).toBe(404);
        const archivedHttpBody = await archivedHttpRes.json();

        // Exactly identical: no information leak about course lifecycle status
        expect(archivedResult).toEqual(activeResult);
        expect(archivedHttpBody).toEqual(activeHttpBody);
    });

    it('fails closed on unlinked batches/pages across all roles and enforces canonical policy without uploader fallback', async () => {
        const fixture = await createFixture();

        // Create an unlinked batch (no exam assigned) and unlinked page (no answerScript)
        const unlinkedBatchId = `unlinked-batch-${Date.now()}`;
        await Batch.create({
            batchId: unlinkedBatchId,
            uploadedBy: fixture.examCreator._id,
            files: [{
                fileId: 'f1',
                fileIndex: 0,
                originalFilename: 'unlinked.pdf',
                fileType: 'pdf',
                mimeType: 'application/pdf',
                size: 1024,
                pageCount: 1,
                storageKey: `batches/${unlinkedBatchId}/unlinked.pdf`
            }],
            totalFiles: 1,
            totalSize: 1024,
            totalPageCount: 1,
            status: BatchStatus.DONE,
            isActive: true
        });

        const unlinkedPage = await IngestionPage.create({
            batchId: unlinkedBatchId,
            job: new mongoose.Types.ObjectId(),
            fileId: 'f1',
            fileIndex: 0,
            storageKey: `batches/${unlinkedBatchId}/page-1.png`,
            thumbnailKey: `batches/${unlinkedBatchId}/thumb-1.jpg`,
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED
            // no answerScript!
        });

        // 1. The professor who uploaded the unlinked batch must FAIL CLOSED with 404 (no uploader fallback)
        mockSessionUser = { id: fixture.examCreator._id.toString(), role: UserRole.PROFESSOR };
        const uploaderImage = await callImage(unlinkedBatchId, unlinkedPage._id.toString());
        expect(uploaderImage.status).toBe(404);
        const uploaderThumb = await callThumbnail(unlinkedBatchId, unlinkedPage._id.toString());
        expect(uploaderThumb.status).toBe(404);

        // 2. Unrelated professor receives 404
        mockSessionUser = { id: fixture.unrelatedProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await callImage(unlinkedBatchId, unlinkedPage._id.toString())).status).toBe(404);
        expect((await callThumbnail(unlinkedBatchId, unlinkedPage._id.toString())).status).toBe(404);

        // 3. TA receives 404
        mockSessionUser = { id: fixture.ta._id.toString(), role: UserRole.TA };
        expect((await callImage(unlinkedBatchId, unlinkedPage._id.toString())).status).toBe(404);
        expect((await callThumbnail(unlinkedBatchId, unlinkedPage._id.toString())).status).toBe(404);

        // 4. Admin receives 404 on unlinked page
        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await callImage(unlinkedBatchId, unlinkedPage._id.toString())).status).toBe(404);
        expect((await callThumbnail(unlinkedBatchId, unlinkedPage._id.toString())).status).toBe(404);

        // 5. Conversely, linked page allows current course professor and admin
        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await callImage(fixture.batch.batchId, fixture.page._id.toString())).status).toBe(200);
        expect((await callThumbnail(fixture.batch.batchId, fixture.page._id.toString())).status).toBe(200);

        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await callImage(fixture.batch.batchId, fixture.page._id.toString())).status).toBe(200);
        expect((await callThumbnail(fixture.batch.batchId, fixture.page._id.toString())).status).toBe(200);
    });
});
