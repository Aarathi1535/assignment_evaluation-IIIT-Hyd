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

describe('Allocation EQUAL Strategy Tests (AE-083)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let allocatePOST: any;
    let testExamId: mongoose.Types.ObjectId;
    let testCourseId: mongoose.Types.ObjectId;
    let professorId: mongoose.Types.ObjectId;
    let taId1: mongoose.Types.ObjectId;
    let taId2: mongoose.Types.ObjectId;
    let taId3: mongoose.Types.ObjectId;
    let studentId1: mongoose.Types.ObjectId;
    let studentId2: mongoose.Types.ObjectId;

    beforeAll(async () => {
        allocatePOST = (await import('../app/api/exams/[id]/allocate/route')).POST;

        // Force indexes creation
        await Allocation.init();
        await Grade.init();
        await AnswerScript.init();

        professorId = new mongoose.Types.ObjectId('000000000000000000000100');
        taId1 = new mongoose.Types.ObjectId('000000000000000000000103');
        taId2 = new mongoose.Types.ObjectId('000000000000000000000104');
        taId3 = new mongoose.Types.ObjectId('000000000000000000000105');
        studentId1 = new mongoose.Types.ObjectId('000000000000000000000101');
        studentId2 = new mongoose.Types.ObjectId('000000000000000000000102');
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
            teachingAssistants: [taId1, taId2, taId3],
            enrolledStudents: [studentId1, studentId2],
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
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
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
                }
            ],
            createdBy: professorId,
            isActive: true
        });
        await rubric.save();
    });

    const createScript = async (studentId: mongoose.Types.ObjectId | null, isActive = true, needsManualId = false) => {
        const script = new AnswerScript({
            exam: testExamId,
            student: studentId,
            filePath: '/path/to/script.pdf',
            filename: `script_${studentId?.toString() || 'unidentified'}.pdf`,
            isActive,
            needsManualId
        });
        return await script.save();
    };

    describe('EQUAL Allocation Algorithm', () => {
        it('equal distribution with an evenly divisible number of scripts', async () => {
            // 4 eligible scripts
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());

            // 2 TAs selected
            const result = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString(), taId2.toString()],
                professorId.toString()
            );

            expect(result).toHaveLength(4);

            // Group by TA
            const ta1Count = result.filter(a => a.ta.toString() === taId1.toString()).length;
            const ta2Count = result.filter(a => a.ta.toString() === taId2.toString()).length;

            expect(ta1Count).toBe(2);
            expect(ta2Count).toBe(2);

            // Validate rule and question fields
            for (const alloc of result) {
                expect(alloc.rule).toBe(AllocationRule.EQUAL);
                expect(alloc.question).toBeUndefined();
            }

            // Verify no answerScript appears more than once (AE-089)
            const scriptIds = result.map(a => a.answerScript.toString());
            expect(new Set(scriptIds).size).toBe(result.length);
        });

        it('equal distribution with a remainder', async () => {
            // 5 eligible scripts
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());

            // 2 TAs selected
            const result = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString(), taId2.toString()],
                professorId.toString()
            );

            expect(result).toHaveLength(5);

            // Group by TA
            const ta1Count = result.filter(a => a.ta.toString() === taId1.toString()).length;
            const ta2Count = result.filter(a => a.ta.toString() === taId2.toString()).length;

            // One receives 3, the other receives 2
            expect(Math.abs(ta1Count - ta2Count)).toBe(1);
            expect(ta1Count + ta2Count).toBe(5);

            // Verify no answerScript appears more than once (AE-089)
            const scriptIds = result.map(a => a.answerScript.toString());
            expect(new Set(scriptIds).size).toBe(result.length);
        });

        it('one TA', async () => {
            // 3 eligible scripts
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());

            // 1 TA selected
            const result = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );

            expect(result).toHaveLength(3);
            const ta1Count = result.filter(a => a.ta.toString() === taId1.toString()).length;
            expect(ta1Count).toBe(3);

            // Verify no answerScript appears more than once (AE-089)
            const scriptIds = result.map(a => a.answerScript.toString());
            expect(new Set(scriptIds).size).toBe(result.length);
        });

        it('more TAs than scripts', async () => {
            // 2 eligible scripts
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());

            // 3 TAs selected
            const result = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString(), taId2.toString(), taId3.toString()],
                professorId.toString()
            );

            expect(result).toHaveLength(2);
            const ta1Count = result.filter(a => a.ta.toString() === taId1.toString()).length;
            const ta2Count = result.filter(a => a.ta.toString() === taId2.toString()).length;
            const ta3Count = result.filter(a => a.ta.toString() === taId3.toString()).length;

            expect(ta1Count).toBeLessThanOrEqual(1);
            expect(ta2Count).toBeLessThanOrEqual(1);
            expect(ta3Count).toBeLessThanOrEqual(1);
            expect(ta1Count + ta2Count + ta3Count).toBe(2);

            // Verify no answerScript appears more than once (AE-089)
            const scriptIds = result.map(a => a.answerScript.toString());
            expect(new Set(scriptIds).size).toBe(result.length);
        });

        it('no eligible scripts throws validation error', async () => {
            await expect(
                AllocationService.allocateEqual(
                    testExamId.toString(),
                    [taId1.toString()],
                    professorId.toString()
                )
            ).rejects.toThrow('No eligible scripts found for allocation');
        });

        it('no selected TAs throws validation error', async () => {
            await createScript(new mongoose.Types.ObjectId());
            await expect(
                AllocationService.allocateEqual(
                    testExamId.toString(),
                    [],
                    professorId.toString()
                )
            ).rejects.toThrow('At least one selected TA must be provided for allocation');
        });

        it('inactive scripts excluded', async () => {
            // 1 active, 1 inactive script
            const active = await createScript(new mongoose.Types.ObjectId(), true);
            await createScript(new mongoose.Types.ObjectId(), false);

            const result = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );

            expect(result).toHaveLength(1);
            expect(result[0].answerScript.toString()).toBe(active._id.toString());
        });

        it('unidentified / needsManualId scripts excluded', async () => {
            // 1 active identified, 1 unidentified (student: null), 1 active needsManualId: true
            const activeIdentified = await createScript(new mongoose.Types.ObjectId(), true, false);
            await createScript(null, true, false); // unidentified student
            await createScript(new mongoose.Types.ObjectId(), true, true); // needs manual id

            const result = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );

            expect(result).toHaveLength(1);
            expect(result[0].answerScript.toString()).toBe(activeIdentified._id.toString());
        });

        it('every eligible script allocated exactly once', async () => {
            const s1 = await createScript(new mongoose.Types.ObjectId());
            const s2 = await createScript(new mongoose.Types.ObjectId());

            const result = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString(), taId2.toString()],
                professorId.toString()
            );

            expect(result).toHaveLength(2);
            const scriptIds = result.map(a => a.answerScript.toString());
            expect(scriptIds).toContain(s1._id.toString());
            expect(scriptIds).toContain(s2._id.toString());
        });
    });

    describe('EQUAL Allocation Re-run Safety Checks', () => {
        it('rerun before grading works through the AE-082 preparation contract', async () => {
            await createScript(new mongoose.Types.ObjectId());
            
            // Run 1
            const result1 = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );
            expect(result1).toHaveLength(1);

            // Run 2: Should succeed and clear old allocations
            const result2 = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );
            expect(result2).toHaveLength(1);

            const allAllocations = await Allocation.find({ exam: testExamId });
            expect(allAllocations).toHaveLength(1);
        });

        it('rerun after grading has started is rejected', async () => {
            await createScript(new mongoose.Types.ObjectId());
            
            const allocs = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );

            // Mock grading commenced
            await Allocation.updateOne(
                { _id: allocs[0]._id },
                { $set: { status: AllocationStatus.IN_PROGRESS } }
            );

            await expect(
                AllocationService.allocateEqual(
                    testExamId.toString(),
                    [taId1.toString()],
                    professorId.toString()
                )
            ).rejects.toThrow('Cannot re-run allocation: grading has already commenced');
        });
    });

    describe('API Gating validation for EQUAL rule', () => {
        it('RBAC gate remains enforced', async () => {
            mockSessionUser = {
                id: new mongoose.Types.ObjectId().toString(),
                email: 'student@univ.edu',
                name: 'Student User',
                role: UserRole.STUDENT
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${testExamId}/allocate`, {
                method: 'POST',
                body: JSON.stringify({
                    rule: AllocationRule.EQUAL,
                    taIds: [taId1.toString()]
                })
            });

            const res = await allocatePOST(req, { params: Promise.resolve({ id: testExamId.toString() }) });
            expect(res.status).toBe(403);
        });

        it('ingestion approval gate remains enforced', async () => {
            // Set unapproved exam
            await Exam.updateOne(
                { _id: testExamId },
                { $set: { ingestionApprovalStatus: IngestionApprovalStatus.PENDING_REVIEW } }
            );

            mockSessionUser = {
                id: professorId.toString(),
                email: 'prof@univ.edu',
                name: 'Prof User',
                role: UserRole.PROFESSOR
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${testExamId}/allocate`, {
                method: 'POST',
                body: JSON.stringify({
                    rule: AllocationRule.EQUAL,
                    taIds: [taId1.toString()]
                })
            });

            const res = await allocatePOST(req, { params: Promise.resolve({ id: testExamId.toString() }) });
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.message).toContain('Ingestion has not been approved');
        });
    });
});
