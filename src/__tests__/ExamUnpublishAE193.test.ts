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
    let publishPOST: typeof import('../app/api/exams/[id]/publish/route').POST;
    let studentResultsGET: typeof import('../app/api/student/results/route').GET;
    let studentScriptDetailGET: typeof import('../app/api/student/results/[scriptId]/route').GET;

    let professor!: IUser;
    let otherProfessor!: IUser;
    let ta!: IUser;
    let student!: IUser;
    let exam!: IExam;
    let script!: IAnswerScript;
    let grade!: IGrade;

    beforeAll(async () => {
        unpublishPOST = (await import('../app/api/exams/[id]/unpublish/route')).POST;
        publishPOST = (await import('../app/api/exams/[id]/publish/route')).POST;
        studentResultsGET = (await import('../app/api/student/results/route')).GET;
        studentScriptDetailGET = (await import('../app/api/student/results/[scriptId]/route')).GET;
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

    it('removes student result and script access through real API routes after unpublishing', async () => {
        await createPublishedExam();

        // 1. Before unpublish, student route returns results
        mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };
        const resListBefore = await studentResultsGET();
        expect(resListBefore.status).toBe(200);
        const bodyListBefore = await resListBefore.json();
        expect(bodyListBefore.success).toBe(true);
        expect(bodyListBefore.data.length).toBeGreaterThan(0);

        const reqDetailBefore = new NextRequest(`http://localhost:3000/api/student/results/${script._id}`);
        const resDetailBefore = await studentScriptDetailGET(reqDetailBefore, { params: Promise.resolve({ scriptId: script._id.toString() }) });
        expect(resDetailBefore.status).toBe(200);

        // 2. Professor unpublishes
        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };
        const unpublishRes = await callUnpublish();
        expect(unpublishRes.status).toBe(200);

        // 3. After unpublish, student routes return empty list and 404 for script detail
        mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };
        const resListAfter = await studentResultsGET();
        expect(resListAfter.status).toBe(200);
        const bodyListAfter = await resListAfter.json();
        expect(bodyListAfter.success).toBe(true);
        expect(bodyListAfter.data).toHaveLength(0);

        const reqDetailAfter = new NextRequest(`http://localhost:3000/api/student/results/${script._id}`);
        const resDetailAfter = await studentScriptDetailGET(reqDetailAfter, { params: Promise.resolve({ scriptId: script._id.toString() }) });
        expect(resDetailAfter.status).toBe(404);
    });

    it('is idempotent and writes only one unpublish audit record on duplicate requests', async () => {
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

    it('rejects unpublish on non-PUBLISHED exams (e.g. DRAFT) with 409 Conflict', async () => {
        await createPublishedExam();
        exam.status = ExamStatus.DRAFT;
        await exam.save();

        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };
        const res = await callUnpublish();
        expect(res.status).toBe(409);
        const body = await res.json();
        expect(body.message).toContain("Only exams in 'PUBLISHED' status can be unpublished");
    });

    it('clears unpublishedBy and unpublishedAt when exam is republished', async () => {
        await createPublishedExam();
        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };

        // Unpublish
        const unpublishRes = await callUnpublish();
        expect(unpublishRes.status).toBe(200);
        let currentExam = await Exam.findById(exam._id);
        expect(currentExam?.status).toBe(ExamStatus.REVIEW_PENDING);
        expect(currentExam?.unpublishedBy).toBeDefined();
        expect(currentExam?.unpublishedAt).toBeDefined();

        // Republish via route
        const republishReq = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST'
        });
        const republishRes = await publishPOST(republishReq, { params: Promise.resolve({ id: exam._id.toString() }) });
        expect(republishRes.status).toBe(200);

        currentExam = await Exam.findById(exam._id);
        expect(currentExam?.status).toBe(ExamStatus.PUBLISHED);
        expect(currentExam?.unpublishedBy).toBeNull();
        expect(currentExam?.unpublishedAt).toBeNull();
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
