/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import mongoose from 'mongoose';
import Exam, { ExamStatus } from '../models/Exam';
import Course from '../models/Course';
import User, { UserRole } from '../models/User';
import StudentMapping from '../models/StudentMapping';
import AnswerScript from '../models/AnswerScript';
import Grade from '../models/Grade';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AuditLog from '../models/AuditLog';
import * as apiAuth from '../lib/apiAuth';
import { Permission } from '../constants/permissions';
import { NextResponse } from 'next/server';

describe('AE-091: Per-Exam Blind-Grading Toggle Tests', () => {
    let routePOST: any;
    let profUser: any;
    let taUser: any;
    let studentUser: any;
    let course: any;
    let exam: any;
    let studentMapping: any;

    beforeAll(async () => {
        await Exam.init();
        await Course.init();
        await User.init();
        await StudentMapping.init();
        await AnswerScript.init();
        await Grade.init();
        await Allocation.init();
        await AuditLog.init();

        routePOST = (await import('../app/api/exams/[id]/blind-grading/route')).POST;
    });

    beforeEach(async () => {
        // Clear collections
        await AuditLog.deleteMany({});
        await Allocation.deleteMany({});
        await Grade.deleteMany({});
        await AnswerScript.deleteMany({});
        await StudentMapping.deleteMany({});
        await Exam.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});

        // Create Users
        profUser = await User.create({
            name: 'Professor Snape',
            email: 'snape@hogwarts.edu',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        taUser = await User.create({
            name: 'Hermione Granger',
            email: 'hermione@hogwarts.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        studentUser = await User.create({
            name: 'Harry Potter',
            email: 'harry@hogwarts.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        course = await Course.create({
            courseCode: 'POTIONS-101',
            courseName: 'Intro to Potions',
            semester: 1,
            academicYear: '2026',
            professor: profUser._id,
            enrolledStudents: [studentUser._id],
            isActive: true
        });

        // Exam
        exam = await Exam.create({
            title: 'Potions Midterm',
            course: course._id,
            createdBy: profUser._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 4,
            enrolledStudents: [studentUser._id],
            blindGrading: false,
            isActive: true
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should allow an authorized professor to enable blind grading before grading starts', async () => {
        vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: true,
            user: {
                id: profUser._id.toString(),
                name: profUser.name,
                email: profUser.email,
                role: UserRole.PROFESSOR
            }
        } as any);

        const req = new Request(`http://localhost:3000/api/exams/${exam._id.toString()}/blind-grading`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blindGrading: true })
        });

        const context = { params: Promise.resolve({ id: exam._id.toString() }) };
        const res = await routePOST(req as any, context);

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.data.blindGrading).toBe(true);
        expect(data.data.changed).toBe(true);

        // Verify DB update
        const updatedExam = await Exam.findById(exam._id);
        expect(updatedExam!.blindGrading).toBe(true);

        // Verify exactly one AuditLog entry exists
        const audits = await AuditLog.find({ entityId: exam._id });
        expect(audits.length).toBe(1);
        const audit = audits[0]!;
        expect(audit.action).toBe('EXAM_BLIND_GRADING_TOGGLED');
        expect(audit.outcome).toBe('SUCCESS');
        expect(audit.details?.previousValue).toBe(false);
        expect(audit.details?.newValue).toBe(true);
        expect(audit.user.toString()).toBe(profUser._id.toString());
    });

    it('should allow an authorized professor to disable blind grading before grading starts', async () => {
        // Set blindGrading to true first
        exam.blindGrading = true;
        await exam.save();

        vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: true,
            user: {
                id: profUser._id.toString(),
                name: profUser.name,
                email: profUser.email,
                role: UserRole.PROFESSOR
            }
        } as any);

        const req = new Request(`http://localhost:3000/api/exams/${exam._id.toString()}/blind-grading`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blindGrading: false })
        });

        const context = { params: Promise.resolve({ id: exam._id.toString() }) };
        const res = await routePOST(req as any, context);

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.data.blindGrading).toBe(false);
        expect(data.data.changed).toBe(true);

        // Verify DB update
        const updatedExam = await Exam.findById(exam._id);
        expect(updatedExam!.blindGrading).toBe(false);

        // Verify exactly one AuditLog entry exists
        const audits = await AuditLog.find({ entityId: exam._id });
        expect(audits.length).toBe(1);
        const audit = audits[0]!;
        expect(audit.details?.previousValue).toBe(true);
        expect(audit.details?.newValue).toBe(false);
    });

    it('should reject unauthorized user (e.g. role/permissions match fails)', async () => {
        vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: false,
            response: NextResponse.json({
                success: false,
                message: 'Unauthorized'
            }, { status: 403 })
        } as any);

        const req = new Request(`http://localhost:3000/api/exams/${exam._id.toString()}/blind-grading`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blindGrading: true })
        });

        const context = { params: Promise.resolve({ id: exam._id.toString() }) };
        const res = await routePOST(req as any, context);

        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.success).toBe(false);

        // Verify DB remains unchanged
        const dbExam = await Exam.findById(exam._id);
        expect(dbExam!.blindGrading).toBe(false);

        // Verify no audit log
        const audits = await AuditLog.find({ entityId: exam._id });
        expect(audits.length).toBe(0);
    });

    it('should reject unauthenticated request', async () => {
        vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: false,
            response: NextResponse.json({
                success: false,
                message: 'Unauthenticated'
            }, { status: 401 })
        } as any);

        const req = new Request(`http://localhost:3000/api/exams/${exam._id.toString()}/blind-grading`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blindGrading: true })
        });

        const context = { params: Promise.resolve({ id: exam._id.toString() }) };
        const res = await routePOST(req as any, context);

        expect(res.status).toBe(401);
    });

    it('should reject invalid exam ID formats with 400', async () => {
        vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: true,
            user: { id: profUser._id.toString(), role: UserRole.PROFESSOR }
        } as any);

        const req = new Request(`http://localhost:3000/api/exams/invalid-id/blind-grading`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blindGrading: true })
        });

        const context = { params: Promise.resolve({ id: 'invalid-id' }) };
        const res = await routePOST(req as any, context);

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.message).toContain('Invalid Exam ID format');
    });

    it('should reject missing or non-boolean blindGrading parameter with 400', async () => {
        vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: true,
            user: { id: profUser._id.toString(), role: UserRole.PROFESSOR }
        } as any);

        const req = new Request(`http://localhost:3000/api/exams/${exam._id.toString()}/blind-grading`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blindGrading: 'not-a-boolean' })
        });

        const context = { params: Promise.resolve({ id: exam._id.toString() }) };
        const res = await routePOST(req as any, context);

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.message).toContain('blindGrading must be explicitly a boolean');
    });

    it('should return 404 for nonexistent exam', async () => {
        vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: true,
            user: { id: profUser._id.toString(), role: UserRole.PROFESSOR }
        } as any);

        const fakeId = new mongoose.Types.ObjectId().toString();
        const req = new Request(`http://localhost:3000/api/exams/${fakeId}/blind-grading`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blindGrading: true })
        });

        const context = { params: Promise.resolve({ id: fakeId }) };
        const res = await routePOST(req as any, context);

        expect(res.status).toBe(404);
    });

    it('should reject toggle when an allocation is IN_PROGRESS', async () => {
        // Create an allocation that is IN_PROGRESS
        await Allocation.create({
            exam: exam._id,
            ta: taUser._id,
            allocatedBy: profUser._id,
            answerScript: new mongoose.Types.ObjectId(),
            status: AllocationStatus.IN_PROGRESS,
            rule: AllocationRule.EQUAL
        });

        vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: true,
            user: { id: profUser._id.toString(), role: UserRole.PROFESSOR }
        } as any);

        const req = new Request(`http://localhost:3000/api/exams/${exam._id.toString()}/blind-grading`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blindGrading: true })
        });

        const context = { params: Promise.resolve({ id: exam._id.toString() }) };
        const res = await routePOST(req as any, context);

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.message).toContain('grading has already commenced');

        // Verify DB was NOT updated
        const dbExam = await Exam.findById(exam._id);
        expect(dbExam!.blindGrading).toBe(false);

        // Verify no audit log
        const audits = await AuditLog.find({ entityId: exam._id });
        expect(audits.length).toBe(0);
    });

    it('should reject toggle when an allocation is COMPLETED', async () => {
        // Create an allocation that is COMPLETED
        await Allocation.create({
            exam: exam._id,
            ta: taUser._id,
            allocatedBy: profUser._id,
            answerScript: new mongoose.Types.ObjectId(),
            status: AllocationStatus.COMPLETED,
            rule: AllocationRule.EQUAL
        });

        vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: true,
            user: { id: profUser._id.toString(), role: UserRole.PROFESSOR }
        } as any);

        const req = new Request(`http://localhost:3000/api/exams/${exam._id.toString()}/blind-grading`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blindGrading: true })
        });

        const context = { params: Promise.resolve({ id: exam._id.toString() }) };
        const res = await routePOST(req as any, context);

        expect(res.status).toBe(400);
        expect(res.statusText || 'Bad Request').toBeDefined();
    });

    it('should reject toggle when a Grade already exists', async () => {
        // Create script
        const script = await AnswerScript.create({
            exam: exam._id,
            student: studentUser._id,
            filePath: '/scans/potions/script1.pdf',
            filename: 'script1.pdf',
            isActive: true
        });

        // Create Grade
        await Grade.create({
            answerScript: script._id,
            rubric: new mongoose.Types.ObjectId(),
            gradedBy: taUser._id,
            marksAwarded: [
                { criterionName: 'Accuracy', score: 10, feedback: 'Great.' }
            ],
            totalScore: 10,
            feedback: 'Perfect',
            isFinal: false,
            question: 0
        });

        vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: true,
            user: { id: profUser._id.toString(), role: UserRole.PROFESSOR }
        } as any);

        const req = new Request(`http://localhost:3000/api/exams/${exam._id.toString()}/blind-grading`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blindGrading: true })
        });

        const context = { params: Promise.resolve({ id: exam._id.toString() }) };
        const res = await routePOST(req as any, context);

        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.message).toContain('grades already exist');

        // Verify DB was NOT updated
        const dbExam = await Exam.findById(exam._id);
        expect(dbExam!.blindGrading).toBe(false);

        // Verify no audit log
        const audits = await AuditLog.find({ entityId: exam._id });
        expect(audits.length).toBe(0);
    });

    it('should treat no-op request as success but skip modifications and skip creating audit entry', async () => {
        vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
            authorized: true,
            user: { id: profUser._id.toString(), role: UserRole.PROFESSOR }
        } as any);

        // Already false, requesting false
        const req = new Request(`http://localhost:3000/api/exams/${exam._id.toString()}/blind-grading`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blindGrading: false })
        });

        const context = { params: Promise.resolve({ id: exam._id.toString() }) };
        const res = await routePOST(req as any, context);

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.data.changed).toBe(false);

        // Verify no audit log entry is created
        const audits = await AuditLog.find({ entityId: exam._id });
        expect(audits.length).toBe(0);
    });
});
