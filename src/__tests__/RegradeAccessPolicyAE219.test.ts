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

    beforeAll(async () => {
        getRequests = (await import('../app/api/professor/regrade-requests/route')).GET;
        assignReviewer = (await import('../app/api/professor/regrade-requests/[id]/assignment/route')).PATCH;
        patchDecision = (await import('../app/api/professor/regrade-requests/[id]/route')).PATCH;
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
});
