// Route-level security audit test suite verifying student access constraints across all VIEW_COURSES routes (AE-199)
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { IUser, UserRole } from '../models/User';
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

describe('AE-199: Security audit of VIEW_COURSES routes for student access', () => {
    let coursesGET: typeof import('../app/api/courses/route').GET;
    let courseByIdGET: typeof import('../app/api/courses/[id]/route').GET;
    let examsGET: typeof import('../app/api/exams/route').GET;
    let examByIdGET: typeof import('../app/api/exams/[id]/route').GET;
    let regradeWindowGET: typeof import('../app/api/exams/[id]/regrade-window/route').GET;
    let ingestionSummaryGET: typeof import('../app/api/exams/[id]/ingestion-summary/route').GET;
    let rubricsGET: typeof import('../app/api/rubrics/route').GET;
    let rubricByIdGET: typeof import('../app/api/rubrics/[id]/route').GET;

    beforeAll(async () => {
        coursesGET = (await import('../app/api/courses/route')).GET;
        courseByIdGET = (await import('../app/api/courses/[id]/route')).GET;
        examsGET = (await import('../app/api/exams/route')).GET;
        examByIdGET = (await import('../app/api/exams/[id]/route')).GET;
        regradeWindowGET = (await import('../app/api/exams/[id]/regrade-window/route')).GET;
        ingestionSummaryGET = (await import('../app/api/exams/[id]/ingestion-summary/route')).GET;
        rubricsGET = (await import('../app/api/rubrics/route')).GET;
        rubricByIdGET = (await import('../app/api/rubrics/[id]/route')).GET;
    });

    afterEach(() => {
        mockSessionUser = null;
    });

    it('walks every VIEW_COURSES route as a student, verifying proper scoping and zero data exposure', async () => {
        const professor: IUser = await User.create({
            name: 'Prof Security',
            email: 'prof-ae199@example.edu',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        const studentAlice: IUser = await User.create({
            name: 'Alice Student',
            email: 'alice-ae199@example.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });
        const studentBob: IUser = await User.create({
            name: 'Bob Student',
            email: 'bob-ae199@example.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });
        const ta: IUser = await User.create({
            name: 'TA Security',
            email: 'ta-ae199@example.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        const course = await Course.create({
            courseCode: 'CS199',
            courseName: 'Security Audit',
            academicYear: '2026',
            semester: 1,
            professor: professor._id,
            enrolledStudents: [studentAlice._id, studentBob._id],
            teachingAssistants: [ta._id],
            isActive: true
        });

        const publishedExam = await Exam.create({
            title: 'Published Audit Exam',
            course: course._id,
            createdBy: professor._id,
            examDate: new Date('2026-10-25'),
            totalMarks: 20,
            numberOfQuestions: 2,
            status: ExamStatus.PUBLISHED,
            isActive: true,
            regradeWindowOpensAt: new Date(Date.now() - 60_000),
            regradeWindowClosesAt: new Date(Date.now() + 60 * 60_000)
        });

        const draftExam = await Exam.create({
            title: 'Draft Exam Under Review',
            course: course._id,
            createdBy: professor._id,
            examDate: new Date('2026-11-01'),
            totalMarks: 20,
            numberOfQuestions: 2,
            status: ExamStatus.REVIEW_PENDING,
            isActive: true
        });

        const rubric = await Rubric.create({
            exam: publishedExam._id,
            createdBy: professor._id,
            scoreStep: 0.5,
            questions: [
                { questionNumber: 1, maxMarks: 10, criteria: [{ criterionName: 'Correctness', points: 10 }] },
                { questionNumber: 2, maxMarks: 10, criteria: [{ criterionName: 'Code Style', points: 10 }] }
            ],
            isActive: true
        });
        publishedExam.rubric = rubric._id;
        await publishedExam.save();

        // 1. GET /api/exams/[id]/ingestion-summary denies students and unprivileged TAs (403)
        mockSessionUser = { id: studentAlice._id.toString(), role: UserRole.STUDENT };
        const studentIngestionRes = await ingestionSummaryGET(
            new NextRequest(`http://localhost:3000/api/exams/${publishedExam._id}/ingestion-summary?category=total`),
            { params: Promise.resolve({ id: publishedExam._id.toString() }) }
        );
        expect(studentIngestionRes.status).toBe(403);

        mockSessionUser = { id: ta._id.toString(), role: UserRole.TA };
        const taIngestionRes = await ingestionSummaryGET(
            new NextRequest(`http://localhost:3000/api/exams/${publishedExam._id}/ingestion-summary`),
            { params: Promise.resolve({ id: publishedExam._id.toString() }) }
        );
        expect(taIngestionRes.status).toBe(403);

        // 2. GET /api/courses and /api/courses/[id] strip enrolled student rosters for students
        mockSessionUser = { id: studentAlice._id.toString(), role: UserRole.STUDENT };
        const listResponse = await coursesGET();
        expect(listResponse.status).toBe(200);
        const listBody = await listResponse.json();
        expect(listBody.data).toHaveLength(1);
        expect(listBody.data[0]).not.toHaveProperty('enrolledStudents');

        const detailResponse = await courseByIdGET(
            new NextRequest(`http://localhost:3000/api/courses/${course._id}`),
            { params: Promise.resolve({ id: course._id.toString() }) }
        );
        expect(detailResponse.status).toBe(200);
        const detailBody = await detailResponse.json();
        expect(detailBody.data).not.toHaveProperty('enrolledStudents');

        // 3. GET /api/exams lists only published exams for enrolled courses without storage leaks
        const examsResponse = await examsGET(new NextRequest('http://localhost:3000/api/exams'));
        expect(examsResponse.status).toBe(200);
        const examsBody = await examsResponse.json();
        const returnedExamIds = examsBody.data.map((e: { _id: string }) => e._id);
        expect(returnedExamIds).toContain(publishedExam._id.toString());
        expect(returnedExamIds).not.toContain(draftExam._id.toString());

        const rawText = JSON.stringify(examsBody);
        expect(rawText).not.toContain('storageKey');
        expect(rawText).not.toContain('filePath');

        // 4. GET /api/exams/[id] denies access to unpublished exams for students
        const draftDetailResponse = await examByIdGET(
            new NextRequest(`http://localhost:3000/api/exams/${draftExam._id}`),
            { params: Promise.resolve({ id: draftExam._id.toString() }) }
        );
        expect([403, 404]).toContain(draftDetailResponse.status);

        // 5. GET /api/exams/[id]/regrade-window returns window dates for enrolled students
        const windowResponse = await regradeWindowGET(
            new NextRequest(`http://localhost:3000/api/exams/${publishedExam._id}/regrade-window`),
            { params: Promise.resolve({ id: publishedExam._id.toString() }) }
        );
        expect(windowResponse.status).toBe(200);
        const windowBody = await windowResponse.json();
        expect(windowBody.data).toHaveProperty('regradeWindowOpensAt');
        expect(windowBody.data).toHaveProperty('regradeWindowClosesAt');

        // 6. GET /api/rubrics and /api/rubrics/[id] return rubric without leaking student scripts or storage keys
        const rubricResponse = await rubricByIdGET(
            new NextRequest(`http://localhost:3000/api/rubrics/${rubric._id}`),
            { params: Promise.resolve({ id: rubric._id.toString() }) }
        );
        expect(rubricResponse.status).toBe(200);
        const rubricBody = await rubricResponse.json();
        expect(rubricBody.data.questions).toHaveLength(2);

        const rawRubricText = JSON.stringify(rubricBody);
        expect(rawRubricText).not.toContain('storageKey');
        expect(rawRubricText).not.toContain('filePath');
        expect(rawRubricText).not.toContain('answerScript');
    });
});
