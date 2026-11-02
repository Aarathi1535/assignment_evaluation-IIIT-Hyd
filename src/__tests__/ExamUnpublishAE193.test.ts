import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Allocation, { AllocationStatus } from '../models/Allocation';
import AuditLog from '../models/AuditLog';
import AnswerScript, { IAnswerScript, IdentificationStatus } from '../models/AnswerScript';
import Course from '../models/Course';
import Exam, { ExamStatus, IExam } from '../models/Exam';
import Grade, { IGrade } from '../models/Grade';
import Rubric from '../models/Rubric';
import User, { IUser, UserRole } from '../models/User';
import StudentResultService from '../services/StudentResultService';

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

describe('AE-193: Professor unpublish and audit trail', () => {
    let unpublishPOST: typeof import('../app/api/exams/[id]/unpublish/route').POST;
    let professor!: IUser;
    let otherProfessor!: IUser;
    let ta!: IUser;
    let student!: IUser;
    let exam!: IExam;
    let script!: IAnswerScript;
    let grade!: IGrade;

    beforeAll(async () => {
        unpublishPOST = (await import('../app/api/exams/[id]/unpublish/route')).POST;
    });

    beforeEach(() => {
        process.env.STUDENT_RESULTS_ENABLED = 'true';
    });

    afterEach(() => {
        mockSessionUser = null;
    });

    async function createPublishedExam() {
        professor = await User.create({
            name: 'Professor Turing',
            email: 'turing@example.edu',
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        otherProfessor = await User.create({
            name: 'Professor Lovelace',
            email: 'lovelace@example.edu',
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        ta = await User.create({
            name: 'TA Hopper',
            email: 'hopper@example.edu',
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });
        student = await User.create({
            name: 'Student Ada',
            email: 'ada@example.edu',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true
        });

        const course = await Course.create({
            courseCode: 'CS193',
            courseName: 'Algorithms',
            semester: 1,
            academicYear: '2026',
            professor: professor._id,
            teachingAssistants: [ta._id],
            enrolledStudents: [student._id],
            isActive: true
        });
        exam = await Exam.create({
            title: 'AE-193 Exam',
            course: course._id,
            createdBy: professor._id,
            examDate: new Date('2026-10-15'),
            totalMarks: 20,
            numberOfQuestions: 1,
            status: ExamStatus.PUBLISHED,
            publishedBy: professor._id,
            publishedAt: new Date('2026-10-20T10:00:00Z'),
            isActive: true
        });
        const rubric = await Rubric.create({
            exam: exam._id,
            createdBy: professor._id,
            scoreStep: 0.5,
            questions: [{
                questionNumber: 1,
                maxMarks: 20,
                criteria: [{ criterionName: 'Correctness', points: 20 }]
            }],
            isActive: true
        });
        script = await AnswerScript.create({
            exam: exam._id,
            student: student._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            hasIdentificationConflict: false,
            needsManualId: false,
            isActive: true
        });
        await Allocation.create({
            exam: exam._id,
            ta: ta._id,
            answerScript: script._id,
            allocatedBy: professor._id,
            status: AllocationStatus.COMPLETED
        });
        grade = await Grade.create({
            answerScript: script._id,
            gradedBy: ta._id,
            rubric: rubric._id,
            question: undefined,
            totalScore: 18,
            isFinal: true,
            marksAwarded: [{ criterionName: 'Correctness', score: 18 }],
            feedback: 'Clear solution'
        });
    }

    async function callUnpublish(examId = exam._id.toString()) {
        const request = new NextRequest(`http://localhost:3000/api/exams/${examId}/unpublish`, {
            method: 'POST'
        });
        return unpublishPOST(request, { params: Promise.resolve({ id: examId }) });
    }

    it('unpublishes results, records actor/time, preserves evaluation data, and audits the action', async () => {
        await createPublishedExam();
        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };

        const response = await callUnpublish();
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.status).toBe(ExamStatus.REVIEW_PENDING);

        const savedExam = await Exam.findById(exam._id);
        expect(savedExam?.unpublishedBy?.toString()).toBe(professor._id.toString());
        expect(savedExam?.unpublishedAt).toBeInstanceOf(Date);
        expect(savedExam?.publishedBy?.toString()).toBe(professor._id.toString());
        expect(savedExam?.publishedAt?.toISOString()).toBe('2026-10-20T10:00:00.000Z');

        const savedGrade = await Grade.findById(grade._id);
        expect(savedGrade?.totalScore).toBe(18);
        expect(savedGrade?.feedback).toBe('Clear solution');
        expect(savedGrade?.marksAwarded.map(({ criterionName, score }) => ({ criterionName, score })))
            .toEqual([{ criterionName: 'Correctness', score: 18 }]);
        expect(await AnswerScript.findById(script._id)).not.toBeNull();

        const audit = await AuditLog.findOne({ action: 'EXAM_UNPUBLISHED', entityId: exam._id });
        expect(audit?.user.toString()).toBe(professor._id.toString());
        expect(audit?.outcome).toBe('SUCCESS');
        expect(audit?.details).toMatchObject({
            unpublishedBy: professor._id,
            unpublishedAt: savedExam?.unpublishedAt
        });
    });

    it('removes student result and script access after unpublishing', async () => {
        await createPublishedExam();
        expect(await StudentResultService.getStudentResults(student._id.toString(), UserRole.STUDENT))
            .toHaveLength(1);
        await StudentResultService.verifyStudentScriptAccess(
            script._id.toString(),
            student._id.toString(),
            UserRole.STUDENT
        );

        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };
        expect((await callUnpublish()).status).toBe(200);

        expect(await StudentResultService.getStudentResults(student._id.toString(), UserRole.STUDENT))
            .toHaveLength(0);
        await expect(StudentResultService.verifyStudentScriptAccess(
            script._id.toString(),
            student._id.toString(),
            UserRole.STUDENT
        )).rejects.toMatchObject({ statusCode: 404 });
    });

    it('is idempotent and writes only one unpublish audit record', async () => {
        await createPublishedExam();
        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };

        expect((await callUnpublish()).status).toBe(200);
        const firstTimestamp = (await Exam.findById(exam._id))?.unpublishedAt;
        expect((await callUnpublish()).status).toBe(200);

        const savedExam = await Exam.findById(exam._id);
        expect(savedExam?.unpublishedAt?.getTime()).toBe(firstTimestamp?.getTime());
        expect(await AuditLog.countDocuments({ action: 'EXAM_UNPUBLISHED', entityId: exam._id }))
            .toBe(1);
    });

    it('rejects unauthorized users and professors without exam access', async () => {
        await createPublishedExam();

        mockSessionUser = { id: ta._id.toString(), role: UserRole.TA };
        expect((await callUnpublish()).status).toBe(403);

        mockSessionUser = { id: otherProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await callUnpublish()).status).toBe(404);
        expect((await Exam.findById(exam._id))?.status).toBe(ExamStatus.PUBLISHED);
        expect(await AuditLog.countDocuments({ action: 'EXAM_UNPUBLISHED', entityId: exam._id }))
            .toBe(0);
    });

    it('rejects malformed exam IDs', async () => {
        mockSessionUser = {
            id: '507f1f77bcf86cd799439011',
            role: UserRole.PROFESSOR
        };
        expect((await callUnpublish('invalid-id')).status).toBe(400);
    });
});
