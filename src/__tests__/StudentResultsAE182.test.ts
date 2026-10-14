/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Rubric from '../models/Rubric';
import { NextRequest } from 'next/server';

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

describe('AE-182: Student My Exams List + Auth Scope', () => {
    let resultsGET: any;
    let examsGET: any;
    let examDetailGET: any;

    let studentA: any;
    let studentB: any;
    let prof: any;
    let ta: any;
    let course: any;
    let rubric: any;
    let publishedExam: any;
    let draftExam: any;

    beforeAll(async () => {
        resultsGET = (await import('../app/api/student/results/route')).GET;
        examsGET = (await import('../app/api/exams/route')).GET;
        examDetailGET = (await import('../app/api/exams/[id]/route')).GET;
    });

    beforeEach(async () => {
        process.env.STUDENT_RESULTS_ENABLED = 'true';

        // Seed users
        studentA = await User.create({
            name: 'Student Alice',
            email: 'alice@iiit.ac.in',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        studentB = await User.create({
            name: 'Student Bob',
            email: 'bob@iiit.ac.in',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        prof = await User.create({
            name: 'Professor Snape',
            email: 'snape@iiit.ac.in',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        ta = await User.create({
            name: 'TA Draco',
            email: 'draco@iiit.ac.in',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        course = await Course.create({
            courseCode: 'CS301',
            courseName: 'Algorithms',
            academicYear: '2026-2027',
            semester: 1,
            professor: prof._id,
            enrolledStudents: [studentA._id, studentB._id],
            teachingAssistants: [ta._id],
            isActive: true
        });

        publishedExam = await Exam.create({
            title: 'Midterm Algorithms',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-10-20'),
            totalMarks: 100,
            numberOfQuestions: 5,
            status: ExamStatus.PUBLISHED,
            isActive: true,
            enrolledStudents: [studentA._id, studentB._id],
            omrTemplate: { pageIndex: 0, columns: [] },
            approvedBy: prof._id,
            approvedAt: new Date(),
            assemblySeal: 'seal-hash-12345',
            assemblySealKeyId: 'key-v1',
            assemblySealAt: new Date(),
            assemblySealBy: prof._id
        });

        rubric = await Rubric.create({
            exam: publishedExam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 100,
                    criteria: [{ criterionName: 'Correctness', points: 100 }]
                }
            ],
            isActive: true
        });

        await Exam.findByIdAndUpdate(publishedExam._id, { rubric: rubric._id });

        draftExam = await Exam.create({
            title: 'Unpublished Final Algorithms',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-12-15'),
            totalMarks: 100,
            numberOfQuestions: 10,
            status: ExamStatus.DRAFT,
            isActive: true,
            enrolledStudents: [studentA._id]
        });

        // Set default authenticated session to studentA
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            name: studentA.name,
            role: UserRole.STUDENT
        };
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    // 1. A student's own released result is listed with its total
    it("1. lists a student's own released result with its total marks", async () => {
        const scriptA = await AnswerScript.create({
            exam: publishedExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubric._id,
            gradedBy: ta._id,
            marksAwarded: [{ criterionName: 'Correctness', score: 88.5 }],
            totalScore: 88.5,
            isFinal: true
        });

        await Allocation.create({
            exam: publishedExam._id,
            ta: ta._id,
            answerScript: scriptA._id,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED
        });

        const res = await resultsGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(Array.isArray(body.data)).toBe(true);

        const record = body.data.find((r: any) => r.examId === publishedExam._id.toString());
        expect(record).toBeDefined();
        expect(record.status).toBe('RELEASED');
        expect(record.examTitle).toBe('Midterm Algorithms');
        expect(record.courseCode).toBe('CS301');
        expect(record.total).toBe(88.5);
        expect(record.maxMarks).toBe(100);
        expect(record.scriptId).toBe(scriptA._id.toString());
    });

    // 2. Another student's script is never returned
    it("2. never returns another student's script or score", async () => {
        // Script and grade belong strictly to studentB
        const scriptB = await AnswerScript.create({
            exam: publishedExam._id,
            student: studentB._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        await Grade.create({
            answerScript: scriptB._id,
            rubric: rubric._id,
            gradedBy: ta._id,
            marksAwarded: [{ criterionName: 'Correctness', score: 95 }],
            totalScore: 95,
            isFinal: true
        });

        await Allocation.create({
            exam: publishedExam._id,
            ta: ta._id,
            answerScript: scriptB._id,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED
        });

        // Student A makes the request
        const res = await resultsGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        const record = body.data.find((r: any) => r.examId === publishedExam._id.toString());

        expect(record).toBeDefined();
        expect(record.status).toBe('NOT_AVAILABLE');
        expect(record.total).toBeUndefined();
        expect(record.scriptId).toBeUndefined();
        expect(record.maxMarks).toBeUndefined();
    });

    // 3. An unpublished exam is not exposed
    it('3. does not expose unpublished exams in the results list', async () => {
        // Create an answer script and final grade for draftExam
        const draftScript = await AnswerScript.create({
            exam: draftExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        await Grade.create({
            answerScript: draftScript._id,
            rubric: rubric._id,
            gradedBy: ta._id,
            marksAwarded: [{ criterionName: 'Correctness', score: 90 }],
            totalScore: 90,
            isFinal: true
        });

        const res = await resultsGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        const draftRecord = body.data.find((r: any) => r.examId === draftExam._id.toString());
        expect(draftRecord).toBeUndefined();
    });

    // 4. Unidentified, conflicted, or manually flagged scripts are not released
    it('4. marks results as NOT_AVAILABLE when script is unidentified, conflicted, or needs manual ID', async () => {
        // Case A: UNIDENTIFIED
        const scriptUnidentified = await AnswerScript.create({
            exam: publishedExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.UNIDENTIFIED,
            isActive: true
        });

        await Grade.create({
            answerScript: scriptUnidentified._id,
            rubric: rubric._id,
            gradedBy: ta._id,
            marksAwarded: [{ criterionName: 'Correctness', score: 70 }],
            totalScore: 70,
            isFinal: true
        });

        let res = await resultsGET();
        let body = await res.json();
        let record = body.data.find((r: any) => r.examId === publishedExam._id.toString());
        expect(record.status).toBe('NOT_AVAILABLE');
        expect(record.total).toBeUndefined();

        // Case B: hasIdentificationConflict
        await AnswerScript.findByIdAndUpdate(scriptUnidentified._id, {
            identificationStatus: IdentificationStatus.IDENTIFIED,
            hasIdentificationConflict: true
        });

        res = await resultsGET();
        body = await res.json();
        record = body.data.find((r: any) => r.examId === publishedExam._id.toString());
        expect(record.status).toBe('NOT_AVAILABLE');
        expect(record.total).toBeUndefined();

        // Case C: needsManualId
        await AnswerScript.findByIdAndUpdate(scriptUnidentified._id, {
            hasIdentificationConflict: false,
            needsManualId: true
        });

        res = await resultsGET();
        body = await res.json();
        record = body.data.find((r: any) => r.examId === publishedExam._id.toString());
        expect(record.status).toBe('NOT_AVAILABLE');
        expect(record.total).toBeUndefined();
    });

    // 5. A grade with isFinal: false makes the result unavailable and exposes no total
    it('5. does not release result or expose total if any grade has isFinal: false', async () => {
        const scriptA = await AnswerScript.create({
            exam: publishedExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubric._id,
            gradedBy: ta._id,
            marksAwarded: [{ criterionName: 'Correctness', score: 85 }],
            totalScore: 85,
            isFinal: false // Draft / in-progress grade
        });

        const res = await resultsGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        const record = body.data.find((r: any) => r.examId === publishedExam._id.toString());

        expect(record.status).toBe('NOT_AVAILABLE');
        expect(record.total).toBeUndefined();
        expect(record.scriptId).toBeUndefined();
        expect(record.maxMarks).toBeUndefined();
    });

    // 6. The feature flag being off prevents access
    it('6. returns 404 when STUDENT_RESULTS_ENABLED feature flag is off', async () => {
        process.env.STUDENT_RESULTS_ENABLED = 'false';

        const res = await resultsGET();
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toBe('Not found');
    });

    // 7. Unauthenticated, TA, PROFESSOR, and deactivated-student requests receive 401/403
    it('7. enforces role and active-account security guards (401/403)', async () => {
        // Unauthenticated
        mockSessionUser = null;
        let res = await resultsGET();
        expect(res.status).toBe(401);

        // TA role
        mockSessionUser = {
            id: ta._id.toString(),
            email: ta.email,
            name: ta.name,
            role: UserRole.TA
        };
        res = await resultsGET();
        expect(res.status).toBe(403);

        // PROFESSOR role
        mockSessionUser = {
            id: prof._id.toString(),
            email: prof.email,
            name: prof.name,
            role: UserRole.PROFESSOR
        };
        res = await resultsGET();
        expect(res.status).toBe(403);

        // Deactivated student
        await User.findByIdAndUpdate(studentA._id, { isActive: false });
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            name: studentA.name,
            role: UserRole.STUDENT
        };
        res = await resultsGET();
        expect(res.status).toBe(403);

        // Restoring student status: DB role changed to TA while session still claims STUDENT
        await User.findByIdAndUpdate(studentA._id, { isActive: true, role: UserRole.TA });
        res = await resultsGET();
        expect(res.status).toBe(403);
    });

    // 8. Serialized responses contain none of: gradedBy, annotatedBy, enrolledStudents, qrStudentId, omrStudentId, storageKey, or isFinal
    it('8. strictly prevents data exposure: excludes internal and grading metadata', async () => {
        const scriptA = await AnswerScript.create({
            exam: publishedExam._id,
            student: studentA._id,
            filePath: '/secure/storage/key/scriptA.pdf',
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false,
            qrStudentId: 'QR-12345',
            omrStudentId: 'OMR-67890'
        });

        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubric._id,
            gradedBy: ta._id,
            marksAwarded: [{ criterionName: 'Correctness', score: 92 }],
            totalScore: 92,
            isFinal: true
        });

        await Allocation.create({
            exam: publishedExam._id,
            ta: ta._id,
            answerScript: scriptA._id,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED
        });

        const res = await resultsGET();
        expect(res.status).toBe(200);
        const rawJsonText = await res.text();

        // Verify none of the sensitive field keys exist anywhere in the raw response text
        expect(rawJsonText).not.toContain('gradedBy');
        expect(rawJsonText).not.toContain('annotatedBy');
        expect(rawJsonText).not.toContain('enrolledStudents');
        expect(rawJsonText).not.toContain('qrStudentId');
        expect(rawJsonText).not.toContain('omrStudentId');
        expect(rawJsonText).not.toContain('storageKey');
        expect(rawJsonText).not.toContain('isFinal');
    });

    // 9. Student-facing exam responses exclude sensitive fields (enrolledStudents, omrTemplate, assemblySeal*, approvedBy, createdBy)
    it('9. shapes GET /api/exams and GET /api/exams/[id] to exclude sensitive fields for student requests', async () => {
        // Query GET /api/exams as Student A
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            name: studentA.name,
            role: UserRole.STUDENT
        };

        const listRes = await examsGET();
        expect(listRes.status).toBe(200);
        const listText = await listRes.text();

        // Must NOT expose sensitive fields in list
        expect(listText).not.toContain('enrolledStudents');
        expect(listText).not.toContain('omrTemplate');
        expect(listText).not.toContain('assemblySeal');
        expect(listText).not.toContain('assemblySealKeyId');
        expect(listText).not.toContain('assemblySealAt');
        expect(listText).not.toContain('assemblySealBy');
        expect(listText).not.toContain('approvedBy');
        expect(listText).not.toContain('createdBy');

        // Query GET /api/exams/[id] as Student A
        const req = new NextRequest(`http://localhost:3000/api/exams/${publishedExam._id}`);
        const detailRes = await examDetailGET(req, {
            params: Promise.resolve({ id: publishedExam._id.toString() })
        });
        expect(detailRes.status).toBe(200);
        const detailText = await detailRes.text();

        // Must NOT expose sensitive fields in detail
        expect(detailText).not.toContain('enrolledStudents');
        expect(detailText).not.toContain('omrTemplate');
        expect(detailText).not.toContain('assemblySeal');
        expect(detailText).not.toContain('assemblySealKeyId');
        expect(detailText).not.toContain('assemblySealAt');
        expect(detailText).not.toContain('assemblySealBy');
        expect(detailText).not.toContain('approvedBy');
        expect(detailText).not.toContain('createdBy');

        // Must preserve required legitimate client fields
        const detailBody = JSON.parse(detailText);
        expect(detailBody.data._id).toBe(publishedExam._id.toString());
        expect(detailBody.data.title).toBe('Midterm Algorithms');
        expect(detailBody.data.totalMarks).toBe(100);
        expect(detailBody.data.numberOfQuestions).toBe(5);
        expect(detailBody.data.status).toBe(ExamStatus.PUBLISHED);
    });
});
