import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import AuditLog from '../models/AuditLog';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import RegradeRequest, { RegradeStatus } from '../models/RegradeRequest';

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

describe('AE-205 regrade reviewer assignment', () => {
    let assignReviewer: typeof import('../app/api/professor/regrade-requests/[id]/assignment/route').PATCH;
    let getRequests: typeof import('../app/api/professor/regrade-requests/route').GET;
    let getPages: typeof import('../app/api/scripts/[id]/pages/route').GET;

    beforeAll(async () => {
        assignReviewer = (await import('../app/api/professor/regrade-requests/[id]/assignment/route')).PATCH;
        getRequests = (await import('../app/api/professor/regrade-requests/route')).GET;
        getPages = (await import('../app/api/scripts/[id]/pages/route')).GET;
        await RegradeRequest.init();
    });

    afterEach(() => {
        mockSessionUser = null;
    });

    async function createFixture() {
        const suffix = `${Date.now()}-${Math.random()}`;
        const professor = await User.create({
            name: 'Professor Owner',
            email: `owner-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        const ta = await User.create({
            name: 'Assigned TA',
            email: `ta-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });
        const otherTa = await User.create({
            name: 'Unassigned TA',
            email: `other-ta-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });
        const student = await User.create({
            name: 'Student Example',
            email: `student-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true
        });
        const course = await Course.create({
            courseCode: `CS-${suffix}`,
            courseName: 'Algorithms',
            academicYear: '2026',
            semester: 1,
            professor: professor._id,
            enrolledStudents: [student._id],
            teachingAssistants: [ta._id],
            isActive: true
        });
        const exam = await Exam.create({
            title: 'Midterm',
            course: course._id,
            createdBy: professor._id,
            examDate: new Date(),
            totalMarks: 10,
            numberOfQuestions: 1,
            status: ExamStatus.PUBLISHED,
            isActive: true
        });
        const script = await AnswerScript.create({
            exam: exam._id,
            student: student._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });
        const regrade = await RegradeRequest.create({
            exam: exam._id,
            answerScript: script._id,
            questionNumber: 1,
            student: student._id,
            reason: 'Please review the question score.',
            status: RegradeStatus.OPEN
        });
        return { professor, ta, otherTa, student, script, regrade };
    }

    function assign(id: string, reviewerId: string) {
        return assignReviewer(
            new NextRequest(`http://localhost:3000/api/professor/regrade-requests/${id}/assignment`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ reviewerId })
            }),
            { params: Promise.resolve({ id }) }
        );
    }

    it('assigns only an eligible course TA and records assignment history and audit event', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };

        const response = await assign(fixture.regrade._id.toString(), fixture.ta._id.toString());
        const payload = await response.json();
        const saved = await RegradeRequest.findById(fixture.regrade._id);
        const audit = await AuditLog.findOne({
            entityId: fixture.regrade._id,
            action: 'REGRADE_REVIEWER_ASSIGNED'
        });

        expect(response.status).toBe(200);
        expect(payload.data.assignedTo).toMatchObject({
            id: fixture.ta._id.toString(),
            name: fixture.ta.name
        });
        expect(saved?.assignedTo?.toString()).toBe(fixture.ta._id.toString());
        expect(saved?.assignmentHistory).toHaveLength(1);
        expect(audit?.details).toMatchObject({
            previousAssignee: null,
            assignedTo: fixture.ta._id.toString()
        });
    });

    it('rejects reviewers outside the course and leaves the request unassigned', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };

        const response = await assign(fixture.regrade._id.toString(), fixture.otherTa._id.toString());
        const saved = await RegradeRequest.findById(fixture.regrade._id);

        expect(response.status).toBe(400);
        expect(saved?.assignedTo).toBeNull();
        expect(saved?.assignmentHistory).toHaveLength(0);
    });

    it('limits the reviewer queue and answer pages to the assigned TA', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        const assignment = await assign(fixture.regrade._id.toString(), fixture.ta._id.toString());
        expect(assignment.status).toBe(200);

        mockSessionUser = { id: fixture.ta._id.toString(), role: UserRole.TA };
        const queue = await getRequests(new NextRequest('http://localhost:3000/api/professor/regrade-requests'));
        const queuePayload = await queue.json();
        const pages = await getPages(
            new NextRequest(`http://localhost:3000/api/scripts/${fixture.script._id}/pages`),
            { params: Promise.resolve({ id: fixture.script._id.toString() }) }
        );

        expect(queue.status).toBe(200);
        expect(queuePayload.data.requests).toHaveLength(1);
        expect(queuePayload.data.requests[0].id).toBe(fixture.regrade._id.toString());
        expect(pages.status).toBe(200);
        expect((await pages.json()).data).toEqual([]);

        mockSessionUser = { id: fixture.otherTa._id.toString(), role: UserRole.TA };
        const unassignedQueue = await getRequests(new NextRequest('http://localhost:3000/api/professor/regrade-requests'));
        const deniedPages = await getPages(
            new NextRequest(`http://localhost:3000/api/scripts/${fixture.script._id}/pages`),
            { params: Promise.resolve({ id: fixture.script._id.toString() }) }
        );

        expect(unassignedQueue.status).toBe(200);
        expect((await unassignedQueue.json()).data.requests).toHaveLength(0);
        expect(deniedPages.status).toBe(403);
    });
});
