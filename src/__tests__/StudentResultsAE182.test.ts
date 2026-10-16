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
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

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
    let reopenPOST: any;
    let scriptsGET: any;
    let imageGET: any;

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
        reopenPOST = (await import('../app/api/allocations/[id]/reopen/route')).POST;
        scriptsGET = (await import('../app/api/scripts/[id]/route')).GET;
        imageGET = (await import('../app/api/ingest/[id]/pages/[pageId]/image/route')).GET;
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

    // 1. A student's own released result is listed with its total and maxMarks derived from rubric
    it("1. lists a student's own released result with its total marks and derives maxMarks from rubric", async () => {
        const scriptA = await AnswerScript.create({
            exam: publishedExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        // Rubric questions sum to 10 while publishedExam.totalMarks is 100
        const rubric10 = await Rubric.create({
            exam: publishedExam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 10,
                    criteria: [{ criterionName: 'Correctness', points: 10 }]
                }
            ],
            isActive: true
        });

        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubric10._id,
            gradedBy: ta._id,
            marksAwarded: [{ criterionName: 'Correctness', score: 8.5 }],
            totalScore: 8.5,
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
        expect(record.total).toBe(8.5);
        expect(publishedExam.totalMarks).toBe(100);
        // Released result must report maxMarks: 10, not 100
        expect(record.maxMarks).toBe(10);
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
        expect(record.maxMarks).toBeUndefined();
        expect(record.scriptId).toBeUndefined();

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
        expect(record.maxMarks).toBeUndefined();
        expect(record.scriptId).toBeUndefined();

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
        expect(record.maxMarks).toBeUndefined();
        expect(record.scriptId).toBeUndefined();
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

    // 6. The feature flag being off prevents access and unexpected errors return generic message
    it('6. returns 404 when STUDENT_RESULTS_ENABLED feature flag is off and generic message on unexpected 500 error', async () => {
        process.env.STUDENT_RESULTS_ENABLED = 'false';

        const res = await resultsGET();
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toBe('Not found');

        // 6a. Verify unexpected 500 errors return a generic message and do NOT expose exception details
        process.env.STUDENT_RESULTS_ENABLED = 'true';
        const studentResultService = (await import('../services/StudentResultService')).default;
        const getSpy = vi.spyOn(studentResultService, 'getStudentResults').mockRejectedValueOnce(
            new Error('DATABASE_CONNECTION_LEAK: mongodb://user:pass@cluster.internal/prod_db')
        );
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const errRes = await resultsGET();
        expect(errRes.status).toBe(500);
        const errBody = await errRes.json();
        expect(errBody.success).toBe(false);
        expect(errBody.message).toBe('An unexpected error occurred');
        expect(JSON.stringify(errBody)).not.toContain('DATABASE_CONNECTION_LEAK');
        expect(JSON.stringify(errBody)).not.toContain('prod_db');
        getSpy.mockRestore();
        consoleErrorSpy.mockRestore();

        // 6b. Verify UI "View Grades" link is hidden by default and when NEXT_PUBLIC_STUDENT_RESULTS_ENABLED is false
        delete process.env.NEXT_PUBLIC_STUDENT_RESULTS_ENABLED;
        const StudentDashboardPage = (await import('../app/(dashboard)/student/page')).default;
        let html = renderToStaticMarkup(React.createElement(StudentDashboardPage));
        expect(html).not.toContain('View Grades');
        expect(html).not.toContain('/student/results');

        process.env.NEXT_PUBLIC_STUDENT_RESULTS_ENABLED = 'false';
        html = renderToStaticMarkup(React.createElement(StudentDashboardPage));
        expect(html).not.toContain('View Grades');
        expect(html).not.toContain('/student/results');

        // Verify "View Grades" link is displayed only when NEXT_PUBLIC_STUDENT_RESULTS_ENABLED is explicitly true
        process.env.NEXT_PUBLIC_STUDENT_RESULTS_ENABLED = 'true';
        html = renderToStaticMarkup(React.createElement(StudentDashboardPage));
        expect(html).toContain('View Grades');
        expect(html).toContain('/student/results');

        delete process.env.NEXT_PUBLIC_STUDENT_RESULTS_ENABLED;
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

        // ADMIN role
        const admin = await User.create({
            name: 'Admin Albus',
            email: 'admin@iiit.ac.in',
            password: 'password123',
            role: UserRole.ADMIN,
            isActive: true
        });
        mockSessionUser = {
            id: admin._id.toString(),
            email: admin.email,
            name: admin.name,
            role: UserRole.ADMIN
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

        // Student access to staff APIs: verify student receives HTTP 403 from GET /api/scripts/[id] and staff image route
        await User.findByIdAndUpdate(studentA._id, { isActive: true, role: UserRole.STUDENT });
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            name: studentA.name,
            role: UserRole.STUDENT
        };

        const staffScriptReq = new NextRequest(`http://localhost:3000/api/scripts/${publishedExam._id}`);
        const staffScriptRes = await scriptsGET(staffScriptReq, {
            params: Promise.resolve({ id: publishedExam._id.toString() })
        });
        expect(staffScriptRes.status).toBe(403);

        const staffImageReq = new NextRequest(`http://localhost:3000/api/ingest/batch-1/pages/page-1/image`);
        const staffImageRes = await imageGET(staffImageReq, {
            params: Promise.resolve({ id: 'batch-1', pageId: 'page-1' })
        });
        expect(staffImageRes.status).toBe(403);
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

    // 10. Partial question-wise grades and missing required grades never expose totals or script IDs
    it('10. prevents releasing partial question-wise results when some rubric questions are missing grades', async () => {
        // Create an exam with a 2-question rubric (Q1: 50 marks, Q2: 50 marks)
        const multiQExam = await Exam.create({
            title: 'Calculus Final MultiQ',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-11-05'),
            totalMarks: 100,
            numberOfQuestions: 2,
            status: ExamStatus.PUBLISHED,
            isActive: true,
            enrolledStudents: [studentA._id]
        });

        const multiQRubric = await Rubric.create({
            exam: multiQExam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            questions: [
                { questionNumber: 1, maxMarks: 50, criteria: [{ criterionName: 'Derivatives', points: 50 }] },
                { questionNumber: 2, maxMarks: 50, criteria: [{ criterionName: 'Integrals', points: 50 }] }
            ],
            isActive: true
        });
        await Exam.findByIdAndUpdate(multiQExam._id, { rubric: multiQRubric._id });

        const scriptMultiQ = await AnswerScript.create({
            exam: multiQExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        // Only Question 1 is graded and finalized; Question 2 is missing completely!
        await Grade.create({
            answerScript: scriptMultiQ._id,
            rubric: multiQRubric._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Derivatives', score: 45 }],
            totalScore: 45,
            isFinal: true
        });

        await Allocation.create({
            exam: multiQExam._id,
            ta: ta._id,
            answerScript: scriptMultiQ._id,
            question: 1,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED
        });

        const res = await resultsGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        const record = body.data.find((r: any) => r.examId === multiQExam._id.toString());

        expect(record).toBeDefined();
        // Must NOT be released because Q2 is missing
        expect(record.status).toBe('NOT_AVAILABLE');
        expect(record.total).toBeUndefined();
        expect(record.scriptId).toBeUndefined();
        expect(record.maxMarks).toBeUndefined();
    });

    // 11. Unfinished allocations prevent release even if all question grades are finalized
    it('11. prevents release when any allocation remains PENDING or IN_PROGRESS', async () => {
        const multiQExam = await Exam.create({
            title: 'Physics MultiQ',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-11-10'),
            totalMarks: 100,
            numberOfQuestions: 2,
            status: ExamStatus.PUBLISHED,
            isActive: true,
            enrolledStudents: [studentA._id]
        });

        const multiQRubric = await Rubric.create({
            exam: multiQExam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            questions: [
                { questionNumber: 1, maxMarks: 50, criteria: [{ criterionName: 'Mechanics', points: 50 }] },
                { questionNumber: 2, maxMarks: 50, criteria: [{ criterionName: 'Optics', points: 50 }] }
            ],
            isActive: true
        });
        await Exam.findByIdAndUpdate(multiQExam._id, { rubric: multiQRubric._id });

        const scriptMultiQ = await AnswerScript.create({
            exam: multiQExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        // Both Q1 and Q2 are final
        await Grade.create({
            answerScript: scriptMultiQ._id,
            rubric: multiQRubric._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Mechanics', score: 40 }],
            totalScore: 40,
            isFinal: true
        });
        await Grade.create({
            answerScript: scriptMultiQ._id,
            rubric: multiQRubric._id,
            gradedBy: ta._id,
            question: 2,
            marksAwarded: [{ criterionName: 'Optics', score: 45 }],
            totalScore: 45,
            isFinal: true
        });

        // Allocation 1 is COMPLETED, but Allocation 2 remains IN_PROGRESS
        await Allocation.create({
            exam: multiQExam._id,
            ta: ta._id,
            answerScript: scriptMultiQ._id,
            question: 1,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED
        });
        await Allocation.create({
            exam: multiQExam._id,
            ta: ta._id,
            answerScript: scriptMultiQ._id,
            question: 2,
            allocatedBy: prof._id,
            status: AllocationStatus.IN_PROGRESS
        });

        const res = await resultsGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        const record = body.data.find((r: any) => r.examId === multiQExam._id.toString());

        expect(record).toBeDefined();
        expect(record.status).toBe('NOT_AVAILABLE');
        expect(record.total).toBeUndefined();
        expect(record.scriptId).toBeUndefined();
    });

    // 12. Full question-wise grading releases with sum of scores when all questions and allocations are completed
    it('12. releases result with sum of scores when all questions and allocations are COMPLETED', async () => {
        const multiQExam = await Exam.create({
            title: 'Chemistry MultiQ Complete',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-11-15'),
            totalMarks: 100,
            numberOfQuestions: 2,
            status: ExamStatus.PUBLISHED,
            isActive: true,
            enrolledStudents: [studentA._id]
        });

        const multiQRubric = await Rubric.create({
            exam: multiQExam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            questions: [
                { questionNumber: 1, maxMarks: 50, criteria: [{ criterionName: 'Organic', points: 50 }] },
                { questionNumber: 2, maxMarks: 50, criteria: [{ criterionName: 'Inorganic', points: 50 }] }
            ],
            isActive: true
        });
        await Exam.findByIdAndUpdate(multiQExam._id, { rubric: multiQRubric._id });

        const scriptMultiQ = await AnswerScript.create({
            exam: multiQExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        await Grade.create({
            answerScript: scriptMultiQ._id,
            rubric: multiQRubric._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Organic', score: 42 }],
            totalScore: 42,
            isFinal: true
        });
        await Grade.create({
            answerScript: scriptMultiQ._id,
            rubric: multiQRubric._id,
            gradedBy: ta._id,
            question: 2,
            marksAwarded: [{ criterionName: 'Inorganic', score: 48 }],
            totalScore: 48,
            isFinal: true
        });

        const alloc1 = await Allocation.create({
            exam: multiQExam._id,
            ta: ta._id,
            answerScript: scriptMultiQ._id,
            question: 1,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED
        });
        await Allocation.create({
            exam: multiQExam._id,
            ta: ta._id,
            answerScript: scriptMultiQ._id,
            question: 2,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED
        });

        const res = await resultsGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        const record = body.data.find((r: any) => r.examId === multiQExam._id.toString());

        expect(record).toBeDefined();
        expect(record.status).toBe('RELEASED');
        expect(record.total).toBe(90); // 42 + 48
        expect(record.maxMarks).toBe(100);
        expect(record.scriptId).toBe(scriptMultiQ._id.toString());

        // Reopen after publish: call real POST /api/allocations/[id]/reopen route as professor
        mockSessionUser = {
            id: prof._id.toString(),
            email: prof.email,
            name: prof.name,
            role: UserRole.PROFESSOR
        };

        const reopenReq = new NextRequest(`http://localhost:3000/api/allocations/${alloc1._id}/reopen`, {
            method: 'POST',
            body: JSON.stringify({ reason: 'Student submitted regrade request' })
        });
        const reopenRes = await reopenPOST(reopenReq, {
            params: Promise.resolve({ id: alloc1._id.toString() })
        });
        expect(reopenRes.status).toBe(200);

        // Switch back to Student A session: verify results list changes to NOT_AVAILABLE
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            name: studentA.name,
            role: UserRole.STUDENT
        };

        const afterReopenRes = await resultsGET();
        expect(afterReopenRes.status).toBe(200);
        const afterReopenBody = await afterReopenRes.json();
        const afterReopenRecord = afterReopenBody.data.find((r: any) => r.examId === multiQExam._id.toString());
        expect(afterReopenRecord).toBeDefined();
        expect(afterReopenRecord.status).toBe('NOT_AVAILABLE');
        expect(afterReopenRecord.total).toBeUndefined();
        expect(afterReopenRecord.maxMarks).toBeUndefined();
        expect(afterReopenRecord.scriptId).toBeUndefined();
    });

    // 13. Inactive script is never released
    it('13. does not release result or expose totals when answerScript.isActive is false', async () => {
        const inactiveScript = await AnswerScript.create({
            exam: publishedExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: false, // Inactive script
            needsManualId: false,
            hasIdentificationConflict: false
        });

        await Grade.create({
            answerScript: inactiveScript._id,
            rubric: rubric._id,
            gradedBy: ta._id,
            marksAwarded: [{ criterionName: 'Correctness', score: 99 }],
            totalScore: 99,
            isFinal: true
        });

        const res = await resultsGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        const record = body.data.find((r: any) => r.examId === publishedExam._id.toString());

        expect(record).toBeDefined();
        expect(record.status).toBe('NOT_AVAILABLE');
        expect(record.total).toBeUndefined();
        expect(record.maxMarks).toBeUndefined();
        expect(record.scriptId).toBeUndefined();
    });

    // 14. Inactive exam is not exposed in results list
    it('14. does not include inactive exams in the student results list', async () => {
        // Create an inactive exam (even if status is PUBLISHED)
        const inactiveExam = await Exam.create({
            title: 'Decommissioned Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-09-01'),
            totalMarks: 100,
            numberOfQuestions: 5,
            status: ExamStatus.PUBLISHED,
            isActive: false, // Inactive exam
            enrolledStudents: [studentA._id]
        });

        const script = await AnswerScript.create({
            exam: inactiveExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        await Grade.create({
            answerScript: script._id,
            rubric: rubric._id,
            gradedBy: ta._id,
            marksAwarded: [{ criterionName: 'Correctness', score: 95 }],
            totalScore: 95,
            isFinal: true
        });

        const res = await resultsGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        const record = body.data.find((r: any) => r.examId === inactiveExam._id.toString());
        expect(record).toBeUndefined();
    });

    // 15. Unfinalized whole-script grade is never released
    it('15. does not release result or expose totals when a whole-script grade has isFinal === false', async () => {
        const wholeExam = await Exam.create({
            title: 'Draft Whole-Script Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-11-20'),
            totalMarks: 50,
            numberOfQuestions: 1,
            status: ExamStatus.PUBLISHED,
            isActive: true,
            enrolledStudents: [studentA._id]
        });

        const wholeRubric = await Rubric.create({
            exam: wholeExam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            questions: [{ questionNumber: 1, maxMarks: 50, criteria: [{ criterionName: 'Essay', points: 50 }] }],
            isActive: true
        });

        const script = await AnswerScript.create({
            exam: wholeExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        // Unfinalized whole-script grade (question is undefined, isFinal is false)
        await Grade.create({
            answerScript: script._id,
            rubric: wholeRubric._id,
            gradedBy: ta._id,
            marksAwarded: [{ criterionName: 'Essay', score: 40 }],
            totalScore: 40,
            isFinal: false
        });

        const res = await resultsGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        const record = body.data.find((r: any) => r.examId === wholeExam._id.toString());

        expect(record).toBeDefined();
        expect(record.status).toBe('NOT_AVAILABLE');
        expect(record.total).toBeUndefined();
        expect(record.maxMarks).toBeUndefined();
        expect(record.scriptId).toBeUndefined();
    });

    // 16. Inconsistent rubric versions across grades prevent release
    it('16. prevents release when grades reference inconsistent rubric versions', async () => {
        const rubricExam = await Exam.create({
            title: 'Rubric Version Test Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-11-25'),
            totalMarks: 100,
            numberOfQuestions: 2,
            status: ExamStatus.PUBLISHED,
            isActive: true,
            enrolledStudents: [studentA._id]
        });

        const rubricV1 = await Rubric.create({
            exam: rubricExam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            version: 1,
            questions: [
                { questionNumber: 1, maxMarks: 50, criteria: [{ criterionName: 'Q1', points: 50 }] },
                { questionNumber: 2, maxMarks: 50, criteria: [{ criterionName: 'Q2', points: 50 }] }
            ],
            isActive: false
        });

        const rubricV2 = await Rubric.create({
            exam: rubricExam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            version: 2,
            questions: [
                { questionNumber: 1, maxMarks: 50, criteria: [{ criterionName: 'Q1_v2', points: 50 }] },
                { questionNumber: 2, maxMarks: 50, criteria: [{ criterionName: 'Q2_v2', points: 50 }] }
            ],
            isActive: true
        });

        const script = await AnswerScript.create({
            exam: rubricExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        // Q1 graded against rubricV1, Q2 graded against rubricV2
        await Grade.create({
            answerScript: script._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Q1', score: 45 }],
            totalScore: 45,
            isFinal: true
        });
        await Grade.create({
            answerScript: script._id,
            rubric: rubricV2._id,
            gradedBy: ta._id,
            question: 2,
            marksAwarded: [{ criterionName: 'Q2_v2', score: 45 }],
            totalScore: 45,
            isFinal: true
        });

        const res = await resultsGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        const record = body.data.find((r: any) => r.examId === rubricExam._id.toString());

        expect(record).toBeDefined();
        expect(record.status).toBe('NOT_AVAILABLE');
        expect(record.total).toBeUndefined();
        expect(record.maxMarks).toBeUndefined();
        expect(record.scriptId).toBeUndefined();
    });

    // 17. Question-wise grading without allocations (direct faculty grading) releases when complete
    it('17. releases question-wise result when graded directly without allocations (empty allocation list)', async () => {
        const facultyExam = await Exam.create({
            title: 'Faculty Graded Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-11-28'),
            totalMarks: 60,
            numberOfQuestions: 2,
            status: ExamStatus.PUBLISHED,
            isActive: true,
            enrolledStudents: [studentA._id]
        });

        const facultyRubric = await Rubric.create({
            exam: facultyExam._id,
            createdBy: prof._id,
            scoreStep: 1,
            questions: [
                { questionNumber: 1, maxMarks: 30, criteria: [{ criterionName: 'Part1', points: 30 }] },
                { questionNumber: 2, maxMarks: 30, criteria: [{ criterionName: 'Part2', points: 30 }] }
            ],
            isActive: true
        });

        const script = await AnswerScript.create({
            exam: facultyExam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });

        // Faculty grades directly without creating allocations
        await Grade.create({
            answerScript: script._id,
            rubric: facultyRubric._id,
            gradedBy: prof._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Part1', score: 28 }],
            totalScore: 28,
            isFinal: true
        });
        await Grade.create({
            answerScript: script._id,
            rubric: facultyRubric._id,
            gradedBy: prof._id,
            question: 2,
            marksAwarded: [{ criterionName: 'Part2', score: 27 }],
            totalScore: 27,
            isFinal: true
        });

        // Verify zero allocations exist
        const allocCount = await Allocation.countDocuments({ answerScript: script._id });
        expect(allocCount).toBe(0);

        const res = await resultsGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        const record = body.data.find((r: any) => r.examId === facultyExam._id.toString());

        expect(record).toBeDefined();
        expect(record.status).toBe('RELEASED');
        expect(record.total).toBe(55); // 28 + 27
        expect(record.maxMarks).toBe(60);
        expect(record.scriptId).toBe(script._id.toString());
    });
});
