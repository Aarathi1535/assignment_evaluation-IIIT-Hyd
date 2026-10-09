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


import { GET as scriptGET } from '../app/api/scripts/[id]/route';
import { POST as submitPOST } from '../app/api/scripts/[id]/submit/route';
import { POST as bulkPOST } from '../app/api/exams/[id]/submissions/bulk/route';
import { DEFAULT_BULK_TIMEOUT_MS } from '../services/GradingService';

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
        const query: Record<string, unknown> = {
            ta: ta._id,
            exam: exam._id,
            status: { $in: [AllocationStatus.PENDING, AllocationStatus.IN_PROGRESS] }
        };
        const explainResult: any = await Allocation.find(query)
            .sort({ createdAt: 1, _id: 1 })
            .limit(1)
            .explain('executionStats');

        expect(explainResult).toBeDefined();
        const winningPlan = explainResult.queryPlanner?.winningPlan || explainResult.executionStats;
        expect(JSON.stringify(winningPlan)).toContain('IXSCAN');
        expect(JSON.stringify(winningPlan)).toContain('ta_1_exam_1_status_1_createdAt_1__id_1');

        // Also verify pagination query with _id $ne exclusion uses the intended compound index
        const queryWithExclude = {
            ...query,
            _id: { $ne: new mongoose.Types.ObjectId() }
        };
        const explainExclude: any = await Allocation.find(queryWithExclude)
            .sort({ createdAt: 1, _id: 1 })
            .limit(1)
            .explain('executionStats');
        const planExclude = explainExclude.queryPlanner?.winningPlan || explainExclude.executionStats;
        expect(JSON.stringify(planExclude)).toContain('IXSCAN');
        expect(JSON.stringify(planExclude)).toContain('ta_1_exam_1_status_1_createdAt_1__id_1');
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
        expect(duration).toBeLessThan(DEFAULT_BULK_TIMEOUT_MS);
    });

    it('4. Restores _id as secondary sort key for deterministic ordering with equal createdAt', async () => {
        const tieExam = await Exam.create({
            title: 'Tie Breaker Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.PUBLISHED,
            numberOfQuestions: 10,
            isActive: true,
        });
        const testScript1 = await AnswerScript.create({ exam: tieExam._id, candidateStudentId: 'TIE_1', isActive: true });
        const testScript2 = await AnswerScript.create({ exam: tieExam._id, candidateStudentId: 'TIE_2', isActive: true });
        const fixedDate = new Date('2026-10-09T12:00:00.000Z');

        const allocFirst = await Allocation.create({
            _id: new mongoose.Types.ObjectId('111111111111111111111111'),
            exam: tieExam._id,
            ta: ta._id,
            answerScript: testScript1._id,
            allocatedBy: prof._id,
            rule: AllocationRule.EQUAL,
            status: AllocationStatus.PENDING,
            createdAt: fixedDate,
        });

        const allocSecond = await Allocation.create({
            _id: new mongoose.Types.ObjectId('222222222222222222222222'),
            exam: tieExam._id,
            ta: ta._id,
            answerScript: testScript2._id,
            allocatedBy: prof._id,
            rule: AllocationRule.EQUAL,
            status: AllocationStatus.PENDING,
            createdAt: fixedDate,
        });

        const AllocationService = (await import('../services/AllocationService')).default;

        // Without currentAllocationId, smaller _id is chosen deterministically
        const next1 = await AllocationService.getNextAllocation(ta._id.toString(), tieExam._id.toString());
        expect(next1).not.toBeNull();
        expect(next1?.allocationId).toBe(allocFirst._id.toString());

        // When passing currentAllocationId = allocFirst._id, advances deterministically to allocSecond
        const next2 = await AllocationService.getNextAllocation(ta._id.toString(), tieExam._id.toString(), allocFirst._id.toString());
        expect(next2).not.toBeNull();
        expect(next2?.allocationId).toBe(allocSecond._id.toString());
    });

    it('5. Verifies database timing reports non-zero on DB operations and zero on zero-query operations', async () => {
        // Case A: Endpoint executing database operations returns non-zero db;dur and round trips >= 1
        const resWithDb = await scriptGET(
            new NextRequest(`http://localhost:3000/api/scripts/${scripts[0]._id}`, { method: 'GET' }),
            { params: Promise.resolve({ id: scripts[0]._id.toString() }) }
        );
        expect(resWithDb.status).toBe(200);
        const serverTimingHeader = resWithDb.headers.get('Server-Timing');
        expect(serverTimingHeader).toBeDefined();
        expect(serverTimingHeader).toContain('db;dur=');

        const matchDur = serverTimingHeader?.match(/db;dur=([\d.]+)/);
        expect(matchDur).toBeTruthy();
        const dbDur = parseFloat(matchDur![1]);
        expect(dbDur).toBeGreaterThan(0);

        const matchTrips = serverTimingHeader?.match(/round_trips_(\d+)/);
        expect(matchTrips).toBeTruthy();
        const trips = parseInt(matchTrips![1], 10);
        expect(trips).toBeGreaterThan(0);

        // Case B: Handler with zero database operations reports db;dur=0.0 and round_trips_0
        const { withServerTiming } = await import('../lib/serverTiming');
        const zeroDbHandler = withServerTiming(async () => {
            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        });
        const resZero = await zeroDbHandler(new NextRequest('http://localhost:3000/api/zero-test', { method: 'GET' }));
        const zeroTimingHeader = resZero.headers.get('Server-Timing');
        expect(zeroTimingHeader).toContain('db;dur=0.0');
        expect(zeroTimingHeader).toContain('round_trips_0');
    });

    it('6. Verifies MongoClient command monitoring is attached directly to driver instance, avoids duplicates, and increments duration and round trips', async () => {
        const { attachCommandMonitoring, timingContext } = await import('../lib/serverTiming');
        const client = mongoose.connection.getClient() as any;
        expect(client).toBeDefined();

        // 1. Listeners are attached directly to the actual MongoClient instance
        const initialSucceeded = client.listenerCount('commandSucceeded');
        const initialFailed = client.listenerCount('commandFailed');
        expect(initialSucceeded).toBeGreaterThan(0);
        expect(initialFailed).toBeGreaterThan(0);

        // 2. Avoids duplicate listeners across reconnects / re-invocations
        attachCommandMonitoring(client);
        expect(client.listenerCount('commandSucceeded')).toBe(initialSucceeded);
        expect(client.listenerCount('commandFailed')).toBe(initialFailed);

        // 3. Proves a real database operation increments dbRoundTrips and records non-zero duration
        const store = { dbRoundTrips: 0, dbTimeMs: 0 };
        await timingContext.run(store, async () => {
            const foundUser = await User.findById(ta._id).lean();
            expect(foundUser).not.toBeNull();
        });

        expect(store.dbRoundTrips).toBeGreaterThan(0);
        expect(store.dbTimeMs).toBeGreaterThan(0);
    });

    it('7. Verifies bulk submission transaction-safe timeout semantics: preserves partial progress and records unattempted items without failing completed items', async () => {
        const gradingService = (await import('../services/GradingService')).default;

        const targetAllocs = allocations.slice(100, 104);
        const targetIds = targetAllocs.map(a => a._id.toString());

        // Run bulk submit with small timeout budget to test boundary timeout
        const result = await gradingService.bulkSubmit({
            examId: exam._id.toString(),
            userId: ta._id.toString(),
            userRole: UserRole.TA,
            allocationIds: targetIds,
            confirmed: true,
            timeoutMs: 1, // immediate timeout check at boundary
        });

        expect(result.timedOut).toBe(true);
        // Unattempted items are distinguished from actual execution failures
        expect(result.unattemptedCount).toBeGreaterThan(0);
        expect(result.unattempted.length).toBe(result.unattemptedCount);
        expect(result.failedCount).toBe(0);
        expect(result.failed.length).toBe(0);
        expect(result.unattempted[0].reason).toContain('Unattempted: bulk processing timeout');

        // Total processed allocations correctly tallies submitted + unattempted
        const totalItems = result.submittedCount + result.unattemptedCount;
        expect(totalItems).toBe(targetIds.length);
    });

    it('8. Verifies bulk submission distinguishes actual execution failures from unattempted items', async () => {
        const gradingService = (await import('../services/GradingService')).default;
        const targetAllocs = allocations.slice(110, 113);
        const targetIds = targetAllocs.map(a => a._id.toString());

        let callCount = 0;
        const origSubmitScript = gradingService.submitScript.bind(gradingService);
        const submitSpy = vi.spyOn(gradingService, 'submitScript').mockImplementation(async (opts) => {
            callCount++;
            if (callCount === 1) {
                throw new Error('Script submission database error');
            }
            return origSubmitScript(opts);
        });

        const result = await gradingService.bulkSubmit({
            examId: exam._id.toString(),
            userId: ta._id.toString(),
            userRole: UserRole.TA,
            allocationIds: targetIds,
            confirmed: true,
            timeoutMs: 1,
        });

        submitSpy.mockRestore();

        // 1 failed item due to actual execution error
        expect(result.failedCount).toBe(1);
        expect(result.failed[0].error).toBe('Script submission database error');

        // Remaining items were unattempted due to timeout budget expiration
        expect(result.unattemptedCount).toBeGreaterThan(0);
        expect(result.unattempted[0].reason).toContain('Unattempted: bulk processing timeout');
        expect(result.timedOut).toBe(true);
    });
});