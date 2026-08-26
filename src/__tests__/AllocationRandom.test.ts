import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import Allocation, { AllocationRule, AllocationStatus } from '../models/Allocation';
import Grade from '../models/Grade';
import AnswerScript from '../models/AnswerScript';
import Exam, { IngestionApprovalStatus } from '../models/Exam';
import Course from '../models/Course';
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

describe('Allocation RANDOM Strategy Tests (AE-085)', () => {
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
            numberOfQuestions: 3,
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

    describe('Random Allocation Strategy', () => {
        it('Same seed produces identical script-to-TA mapping across clean re-runs', async () => {
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());

            // Run 1
            const result1 = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString(), taId2.toString(), taId3.toString()],
                professorId.toString(),
                42
            );

            // Clean allocations to run again
            await Allocation.deleteMany({});

            // Run 2
            const result2 = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString(), taId2.toString(), taId3.toString()],
                professorId.toString(),
                42
            );

            expect(result1).toHaveLength(3);
            expect(result2).toHaveLength(3);

            const r1Mapping = result1.map(a => ({ script: a.answerScript.toString(), ta: a.ta.toString() }));
            const r2Mapping = result2.map(a => ({ script: a.answerScript.toString(), ta: a.ta.toString() }));

            expect(r1Mapping).toEqual(r2Mapping);

            // Verify no answerScript appears more than once (AE-089)
            const r1ScriptIds = result1.map(a => a.answerScript.toString());
            expect(new Set(r1ScriptIds).size).toBe(result1.length);
            const r2ScriptIds = result2.map(a => a.answerScript.toString());
            expect(new Set(r2ScriptIds).size).toBe(result2.length);
        });

        it('Different seeds can produce different mappings', async () => {
            // Need a larger set of scripts to guarantee different permutations with high probability
            for (let i = 0; i < 10; i++) {
                await createScript(new mongoose.Types.ObjectId());
            }

            // Run 1 (seed = 42)
            const result1 = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString(), taId2.toString(), taId3.toString()],
                professorId.toString(),
                42
            );

            // Run 2 (seed = 1337)
            const result2 = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString(), taId2.toString(), taId3.toString()],
                professorId.toString(),
                1337
            );

            expect(result1).toHaveLength(10);
            expect(result2).toHaveLength(10);

            const r1Mapping = result1.map(a => ({ script: a.answerScript.toString(), ta: a.ta.toString() }));
            const r2Mapping = result2.map(a => ({ script: a.answerScript.toString(), ta: a.ta.toString() }));

            // Should differ
            expect(r1Mapping).not.toEqual(r2Mapping);
        });

        it('Seed and rule RANDOM are persisted on every created allocation, and question is not set', async () => {
            await createScript(new mongoose.Types.ObjectId());

            const result = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString(),
                999
            );

            expect(result).toHaveLength(1);
            expect(result[0].rule).toBe(AllocationRule.RANDOM);
            expect(result[0].seed).toBe(999);
            expect(result[0].question).toBeUndefined();
            expect(result[0].status).toBe(AllocationStatus.PENDING);
        });

        it('Workload remains balanced with difference <= 1', async () => {
            for (let i = 0; i < 8; i++) {
                await createScript(new mongoose.Types.ObjectId());
            }

            // 8 scripts, 3 TAs
            const result = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString(), taId2.toString(), taId3.toString()],
                professorId.toString(),
                123
            );

            expect(result).toHaveLength(8);

            const ta1Count = result.filter(a => a.ta.toString() === taId1.toString()).length;
            const ta2Count = result.filter(a => a.ta.toString() === taId2.toString()).length;
            const ta3Count = result.filter(a => a.ta.toString() === taId3.toString()).length;

            expect(Math.abs(ta1Count - ta2Count)).toBeLessThanOrEqual(1);
            expect(Math.abs(ta1Count - ta3Count)).toBeLessThanOrEqual(1);
            expect(Math.abs(ta2Count - ta3Count)).toBeLessThanOrEqual(1);

            // Verify no answerScript appears more than once (AE-089)
            const scriptIds = result.map(a => a.answerScript.toString());
            expect(new Set(scriptIds).size).toBe(result.length);
        });

        it('One TA receives all eligible scripts', async () => {
            for (let i = 0; i < 3; i++) {
                await createScript(new mongoose.Types.ObjectId());
            }

            const result = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString(),
                77
            );

            expect(result).toHaveLength(3);
            expect(result.every(a => a.ta.toString() === taId1.toString())).toBe(true);
        });

        it('More TAs than scripts works correctly (some TAs receive no allocations, difference <= 1)', async () => {
            await createScript(new mongoose.Types.ObjectId());
            await createScript(new mongoose.Types.ObjectId());

            // 2 scripts, 3 TAs
            const result = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString(), taId2.toString(), taId3.toString()],
                professorId.toString(),
                88
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

        it('verify every eligible script is allocated exactly once with no duplicate answerScript allocations across multiple different seeds (AE-089)', async () => {
            const scripts = [
                await createScript(new mongoose.Types.ObjectId()),
                await createScript(new mongoose.Types.ObjectId()),
                await createScript(new mongoose.Types.ObjectId()),
                await createScript(new mongoose.Types.ObjectId()),
                await createScript(new mongoose.Types.ObjectId())
            ];

            const seeds = [42, 1337, 2026, 9999];
            for (const seed of seeds) {
                // Clean existing allocations to start fresh
                await Allocation.deleteMany({});

                const result = await AllocationService.allocateRandom(
                    testExamId.toString(),
                    [taId1.toString(), taId2.toString(), taId3.toString()],
                    professorId.toString(),
                    seed
                );

                expect(result).toHaveLength(scripts.length);

                // Verify every eligible script is allocated exactly once
                const scriptIds = result.map(a => a.answerScript.toString());
                const uniqueScriptIds = new Set(scriptIds);
                expect(uniqueScriptIds.size).toBe(scripts.length);

                for (const script of scripts) {
                    expect(scriptIds.filter(id => id === script._id.toString())).toHaveLength(1);
                }
            }
        });
    });

    describe('RANDOM Validation and Edge Cases', () => {
        it('No eligible scripts returns 400', async () => {
            await expect(
                AllocationService.allocateRandom(
                    testExamId.toString(),
                    [taId1.toString()],
                    professorId.toString(),
                    10
                )
            ).rejects.toThrow('No eligible scripts found for allocation');
        });

        it('No selected TAs returns 400', async () => {
            await createScript(new mongoose.Types.ObjectId());
            await expect(
                AllocationService.allocateRandom(
                    testExamId.toString(),
                    [],
                    professorId.toString(),
                    10
                )
            ).rejects.toThrow('At least one selected TA must be provided for allocation');
        });

        it('Missing seed returns 400', async () => {
            await createScript(new mongoose.Types.ObjectId());
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const missingSeed: any = undefined;
            await expect(
                AllocationService.allocateRandom(
                    testExamId.toString(),
                    [taId1.toString()],
                    professorId.toString(),
                    missingSeed
                )
            ).rejects.toThrow('Invalid seed: seed must be a finite integer number');
        });

        it('Invalid seed returns 400', async () => {
            await createScript(new mongoose.Types.ObjectId());

            // Decimal seed
            await expect(
                AllocationService.allocateRandom(
                    testExamId.toString(),
                    [taId1.toString()],
                    professorId.toString(),
                    4.2
                )
            ).rejects.toThrow('Invalid seed');

            // Infinity seed
            await expect(
                AllocationService.allocateRandom(
                    testExamId.toString(),
                    [taId1.toString()],
                    professorId.toString(),
                    Infinity
                )
            ).rejects.toThrow('Invalid seed');
        });

        it('Inactive scripts are excluded', async () => {
            const active = await createScript(new mongoose.Types.ObjectId(), true);
            await createScript(new mongoose.Types.ObjectId(), false);

            const result = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString(),
                42
            );

            expect(result).toHaveLength(1);
            expect(result[0].answerScript.toString()).toBe(active._id.toString());
        });

        it('needsManualId scripts are excluded', async () => {
            const active = await createScript(new mongoose.Types.ObjectId(), true, false);
            await createScript(new mongoose.Types.ObjectId(), true, true);

            const result = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString(),
                42
            );

            expect(result).toHaveLength(1);
            expect(result[0].answerScript.toString()).toBe(active._id.toString());
        });

        it('Unidentified scripts are excluded', async () => {
            const active = await createScript(new mongoose.Types.ObjectId(), true, false);
            await createScript(null, true, false);

            const result = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString(),
                42
            );

            expect(result).toHaveLength(1);
            expect(result[0].answerScript.toString()).toBe(active._id.toString());
        });
    });

    describe('RANDOM Re-run Safety Checks', () => {
        it('Re-run clears pending allocations and replaces them', async () => {
            await createScript(new mongoose.Types.ObjectId());

            // Run 1
            await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString(),
                10
            );

            // Run 2
            const result2 = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString(),
                20
            );

            expect(result2).toHaveLength(1);
            expect(result2[0].seed).toBe(20);

            const count = await Allocation.countDocuments({ exam: testExamId });
            expect(count).toBe(1);
        });

        it('Re-run is rejected once grading/allocation progress has commenced', async () => {
            await createScript(new mongoose.Types.ObjectId());

            const result = await AllocationService.allocateRandom(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString(),
                10
            );

            // Mock progress
            await Allocation.updateOne(
                { _id: result[0]._id },
                { $set: { status: AllocationStatus.IN_PROGRESS } }
            );

            await expect(
                AllocationService.allocateRandom(
                    testExamId.toString(),
                    [taId1.toString()],
                    professorId.toString(),
                    20
                )
            ).rejects.toThrow('Cannot re-run allocation: grading has already commenced');
        });
    });

    describe('API Route Gates and Payloads for RANDOM', () => {
        it('Route preserves RBAC gate', async () => {
            mockSessionUser = {
                id: new mongoose.Types.ObjectId().toString(),
                email: 'student@univ.edu',
                name: 'Student User',
                role: UserRole.STUDENT
            };

            const req = new NextRequest(`http://localhost:3000/api/exams/${testExamId}/allocate`, {
                method: 'POST',
                body: JSON.stringify({
                    rule: AllocationRule.RANDOM,
                    taIds: [taId1.toString()],
                    seed: 42
                })
            });

            const res = await allocatePOST(req, { params: Promise.resolve({ id: testExamId.toString() }) });
            expect(res.status).toBe(403);
        });

        it('Route preserves Ingestion Approval gate', async () => {
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
                    rule: AllocationRule.RANDOM,
                    taIds: [taId1.toString()],
                    seed: 42
                })
            });

            const res = await allocatePOST(req, { params: Promise.resolve({ id: testExamId.toString() }) });
            expect(res.status).toBe(403);
            const data = await res.json();
            expect(data.message).toContain('Ingestion has not been approved');
        });

        it('Route returns 400 for missing or invalid seed for RANDOM', async () => {
            mockSessionUser = {
                id: professorId.toString(),
                email: 'prof@univ.edu',
                name: 'Prof User',
                role: UserRole.PROFESSOR
            };

            // Missing seed
            const req1 = new NextRequest(`http://localhost:3000/api/exams/${testExamId}/allocate`, {
                method: 'POST',
                body: JSON.stringify({
                    rule: AllocationRule.RANDOM,
                    taIds: [taId1.toString()]
                })
            });

            const res1 = await allocatePOST(req1, { params: Promise.resolve({ id: testExamId.toString() }) });
            expect(res1.status).toBe(400);

            // Invalid seed
            const req2 = new NextRequest(`http://localhost:3000/api/exams/${testExamId}/allocate`, {
                method: 'POST',
                body: JSON.stringify({
                    rule: AllocationRule.RANDOM,
                    taIds: [taId1.toString()],
                    seed: 'forty-two'
                })
            });

            const res2 = await allocatePOST(req2, { params: Promise.resolve({ id: testExamId.toString() }) });
            expect(res2.status).toBe(400);
        });
    });
});
