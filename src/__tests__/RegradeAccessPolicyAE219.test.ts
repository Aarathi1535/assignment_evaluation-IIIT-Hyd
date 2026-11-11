import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import RegradeRequest, { RegradeDecisionOutcome, RegradeStatus } from '../models/RegradeRequest';
import Rubric from '../models/Rubric';

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
        await RegradeRequest.init();
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
            regrade
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

        // Former creator (no longer course professor) gets 403 on script pages
        mockSessionUser = { id: fixture.examCreator._id.toString(), role: UserRole.PROFESSOR };
        const creatorPagesRes = await callScriptPages(fixture.script._id.toString());
        expect(creatorPagesRes.status).toBe(403);
    });

    it('uniformly denies queue, assignment, decision, and script pages when course is inactive', async () => {
        const fixture = await createFixture();
        await Course.updateOne({ _id: fixture.course._id }, { $set: { isActive: false } });

        // For Course Professor:
        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await callGetQueue(fixture.exam._id.toString())).status).toBe(404);
        expect((await callAssign(fixture.regrade._id.toString(), fixture.ta._id.toString())).status).toBe(404);
        expect((await callDecide(fixture.regrade._id.toString(), { outcome: RegradeDecisionOutcome.REJECTED, reason: 'test' })).status).toBe(404);
        expect((await callScriptPages(fixture.script._id.toString())).status).toBe(403);

        // For Admin:
        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await callGetQueue(fixture.exam._id.toString())).status).toBe(404);
        expect((await callAssign(fixture.regrade._id.toString(), fixture.ta._id.toString())).status).toBe(404);
        expect((await callDecide(fixture.regrade._id.toString(), { outcome: RegradeDecisionOutcome.REJECTED, reason: 'test' })).status).toBe(404);
        expect((await callScriptPages(fixture.script._id.toString())).status).toBe(403);
    });

    it('uniformly denies queue, assignment, decision, and script pages when exam is inactive', async () => {
        const fixture = await createFixture();
        await Exam.updateOne({ _id: fixture.exam._id }, { $set: { isActive: false } });

        // For Course Professor:
        mockSessionUser = { id: fixture.courseProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await callGetQueue(fixture.exam._id.toString())).status).toBe(404);
        expect((await callAssign(fixture.regrade._id.toString(), fixture.ta._id.toString())).status).toBe(404);
        expect((await callDecide(fixture.regrade._id.toString(), { outcome: RegradeDecisionOutcome.REJECTED, reason: 'test' })).status).toBe(404);
        expect((await callScriptPages(fixture.script._id.toString())).status).toBe(403);

        // For Admin:
        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await callGetQueue(fixture.exam._id.toString())).status).toBe(404);
        expect((await callAssign(fixture.regrade._id.toString(), fixture.ta._id.toString())).status).toBe(404);
        expect((await callDecide(fixture.regrade._id.toString(), { outcome: RegradeDecisionOutcome.REJECTED, reason: 'test' })).status).toBe(404);
        expect((await callScriptPages(fixture.script._id.toString())).status).toBe(403);
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
        expect([200, 409]).toContain(profAnalytics.status); // 200 or 409 if no released scores

        const profGraders = await getGraders(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/graders`), makeContext(examIdStr));
        expect([200, 409]).toContain(profGraders.status);

        const profExport = await getExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export?format=csv`), makeContext(examIdStr));
        expect(profExport.status).toBe(200);

        const profLms = await getLmsExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export/lms`), makeContext(examIdStr));
        expect(profLms.status).toBe(200);

        const profLti = await getLtiPassback(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/lti/passback`), makeContext(examIdStr));
        expect(profLti.status).toBe(200);

        const profAudit = await getAuditExport(new NextRequest(`http://localhost:3000/api/audit-logs/export?examId=${examIdStr}`));
        expect(profAudit.status).toBe(200);

        // Former creator (no longer course professor) is denied:
        mockSessionUser = { id: fixture.examCreator._id.toString(), role: UserRole.PROFESSOR };
        expect([403, 404]).toContain((await getAnalytics(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}`), makeContext(examIdStr))).status);
        expect([403, 404]).toContain((await getExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export?format=csv`), makeContext(examIdStr))).status);
        expect([403, 404]).toContain((await getLmsExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export/lms`), makeContext(examIdStr))).status);
        expect([403, 404]).toContain((await getLtiPassback(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/lti/passback`), makeContext(examIdStr))).status);
        expect([403, 404]).toContain((await getAuditExport(new NextRequest(`http://localhost:3000/api/audit-logs/export?examId=${examIdStr}`))).status);

        // Admin is allowed:
        mockSessionUser = { id: fixture.admin._id.toString(), role: UserRole.ADMIN };
        expect((await getExport(new NextRequest(`http://localhost:3000/api/analytics/exams/${examIdStr}/export?format=csv`), makeContext(examIdStr))).status).toBe(200);
        expect((await getAuditExport(new NextRequest(`http://localhost:3000/api/audit-logs/export?examId=${examIdStr}`))).status).toBe(200);
    });

    it('uniformly returns 404 for analytics, export, LMS, LTI, and audit routes when course or exam is inactive', async () => {
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
});
