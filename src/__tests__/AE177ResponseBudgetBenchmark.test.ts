/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Rubric from '../models/Rubric';
import Grade from '../models/Grade';

vi.spyOn(mongoose, 'set').mockImplementation(((key: any, val: any) => {
    if (key === 'monitorCommands') return mongoose;
    // @ts-expect-error - mongoose.options is a hidden property
    return (mongoose.options as any)[key] = val;
}) as any);

import { GET as scriptGET } from '../app/api/scripts/[id]/route';
import { POST as submitPOST } from '../app/api/scripts/[id]/submit/route';
import { POST as bulkPOST } from '../app/api/exams/[id]/submissions/bulk/route';

import Batch, { BatchStatus } from '../models/Batch';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';

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

vi.mock('../services/DerivedStorageService', async () => {
    const { Readable } = await import('node:stream');
    return {
        default: {
            openDerivedPage: vi.fn().mockImplementation(() => Promise.resolve({
                stream: Readable.from([Buffer.from('test')]),
                size: 4
            }))
        }
    };
});

describe('AE-177: Response Budget Benchmark', () => {
    let ta: any;
    let prof: any;
    let course: any;
    let exam: any;
    let scripts: any[] = [];
    let allocations: any[] = [];
    let rubric: any;
    let testBatch: any;

    beforeAll(async () => {
        await User.init();
        await Course.init();
        await Exam.init();
        await AnswerScript.init();
        await Allocation.init();
        await Rubric.init();
        await Grade.init();
        await Batch.init();
        await IngestionPage.init();
    });

    beforeEach(async () => {
        await Grade.deleteMany({});
        await Allocation.deleteMany({});
        await AnswerScript.deleteMany({});
        await Exam.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});
        await Rubric.deleteMany({});
        await Batch.deleteMany({});
        await IngestionPage.deleteMany({});

        prof = await User.create({
            name: 'Prof. Test',
            email: 'prof@test.edu',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        ta = await User.create({
            name: `TA Benchmark`,
            email: `tabench@test.edu`,
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        course = await Course.create({
            courseCode: 'BM101',
            courseName: 'Benchmark 101',
            semester: 1,
            academicYear: '2026-2027',
            professor: prof._id,
            teachingAssistants: [ta._id],
            isActive: true
        });

        exam = await Exam.create({
            title: 'Benchmark Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.PUBLISHED,
            numberOfQuestions: 10,
            isActive: true
        });

        rubric = await Rubric.create({
            exam: exam._id,
            questions: Array.from({ length: 10 }).map((_, i) => ({
                questionNumber: i + 1,
                maxMarks: 10,
                criteria: [{ criterionName: 'Perfect', points: 10 }]
            })),
            createdBy: prof._id
        });

        testBatch = await Batch.create({
            batchId: 'BENCH_BATCH',
            exam: exam._id,
            uploadedBy: prof._id,
            status: BatchStatus.DONE
        });

        scripts = [];
        allocations = [];
        for (let i = 0; i < 200; i++) {
            const script = await AnswerScript.create({
                exam: exam._id,
                candidateStudentId: `STU${i}`,
                isActive: true
            });
            scripts.push(script);

            for (let p = 1; p <= 20; p++) {
                await IngestionPage.create({
                    batchId: testBatch.batchId,
                    job: new mongoose.Types.ObjectId(),
                    fileId: `file${i}`,
                    fileIndex: i,
                    answerScript: script._id,
                    pageNumber: p,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `bench/test_${p}.png`
                });
            }

            const alloc = await Allocation.create({
                exam: exam._id,
                ta: ta._id,
                answerScript: script._id,
                allocatedBy: prof._id,
                rule: AllocationRule.EQUAL,
                status: AllocationStatus.IN_PROGRESS
            });
            allocations.push(alloc);

            for (let q = 1; q <= 10; q++) {
                await Grade.create({
                    answerScript: script._id,
                    rubric: rubric._id,
                    gradedBy: ta._id,
                    question: q,
                    marksAwarded: [{ criterionId: new mongoose.Types.ObjectId(), criterionName: 'Perfect', score: 10 }],
                    totalScore: 10,
                    isFinal: false
                });
            }
        }

        mockSessionUser = {
            id: ta._id.toString(),
            email: ta.email,
            name: ta.name,
            role: ta.role,
        };
    });

    afterEach(() => {
        mockSessionUser = null;
        vi.clearAllMocks();
    });

    it('1. Verifies index usage on getNextAllocation', async () => {
        const query = {
            ta: ta._id,
            exam: exam._id,
            status: { $in: [AllocationStatus.PENDING, AllocationStatus.IN_PROGRESS] }
        };
        const explainResult: any = await Allocation.find(query)
            .sort({ createdAt: 1 })
            .limit(1)
            .explain('executionStats');

        expect(explainResult).toBeDefined();
        const stats = explainResult.executionStats || explainResult.queryPlanner;
        expect(JSON.stringify(stats)).toContain('IXSCAN');
        expect(JSON.stringify(stats)).toContain('ta_1_exam_1_status_1_createdAt_1');
    });

    it('2. Benchmarks individual APIs (100 iterations)', async () => {
        // Warmup
        await submitPOST(new NextRequest(`http://localhost:3000/api/scripts/${scripts[0]._id}/submit`, { method: 'POST' }), { params: Promise.resolve({ id: scripts[0]._id.toString() }) });
        await scriptGET(new NextRequest(`http://localhost:3000/api/scripts/${scripts[0]._id}`, { method: 'GET' }), { params: Promise.resolve({ id: scripts[0]._id.toString() }) });

        const iterations = 100;
        const submitDurations: number[] = [];
        const getDurations: number[] = [];

        for (let i = 1; i <= iterations; i++) {
            const scriptId = scripts[i]._id.toString();

            const startGet = performance.now();
            const resGet = await scriptGET(new NextRequest(`http://localhost:3000/api/scripts/${scriptId}`, { method: 'GET' }), { params: Promise.resolve({ id: scriptId }) });
            const durGet = performance.now() - startGet;
            getDurations.push(durGet);
            expect(resGet.status).toBe(200);

            const startSubmit = performance.now();
            const resSubmit = await submitPOST(new NextRequest(`http://localhost:3000/api/scripts/${scriptId}/submit`, { method: 'POST' }), { params: Promise.resolve({ id: scriptId }) });
            const durSubmit = performance.now() - startSubmit;
            submitDurations.push(durSubmit);
            expect(resSubmit.status).toBe(200);
        }

        submitDurations.sort((a, b) => a - b);
        getDurations.sort((a, b) => a - b);
        const submitP50 = submitDurations[Math.floor(iterations * 0.5)];
        const submitP95 = submitDurations[Math.floor(iterations * 0.95)];
        const getP50 = getDurations[Math.floor(iterations * 0.5)];
        const getP95 = getDurations[Math.floor(iterations * 0.95)];

        console.log(`\n[AE-177 Benchmark: GET Script]`);
        console.log(`p50: ${getP50.toFixed(2)} ms, p95: ${getP95.toFixed(2)} ms`);

        console.log(`\n[AE-177 Benchmark: POST submitScript]`);
        console.log(`p50: ${submitP50.toFixed(2)} ms, p95: ${submitP95.toFixed(2)} ms`);

        expect(getP95).toBeLessThan(300);
        expect(submitP95).toBeLessThan(300);
    });

    it('3. Benchmarks Bulk Submit (50 items)', async () => {
        // Collect 50 allocations that are IN_PROGRESS
        const bulkAllocationIds = allocations.slice(150, 200).map(a => a._id.toString());

        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/submissions/bulk`, {
            method: 'POST',
            body: JSON.stringify({
                allocationIds: bulkAllocationIds,
                confirmed: true
            })
        });

        const start = performance.now();
        const res = await bulkPOST(req, { params: Promise.resolve({ id: exam._id.toString() }) });
        const duration = performance.now() - start;

        expect(res.status).toBe(200);
        console.log(`\n[AE-177 Benchmark: POST Bulk Submit (50 items)]`);
        console.log(`Total duration: ${duration.toFixed(2)} ms`);
        expect(duration).toBeLessThan(2000);
    });
});