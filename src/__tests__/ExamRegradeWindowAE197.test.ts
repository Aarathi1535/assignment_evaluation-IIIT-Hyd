import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import AuditLog from '../models/AuditLog';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { IUser, UserRole } from '../models/User';
import { isRegradeWindowOpen } from '../utils/regradeWindow';

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

describe('AE-197: Per-exam regrade window configuration', () => {
    let updateWindowPUT: typeof import('../app/api/exams/[id]/regrade-window/route').PUT;
    let getWindowGET: typeof import('../app/api/exams/[id]/regrade-window/route').GET;
    let professor!: IUser;
    let otherProfessor!: IUser;
    let ta!: IUser;
    let examId!: string;

    beforeAll(async () => {
        updateWindowPUT = (await import('../app/api/exams/[id]/regrade-window/route')).PUT;
        getWindowGET = (await import('../app/api/exams/[id]/regrade-window/route')).GET;
    });

    afterEach(() => {
        mockSessionUser = null;
    });

    async function createExam() {
        professor = await User.create({
            name: 'Professor Turing',
            email: 'turing197@example.edu',
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        otherProfessor = await User.create({
            name: 'Professor Lovelace',
            email: 'lovelace197@example.edu',
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });
        ta = await User.create({
            name: 'TA Hopper',
            email: 'hopper197@example.edu',
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });
        const course = await Course.create({
            courseCode: 'CS197',
            courseName: 'Algorithms',
            semester: 1,
            academicYear: '2026',
            professor: professor._id,
            teachingAssistants: [ta._id],
            enrolledStudents: [],
            isActive: true
        });
        const exam = await Exam.create({
            title: 'AE-197 Exam',
            course: course._id,
            createdBy: professor._id,
            examDate: new Date('2026-10-15'),
            totalMarks: 20,
            numberOfQuestions: 1,
            status: ExamStatus.REVIEW_PENDING,
            isActive: true
        });
        examId = exam._id.toString();
    }

    async function updateWindow(
        body: unknown,
        id = examId
    ) {
        const request = new NextRequest(`http://localhost:3000/api/exams/${id}/regrade-window`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
        });
        return updateWindowPUT(request, { params: Promise.resolve({ id }) });
    }

    it('persists and audits a valid window for the exam owner', async () => {
        await createExam();
        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };

        const opensAt = '2026-11-03T10:00:00.000Z';
        const closesAt = '2026-11-10T10:00:00.000Z';
        const response = await updateWindow({
            regradeWindowOpensAt: opensAt,
            regradeWindowClosesAt: closesAt
        });
        const body = await response.json();

        expect(response.status).toBe(200);
        expect(body.data.regradeWindowOpensAt).toBe(opensAt);
        expect(body.data.regradeWindowClosesAt).toBe(closesAt);
        const savedExam = await Exam.findById(examId);
        expect(savedExam?.regradeWindowOpensAt?.toISOString()).toBe(opensAt);
        expect(savedExam?.regradeWindowClosesAt?.toISOString()).toBe(closesAt);

        const audit = await AuditLog.findOne({
            action: 'EXAM_REGRADE_WINDOW_UPDATED',
            entityId: examId
        });
        expect(audit?.user.toString()).toBe(professor._id.toString());
        expect(audit?.outcome).toBe('SUCCESS');
        expect(audit?.details).toMatchObject({
            opensAt: savedExam?.regradeWindowOpensAt,
            closesAt: savedExam?.regradeWindowClosesAt
        });
    });

    it('fetches regrade window via GET route', async () => {
        await createExam();
        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };

        await updateWindow({
            regradeWindowOpensAt: '2026-11-03T10:00:00.000Z',
            regradeWindowClosesAt: '2026-11-10T10:00:00.000Z'
        });

        const req = new NextRequest(`http://localhost:3000/api/exams/${examId}/regrade-window`);
        const res = await getWindowGET(req, { params: Promise.resolve({ id: examId }) });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(new Date(body.data.regradeWindowOpensAt).toISOString()).toBe('2026-11-03T10:00:00.000Z');
        expect(new Date(body.data.regradeWindowClosesAt).toISOString()).toBe('2026-11-10T10:00:00.000Z');
    });

    it('rejects invalid timestamps and invalid or incomplete ranges', async () => {
        await createExam();
        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };

        const invalidDate = await updateWindow({
            regradeWindowOpensAt: 'not-a-date',
            regradeWindowClosesAt: '2026-11-10T10:00:00.000Z'
        });
        expect(invalidDate.status).toBe(400);

        const reversed = await updateWindow({
            regradeWindowOpensAt: '2026-11-10T10:00:00.000Z',
            regradeWindowClosesAt: '2026-11-03T10:00:00.000Z'
        });
        expect(reversed.status).toBe(400);

        const incomplete = await updateWindow({
            regradeWindowOpensAt: '2026-11-03T10:00:00.000Z',
            regradeWindowClosesAt: null
        });
        expect(incomplete.status).toBe(400);
        expect((await Exam.findById(examId))?.regradeWindowOpensAt).toBeNull();
        expect(await AuditLog.countDocuments({ action: 'EXAM_REGRADE_WINDOW_UPDATED' })).toBe(0);
    });

    it('allows clearing a configured window as a pair', async () => {
        await createExam();
        await Exam.updateOne(
            { _id: examId },
            {
                $set: {
                    regradeWindowOpensAt: new Date('2026-11-03T10:00:00.000Z'),
                    regradeWindowClosesAt: new Date('2026-11-10T10:00:00.000Z')
                }
            }
        );
        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };

        expect((await updateWindow({
            regradeWindowOpensAt: null,
            regradeWindowClosesAt: null
        })).status).toBe(200);
        const savedExam = await Exam.findById(examId);
        expect(savedExam?.regradeWindowOpensAt).toBeNull();
        expect(savedExam?.regradeWindowClosesAt).toBeNull();
    });

    it('denies TAs and professors who do not own the exam', async () => {
        await createExam();
        const body = {
            regradeWindowOpensAt: '2026-11-03T10:00:00.000Z',
            regradeWindowClosesAt: '2026-11-10T10:00:00.000Z'
        };
        mockSessionUser = { id: ta._id.toString(), role: UserRole.TA };
        expect((await updateWindow(body)).status).toBe(403);

        mockSessionUser = { id: otherProfessor._id.toString(), role: UserRole.PROFESSOR };
        expect((await updateWindow(body)).status).toBe(404);
        expect((await Exam.findById(examId))?.regradeWindowOpensAt).toBeNull();
    });

    it('treats opening and closing instants as inclusive and leaves missing windows closed', () => {
        const opensAt = new Date('2026-11-03T10:00:00.000Z');
        const closesAt = new Date('2026-11-10T10:00:00.000Z');
        const window = { regradeWindowOpensAt: opensAt, regradeWindowClosesAt: closesAt };

        expect(isRegradeWindowOpen(window, opensAt)).toBe(true);
        expect(isRegradeWindowOpen(window, closesAt)).toBe(true);
        expect(isRegradeWindowOpen(window, new Date('2026-11-03T09:59:59.999Z'))).toBe(false);
        expect(isRegradeWindowOpen(window, new Date('2026-11-10T10:00:00.001Z'))).toBe(false);
        expect(isRegradeWindowOpen({ regradeWindowOpensAt: opensAt }, opensAt)).toBe(false);
    });
});

