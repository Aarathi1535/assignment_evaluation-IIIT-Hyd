import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { IUser, UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Rubric from '../models/Rubric';
import RegradeRequest from '../models/RegradeRequest';

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

describe('AE-198: published results and student regrade workflow', () => {
    let publishExam: typeof import('../app/api/exams/[id]/publish/route').POST;
    let getResults: typeof import('../app/api/student/results/route').GET;
    let getResultDetails: typeof import('../app/api/student/results/[scriptId]/route').GET;
    let getRegradeRequests: typeof import('../app/api/student/regrade-requests/route').GET;
    let postRegradeRequest: typeof import('../app/api/student/regrade-requests/route').POST;
    let professor!: IUser;
    let ta!: IUser;
    let student!: IUser;
    let otherStudent!: IUser;
    let exam!: InstanceType<typeof Exam>;
    let script!: InstanceType<typeof AnswerScript>;

    beforeAll(async () => {
        publishExam = (await import('../app/api/exams/[id]/publish/route')).POST;
        getResults = (await import('../app/api/student/results/route')).GET;
        getResultDetails = (await import('../app/api/student/results/[scriptId]/route')).GET;
        const regradeRoutes = await import('../app/api/student/regrade-requests/route');
        getRegradeRequests = regradeRoutes.GET;
        postRegradeRequest = regradeRoutes.POST;
        await RegradeRequest.init();
    });

    afterEach(() => {
        mockSessionUser = null;
    });

    it('publishes results, permits the owner to request and track a regrade, and denies another student', async () => {
        process.env.STUDENT_RESULTS_ENABLED = 'true';

        professor = await User.create({
            name: 'Professor Workflow',
            email: 'professor-ae198@example.edu',
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        ta = await User.create({
            name: 'TA Workflow',
            email: 'ta-ae198@example.edu',
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });
        student = await User.create({
            name: 'Student Workflow',
            email: 'student-ae198@example.edu',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true
        });
        otherStudent = await User.create({
            name: 'Other Student Workflow',
            email: 'other-student-ae198@example.edu',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true
        });

        const course = await Course.create({
            courseCode: 'CS198',
            courseName: 'Workflow Testing',
            academicYear: '2026',
            semester: 1,
            professor: professor._id,
            enrolledStudents: [student._id, otherStudent._id],
            teachingAssistants: [ta._id],
            isActive: true
        });
        exam = await Exam.create({
            title: 'Workflow Midterm',
            course: course._id,
            createdBy: professor._id,
            examDate: new Date('2026-10-20'),
            totalMarks: 10,
            numberOfQuestions: 1,
            status: ExamStatus.REVIEW_PENDING,
            isActive: true,
            regradeWindowOpensAt: new Date(Date.now() - 60_000),
            regradeWindowClosesAt: new Date(Date.now() + 60 * 60_000)
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
        exam.rubric = rubric._id;
        await exam.save();

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
        await Grade.create({
            answerScript: script._id,
            gradedBy: ta._id,
            question: undefined,
            totalScore: 8,
            isFinal: true,
            rubric: rubric._id,
            marksAwarded: [{ criterionName: 'Accuracy', score: 8 }]
        });

        mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };
        const beforePublication = await getResults();
        expect(beforePublication.status).toBe(200);
        expect((await beforePublication.json()).data).toEqual([]);

        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };
        const publishResponse = await publishExam(
            new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, { method: 'POST' }),
            { params: Promise.resolve({ id: exam._id.toString() }) }
        );
        expect(publishResponse.status).toBe(200);
        expect((await publishResponse.json()).data.status).toBe(ExamStatus.PUBLISHED);

        mockSessionUser = { id: student._id.toString(), role: UserRole.STUDENT };
        const releasedResults = await getResults();
        const releasedBody = await releasedResults.json();
        expect(releasedResults.status).toBe(200);
        expect(releasedBody.data).toHaveLength(1);
        expect(releasedBody.data[0]).toMatchObject({
            examId: exam._id.toString(),
            status: 'RELEASED',
            total: 8
        });

        const resultDetails = await getResultDetails(
            new NextRequest(`http://localhost:3000/api/student/results/${script._id}`),
            { params: Promise.resolve({ scriptId: script._id.toString() }) }
        );
        expect(resultDetails.status).toBe(200);

        const requestResponse = await postRegradeRequest(
            new NextRequest('http://localhost:3000/api/student/regrade-requests', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    scriptId: script._id.toString(),
                    questionNumber: 1,
                    reason: 'Please review the accuracy criterion for my answer.'
                })
            })
        );
        expect(requestResponse.status).toBe(201);
        const createdRequest = await requestResponse.json();
        expect(createdRequest.data).toMatchObject({
            examId: exam._id.toString(),
            questionNumber: 1,
            status: 'open'
        });

        const ownRequests = await getRegradeRequests();
        expect((await ownRequests.json()).data).toMatchObject([
            { id: createdRequest.data.id, status: 'open' }
        ]);

        mockSessionUser = { id: otherStudent._id.toString(), role: UserRole.STUDENT };
        const otherStudentResults = await getResults();
        const otherStudentResultBody = await otherStudentResults.json();
        expect(otherStudentResultBody.data).toMatchObject([
            { examId: exam._id.toString(), status: 'NOT_AVAILABLE' }
        ]);
        expect(otherStudentResultBody.data[0]).not.toHaveProperty('scriptId');
        expect(otherStudentResultBody.data[0]).not.toHaveProperty('total');

        const deniedResultDetails = await getResultDetails(
            new NextRequest(`http://localhost:3000/api/student/results/${script._id}`),
            { params: Promise.resolve({ scriptId: script._id.toString() }) }
        );
        expect(deniedResultDetails.status).toBe(404);

        const otherStudentRequests = await getRegradeRequests();
        expect((await otherStudentRequests.json()).data).toEqual([]);

        const deniedRequest = await postRegradeRequest(
            new NextRequest('http://localhost:3000/api/student/regrade-requests', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    scriptId: script._id.toString(),
                    questionNumber: 1,
                    reason: 'Attempt to access another student request.'
                })
            })
        );
        expect(deniedRequest.status).toBe(404);
        expect(await RegradeRequest.countDocuments()).toBe(1);
    });
});
