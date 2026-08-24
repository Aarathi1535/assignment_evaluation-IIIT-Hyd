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

describe('Allocation QUESTION Strategy Tests (AE-084)', () => {
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
            numberOfQuestions: 3, // 3 questions default
            status: 'DRAFT',
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            isActive: true
        });
        const savedExam = await exam.save();
        testExamId = savedExam._id as mongoose.Types.ObjectId;
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

    describe('Question Allocation Strategy', () => {
        it('Questions are allocated using indices 1..N and question details are persisted correctly', async () => {
            const s = await createScript(new mongoose.Types.ObjectId());

            const result = await AllocationService.allocateByQuestion(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );

            // 3 questions, 1 TA -> 3 allocations
            expect(result).toHaveLength(3);
            const questionNumbers = result.map(a => a.question);
            expect(questionNumbers).toContain(1);
            expect(questionNumbers).toContain(2);
            expect(questionNumbers).toContain(3);

            for (const alloc of result) {
                expect(alloc.rule).toBe(AllocationRule.QUESTION);
                expect(alloc.answerScript.toString()).toBe(s._id.toString());
                expect(alloc.status).toBe(AllocationStatus.PENDING);
            }
        });

        it('Multiple scripts receive allocations for every question and every eligible (script, question) pair is allocated exactly once', async () => {
            const s1 = await createScript(new mongoose.Types.ObjectId());
            const s2 = await createScript(new mongoose.Types.ObjectId());

            const result = await AllocationService.allocateByQuestion(
                testExamId.toString(),
                [taId1.toString(), taId2.toString()],
                professorId.toString()
            );

            // 2 scripts * 3 questions = 6 allocations
            expect(result).toHaveLength(6);

            // Assert that script 1 has questions 1, 2, 3
            const s1Allocs = result.filter(a => a.answerScript.toString() === s1._id.toString());
            expect(s1Allocs).toHaveLength(3);
            expect(s1Allocs.map(a => a.question)).toContain(1);
            expect(s1Allocs.map(a => a.question)).toContain(2);
            expect(s1Allocs.map(a => a.question)).toContain(3);

            // Assert that script 2 has questions 1, 2, 3
            const s2Allocs = result.filter(a => a.answerScript.toString() === s2._id.toString());
            expect(s2Allocs).toHaveLength(3);
            expect(s2Allocs.map(a => a.question)).toContain(1);
            expect(s2Allocs.map(a => a.question)).toContain(2);
            expect(s2Allocs.map(a => a.question)).toContain(3);
        });

        it('Questions are distributed evenly/round-robin among TAs and a TA can hold multiple different questions for the same script', async () => {
            await createScript(new mongoose.Types.ObjectId());

            // 3 questions, 2 TAs (taId1, taId2)
            // Round-robin:
            // Q1 -> taId1 (index 0)
            // Q2 -> taId2 (index 1)
            // Q3 -> taId1 (index 0)
            const result = await AllocationService.allocateByQuestion(
                testExamId.toString(),
                [taId1.toString(), taId2.toString()],
                professorId.toString()
            );

            expect(result).toHaveLength(3);

            const q1Alloc = result.find(a => a.question === 1);
            const q2Alloc = result.find(a => a.question === 2);
            const q3Alloc = result.find(a => a.question === 3);

            expect(q1Alloc?.ta.toString()).toBe(taId1.toString());
            expect(q2Alloc?.ta.toString()).toBe(taId2.toString());
            expect(q3Alloc?.ta.toString()).toBe(taId1.toString()); // taId1 holds Q1 and Q3 on same script
        });

        it('One TA receives all questions', async () => {
            await createScript(new mongoose.Types.ObjectId());

            // 1 TA, 3 questions
            const result = await AllocationService.allocateByQuestion(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );

            expect(result).toHaveLength(3);
            for (const alloc of result) {
                expect(alloc.ta.toString()).toBe(taId1.toString());
            }
        });

        it('More TAs than questions works (some TAs receive no questions, no empty Allocation records are created)', async () => {
            await createScript(new mongoose.Types.ObjectId());

            // 3 TAs, 2 questions (update exam to 2 questions)
            await Exam.updateOne({ _id: testExamId }, { $set: { numberOfQuestions: 2 } });

            const result = await AllocationService.allocateByQuestion(
                testExamId.toString(),
                [taId1.toString(), taId2.toString(), taId3.toString()],
                professorId.toString()
            );

            // 1 script * 2 questions = 2 allocations
            expect(result).toHaveLength(2);
            
            const ta1Count = result.filter(a => a.ta.toString() === taId1.toString()).length;
            const ta2Count = result.filter(a => a.ta.toString() === taId2.toString()).length;
            const ta3Count = result.filter(a => a.ta.toString() === taId3.toString()).length;

            expect(ta1Count).toBe(1);
            expect(ta2Count).toBe(1);
            expect(ta3Count).toBe(0); // ta3 receives no questions
        });

        it('duplicate same-question allocation is prevented by the existing model constraints', async () => {
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
    });

    describe('QUESTION Validation and Edge Cases', () => {
        it('No selected TAs is rejected', async () => {
            await createScript(new mongoose.Types.ObjectId());
            await expect(
                AllocationService.allocateByQuestion(
                    testExamId.toString(),
                    [],
                    professorId.toString()
                )
            ).rejects.toThrow('At least one selected TA must be provided for allocation');
        });

        it('No eligible scripts is rejected', async () => {
            await expect(
                AllocationService.allocateByQuestion(
                    testExamId.toString(),
                    [taId1.toString()],
                    professorId.toString()
                )
            ).rejects.toThrow('No eligible scripts found for allocation');
        });

        it('numberOfQuestions = 0 is rejected', async () => {
            await createScript(new mongoose.Types.ObjectId());
            await Exam.updateOne({ _id: testExamId }, { $set: { numberOfQuestions: 0 } });

            await expect(
                AllocationService.allocateByQuestion(
                    testExamId.toString(),
                    [taId1.toString()],
                    professorId.toString()
                )
            ).rejects.toThrow('Invalid number of questions: 0');
        });

        it('invalid/non-integer numberOfQuestions is rejected', async () => {
            await createScript(new mongoose.Types.ObjectId());
            
            // Decimal
            await Exam.updateOne({ _id: testExamId }, { $set: { numberOfQuestions: 2.5 } });
            await expect(
                AllocationService.allocateByQuestion(
                    testExamId.toString(),
                    [taId1.toString()],
                    professorId.toString()
                )
            ).rejects.toThrow('Invalid number of questions: 2.5');

            // Negative
            await Exam.updateOne({ _id: testExamId }, { $set: { numberOfQuestions: -1 } });
            await expect(
                AllocationService.allocateByQuestion(
                    testExamId.toString(),
                    [taId1.toString()],
                    professorId.toString()
                )
            ).rejects.toThrow('Invalid number of questions: -1');
        });

        it('inactive scripts are excluded', async () => {
            const active = await createScript(new mongoose.Types.ObjectId(), true);
            await createScript(new mongoose.Types.ObjectId(), false);

            const result = await AllocationService.allocateByQuestion(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );

            expect(result.every(a => a.answerScript.toString() === active._id.toString())).toBe(true);
        });

        it('unidentified/needsManualId scripts are excluded', async () => {
            const activeIdentified = await createScript(new mongoose.Types.ObjectId(), true, false);
            await createScript(null, true, false);
            await createScript(new mongoose.Types.ObjectId(), true, true);

            const result = await AllocationService.allocateByQuestion(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );

            expect(result.every(a => a.answerScript.toString() === activeIdentified._id.toString())).toBe(true);
        });
    });

    describe('QUESTION Re-run Safety Checks', () => {
        it('allocation rerun works before grading begins', async () => {
            await createScript(new mongoose.Types.ObjectId());

            // Run 1
            const result1 = await AllocationService.allocateByQuestion(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );
            expect(result1).toHaveLength(3);

            // Run 2
            const result2 = await AllocationService.allocateByQuestion(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );
            expect(result2).toHaveLength(3);

            const count = await Allocation.countDocuments({ exam: testExamId });
            expect(count).toBe(3);
        });

        it('allocation rerun is rejected after grading begins', async () => {
            await createScript(new mongoose.Types.ObjectId());

            const result = await AllocationService.allocateByQuestion(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );

            await Allocation.updateOne(
                { _id: result[0]._id },
                { $set: { status: AllocationStatus.IN_PROGRESS } }
            );

            await expect(
                AllocationService.allocateByQuestion(
                    testExamId.toString(),
                    [taId1.toString()],
                    professorId.toString()
                )
            ).rejects.toThrow('Cannot re-run allocation: grading has already commenced');
        });
    });

    describe('Existing EQUAL Allocation Regression', () => {
        it('existing EQUAL allocation still works', async () => {
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());

            const result = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString(), taId2.toString()],
                professorId.toString()
            );

            expect(result).toHaveLength(2);
            expect(result[0].rule).toBe(AllocationRule.EQUAL);
            expect(result[0].question).toBeUndefined();
        });
    });

    describe('API Gating validation for QUESTION rule', () => {
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
                    rule: AllocationRule.QUESTION,
                    taIds: [taId1.toString()]
                })
            });

            const res = await allocatePOST(req, { params: Promise.resolve({ id: testExamId.toString() }) });
            expect(res.status).toBe(403);
        });

        it('ingestion approval gate remains enforced', async () => {
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
                    rule: AllocationRule.QUESTION,
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
