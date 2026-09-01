/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
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

describe('AE-104a: Relative TA Progress & Bottleneck Detection Tests', () => {
    let progressGET: any;

    let prof: any;
    let admin: any;
    let ta1: any;
    let ta2: any;
    let ta3: any;
    let ta4: any;
    let student1: any;
    let student2: any;

    let course: any;
    let exam1: any;
    let exam2: any;

    let script1: any;
    let script2: any;
    let script3: any;
    let script4: any;
    let script5: any;

    beforeAll(async () => {
        progressGET = (await import('../app/api/exams/[id]/progress/route')).GET;

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
            name: 'Neville Longbottom',
            email: 'neville@hogwarts.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        ta4 = await User.create({
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
            teachingAssistants: [ta1._id, ta2._id, ta3._id, ta4._id],
            enrolledStudents: [student1._id, student2._id],
            isActive: true
        });

        exam1 = await Exam.create({
            title: 'Midterm Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.PUBLISHED,
            numberOfQuestions: 3,
            isActive: true
        });

        exam2 = await Exam.create({
            title: 'Final Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date(),
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

        script3 = await AnswerScript.create({
            exam: exam1._id,
            filePath: '/scans/trans/script3.pdf',
            filename: 'script3.pdf',
            startPageNumber: 9,
            endPageNumber: 12,
            pageCount: 4,
            candidateStudentId: 'ROLL-003',
            isActive: true
        });

        script4 = await AnswerScript.create({
            exam: exam1._id,
            filePath: '/scans/trans/script4.pdf',
            filename: 'script4.pdf',
            startPageNumber: 13,
            endPageNumber: 16,
            pageCount: 4,
            candidateStudentId: 'ROLL-004',
            isActive: true
        });

        script5 = await AnswerScript.create({
            exam: exam2._id,
            student: student1._id,
            filePath: '/scans/trans/script5.pdf',
            filename: 'script5.pdf',
            startPageNumber: 1,
            endPageNumber: 4,
            pageCount: 4,
            candidateStudentId: 'ROLL-005',
            isActive: true
        });

        mockSessionUser = {
            id: prof._id.toString(),
            role: UserRole.PROFESSOR,
            email: prof.email
        };
    });

    describe('1. Bottleneck Calculation & Edge Cases', () => {
        it('1. Handles exam with zero allocations gracefully', async () => {
            const progress = await AllocationService.getProgress(exam1._id.toString());

            expect(progress.total).toBe(0);
            expect(progress.graded).toBe(0);
            expect(progress.cohortMedianCompletionRatio).toBe(0);
            expect(progress.bottleneckCount).toBe(0);
            expect(progress.progress).toEqual([]);
        });

        it('2. Excludes TAs with zero allocations from bottleneck calculation', async () => {
            // ta1: 1 allocation, 1 completed (100%)
            await Allocation.create({
                exam: exam1._id,
                answerScript: script1._id,
                ta: ta1._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.COMPLETED
            });

            // ta2 has zero allocations for exam1
            const progress = await AllocationService.getProgress(exam1._id.toString());

            expect(progress.cohortMedianCompletionRatio).toBe(1.0);
            expect(progress.bottleneckCount).toBe(0);
            expect(progress.progress.length).toBe(1);
            expect(progress.progress[0].taId).toBe(ta1._id.toString());
            expect(progress.progress[0].isBottleneck).toBe(false);
        });

        it('3. Single eligible TA is never flagged as a bottleneck (diff is 0)', async () => {
            await Allocation.create({
                exam: exam1._id,
                answerScript: script1._id,
                ta: ta1._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.IN_PROGRESS
            });

            const progress = await AllocationService.getProgress(exam1._id.toString());

            expect(progress.cohortMedianCompletionRatio).toBe(0.0);
            expect(progress.bottleneckCount).toBe(0);
            expect(progress.progress[0].completionRatio).toBe(0.0);
            expect(progress.progress[0].isBottleneck).toBe(false);
            expect(progress.progress[0].bottleneck).toBe(false);
        });

        it('4. All TAs at identical completion ratio are not flagged as bottlenecks', async () => {
            // ta1: 1/2 = 50%
            await Allocation.create({
                exam: exam1._id,
                answerScript: script1._id,
                ta: ta1._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.COMPLETED
            });
            await Allocation.create({
                exam: exam1._id,
                answerScript: script2._id,
                ta: ta1._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.IN_PROGRESS
            });

            // ta2: 1/2 = 50%
            await Allocation.create({
                exam: exam1._id,
                answerScript: script3._id,
                ta: ta2._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.COMPLETED
            });
            await Allocation.create({
                exam: exam1._id,
                answerScript: script4._id,
                ta: ta2._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.PENDING
            });

            const progress = await AllocationService.getProgress(exam1._id.toString());

            expect(progress.cohortMedianCompletionRatio).toBe(0.50);
            expect(progress.bottleneckCount).toBe(0);
            expect(progress.progress.every((p) => !p.isBottleneck)).toBe(true);
        });

        it('5. Boundary check: TA exactly 20 percentage points below median is NOT flagged', async () => {
            // Setup 3 TAs:
            // ta1: 10/10 = 100% (1.0)
            // ta2: 8/10 = 80% (0.80)  <-- Median = 80%
            // ta3: 6/10 = 60% (0.60)  <-- Exactly 20% below median (0.80 - 0.60 = 0.20)
            const makeAllocations = async (ta: any, completed: number, total: number) => {
                for (let i = 0; i < total; i++) {
                    await Allocation.create({
                        exam: exam1._id,
                        answerScript: script1._id,
                        ta: ta._id,
                        allocatedBy: prof._id,
                        rule: AllocationRule.QUESTION,
                        question: i + 1,
                        status: i < completed ? AllocationStatus.COMPLETED : AllocationStatus.IN_PROGRESS
                    });
                }
            };

            await makeAllocations(ta1, 10, 10);
            await makeAllocations(ta2, 8, 10);
            await makeAllocations(ta3, 6, 10);

            const progress = await AllocationService.getProgress(exam1._id.toString());

            expect(progress.cohortMedianCompletionRatio).toBe(0.80);
            expect(progress.bottleneckCount).toBe(0);

            const ta3Result = progress.progress.find((p) => p.taId === ta3._id.toString());
            expect(ta3Result).toBeDefined();
            expect(ta3Result!.completionRatio).toBe(0.60);
            expect(ta3Result!.isBottleneck).toBe(false);
            expect(ta3Result!.bottleneck).toBe(false);
        });

        it('6. Material lag: TA more than 20 percentage points below median IS flagged as bottleneck', async () => {
            // Setup 3 TAs:
            // ta1: 10/10 = 100% (1.0)
            // ta2: 8/10 = 80% (0.80)  <-- Median = 80%
            // ta3: 5/10 = 50% (0.50)  <-- 30% below median (0.80 - 0.50 = 0.30 > 0.20) => BOTTLENECK
            const makeAllocations = async (ta: any, completed: number, total: number) => {
                for (let i = 0; i < total; i++) {
                    await Allocation.create({
                        exam: exam1._id,
                        answerScript: script1._id,
                        ta: ta._id,
                        allocatedBy: prof._id,
                        rule: AllocationRule.QUESTION,
                        question: i + 1,
                        status: i < completed ? AllocationStatus.COMPLETED : AllocationStatus.IN_PROGRESS
                    });
                }
            };

            await makeAllocations(ta1, 10, 10);
            await makeAllocations(ta2, 8, 10);
            await makeAllocations(ta3, 5, 10);

            const progress = await AllocationService.getProgress(exam1._id.toString());

            expect(progress.cohortMedianCompletionRatio).toBe(0.80);
            expect(progress.bottleneckCount).toBe(1);

            const ta3Result = progress.progress.find((p) => p.taId === ta3._id.toString());
            expect(ta3Result).toBeDefined();
            expect(ta3Result!.completionRatio).toBe(0.50);
            expect(ta3Result!.isBottleneck).toBe(true);
            expect(ta3Result!.bottleneck).toBe(true);

            // Verify getBottlenecks convenience method
            const bottleneckData = await AllocationService.getBottlenecks(exam1._id.toString());
            expect(bottleneckData.bottlenecks.length).toBe(1);
            expect(bottleneckData.bottlenecks[0].taId).toBe(ta3._id.toString());
        });

        it('7. Even cohort median calculation with multiple tied TAs', async () => {
            // 4 TAs with ratios: 0.90, 0.80, 0.70, 0.40
            // Even median = (0.80 + 0.70) / 2 = 0.75
            // ta1: 0.90 (diff -0.15 => false)
            // ta2: 0.80 (diff -0.05 => false)
            // ta3: 0.70 (diff 0.05 => false)
            // ta4: 0.40 (diff 0.35 > 0.20 => true)
            const makeAllocations = async (ta: any, completed: number, total: number) => {
                for (let i = 0; i < total; i++) {
                    await Allocation.create({
                        exam: exam1._id,
                        answerScript: script1._id,
                        ta: ta._id,
                        allocatedBy: prof._id,
                        rule: AllocationRule.QUESTION,
                        question: i + 1,
                        status: i < completed ? AllocationStatus.COMPLETED : AllocationStatus.IN_PROGRESS
                    });
                }
            };

            await makeAllocations(ta1, 9, 10);
            await makeAllocations(ta2, 8, 10);
            await makeAllocations(ta3, 7, 10);
            await makeAllocations(ta4, 4, 10);

            const progress = await AllocationService.getProgress(exam1._id.toString());

            expect(progress.cohortMedianCompletionRatio).toBe(0.75);
            expect(progress.bottleneckCount).toBe(1);

            const ta4Result = progress.progress.find((p) => p.taId === ta4._id.toString());
            expect(ta4Result!.isBottleneck).toBe(true);
        });

        it('8. Exam isolation: allocations and bottlenecks on exam1 do not affect exam2', async () => {
            // exam1: ta1 100%, ta2 0% (ta2 is bottleneck on exam1)
            await Allocation.create({
                exam: exam1._id,
                answerScript: script1._id,
                ta: ta1._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.COMPLETED
            });
            await Allocation.create({
                exam: exam1._id,
                answerScript: script2._id,
                ta: ta2._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.IN_PROGRESS
            });

            // exam2: ta2 100% (ta2 is NOT a bottleneck on exam2)
            await Allocation.create({
                exam: exam2._id,
                answerScript: script5._id,
                ta: ta2._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.COMPLETED
            });

            const progressExam1 = await AllocationService.getProgress(exam1._id.toString());
            const progressExam2 = await AllocationService.getProgress(exam2._id.toString());

            expect(progressExam1.cohortMedianCompletionRatio).toBe(0.50);
            expect(progressExam1.bottleneckCount).toBe(1);
            expect(progressExam1.progress.find((p) => p.taId === ta2._id.toString())!.isBottleneck).toBe(true);

            expect(progressExam2.cohortMedianCompletionRatio).toBe(1.0);
            expect(progressExam2.bottleneckCount).toBe(0);
            expect(progressExam2.progress.find((p) => p.taId === ta2._id.toString())!.isBottleneck).toBe(false);
        });
    });

    describe('2. API Route & Security / Privacy Tests', () => {
        beforeEach(async () => {
            // Set up 1 bottleneck TA on exam1
            await Allocation.create({
                exam: exam1._id,
                answerScript: script1._id,
                ta: ta1._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.COMPLETED
            });
            await Allocation.create({
                exam: exam1._id,
                answerScript: script2._id,
                ta: ta2._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.IN_PROGRESS
            });
        });

        it('allows authorized Professor to access bottleneck progress', async () => {
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
            expect(json.data.cohortMedianCompletionRatio).toBe(0.50);
            expect(json.data.bottleneckCount).toBe(1);
            expect(json.data.progress[0].completionRatio).toBeDefined();
            expect(json.data.progress[0].isBottleneck).toBeDefined();
        });

        it('allows authorized Admin to access bottleneck progress', async () => {
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

            // Student identity and answer script details must be completely absent
            expect(payloadStr).not.toContain('Harry Potter');
            expect(payloadStr).not.toContain('harry@hogwarts.edu');
            expect(payloadStr).not.toContain('ROLL-001');
            expect(payloadStr).not.toContain('ROLL-002');
            expect(payloadStr).not.toContain('script1.pdf');
            expect(payloadStr).not.toContain('answerScript');
            expect(payloadStr).not.toContain('student');

            // TA identity fields are present for professor management
            expect(payloadStr).toContain('Hermione Granger');
            expect(payloadStr).toContain('Ron Weasley');
        });
    });
});
