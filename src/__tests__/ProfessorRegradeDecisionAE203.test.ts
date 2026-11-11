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
import Notification, { NotificationType } from '../models/Notification';
import NotificationService from '../services/NotificationService';

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
        return { professor, otherProfessor, student, course, exam, script, rubric, regrade };
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
        const savedGrade = await Grade.findOne({
            answerScript: fixture.regrade.answerScript,
            question: 1
        });
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
        expect(savedGrade?.totalScore).toBe(8.5);
        expect(savedGrade?.marksAwarded.map(mark => ({
            criterionName: mark.criterionName,
            score: mark.score
        }))).toEqual([{ criterionName: 'Accuracy', score: 8.5 }]);
        expect(await Notification.countDocuments({
            recipient: fixture.student._id,
            type: NotificationType.REGRADE
        })).toBe(1);
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

    it('does not undo a successful grade decision when student notification delivery fails', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        vi.spyOn(NotificationService, 'createNotifications').mockRejectedValueOnce(new Error('notification unavailable'));

        const response = await decide(fixture.regrade._id.toString(), {
            outcome: 'APPROVED',
            reason: 'The rubric was misapplied.',
            revisedScore: 8
        });
        const body = await response.json();
        const grade = await Grade.findOne({ answerScript: fixture.regrade.answerScript, question: 1 });

        expect(response.status).toBe(200);
        expect(body.data.notificationDelivery).toBe('FAILED');
        expect(grade?.totalScore).toBe(8);
        expect(await RegradeRequest.findById(fixture.regrade._id).then(saved => saved?.status)).toBe(RegradeStatus.RESOLVED);
    });

    it('allows an assigned TA who is not the original grader to decide', async () => {
        const fixture = await createFixture();
        const ta = await User.create({
            name: 'Assigned TA Reviewer',
            email: `assigned-ta-${Date.now()}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });
        await Course.updateOne({ _id: fixture.course._id }, { $push: { teachingAssistants: ta._id } });
        await RegradeRequest.updateOne({ _id: fixture.regrade._id }, { $set: { assignedTo: ta._id } });

        mockSessionUser = { id: ta._id.toString(), role: UserRole.TA };
        const response = await decide(fixture.regrade._id.toString(), {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'TA approved after verification.',
            revisedScore: 9
        });
        expect(response.status).toBe(200);

        const updated = await RegradeRequest.findById(fixture.regrade._id);
        expect(updated?.status).toBe(RegradeStatus.RESOLVED);
        expect(updated?.decision?.reviewer.toString()).toBe(ta._id.toString());
        expect(updated?.decision?.revisedScore).toBe(9);

        const grade = await Grade.findOne({ answerScript: fixture.regrade.answerScript, question: 1 });
        expect(grade?.totalScore).toBe(9);
    });

    it('returns 404 when an unassigned TA attempts to decide', async () => {
        const fixture = await createFixture();
        const unassignedTa = await User.create({
            name: 'Unassigned TA',
            email: `unassigned-ta-${Date.now()}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });
        await Course.updateOne({ _id: fixture.course._id }, { $push: { teachingAssistants: unassignedTa._id } });

        mockSessionUser = { id: unassignedTa._id.toString(), role: UserRole.TA };
        const response = await decide(fixture.regrade._id.toString(), {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'Attempted review without assignment.',
            revisedScore: 8
        });
        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.message).toContain('Regrade request not found');
    });

    it('rejects a student calling PATCH on decision with 403 Forbidden', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.student._id.toString(), role: UserRole.STUDENT };

        const response = await decide(fixture.regrade._id.toString(), {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'Student trying to decide own regrade.',
            revisedScore: 10
        });
        expect(response.status).toBe(403);
    });

    it('handles two decisions racing concurrently: exactly one succeeds and one gets 409', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };

        const body1 = {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'Decision 1.',
            revisedScore: 8
        };
        const body2 = {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'Decision 2.',
            revisedScore: 9
        };

        const [res1, res2] = await Promise.all([
            decide(fixture.regrade._id.toString(), body1),
            decide(fixture.regrade._id.toString(), body2)
        ]);

        const statuses = [res1.status, res2.status].sort();
        expect(statuses).toEqual([200, 409]);

        // Exactly one audit log row
        const auditCount = await AuditLog.countDocuments({
            entityId: fixture.regrade._id,
            action: 'REGRADE_DECIDED'
        });
        expect(auditCount).toBe(1);
    });

    it('supports resolving regrade requests on whole-script grades', async () => {
        const fixture = await createFixture();
        // Replace question-wise grade with whole-script grade (question: null)
        await Grade.deleteMany({ answerScript: fixture.script._id });
        await Grade.create({
            answerScript: fixture.script._id,
            rubric: fixture.rubric._id,
            gradedBy: fixture.professor._id,
            marksAwarded: [{ criterionName: 'Accuracy', score: 6 }],
            totalScore: 6,
            isFinal: true
        });

        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        const response = await decide(fixture.regrade._id.toString(), {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'Whole script score adjustment.',
            revisedScore: 8.5
        });
        expect(response.status).toBe(200);

        const updatedGrade = await Grade.findOne({ answerScript: fixture.script._id });
        expect(updatedGrade?.totalScore).toBe(8.5);
    });

    it('blocks a TA who originally graded the question from deciding the regrade', async () => {
        const fixture = await createFixture();
        const graderTa = await User.create({
            name: 'Grader TA',
            email: `grader-ta-${Date.now()}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });
        await Course.updateOne({ _id: fixture.course._id }, { $push: { teachingAssistants: graderTa._id } });

        // Update grade to show graderTa graded it
        await Grade.updateOne(
            { answerScript: fixture.script._id, question: 1 },
            { $set: { gradedBy: graderTa._id } }
        );
        await RegradeRequest.updateOne(
            { _id: fixture.regrade._id },
            { $set: { assignedTo: graderTa._id } }
        );

        mockSessionUser = { id: graderTa._id.toString(), role: UserRole.TA };
        const response = await decide(fixture.regrade._id.toString(), {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'Attempting to self-review my own grading.',
            revisedScore: 8
        });
        expect(response.status).toBe(403);
        const body = await response.json();
        expect(body.message).toContain('Reviewers cannot decide regrade requests for questions they graded');
    });

    it('allows the course professor to decide even if they originally graded the question, noting it in audit log', async () => {
        const fixture = await createFixture();
        // Professor originally graded it (fixture default)
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        const response = await decide(fixture.regrade._id.toString(), {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'Professor self-review.',
            revisedScore: 8.5
        });
        expect(response.status).toBe(200);

        const audit = await AuditLog.findOne({
            entityId: fixture.regrade._id,
            action: 'REGRADE_DECIDED'
        });
        expect(audit?.details).toMatchObject({
            note: 'Original grader is exam professor; self-review permitted for course owner'
        });
    });

    it('returns 404 when a TA who was removed from the course attempts to decide', async () => {
        const fixture = await createFixture();
        const removedTa = await User.create({
            name: 'Removed TA',
            email: `removed-ta-${Date.now()}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });
        // Not added to course teachingAssistants (or removed)
        await RegradeRequest.updateOne(
            { _id: fixture.regrade._id },
            { $set: { assignedTo: removedTa._id } }
        );

        mockSessionUser = { id: removedTa._id.toString(), role: UserRole.TA };
        const response = await decide(fixture.regrade._id.toString(), {
            outcome: RegradeDecisionOutcome.APPROVED,
            reason: 'Attempt by removed TA.',
            revisedScore: 8
        });
        expect(response.status).toBe(404);
    });
});
