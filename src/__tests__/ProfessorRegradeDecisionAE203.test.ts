import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog';
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

describe('AE-203 regrade decisions', () => {
    let patchDecision: typeof import('../app/api/professor/regrade-requests/[id]/route').PATCH;

    beforeAll(async () => {
        patchDecision = (await import('../app/api/professor/regrade-requests/[id]/route')).PATCH;
        await RegradeRequest.init();
    });

    afterEach(() => {
        mockSessionUser = null;
    });

    async function createFixture() {
        const suffix = `${Date.now()}-${Math.random()}`;
        const professor = await User.create({
            name: 'Professor Reviewer',
            email: `reviewer-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        const otherProfessor = await User.create({
            name: 'Professor Other',
            email: `other-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.PROFESSOR,
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
            teachingAssistants: [],
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
        const rubric = await Rubric.create({
            exam: exam._id,
            createdBy: professor._id,
            scoreStep: 0.5,
            questions: [{
                questionNumber: 1,
                maxMarks: 10,
                criteria: [{ criterionName: 'Accuracy', points: 10 }]
            }],
            isActive: true
        });
        await Exam.updateOne({ _id: exam._id }, { rubric: rubric._id });
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
            gradedBy: professor._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Accuracy', score: 7 }],
            totalScore: 7,
            isFinal: true
        });
        const regrade = await RegradeRequest.create({
            exam: exam._id,
            answerScript: script._id,
            questionNumber: 1,
            student: student._id,
            reason: 'The rubric criteria were not applied to my answer.',
            status: RegradeStatus.OPEN
        });
        return { professor, otherProfessor, student, regrade };
    }

    async function decide(id: string, body: unknown) {
        return patchDecision(
            new NextRequest(`http://localhost:3000/api/professor/regrade-requests/${id}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body)
            }),
            { params: Promise.resolve({ id }) }
        );
    }

    it('records an approved adjusted score, reviewer, reason, and audit event', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };

        const response = await decide(fixture.regrade._id.toString(), {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'The rubric was misapplied.',
            revisedScore: 8.5
        });
        const body = await response.json();
        const saved = await RegradeRequest.findById(fixture.regrade._id);
        const audit = await AuditLog.findOne({ entityId: fixture.regrade._id, action: 'REGRADE_DECIDED' });

        expect(response.status).toBe(200);
        expect(body.data.status).toBe(RegradeStatus.RESOLVED);
        expect(saved?.isOpen).toBe(false);
        expect(saved?.decision).toMatchObject({
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'The rubric was misapplied.',
            reviewer: new mongoose.Types.ObjectId(fixture.professor._id),
            originalScore: 7,
            revisedScore: 8.5
        });
        expect(audit?.details).toMatchObject({
            outcome: RegradeDecisionOutcome.APPROVED,
            originalScore: 7,
            revisedScore: 8.5
        });
    });

    it('rejects invalid scores, missing reasons, and score increments outside the rubric step', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        const id = fixture.regrade._id.toString();

        expect((await decide(id, { outcome: 'APPROVED', reason: '   ', revisedScore: 8 })).status).toBe(400);
        expect((await decide(id, { outcome: 'APPROVED', reason: 'Too many marks', revisedScore: 10.5 })).status).toBe(400);
        expect((await decide(id, { outcome: 'APPROVED', reason: 'Not a valid step', revisedScore: 8.3 })).status).toBe(400);
        expect((await decide(id, { outcome: 'REJECTED', reason: 'Rejected', revisedScore: 8 })).status).toBe(400);
        expect(await AuditLog.countDocuments({ action: 'REGRADE_DECIDED' })).toBe(0);
    });

    it('hides another professor’s request and rejects duplicate decisions', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.otherProfessor._id.toString(), role: UserRole.PROFESSOR };
        const denied = await decide(fixture.regrade._id.toString(), {
            outcome: 'REJECTED',
            reason: 'No change is warranted.'
        });
        expect(denied.status).toBe(404);

        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        const body = { outcome: 'REJECTED', reason: 'No change is warranted.' };
        expect((await decide(fixture.regrade._id.toString(), body)).status).toBe(200);
        expect((await decide(fixture.regrade._id.toString(), body)).status).toBe(409);
        expect(await AuditLog.countDocuments({ action: 'REGRADE_DECIDED' })).toBe(1);
    });
});
