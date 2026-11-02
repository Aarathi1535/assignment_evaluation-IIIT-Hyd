import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { IUser, UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import RegradeRequest, { RegradeStatus } from '../models/RegradeRequest';
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

describe('AE-195: Student regrade request API', () => {
    let getRequests: typeof import('../app/api/student/regrade-requests/route').GET;
    let postRequest: typeof import('../app/api/student/regrade-requests/route').POST;
    let student!: IUser;
    let otherStudent!: IUser;
    let professor!: IUser;
    let exam!: InstanceType<typeof Exam>;
    let rubric!: InstanceType<typeof Rubric>;

    beforeAll(async () => {
        const route = await import('../app/api/student/regrade-requests/route');
        getRequests = route.GET;
        postRequest = route.POST;
        await RegradeRequest.init();
    });

    afterEach(() => {
        mockSessionUser = null;
    });

    async function createPublishedExam() {
        process.env.STUDENT_RESULTS_ENABLED = 'true';
        student = await User.create({
            name: 'Student One',
            email: 'student-ae195@example.edu',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true
        });
        otherStudent = await User.create({
            name: 'Student Two',
            email: 'student2-ae195@example.edu',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true
        });
        professor = await User.create({
            name: 'Professor AE195',
            email: 'professor-ae195@example.edu',
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        const course = await Course.create({
            courseCode: 'CS195',
            courseName: 'Algorithms',
            academicYear: '2026',
            semester: 1,
            professor: professor._id,
            enrolledStudents: [student._id, otherStudent._id],
            teachingAssistants: [],
            isActive: true
        });

        const now = Date.now();
        exam = await Exam.create({
            title: 'AE-195 Midterm',
            course: course._id,
            createdBy: professor._id,
            examDate: new Date(now - 86400000),
            totalMarks: 20,
            numberOfQuestions: 2,
            status: ExamStatus.PUBLISHED,
            isActive: true,
            regradeWindowOpensAt: new Date(now - 3600000),
            regradeWindowClosesAt: new Date(now + 3600000)
        });
        rubric = await Rubric.create({
            exam: exam._id,
            createdBy: professor._id,
            scoreStep: 0.5,
            questions: [
                { questionNumber: 1, maxMarks: 10, criteria: [{ criterionName: 'Accuracy', points: 10 }] },
                { questionNumber: 2, maxMarks: 10, criteria: [{ criterionName: 'Reasoning', points: 10 }] }
            ],
            isActive: true
        });
        await Exam.updateOne({ _id: exam._id }, { rubric: rubric._id });
    }

    async function createReleasedScript(owner: IUser = student) {
        const script = await AnswerScript.create({
            exam: exam._id,
            student: owner._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false
        });
        for (const questionNumber of [1, 2]) {
            await Grade.create({
                answerScript: script._id,
                rubric: rubric._id,
                gradedBy: professor._id,
                marksAwarded: [{
                    criterionName: questionNumber === 1 ? 'Accuracy' : 'Reasoning',
                    score: 8
                }],
                totalScore: 8,
                isFinal: true,
                question: questionNumber
            });
        }
        return script;
    }

    async function submit(body: unknown) {
        const request = new NextRequest('http://localhost:3000/api/student/regrade-requests', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        });
        return postRequest(request);
    }

    it('persists an authenticated student request with status and timestamps', async () => {
        await createPublishedExam();
        const script = await createReleasedScript();
        mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };

        const response = await submit({
            scriptId: script._id.toString(),
            questionNumber: 1,
            reason: 'The rubric criteria were not applied to my answer.'
        });
        const body = await response.json();

        expect(response.status).toBe(201);
        expect(body.data).toMatchObject({
            examId: exam._id.toString(),
            examTitle: exam.title,
            questionNumber: 1,
            status: 'open'
        });
        expect(body.data.createdAt).toBeTruthy();
        expect(body.data.updatedAt).toBeTruthy();
        const saved = await RegradeRequest.findById(body.data.id);
        expect(saved?.student.toString()).toBe(student._id.toString());
        expect(saved?.answerScript.toString()).toBe(script._id.toString());
        expect(saved?.exam.toString()).toBe(exam._id.toString());
        expect(saved?.reason).toBe('The rubric criteria were not applied to my answer.');
        expect(saved?.status).toBe(RegradeStatus.OPEN);
    });

    it('does not accept a spoofed student identity in the request body', async () => {
        await createPublishedExam();
        const script = await createReleasedScript();
        mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };

        const response = await submit({
            scriptId: script._id.toString(),
            questionNumber: 1,
            reason: 'The rubric criteria were not applied to my answer.',
            studentId: otherStudent._id.toString()
        });

        expect(response.status).toBe(400);
        expect(await RegradeRequest.countDocuments()).toBe(0);
    });

    it('rejects another student’s script without creating a request', async () => {
        await createPublishedExam();
        const otherScript = await createReleasedScript(otherStudent);
        mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };

        const response = await submit({
            scriptId: otherScript._id.toString(),
            questionNumber: 1,
            reason: 'The rubric criteria were not applied to my answer.'
        });

        expect(response.status).toBe(404);
        expect(await RegradeRequest.countDocuments()).toBe(0);
    });

    it('rejects requests outside the configured window and for invalid questions', async () => {
        await createPublishedExam();
        const script = await createReleasedScript();
        mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };

        await Exam.updateOne({ _id: exam._id }, {
            regradeWindowClosesAt: new Date(Date.now() - 1000)
        });
        const closedWindow = await submit({
            scriptId: script._id.toString(),
            questionNumber: 1,
            reason: 'The rubric criteria were not applied to my answer.'
        });
        expect(closedWindow.status).toBe(403);

        await Exam.updateOne({ _id: exam._id }, {
            regradeWindowOpensAt: new Date(Date.now() - 3600000),
            regradeWindowClosesAt: new Date(Date.now() + 3600000)
        });
        const invalidQuestion = await submit({
            scriptId: script._id.toString(),
            questionNumber: 3,
            reason: 'The rubric criteria were not applied to my answer.'
        });
        expect(invalidQuestion.status).toBe(400);
        expect(await RegradeRequest.countDocuments()).toBe(0);
    });

    it('prevents duplicate open requests for the same student, exam, and question', async () => {
        await createPublishedExam();
        const script = await createReleasedScript();
        mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };
        const request = {
            scriptId: script._id.toString(),
            questionNumber: 1,
            reason: 'The rubric criteria were not applied to my answer.'
        };

        expect((await submit(request)).status).toBe(201);
        expect((await submit({ ...request, questionNumber: 2 })).status).toBe(201);
        expect((await submit(request)).status).toBe(409);
        expect(await RegradeRequest.countDocuments()).toBe(2);

        const savedRequest = await RegradeRequest.findOne({ questionNumber: 1 });
        if (!savedRequest) {
            throw new Error('Expected the regrade request to be saved');
        }
        savedRequest.status = RegradeStatus.REVIEWING;
        await savedRequest.save();
        expect((await submit(request)).status).toBe(409);

        savedRequest.status = RegradeStatus.RESOLVED;
        await savedRequest.save();
        expect(savedRequest.isOpen).toBe(false);
        expect((await submit(request)).status).toBe(201);
        expect(await RegradeRequest.countDocuments()).toBe(3);
    });

    it('lists only the authenticated student’s regrade requests', async () => {
        await createPublishedExam();
        const studentScript = await createReleasedScript(student);
        const otherScript = await createReleasedScript(otherStudent);
        await RegradeRequest.create({
            exam: exam._id,
            answerScript: studentScript._id,
            questionNumber: 1,
            student: student._id,
            reason: 'The rubric criteria were not applied to my answer.'
        });
        await RegradeRequest.create({
            exam: exam._id,
            answerScript: otherScript._id,
            questionNumber: 2,
            student: otherStudent._id,
            reason: 'The rubric criteria were not applied to my answer.'
        });
        mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };

        const response = await getRequests();
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data).toHaveLength(1);
        expect(body.data[0]).toMatchObject({
            examTitle: exam.title,
            questionNumber: 1,
            status: 'open'
        });
        expect(JSON.stringify(body)).not.toContain(otherStudent._id.toString());
        expect(JSON.stringify(body)).not.toContain('answerScript');
    });
});
