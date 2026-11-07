import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
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

describe('AE-202 professor regrade queue', () => {
    let getRequests: typeof import('../app/api/professor/regrade-requests/route').GET;

    beforeAll(async () => {
        getRequests = (await import('../app/api/professor/regrade-requests/route')).GET;
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
        const grade = await Grade.create({
            answerScript: script._id,
            rubric: rubric._id,
            gradedBy: professor._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Accuracy', score: 7, feedback: 'Review the derivation.' }],
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

        return { professor, otherProfessor, student, exam, script, grade, regrade };
    }

    function get(url: string) {
        return getRequests(new NextRequest(url));
    }

    it('returns request details and the existing evaluation only to the owning professor', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };

        const response = await get('http://localhost:3000/api/professor/regrade-requests');
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.data.requests).toHaveLength(1);
        expect(payload.data.requests[0]).toMatchObject({
            exam: { id: fixture.exam._id.toString(), title: fixture.exam.title },
            answerScriptId: fixture.script._id.toString(),
            questionNumber: 1,
            student: { name: fixture.student.name, email: fixture.student.email },
            reason: fixture.regrade.reason,
            evaluation: {
                score: 7,
                maxMarks: 10,
                criteria: [{ name: 'Accuracy', score: 7, feedback: 'Review the derivation.' }]
            }
        });
        expect(JSON.stringify(payload)).not.toContain('Password@123');
        expect(payload.data.requests[0].evaluation.score).toBe(fixture.grade.totalScore);
    });

    it('does not expose another professor’s request, even with its exam ID', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.otherProfessor._id.toString(), role: UserRole.PROFESSOR };

        const response = await get(`http://localhost:3000/api/professor/regrade-requests?examId=${fixture.exam._id}`);

        expect(response.status).toBe(404);
        expect((await response.json()).data).toBeNull();
    });

    it('rejects TA access and validates queue filters', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };

        const invalidFilter = await get('http://localhost:3000/api/professor/regrade-requests?status=INVALID');
        expect(invalidFilter.status).toBe(400);

        mockSessionUser = { id: fixture.student._id.toString(), role: UserRole.STUDENT };
        const studentResponse = await get('http://localhost:3000/api/professor/regrade-requests');
        expect(studentResponse.status).toBe(403);
    });
});
