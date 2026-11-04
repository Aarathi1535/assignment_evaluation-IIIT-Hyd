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

describe('AE-209 audit CSV export', () => {
    let exportAuditLogs: typeof import('../app/api/audit-logs/export/route').GET;

    beforeAll(async () => {
        exportAuditLogs = (await import('../app/api/audit-logs/export/route')).GET;
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
            name: '=HYPERLINK("https://example.invalid","Actor")',
            email: `actor-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });
        const course = await Course.create({
            courseCode: `CS-${suffix}`,
            courseName: 'Algorithms',
            academicYear: '2026',
            semester: 1,
            professor: professor._id,
            enrolledStudents: [],
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
        const unrelatedTarget = new mongoose.Types.ObjectId();
        await AuditLog.create([
            {
                user: actor._id,
                action: '=HYPERLINK("https://example.invalid","Action")',
                outcome: 'SUCCESS',
                entityId: unrelatedTarget,
                entityType: 'Grade',
                details: {
                    examId: exam._id.toString(),
                    storageKey: 'do-not-export-this-value'
                },
                createdAt: new Date('2026-01-01T10:00:00.000Z')
            },
            {
                user: actor._id,
                action: 'EXAM_UPDATED',
                outcome: 'SUCCESS',
                entityId: exam._id,
                entityType: 'Exam',
                createdAt: new Date('2026-01-01T11:00:00.000Z')
            }
        ]);
        return { professor, otherProfessor, exam };
    }

    it('streams a chronological exam CSV with safe formula escaping and no audit mutation', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };
        const countBefore = await AuditLog.countDocuments({});

        const response = await exportAuditLogs(new NextRequest(
            `http://localhost:3000/api/audit-logs/export?examId=${fixture.exam._id}`
        ));
        const csv = await response.text();

        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/csv');
        expect(response.headers.get('content-disposition')).toContain(`audit-logs-${fixture.exam._id}.csv`);
        expect(csv.startsWith('actor,actor_role,action,outcome,timestamp,target_type,target_id\r\n')).toBe(true);
        expect(csv).toContain(`"'=HYPERLINK(""https://example.invalid"",""Actor"")"`);
        expect(csv).toContain(`"'=HYPERLINK(""https://example.invalid"",""Action"")"`);
        expect(csv.indexOf('HYPERLINK')).toBeLessThan(csv.indexOf('EXAM_UPDATED'));
        expect(csv).not.toContain('do-not-export-this-value');
        expect(await AuditLog.countDocuments({})).toBe(countBefore);
    });

    it('requires a valid exam and enforces ownership and role access', async () => {
        const fixture = await createFixture();
        mockSessionUser = { id: fixture.professor._id.toString(), role: UserRole.PROFESSOR };

        expect((await exportAuditLogs(new NextRequest('http://localhost:3000/api/audit-logs/export'))).status).toBe(400);
        expect((await exportAuditLogs(new NextRequest('http://localhost:3000/api/audit-logs/export?examId=invalid'))).status).toBe(400);
        const validExport = await exportAuditLogs(new NextRequest(
            `http://localhost:3000/api/audit-logs/export?examId=${fixture.exam._id}`
        ));
        expect(validExport.status).toBe(200);
        await validExport.text();

        mockSessionUser = { id: fixture.otherProfessor._id.toString(), role: UserRole.PROFESSOR };
        const denied = await exportAuditLogs(new NextRequest(
            `http://localhost:3000/api/audit-logs/export?examId=${fixture.exam._id}`
        ));
        expect(denied.status).toBe(404);

        mockSessionUser = null;
        const unauthorized = await exportAuditLogs(new NextRequest(
            `http://localhost:3000/api/audit-logs/export?examId=${fixture.exam._id}`
        ));
        expect(unauthorized.status).toBe(401);
    });
});
