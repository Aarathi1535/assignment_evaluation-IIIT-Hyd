import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';

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

describe('AE-206 audit log query API', () => {
    let getAuditLogs: typeof import('../app/api/audit-logs/route').GET;

    beforeAll(async () => {
        getAuditLogs = (await import('../app/api/audit-logs/route')).GET;
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
        const actor = await User.create({
            name: 'TA Actor',
            email: `ta-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
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
            teachingAssistants: [actor._id],
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
        const otherCourse = await Course.create({
            courseCode: `CS2-${suffix}`,
            courseName: 'Databases',
            academicYear: '2026',
            semester: 1,
            professor: otherProfessor._id,
            enrolledStudents: [student._id],
            teachingAssistants: [],
            isActive: true
        });
        const otherExam = await Exam.create({
            title: 'Final',
            course: otherCourse._id,
            createdBy: otherProfessor._id,
            examDate: new Date(),
            totalMarks: 10,
            numberOfQuestions: 1,
            status: ExamStatus.PUBLISHED,
            isActive: true
        });
        const scriptId = new mongoose.Types.ObjectId();

        await AuditLog.create([
            {
                user: actor._id,
                action: 'EXAM_UPDATED',
                outcome: 'SUCCESS',
                entityId: exam._id,
                entityType: 'Exam',
                details: { before: { title: 'Midterm' }, after: { title: 'Midterm 1' } }
            },
            {
                user: actor._id,
                action: 'GRADE_FINALIZED',
                outcome: 'SUCCESS',
                entityId: scriptId,
                entityType: 'Grade',
                details: {
                    examId: exam._id.toString(),
                    before: { score: 6 },
                    after: { score: 8 },
                    storageKey: 'private-storage-location'
                }
            },
            {
                user: student._id,
                action: 'EXAM_UPDATED',
                outcome: 'SUCCESS',
                entityId: otherExam._id,
                entityType: 'Exam'
            }
        ]);

        return { professor, otherProfessor, actor, exam, otherExam };
    }

    function get(url: string) {
        return getAuditLogs(new NextRequest(url));
    }

    it('filters by owned exam and actor, paginates safely, and returns target metadata', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };

        const response = await get(
            `http://localhost:3000/api/audit-logs?examId=${fixture.exam._id}&userId=${fixture.actor._id}&page=1&limit=1`
        );
        const payload = await response.json();

        expect(response.status).toBe(200);
        expect(payload.data).toMatchObject({ page: 1, limit: 1, total: 2, totalPages: 2 });
        expect(payload.data.logs).toHaveLength(1);
        expect(payload.data.logs[0]).toMatchObject({
            actor: { id: fixture.actor._id.toString(), name: fixture.actor.name, role: UserRole.TA },
            action: expect.any(String),
            target: { id: expect.any(String), type: expect.any(String) },
            timestamp: expect.any(String)
        });
        expect(JSON.stringify(payload)).not.toContain('private-storage-location');

        const secondPage = await get(
            `http://localhost:3000/api/audit-logs?examId=${fixture.exam._id}&userId=${fixture.actor._id}&page=2&limit=1`
        );
        expect((await secondPage.json()).data.logs).toHaveLength(1);
    });

    it('requires professors to query an owned exam and rejects invalid filters', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };

        expect((await get('http://localhost:3000/api/audit-logs')).status).toBe(400);
        expect((await get('http://localhost:3000/api/audit-logs?examId=invalid')).status).toBe(400);

        const unauthorizedExam = await get(`http://localhost:3000/api/audit-logs?examId=${fixture.otherExam._id}`);
        expect(unauthorizedExam.status).toBe(404);
    });

    it('denies roles without audit access and supports admin exam queries', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.actor._id.toString(), role: UserRole.TA };
        expect((await get(`http://localhost:3000/api/audit-logs?examId=${fixture.exam._id}`)).status).toBe(403);

        const admin = await User.create({
            name: 'Admin',
            email: `admin-${Date.now()}-${Math.random()}@example.edu`,
            password: 'Password@123',
            role: UserRole.ADMIN,
            isActive: true
        });
        mockSessionUser = { id: admin._id.toString(), role: UserRole.ADMIN };
        const response = await get(`http://localhost:3000/api/audit-logs?examId=${fixture.exam._id}`);
        expect(response.status).toBe(200);
        expect((await response.json()).data.total).toBe(2);
    });
});
