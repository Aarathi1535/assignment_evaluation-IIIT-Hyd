import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import Allocation, { AllocationRule, AllocationStatus } from '../models/Allocation';
import Grade from '../models/Grade';
import AnswerScript from '../models/AnswerScript';
import Exam, { IngestionApprovalStatus } from '../models/Exam';
import Course from '../models/Course';
import Rubric from '../models/Rubric';
import { UserRole } from '../constants/permissions';
import { AllocationService } from '../services/AllocationService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

describe('Allocation Foundation Tests (AE-082)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allocatePOST: any;
    let testExamId: mongoose.Types.ObjectId;
    let testCourseId: mongoose.Types.ObjectId;
    let testRubricId: mongoose.Types.ObjectId;
    let professorId: mongoose.Types.ObjectId;
    let taId1: mongoose.Types.ObjectId;
    let taId2: mongoose.Types.ObjectId;
    let studentId: mongoose.Types.ObjectId;

    beforeAll(async () => {
        allocatePOST = (await import('../app/api/exams/[id]/allocate/route')).POST;

        // Force indexes creation
        await Allocation.init();
        await Grade.init();
        await AnswerScript.init();

        professorId = new mongoose.Types.ObjectId('000000000000000000000100');
        taId1 = new mongoose.Types.ObjectId('000000000000000000000103');
        taId2 = new mongoose.Types.ObjectId('000000000000000000000104');
        studentId = new mongoose.Types.ObjectId('000000000000000000000102');
    });

    beforeEach(async () => {
        // Clean collections
        await Course.deleteMany({});
        await Exam.deleteMany({});
        await Rubric.deleteMany({});
        await Allocation.deleteMany({});
        await Grade.deleteMany({});
        await AnswerScript.deleteMany({});

        const course = new Course({
            courseCode: 'CS101',
            courseName: 'Intro to CS',
            semester: 1,
            academicYear: '2026-2027',
            professor: professorId,
            teachingAssistants: [taId1, taId2],
            enrolledStudents: [studentId],
            isActive: true
        });
        const savedCourse = await course.save();
        testCourseId = savedCourse._id as mongoose.Types.ObjectId;

        const exam = new Exam({
            title: 'Midterm',
            course: testCourseId,
            createdBy: professorId,
            examDate: new Date('2026-10-15T09:00:00.000Z'),
            totalMarks: 50,
            numberOfQuestions: 5,
            status: 'DRAFT',
            ingestionApprovalStatus: IngestionApprovalStatus.PENDING_REVIEW,
            isActive: true
        });
        const savedExam = await exam.save();
        testExamId = savedExam._id as mongoose.Types.ObjectId;

        const rubric = new Rubric({
            exam: testExamId,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 10,
                    criteria: [{ criterionName: 'Q1 Accuracy', points: 10 }]
                },
                {
                    questionNumber: 2,
                    maxMarks: 10,
                    criteria: [{ criterionName: 'Q2 Accuracy', points: 10 }]
                }
            ],
            createdBy: professorId,
            isActive: true
        });
        const savedRubric = await rubric.save();
        testRubricId = savedRubric._id as mongoose.Types.ObjectId;
    });

    describe('Allocation Schema and Rule Persistence', () => {
        it('should support allocation rule types and persist rule, question, and seed data', async () => {
            const scriptId = new mongoose.Types.ObjectId();
            const alloc = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId,
                allocatedBy: professorId,
                rule: AllocationRule.QUESTION,
                question: 1,
                seed: 12345
            });

            const saved = await alloc.save();
            expect(saved.rule).toBe(AllocationRule.QUESTION);
            expect(saved.question).toBe(1);
            expect(saved.seed).toBe(12345);
        });

        it('should allow rule to be omitted for backwards compatibility', async () => {
            const scriptId = new mongoose.Types.ObjectId();
            const alloc = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId,
                allocatedBy: professorId
            });

            const saved = await alloc.save();
            expect(saved.rule).toBeUndefined();
            expect(saved.question).toBeUndefined();
            expect(saved.seed).toBeUndefined();
        });
    });

    describe('Allocation Uniqueness Constraints & Mixed Mode Rejections', () => {
        // Regression test 1
        it('duplicate whole-script allocation is rejected', async () => {
            const scriptId = new mongoose.Types.ObjectId();
            
            const alloc1 = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId,
                allocatedBy: professorId
            });
            await alloc1.save();

            const alloc2 = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId,
                allocatedBy: professorId
            });

            await expect(alloc2.save()).rejects.toThrow();
        });

        // Regression test 2
        it('duplicate same-question allocation is rejected', async () => {
            const scriptId = new mongoose.Types.ObjectId();

            const alloc1 = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId,
                allocatedBy: professorId,
                rule: AllocationRule.QUESTION,
                question: 1
            });
            await alloc1.save();

            const alloc2 = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId,
                allocatedBy: professorId,
                rule: AllocationRule.QUESTION,
                question: 1
            });

            await expect(alloc2.save()).rejects.toThrow();
        });

        // Regression test 3
        it('different questions can be allocated to the same TA/script', async () => {
            const scriptId = new mongoose.Types.ObjectId();

            const alloc1 = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId,
                allocatedBy: professorId,
                rule: AllocationRule.QUESTION,
                question: 1
            });
            await alloc1.save();

            const alloc2 = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId,
                allocatedBy: professorId,
                rule: AllocationRule.QUESTION,
                question: 2
            });

            const saved2 = await alloc2.save();
            expect(saved2._id).toBeDefined();
        });

        // Regression test 4
        it('whole-script allocation cannot coexist with question-wise allocation in an invalid mixed mode', async () => {
            const scriptId = new mongoose.Types.ObjectId();

            // Create question-wise allocation first
            const alloc1 = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId,
                allocatedBy: professorId,
                rule: AllocationRule.QUESTION,
                question: 1
            });
            await alloc1.save();

            // Attempting whole-script allocation should fail
            const alloc2 = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId,
                allocatedBy: professorId
            });
            await expect(alloc2.save()).rejects.toThrow('Cannot create whole-script allocation');

            // Conversely:
            const scriptId2 = new mongoose.Types.ObjectId();
            const alloc3 = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId2,
                allocatedBy: professorId
            });
            await alloc3.save();

            const alloc4 = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId2,
                allocatedBy: professorId,
                rule: AllocationRule.QUESTION,
                question: 1
            });
            await expect(alloc4.save()).rejects.toThrow('Cannot create question-wise allocation');
        });
    });

    describe('Grade Schema for Question-Wise Grading & Mixed Mode Rejections', () => {
        // Regression test 5
        it('duplicate whole-script grade is rejected', async () => {
            const scriptId = new mongoose.Types.ObjectId();

            const gradeWhole = new Grade({
                answerScript: scriptId,
                rubric: testRubricId,
                gradedBy: taId1,
                marksAwarded: [
                    { criterionName: 'Q1', score: 8 },
                    { criterionName: 'Q2', score: 9 }
                ],
                totalScore: 17,
                isFinal: true
            });
            const saved = await gradeWhole.save();
            expect(saved._id).toBeDefined();

            const gradeWholeDuplicate = new Grade({
                answerScript: scriptId,
                rubric: testRubricId,
                gradedBy: taId2,
                marksAwarded: [
                    { criterionName: 'Q1', score: 5 },
                    { criterionName: 'Q2', score: 5 }
                ],
                totalScore: 10,
                isFinal: true
            });
            await expect(gradeWholeDuplicate.save()).rejects.toThrow();
        });

        // Regression test 6
        it('duplicate same-question grade is rejected', async () => {
            const scriptId = new mongoose.Types.ObjectId();

            const gradeQ1 = new Grade({
                answerScript: scriptId,
                rubric: testRubricId,
                gradedBy: taId1,
                question: 1,
                marksAwarded: [{ criterionName: 'Q1 Accuracy', score: 8 }],
                totalScore: 8,
                isFinal: false
            });
            await gradeQ1.save();

            const gradeQ1Duplicate = new Grade({
                answerScript: scriptId,
                rubric: testRubricId,
                gradedBy: taId2,
                question: 1,
                marksAwarded: [{ criterionName: 'Q1 Accuracy', score: 5 }],
                totalScore: 5,
                isFinal: false
            });
            await expect(gradeQ1Duplicate.save()).rejects.toThrow();
        });

        // Regression test 7
        it('different questions can have grades from different TAs', async () => {
            const scriptId = new mongoose.Types.ObjectId();

            const gradeQ1 = new Grade({
                answerScript: scriptId,
                rubric: testRubricId,
                gradedBy: taId1,
                question: 1,
                marksAwarded: [{ criterionName: 'Q1 Accuracy', score: 8 }],
                totalScore: 8,
                isFinal: false
            });
            const savedQ1 = await gradeQ1.save();
            expect(savedQ1._id).toBeDefined();

            const gradeQ2 = new Grade({
                answerScript: scriptId,
                rubric: testRubricId,
                gradedBy: taId2,
                question: 2,
                marksAwarded: [{ criterionName: 'Q2 Accuracy', score: 9 }],
                totalScore: 9,
                isFinal: false
            });
            const savedQ2 = await gradeQ2.save();
            expect(savedQ2._id).toBeDefined();
        });

        // Regression test 8
        it('whole-script grading cannot coexist with question-wise grading in an invalid mixed mode', async () => {
            const scriptId = new mongoose.Types.ObjectId();

            // Create question-wise grade first
            const grade1 = new Grade({
                answerScript: scriptId,
                rubric: testRubricId,
                gradedBy: taId1,
                question: 1,
                marksAwarded: [{ criterionName: 'Q1 Accuracy', score: 8 }],
                totalScore: 8,
                isFinal: false
            });
            await grade1.save();

            // Attempting whole-script grade should fail
            const grade2 = new Grade({
                answerScript: scriptId,
                rubric: testRubricId,
                gradedBy: taId1,
                marksAwarded: [{ criterionName: 'Q1 Accuracy', score: 8 }],
                totalScore: 8,
                isFinal: true
            });
            await expect(grade2.save()).rejects.toThrow('Cannot create whole-script grade');

            // Conversely:
            const scriptId2 = new mongoose.Types.ObjectId();
            const grade3 = new Grade({
                answerScript: scriptId2,
                rubric: testRubricId,
                gradedBy: taId1,
                marksAwarded: [{ criterionName: 'Q1 Accuracy', score: 8 }],
                totalScore: 8,
                isFinal: true
            });
            await grade3.save();

            const grade4 = new Grade({
                answerScript: scriptId2,
                rubric: testRubricId,
                gradedBy: taId1,
                question: 1,
                marksAwarded: [{ criterionName: 'Q1 Accuracy', score: 8 }],
                totalScore: 8,
                isFinal: false
            });
            await expect(grade4.save()).rejects.toThrow('Cannot create question-wise grade');
        });
    });

    describe('Allocation Service Re-run Contract', () => {
        it('should allow deletion of allocations when status is PENDING and no grades exist', async () => {
            const scriptId = new mongoose.Types.ObjectId();
            const alloc = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId,
                allocatedBy: professorId,
                status: AllocationStatus.PENDING
            });
            await alloc.save();

            // Pre-allocation prep should clear the existing allocation
            await expect(AllocationService.prepareForAllocation(testExamId.toString())).resolves.toBeUndefined();
            const count = await Allocation.countDocuments({ exam: testExamId });
            expect(count).toBe(0);
        });

        it('should reject re-allocation with an error if grading is in progress or completed', async () => {
            const scriptId = new mongoose.Types.ObjectId();
            const alloc = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: scriptId,
                allocatedBy: professorId,
                status: AllocationStatus.IN_PROGRESS
            });
            await alloc.save();

            await expect(AllocationService.prepareForAllocation(testExamId.toString())).rejects.toThrow(
                'Cannot re-run allocation: grading has already commenced for this exam.'
            );
        });

        it('should reject re-allocation with an error if grades already exist', async () => {
            const script = new AnswerScript({
                exam: testExamId,
                filePath: '/path/to/script.pdf',
                filename: 'script.pdf'
            });
            const savedScript = await script.save();

            const alloc = new Allocation({
                exam: testExamId,
                ta: taId1,
                answerScript: savedScript._id,
                allocatedBy: professorId,
                status: AllocationStatus.PENDING
            });
            await alloc.save();

            const grade = new Grade({
                answerScript: savedScript._id,
                rubric: testRubricId,
                gradedBy: taId1,
                marksAwarded: [{ criterionName: 'Q1', score: 8 }],
                totalScore: 8
            });
            await grade.save();

            await expect(AllocationService.prepareForAllocation(testExamId.toString())).rejects.toThrow(
                'Cannot re-run allocation: grades already exist for this exam.'
            );
        });
    });

    describe('API Route Gates (RBAC & Ingestion Approval)', () => {
        it('should require ALLOCATE_SCRIPTS permission (RBAC check)', async () => {
            mockSessionUser = {
                id: studentId.toString(),
                email: 'student@univ.edu',
                name: 'Student User',
                role: UserRole.STUDENT
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${testExamId}/allocate`, {
                method: 'POST',
                body: JSON.stringify({ rule: AllocationRule.EQUAL })
            });

            const res = await allocatePOST(req, { params: Promise.resolve({ id: testExamId.toString() }) });
            expect(res.status).toBe(403);
        });

        it('should require exam ingestion to be APPROVED (Ingestion Approval check)', async () => {
            mockSessionUser = {
                id: professorId.toString(),
                email: 'prof@univ.edu',
                name: 'Prof User',
                role: UserRole.PROFESSOR
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${testExamId}/allocate`, {
                method: 'POST',
                body: JSON.stringify({ rule: AllocationRule.EQUAL })
            });

            const res = await allocatePOST(req, { params: Promise.resolve({ id: testExamId.toString() }) });
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.message).toContain('Ingestion has not been approved');
        });

        it('should succeed and run the preparation contract when authorized and ingestion is approved', async () => {
            // Approve the exam ingestion first
            await Exam.updateOne(
                { _id: testExamId },
                { $set: { ingestionApprovalStatus: IngestionApprovalStatus.APPROVED } }
            );

            mockSessionUser = {
                id: professorId.toString(),
                email: 'prof@univ.edu',
                name: 'Prof User',
                role: UserRole.PROFESSOR
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${testExamId}/allocate`, {
                method: 'POST',
                body: JSON.stringify({ rule: AllocationRule.EQUAL })
            });

            const res = await allocatePOST(req, { params: Promise.resolve({ id: testExamId.toString() }) });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.success).toBe(true);
        });

        it('should reject invalid allocation rules', async () => {
            await Exam.updateOne(
                { _id: testExamId },
                { $set: { ingestionApprovalStatus: IngestionApprovalStatus.APPROVED } }
            );

            mockSessionUser = {
                id: professorId.toString(),
                email: 'prof@univ.edu',
                name: 'Prof User',
                role: UserRole.PROFESSOR
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${testExamId}/allocate`, {
                method: 'POST',
                body: JSON.stringify({ rule: 'INVALID_RULE' })
            });

            const res = await allocatePOST(req, { params: Promise.resolve({ id: testExamId.toString() }) });
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.message).toContain('Invalid allocation rule');
        });
    });
});
