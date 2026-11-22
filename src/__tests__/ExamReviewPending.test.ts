import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import Course, { ICourse } from '../models/Course';
import Exam, { ExamStatus, IExam } from '../models/Exam';
import User, { IUser, UserRole } from '../models/User';
import AuditLog from '../models/AuditLog';
import { isValidTransition } from '../validations/examValidation';

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

describe('Exam Review Pending Flow', () => {
    let reviewPendingPOST: typeof import('../app/api/exams/[id]/review-pending/route').POST;

    let professor!: IUser;
    let assignedTa!: IUser;
    let unassignedTa!: IUser;
    let course!: ICourse;
    let exam!: IExam;

    beforeAll(async () => {
        reviewPendingPOST = (await import('../app/api/exams/[id]/review-pending/route')).POST;
    });

    afterEach(() => {
        mockSessionUser = null;
    });

    beforeEach(async () => {
        professor = await User.create({
            name: 'Prof Ramanujan',
            email: `prof-${Date.now()}@example.edu`,
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true,
        });

        assignedTa = await User.create({
            name: 'TA Aryabhata',
            email: `ta-${Date.now()}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true,
        });

        unassignedTa = await User.create({
            name: 'TA Brahmagupta',
            email: `unassigned-ta-${Date.now()}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true,
        });

        course = await Course.create({
            courseCode: `CS-${Date.now()}`,
            courseName: 'Algorithms',
            semester: 1,
            academicYear: '2026-2027',
            professor: professor._id,
            teachingAssistants: [assignedTa._id],
            isActive: true,
        });

        exam = await Exam.create({
            title: 'Midterm Algorithms',
            course: course._id,
            examDate: new Date(),
            totalMarks: 50,
            numberOfQuestions: 5,
            status: ExamStatus.DRAFT,
            createdBy: professor._id,
            isActive: true,
        });
    });

    it('validates status state transitions correctly', () => {
        expect(isValidTransition(ExamStatus.DRAFT, ExamStatus.REVIEW_PENDING)).toBe(true);
        expect(isValidTransition(ExamStatus.EVALUATING, ExamStatus.REVIEW_PENDING)).toBe(true);
        expect(isValidTransition(ExamStatus.REVIEW_PENDING, ExamStatus.PUBLISHED)).toBe(true);
    });

    it('allows an assigned TA to mark exam as review pending', async () => {
        mockSessionUser = {
            id: (assignedTa._id as mongoose.Types.ObjectId).toString(),
            role: UserRole.TA,
        };

        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/review-pending`, {
            method: 'POST',
        });

        const res = await reviewPendingPOST(req, {
            params: Promise.resolve({ id: (exam._id as mongoose.Types.ObjectId).toString() }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.data.status).toBe(ExamStatus.REVIEW_PENDING);

        const updatedExam = await Exam.findById(exam._id);
        expect(updatedExam?.status).toBe(ExamStatus.REVIEW_PENDING);

        const audit = await AuditLog.findOne({
            entityId: exam._id,
            action: 'EXAM_STATUS_UPDATED',
        });
        expect(audit).toBeDefined();
        expect(audit?.details?.newStatus).toBe(ExamStatus.REVIEW_PENDING);
    });

    it('denies an unassigned TA from setting review pending', async () => {
        mockSessionUser = {
            id: (unassignedTa._id as mongoose.Types.ObjectId).toString(),
            role: UserRole.TA,
        };

        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/review-pending`, {
            method: 'POST',
        });

        const res = await reviewPendingPOST(req, {
            params: Promise.resolve({ id: (exam._id as mongoose.Types.ObjectId).toString() }),
        });

        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.success).toBe(false);

        const unchangedExam = await Exam.findById(exam._id);
        expect(unchangedExam?.status).toBe(ExamStatus.DRAFT);
    });

    it('allows professor of the course to set review pending', async () => {
        mockSessionUser = {
            id: (professor._id as mongoose.Types.ObjectId).toString(),
            role: UserRole.PROFESSOR,
        };

        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/review-pending`, {
            method: 'POST',
        });

        const res = await reviewPendingPOST(req, {
            params: Promise.resolve({ id: (exam._id as mongoose.Types.ObjectId).toString() }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.data.status).toBe(ExamStatus.REVIEW_PENDING);
    });

    it('is idempotent if exam is already in REVIEW_PENDING', async () => {
        await Exam.findByIdAndUpdate(exam._id, { status: ExamStatus.REVIEW_PENDING });

        mockSessionUser = {
            id: (assignedTa._id as mongoose.Types.ObjectId).toString(),
            role: UserRole.TA,
        };

        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/review-pending`, {
            method: 'POST',
        });

        const res = await reviewPendingPOST(req, {
            params: Promise.resolve({ id: (exam._id as mongoose.Types.ObjectId).toString() }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(data.data.status).toBe(ExamStatus.REVIEW_PENDING);
    });
});
