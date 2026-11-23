import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import User from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import { UserRole } from '../constants/permissions';
import { isValidTransition } from '../validations/examValidation';

let mockSessionUser: any = null;

vi.mock('next-auth', () => {
    return {
        getServerSession: vi.fn(() => {
            if (!mockSessionUser) return Promise.resolve(null);
            return Promise.resolve({ user: mockSessionUser });
        }),
    };
});

describe('Exam Review Pending & Publish Workflow', () => {
    let reviewPendingPOST: any;
    let publishPOST: any;
    let prof: any;
    let ta: any;
    let student: any;
    let course: any;
    let exam: any;

    beforeAll(async () => {
        reviewPendingPOST = (await import('../app/api/exams/[id]/review-pending/route')).POST;
        publishPOST = (await import('../app/api/exams/[id]/publish/route')).POST;
    });

    beforeEach(async () => {
        process.env.STUDENT_RESULTS_ENABLED = 'true';

        await Course.deleteMany({});
        await Exam.deleteMany({});
        await User.deleteMany({});
        await Rubric.deleteMany({});

        prof = await User.create({
            name: 'Prof Ramanujan',
            email: 'ramanujan@iiit.ac.in',
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true,
        });

        ta = await User.create({
            name: 'TA Aryabhata',
            email: 'aryabhata@iiit.ac.in',
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true,
        });

        student = await User.create({
            name: 'Student Bhaskara',
            email: 'bhaskara@iiit.ac.in',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        course = await Course.create({
            courseCode: 'CS301',
            courseName: 'Algorithms',
            semester: 1,
            academicYear: '2026-2027',
            professor: prof._id,
            teachingAssistants: [ta._id],
            isActive: true,
        });

        exam = await Exam.create({
            title: 'Midterm Algorithms',
            course: course._id,
            examDate: new Date(),
            totalMarks: 50,
            numberOfQuestions: 2,
            status: ExamStatus.DRAFT,
            createdBy: prof._id,
            isActive: true,
        });

        await Rubric.create({
            exam: exam._id,
            scoreStep: 1,
            version: 1,
            createdBy: prof._id,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 25,
                    criteria: [{ criterionName: 'Perfect', points: 25, description: 'Fully correct' }],
                },
                {
                    questionNumber: 2,
                    maxMarks: 25,
                    criteria: [{ criterionName: 'Perfect', points: 25, description: 'Fully correct' }],
                },
            ],
            isActive: true,
        });
    });

    it('validates status transition from DRAFT to REVIEW_PENDING', () => {
        expect(isValidTransition(ExamStatus.DRAFT, ExamStatus.REVIEW_PENDING)).toBe(true);
        expect(isValidTransition(ExamStatus.EVALUATING, ExamStatus.REVIEW_PENDING)).toBe(true);
        expect(isValidTransition(ExamStatus.REVIEW_PENDING, ExamStatus.PUBLISHED)).toBe(true);
    });

    it('allows TA to submit exam for review (transition to REVIEW_PENDING)', async () => {
        mockSessionUser = {
            id: ta._id.toString(),
            email: ta.email,
            role: UserRole.TA,
        };

        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/review-pending`, {
            method: 'POST',
        });

        const res = await reviewPendingPOST(req, {
            params: Promise.resolve({ id: exam._id.toString() }),
        });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.status).toBe(ExamStatus.REVIEW_PENDING);

        const updatedExam = await Exam.findById(exam._id);
        expect(updatedExam!.status).toBe(ExamStatus.REVIEW_PENDING);
    });

    it('rejects student from calling review-pending endpoint', async () => {
        mockSessionUser = {
            id: student._id.toString(),
            email: student.email,
            role: UserRole.STUDENT,
        };

        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/review-pending`, {
            method: 'POST',
        });

        const res = await reviewPendingPOST(req, {
            params: Promise.resolve({ id: exam._id.toString() }),
        });

        expect(res.status).toBe(403);
    });

    it('allows professor to publish exam when exam is in REVIEW_PENDING', async () => {
        // Set exam to REVIEW_PENDING
        exam.status = ExamStatus.REVIEW_PENDING;
        await exam.save();

        mockSessionUser = {
            id: prof._id.toString(),
            email: prof.email,
            role: UserRole.PROFESSOR,
        };

        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST',
        });

        const res = await publishPOST(req, {
            params: Promise.resolve({ id: exam._id.toString() }),
        });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.success).toBe(true);
        expect(body.data.status).toBe(ExamStatus.PUBLISHED);

        const publishedExam = await Exam.findById(exam._id);
        expect(publishedExam!.status).toBe(ExamStatus.PUBLISHED);
    });
});
