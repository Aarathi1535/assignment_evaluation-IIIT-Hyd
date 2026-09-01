/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AllocationService from '../services/AllocationService';

let mockSessionUser: any = null;

vi.mock('next-auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('next-auth')>();
    return {
        ...original,
        getServerSession: vi.fn().mockImplementation(() => {
            if (!mockSessionUser) return Promise.resolve(null);
            return Promise.resolve({ user: mockSessionUser });
        }),
    };
});

describe('AE-104b: Absolute TA Grading Pace & Deadline Bottleneck Detection', () => {
    let progressGET: any;
    let examsPOST: any;
    let examPUT: any;

    let prof: any;
    let admin: any;
    let ta1: any;
    let ta2: any;
    let ta3: any;
    let student1: any;
    let student2: any;

    let course: any;
    let exam1: any;
    let exam2: any;

    let script1: any;
    let script2: any;

    beforeAll(async () => {
        progressGET = (await import('../app/api/exams/[id]/progress/route')).GET;
        examsPOST = (await import('../app/api/exams/route')).POST;
        examPUT = (await import('../app/api/exams/[id]/route')).PUT;

        await User.init();
        await Course.init();
        await Exam.init();
        await AnswerScript.init();
        await Allocation.init();
    });

    beforeEach(async () => {
        mockSessionUser = null;

        await Allocation.deleteMany({});
        await AnswerScript.deleteMany({});
        await Exam.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});

        prof = await User.create({
            name: 'Prof. McGonagall',
            email: 'mcgonagall@hogwarts.edu',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        admin = await User.create({
            name: 'Admin Albus',
            email: 'albus@hogwarts.edu',
            password: 'password123',
            role: UserRole.ADMIN,
            isActive: true
        });

        ta1 = await User.create({
            name: 'Hermione Granger',
            email: 'hermione@hogwarts.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        ta2 = await User.create({
            name: 'Ron Weasley',
            email: 'ron@hogwarts.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        ta3 = await User.create({
            name: 'Draco Malfoy',
            email: 'draco@hogwarts.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        student1 = await User.create({
            name: 'Harry Potter',
            email: 'harry@hogwarts.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        student2 = await User.create({
            name: 'Luna Lovegood',
            email: 'luna@hogwarts.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        course = await Course.create({
            courseCode: 'TRANS101',
            courseName: 'Transfiguration 101',
            semester: 1,
            academicYear: '2026-2027',
            professor: prof._id,
            teachingAssistants: [ta1._id, ta2._id, ta3._id],
            enrolledStudents: [student1._id, student2._id],
            isActive: true
        });

        exam1 = await Exam.create({
            title: 'Midterm Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-09-01T10:00:00.000Z'),
            gradingDeadline: new Date('2026-09-11T10:00:00.000Z'),
            totalMarks: 100,
            status: ExamStatus.PUBLISHED,
            numberOfQuestions: 3,
            isActive: true
        });

        exam2 = await Exam.create({
            title: 'Final Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-10-01T10:00:00.000Z'),
            totalMarks: 100,
            status: ExamStatus.PUBLISHED,
            numberOfQuestions: 3,
            isActive: true
        });

        script1 = await AnswerScript.create({
            exam: exam1._id,
            student: student1._id,
            filePath: '/scans/trans/script1.pdf',
            filename: 'script1.pdf',
            startPageNumber: 1,
            endPageNumber: 4,
            pageCount: 4,
            candidateStudentId: 'ROLL-001',
            isActive: true
        });

        script2 = await AnswerScript.create({
            exam: exam1._id,
            student: student2._id,
            filePath: '/scans/trans/script2.pdf',
            filename: 'script2.pdf',
            startPageNumber: 5,
            endPageNumber: 8,
            pageCount: 4,
            candidateStudentId: 'ROLL-002',
            isActive: true
        });

        await AnswerScript.create({
            exam: exam2._id,
            student: student1._id,
            filePath: '/scans/trans/script3.pdf',
            filename: 'script3.pdf',
            startPageNumber: 1,
            endPageNumber: 4,
            pageCount: 4,
            candidateStudentId: 'ROLL-003',
            isActive: true
        });

        mockSessionUser = {
            id: prof._id.toString(),
            role: UserRole.PROFESSOR,
            email: prof.email
        };
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('1. Model & Validation Rules for gradingDeadline', () => {
        it('allows creating an exam with a valid gradingDeadline >= examDate', async () => {
            const req = new NextRequest('http://localhost:3000/api/exams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Valid Deadline Exam',
                    course: course._id.toString(),
                    examDate: '2026-09-01T10:00:00.000Z',
                    gradingDeadline: '2026-09-10T10:00:00.000Z',
                    totalMarks: 100,
                    numberOfQuestions: 4
                })
            });

            const res = await examsPOST(req);
            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.gradingDeadline).toBeDefined();
            expect(new Date(json.data.gradingDeadline).toISOString()).toBe('2026-09-10T10:00:00.000Z');
        });

        it('rejects exam creation when gradingDeadline is before examDate', async () => {
            const req = new NextRequest('http://localhost:3000/api/exams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Invalid Chronology Exam',
                    course: course._id.toString(),
                    examDate: '2026-09-10T10:00:00.000Z',
                    gradingDeadline: '2026-09-01T10:00:00.000Z',
                    totalMarks: 100,
                    numberOfQuestions: 4
                })
            });

            const res = await examsPOST(req);
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.message).toContain('Grading deadline cannot be before exam date');
        });

        it('rejects invalid date format for gradingDeadline', async () => {
            const req = new NextRequest('http://localhost:3000/api/exams', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    title: 'Invalid Date Format Exam',
                    course: course._id.toString(),
                    examDate: '2026-09-01T10:00:00.000Z',
                    gradingDeadline: 'not-a-date',
                    totalMarks: 100,
                    numberOfQuestions: 4
                })
            });

            const res = await examsPOST(req);
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
        });

        it('allows updating gradingDeadline before grading commences', async () => {
            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gradingDeadline: '2026-09-15T18:00:00.000Z'
                })
            });

            const res = await examPUT(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(new Date(json.data.gradingDeadline).toISOString()).toBe('2026-09-15T18:00:00.000Z');
        });

        it('freezes gradingDeadline once grading has commenced (AE-091 precedent)', async () => {
            // Create an IN_PROGRESS allocation to simulate commenced grading
            await Allocation.create({
                exam: exam1._id,
                answerScript: script1._id,
                ta: ta1._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.IN_PROGRESS
            });

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    gradingDeadline: '2026-09-20T18:00:00.000Z'
                })
            });

            const res = await examPUT(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.message).toContain('grading has already commenced');
        });
    });

    describe('2. Absolute Pace Calculation & Time Edge Cases', () => {
        it('returns paceAvailable: false with reason GRADING_DEADLINE_NOT_SET for exams without a deadline', async () => {
            // exam2 has no gradingDeadline
            const progress = await AllocationService.getProgress(exam2._id.toString());

            expect(progress.paceAvailable).toBe(false);
            expect(progress.paceReason).toBe('GRADING_DEADLINE_NOT_SET');
            expect(progress.expectedCompletionRatio).toBeUndefined();
            expect(progress.bottleneckCount).toBe(0);
        });

        it('returns paceAvailable: false with reason NO_ALLOCATIONS for exams with a deadline but zero allocations', async () => {
            // exam1 has gradingDeadline but no allocations yet
            const progress = await AllocationService.getProgress(exam1._id.toString());

            expect(progress.paceAvailable).toBe(false);
            expect(progress.paceReason).toBe('NO_ALLOCATIONS');
            expect(progress.expectedCompletionRatio).toBeUndefined();
            expect(progress.bottleneckCount).toBe(0);
        });

        it('calculates linear expected pace when midway through grading window (80% elapsed)', async () => {
            // Start: 2026-09-01T00:00:00.000Z
            // Deadline: 2026-09-11T00:00:00.000Z (Total 10 days)
            // Current simulated time: 2026-09-09T00:00:00.000Z (8 days elapsed => expected = 80%)
            const startTime = new Date('2026-09-01T00:00:00.000Z');
            const deadlineTime = new Date('2026-09-11T00:00:00.000Z');
            const simulatedNow = new Date('2026-09-09T00:00:00.000Z');

            await Exam.updateOne(
                { _id: exam1._id },
                { $set: { examDate: startTime, gradingDeadline: deadlineTime } }
            );

            // Create allocations with createdAt = startTime
            // ta1: 10/10 completed (100% vs 80% expected => not bottleneck)
            // ta2: 6/10 completed (60% vs 80% expected => diff = 20% exactly => boundary test: not bottleneck)
            // ta3: 5/10 completed (50% vs 80% expected => diff = 30% > 20% => BOTTLENECK)
            const makeAllocations = async (ta: any, completed: number, total: number) => {
                for (let i = 0; i < total; i++) {
                    await Allocation.create({
                        exam: exam1._id,
                        answerScript: script1._id,
                        ta: ta._id,
                        allocatedBy: prof._id,
                        rule: AllocationRule.QUESTION,
                        question: i + 1,
                        status: i < completed ? AllocationStatus.COMPLETED : AllocationStatus.IN_PROGRESS,
                        createdAt: startTime
                    });
                }
            };

            await makeAllocations(ta1, 10, 10);
            await makeAllocations(ta2, 6, 10);
            await makeAllocations(ta3, 5, 10);

            vi.useFakeTimers();
            vi.setSystemTime(simulatedNow);

            const progress = await AllocationService.getProgress(exam1._id.toString());

            expect(progress.paceAvailable).toBe(true);
            expect(progress.expectedCompletionRatio).toBe(0.80);
            expect(progress.bottleneckCount).toBe(1);

            const ta1Res = progress.progress.find((p) => p.taId === ta1._id.toString());
            expect(ta1Res!.completionRatio).toBe(1.0);
            expect(ta1Res!.expectedCompletionRatio).toBe(0.80);
            expect(ta1Res!.paceLag).toBe(0.0);
            expect(ta1Res!.isBottleneck).toBe(false);

            // Boundary test: Exactly 20 percentage points difference (0.80 - 0.60 = 0.20)
            const ta2Res = progress.progress.find((p) => p.taId === ta2._id.toString());
            expect(ta2Res!.completionRatio).toBe(0.60);
            expect(ta2Res!.paceLag).toBe(0.20);
            expect(ta2Res!.isBottleneck).toBe(false);

            // Material lag test: 30 percentage points difference (0.80 - 0.50 = 0.30 > 0.20)
            const ta3Res = progress.progress.find((p) => p.taId === ta3._id.toString());
            expect(ta3Res!.completionRatio).toBe(0.50);
            expect(ta3Res!.paceLag).toBe(0.30);
            expect(ta3Res!.isBottleneck).toBe(true);

            // Verify getAbsolutePace helper
            const absolutePace = await AllocationService.getAbsolutePace(exam1._id.toString());
            expect(absolutePace.bottlenecks.length).toBe(1);
            expect(absolutePace.bottlenecks[0].taId).toBe(ta3._id.toString());
        });

        it('expects 100% completion when deadline has passed', async () => {
            const startTime = new Date('2026-09-01T00:00:00.000Z');
            const deadlineTime = new Date('2026-09-10T00:00:00.000Z');
            const pastDeadlineNow = new Date('2026-09-15T00:00:00.000Z');

            await Exam.updateOne(
                { _id: exam1._id },
                { $set: { examDate: startTime, gradingDeadline: deadlineTime } }
            );

            // ta1: 10/10 completed (100% vs 100% => false)
            // ta2: 7/10 completed (70% vs 100% => 30% lag > 20% => true)
            for (let i = 0; i < 10; i++) {
                await Allocation.create({
                    exam: exam1._id,
                    answerScript: script1._id,
                    ta: ta1._id,
                    allocatedBy: prof._id,
                    rule: AllocationRule.QUESTION,
                    question: i + 1,
                    status: AllocationStatus.COMPLETED,
                    createdAt: startTime
                });
                await Allocation.create({
                    exam: exam1._id,
                    answerScript: script2._id,
                    ta: ta2._id,
                    allocatedBy: prof._id,
                    rule: AllocationRule.QUESTION,
                    question: i + 1,
                    status: i < 7 ? AllocationStatus.COMPLETED : AllocationStatus.IN_PROGRESS,
                    createdAt: startTime
                });
            }

            vi.useFakeTimers();
            vi.setSystemTime(pastDeadlineNow);

            const progress = await AllocationService.getProgress(exam1._id.toString());

            expect(progress.paceAvailable).toBe(true);
            expect(progress.expectedCompletionRatio).toBe(1.0);
            expect(progress.bottleneckCount).toBe(1);

            const ta2Res = progress.progress.find((p) => p.taId === ta2._id.toString());
            expect(ta2Res!.isBottleneck).toBe(true);
            expect(ta2Res!.paceLag).toBe(0.30);
        });

        it('handles invalid deadline window where deadline <= gradingStart', async () => {
            const startTime = new Date('2026-09-10T00:00:00.000Z');
            const invalidDeadline = new Date('2026-09-05T00:00:00.000Z');

            await Exam.updateOne(
                { _id: exam1._id },
                { $set: { gradingDeadline: invalidDeadline } }
            );

            await Allocation.create({
                exam: exam1._id,
                answerScript: script1._id,
                ta: ta1._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.IN_PROGRESS,
                createdAt: startTime
            });

            const progress = await AllocationService.getProgress(exam1._id.toString());

            expect(progress.paceAvailable).toBe(false);
            expect(progress.paceReason).toBe('INVALID_DEADLINE_WINDOW');
            expect(progress.bottleneckCount).toBe(0);
        });
    });

    describe('3. API Security & Privacy Tests', () => {
        beforeEach(async () => {
            await Allocation.create({
                exam: exam1._id,
                answerScript: script1._id,
                ta: ta1._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.COMPLETED
            });
        });

        it('allows authorized Professor to retrieve progress with deadline pace', async () => {
            mockSessionUser = {
                id: prof._id.toString(),
                role: UserRole.PROFESSOR,
                email: prof.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`);
            const res = await progressGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.gradingDeadline).toBeDefined();
            expect(json.data.paceAvailable).toBeDefined();
        });

        it('allows authorized Admin to retrieve progress with deadline pace', async () => {
            mockSessionUser = {
                id: admin._id.toString(),
                role: UserRole.ADMIN,
                email: admin.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`);
            const res = await progressGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
        });

        it('rejects unauthorized TA with 403 Forbidden', async () => {
            mockSessionUser = {
                id: ta1._id.toString(),
                role: UserRole.TA,
                email: ta1.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`);
            const res = await progressGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            expect(res.status).toBe(403);
        });

        it('rejects unauthorized Student with 403 Forbidden', async () => {
            mockSessionUser = {
                id: student1._id.toString(),
                role: UserRole.STUDENT,
                email: student1.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`);
            const res = await progressGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            expect(res.status).toBe(403);
        });

        it('does NOT expose student PII in the response payload', async () => {
            mockSessionUser = {
                id: prof._id.toString(),
                role: UserRole.PROFESSOR,
                email: prof.email
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`);
            const res = await progressGET(req, {
                params: Promise.resolve({ id: exam1._id.toString() })
            });

            const json = await res.json();
            const payloadStr = JSON.stringify(json);

            // Student identity and script details must be completely absent
            expect(payloadStr).not.toContain('Harry Potter');
            expect(payloadStr).not.toContain('harry@hogwarts.edu');
            expect(payloadStr).not.toContain('ROLL-001');
            expect(payloadStr).not.toContain('script1.pdf');
            expect(payloadStr).not.toContain('student');
        });
    });
});
