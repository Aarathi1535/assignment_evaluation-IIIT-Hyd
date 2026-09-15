/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus } from '../models/Allocation';
import AuditLog from '../models/AuditLog';
import AllocationService, { TaProgressResult } from '../services/AllocationService';
import ProgressEventService, { ProgressUpdateEvent } from '../services/ProgressEventService';
import { HttpError } from '../lib/errors';

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

describe('AE-118: Load-Test Progress Updates (20 TAs)', () => {
  let progressGET: any;
  let streamGET: any;

  let prof: any;
  let tas: any[] = [];
  let students: any[] = [];
  let course: any;
  let exam: any;

  beforeAll(async () => {
    progressGET = (await import('../app/api/exams/[id]/progress/route')).GET;
    streamGET = (await import('../app/api/exams/[id]/progress/stream/route')).GET;

    await User.init();
    await Course.init();
    await Exam.init();
    await AnswerScript.init();
    await Allocation.init();
    await AuditLog.init();
  });

  afterAll(async () => {
    ProgressEventService.clearListeners();
    await ProgressEventService.stopChangeStream();
  });

  beforeEach(async () => {
    ProgressEventService.clearListeners();
    mockSessionUser = null;

    await AuditLog.deleteMany({});
    await Allocation.deleteMany({});
    await AnswerScript.deleteMany({});
    await Exam.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    // 1. Create Professor
    prof = await User.create({
      name: 'Prof. Minerva McGonagall',
      email: 'mcgonagall@iiit.ac.in',
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true,
    });

    // 2. Create 20 Teaching Assistants
    tas = [];
    for (let i = 1; i <= 20; i++) {
      const pad = i.toString().padStart(2, '0');
      const ta = await User.create({
        name: `Teaching Assistant ${pad}`,
        email: `ta${pad}@iiit.ac.in`,
        password: 'password123',
        role: UserRole.TA,
        isActive: true,
      });
      tas.push(ta);
    }

    // 3. Create Course with 20 TAs registered
    course = await Course.create({
      courseCode: 'CS301',
      courseName: 'Concurrent Systems & Load Scaling',
      semester: 1,
      academicYear: '2026-2027',
      professor: prof._id,
      teachingAssistants: tas.map((t) => t._id),
      isActive: true,
    });

    // 4. Create Exam with grading deadline set
    const gradingDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
    exam = await Exam.create({
      title: 'CS301 Comprehensive Exam (1,000 Scripts, 20 TAs)',
      course: course._id,
      createdBy: prof._id,
      examDate: new Date(),
      gradingDeadline,
      totalMarks: 100,
      status: ExamStatus.PUBLISHED,
      numberOfQuestions: 5,
      isActive: true,
    });

    // Set default session to Professor
    mockSessionUser = {
      id: prof._id.toString(),
      role: UserRole.PROFESSOR,
      email: prof.email,
      name: prof.name,
    };
  });

  /**
   * Helper to generate N answer scripts in bulk with unique students
   */
  async function seedAnswerScripts(count: number): Promise<any[]> {
    const studentDocs = [];
    for (let i = 1; i <= count; i++) {
      studentDocs.push({
        name: `Student ${i.toString().padStart(4, '0')}`,
        email: `student${i.toString().padStart(4, '0')}@iiit.ac.in`,
        password: 'password123',
        role: UserRole.STUDENT,
        isActive: true,
      });
    }
    students = await User.insertMany(studentDocs);

    const scriptDocs = students.map((s, idx) => ({
      exam: exam._id,
      student: s._id,
      batchId: 'batch-load-1',
      fileIndex: idx,
      startPageNumber: idx * 2 + 1,
      endPageNumber: idx * 2 + 2,
      pageCount: 2,
      isActive: true,
    }));

    return await AnswerScript.insertMany(scriptDocs);
  }

  // =========================================================================
  // Test 1: 20-TA Balanced Workload Generation & Baseline Aggregation
  // =========================================================================
  it('1. Generates 1,000 allocations across 20 TAs with exact equal distribution and baseline aggregation', async () => {
    await seedAnswerScripts(1000);

    const taIdStrings = tas.map((t) => t._id.toString());
    const result = await AllocationService.allocateEqual(
      exam._id.toString(),
      taIdStrings,
      prof._id.toString()
    );

    expect(result.length).toBe(1000);

    // Verify database count
    const totalInDb = await Allocation.countDocuments({ exam: exam._id });
    expect(totalInDb).toBe(1000);

    // Verify each of the 20 TAs received exactly 50 allocations (1000 / 20 = 50)
    for (const ta of tas) {
      const taAllocCount = await Allocation.countDocuments({ exam: exam._id, ta: ta._id });
      expect(taAllocCount).toBe(50);
    }

    // Baseline progress verification
    const progress = await AllocationService.getProgress(exam._id.toString());
    expect(progress.total).toBe(1000);
    expect(progress.graded).toBe(0);
    expect(progress.progress.length).toBe(20);
    expect(progress.cohortMedianCompletionRatio).toBe(0);
    expect(progress.bottleneckCount).toBe(0);

    for (const taProg of progress.progress) {
      expect(taProg.total).toBe(50);
      expect(taProg.graded).toBe(0);
      expect(taProg.completionRatio).toBe(0);
      expect(taProg.isBottleneck).toBe(false);
    }
  });

  // =========================================================================
  // Test 2: 20-TA Concurrent Claim Operations
  // =========================================================================
  it('2. Handles concurrent claiming across 20 TAs without race conditions or state corruption', async () => {
    await seedAnswerScripts(1000);
    const taIdStrings = tas.map((t) => t._id.toString());
    await AllocationService.allocateEqual(exam._id.toString(), taIdStrings, prof._id.toString());

    // Fetch 5 pending allocations for each of the 20 TAs (100 allocations total)
    const allocationsByTa: Record<string, any[]> = {};
    for (const ta of tas) {
      const taAllocs = await Allocation.find({ exam: exam._id, ta: ta._id, status: AllocationStatus.PENDING })
        .limit(5)
        .lean();
      allocationsByTa[ta._id.toString()] = taAllocs;
    }

    // Execute 100 concurrent claims simultaneously across all 20 TAs
    const claimPromises: Promise<any>[] = [];
    for (const ta of tas) {
      const taId = ta._id.toString();
      for (const alloc of allocationsByTa[taId]) {
        claimPromises.push(
          AllocationService.claimAllocation(alloc._id.toString(), taId)
        );
      }
    }

    const claimedResults = await Promise.all(claimPromises);
    expect(claimedResults.length).toBe(100);

    for (const claimed of claimedResults) {
      expect(claimed.status).toBe(AllocationStatus.IN_PROGRESS);
      expect(claimed.claimedAt).toBeDefined();
    }

    // Verify in database: exactly 100 IN_PROGRESS, 900 PENDING
    const inProgressCount = await Allocation.countDocuments({ exam: exam._id, status: AllocationStatus.IN_PROGRESS });
    const pendingCount = await Allocation.countDocuments({ exam: exam._id, status: AllocationStatus.PENDING });
    expect(inProgressCount).toBe(100);
    expect(pendingCount).toBe(900);

    // Concurrency conflict test: Re-claiming an IN_PROGRESS allocation must reject with 409
    const sampleAlloc = allocationsByTa[tas[0]._id.toString()][0];
    await expect(
      AllocationService.claimAllocation(sampleAlloc._id.toString(), tas[0]._id.toString())
    ).rejects.toThrow(HttpError);

    // Cross-TA forbidden test: TA-02 attempting to claim TA-01's allocation must reject with 403
    const ta1Pending = await Allocation.findOne({ exam: exam._id, ta: tas[0]._id, status: AllocationStatus.PENDING });
    await expect(
      AllocationService.claimAllocation(ta1Pending!._id.toString(), tas[1]._id.toString())
    ).rejects.toThrow(HttpError);
  });

  // =========================================================================
  // Test 3: 20-TA Concurrent Completion & Progress Aggregation Integrity
  // =========================================================================
  it('3. Handles concurrent completions across 20 TAs maintaining exact progress counts and idempotency', async () => {
    await seedAnswerScripts(1000);
    const taIdStrings = tas.map((t) => t._id.toString());
    await AllocationService.allocateEqual(exam._id.toString(), taIdStrings, prof._id.toString());

    // Claim 10 allocations per TA (200 allocations total)
    for (const ta of tas) {
      const taAllocs = await Allocation.find({ exam: exam._id, ta: ta._id, status: AllocationStatus.PENDING }).limit(10);
      for (const a of taAllocs) {
        a.status = AllocationStatus.IN_PROGRESS;
        a.claimedAt = new Date();
        await a.save();
      }
    }

    // Concurrently complete 10 allocations for each of the 20 TAs (200 concurrent completions)
    const inProgressAllocs = await Allocation.find({ exam: exam._id, status: AllocationStatus.IN_PROGRESS });
    expect(inProgressAllocs.length).toBe(200);

    const completionPromises = inProgressAllocs.map((alloc) =>
      AllocationService.markCompleted(alloc._id.toString(), {
        actingUserId: alloc.ta.toString(),
        actingUserRole: UserRole.TA,
      })
    );

    const completedResults = await Promise.all(completionPromises);
    expect(completedResults.length).toBe(200);

    // Verify DB counts
    const completedCount = await Allocation.countDocuments({ exam: exam._id, status: AllocationStatus.COMPLETED });
    expect(completedCount).toBe(200);

    // Verify aggregation via getProgress
    const progress = await AllocationService.getProgress(exam._id.toString());
    expect(progress.total).toBe(1000);
    expect(progress.graded).toBe(200);
    expect(progress.cohortMedianCompletionRatio).toBe(0.20); // 10 / 50 = 0.20 for all 20 TAs

    for (const taProg of progress.progress) {
      expect(taProg.total).toBe(50);
      expect(taProg.graded).toBe(10);
      expect(taProg.completionRatio).toBe(0.20);
      expect(taProg.isBottleneck).toBe(false);
    }

    // Double completion attempt must reject with 409 and not alter counts
    const sampleCompleted = inProgressAllocs[0];
    await expect(
      AllocationService.markCompleted(sampleCompleted._id.toString(), {
        actingUserId: sampleCompleted.ta.toString(),
        actingUserRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);

    const progressAfterDuplicate = await AllocationService.getProgress(exam._id.toString());
    expect(progressAfterDuplicate.graded).toBe(200);
  });

  // =========================================================================
  // Test 4: SSE & Real-Time Event Dispatch Stability Under 20-TA Concurrency
  // =========================================================================
  it('4. Dispatches live progress events to multiple concurrent SSE listeners without message loss', async () => {
    await seedAnswerScripts(200);
    const taIdStrings = tas.map((t) => t._id.toString());
    await AllocationService.allocateEqual(exam._id.toString(), taIdStrings, prof._id.toString());

    // Put 1 allocation per TA in IN_PROGRESS
    const allocsToComplete: any[] = [];
    for (const ta of tas) {
      const a = await Allocation.findOne({ exam: exam._id, ta: ta._id, status: AllocationStatus.PENDING });
      a!.status = AllocationStatus.IN_PROGRESS;
      a!.claimedAt = new Date();
      await a!.save();
      allocsToComplete.push(a!);
    }
    expect(allocsToComplete.length).toBe(20);

    // Set up 5 concurrent SSE listeners for this exam
    const receivedEventsByListener: ProgressUpdateEvent[][] = [[], [], [], [], []];
    const unsubs: (() => void)[] = [];

    for (let i = 0; i < 5; i++) {
      const listenerIdx = i;
      const unsub = ProgressEventService.subscribe(exam._id.toString(), (event) => {
        receivedEventsByListener[listenerIdx].push(event);
      });
      unsubs.push(unsub);
    }

    // Concurrently complete 20 allocations (1 per TA)
    const completionPromises = allocsToComplete.map((alloc) =>
      AllocationService.markCompleted(alloc._id.toString(), {
        actingUserId: alloc.ta.toString(),
        actingUserRole: UserRole.TA,
      })
    );

    await Promise.all(completionPromises);

    // Cleanup listeners
    unsubs.forEach((u) => u());

    // Verify all 5 listeners received all 20 events
    for (let i = 0; i < 5; i++) {
      expect(receivedEventsByListener[i].length).toBe(20);

      // Verify payload integrity for each event
      for (const event of receivedEventsByListener[i]) {
        expect(event.examId).toBe(exam._id.toString());
        expect(event.taProgress).toBeDefined();
        expect(event.examProgress).toBeDefined();
        expect(event.examProgress.total).toBe(200);
        expect(event.examProgress.graded).toBeGreaterThanOrEqual(1);
        expect(event.examProgress.graded).toBeLessThanOrEqual(20);
        expect(event.timestamp).toBeInstanceOf(Date);
      }
    }

    // Also verify SSE endpoint responds with 200 and text/event-stream headers
    const streamRes = await streamGET(
      new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress/stream`),
      { params: Promise.resolve({ id: exam._id.toString() }) }
    );
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('content-type')).toContain('text/event-stream');
  });

  // =========================================================================
  // Test 5: 20-TA Cohort Bottleneck Detection Under Skewed Progress
  // =========================================================================
  it('5. Correctly calculates cohort median and identifies lagging TAs in a 20-TA distribution', async () => {
    await seedAnswerScripts(1000);
    const taIdStrings = tas.map((t) => t._id.toString());
    await AllocationService.allocateEqual(exam._id.toString(), taIdStrings, prof._id.toString());

    // Skew progress:
    // - 16 TAs complete 45 out of 50 (90% completion)
    // - 4 TAs complete 5 out of 50 (10% completion) -> Bottlenecks (> 20% lag below median 90%)
    for (let i = 0; i < 20; i++) {
      const ta = tas[i];
      const countToComplete = i < 16 ? 45 : 5;
      const taAllocs = await Allocation.find({ exam: exam._id, ta: ta._id }).limit(countToComplete);

      for (const a of taAllocs) {
        a.status = AllocationStatus.COMPLETED;
        a.completedAt = new Date();
        await a.save();
      }
    }

    const progress = await AllocationService.getProgress(exam._id.toString());

    expect(progress.total).toBe(1000);
    expect(progress.graded).toBe(16 * 45 + 4 * 5); // 720 + 20 = 740
    expect(progress.cohortMedianCompletionRatio).toBe(0.90);
    expect(progress.bottleneckCount).toBe(4);

    // Verify individual TA bottleneck flags
    const bottlenecks = progress.progress.filter((p) => p.isBottleneck);
    const nonBottlenecks = progress.progress.filter((p) => !p.isBottleneck);

    expect(bottlenecks.length).toBe(4);
    expect(nonBottlenecks.length).toBe(16);

    for (const b of bottlenecks) {
      expect(b.completionRatio).toBe(0.10);
      expect(b.graded).toBe(5);
      expect(b.total).toBe(50);
    }

    for (const nb of nonBottlenecks) {
      expect(nb.completionRatio).toBe(0.90);
      expect(nb.graded).toBe(45);
      expect(nb.total).toBe(50);
    }
  });

  // =========================================================================
  // Test 6: High-Concurrency REST API Load & Stream Endpoint
  // =========================================================================
  it('6. Handles high-concurrency REST API requests with sub-100ms response times and consistent data', async () => {
    await seedAnswerScripts(400);
    const taIdStrings = tas.map((t) => t._id.toString());
    await AllocationService.allocateEqual(exam._id.toString(), taIdStrings, prof._id.toString());

    // Complete 10 per TA for 10 TAs (100 completed)
    for (let i = 0; i < 10; i++) {
      const ta = tas[i];
      const taAllocs = await Allocation.find({ exam: exam._id, ta: ta._id }).limit(10);
      for (const a of taAllocs) {
        a.status = AllocationStatus.COMPLETED;
        a.completedAt = new Date();
        await a.save();
      }
    }

    // Fire 50 concurrent GET requests to /api/exams/[id]/progress
    const reqPromises = Array.from({ length: 50 }, () =>
      progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      )
    );

    const responses = await Promise.all(reqPromises);

    expect(responses.length).toBe(50);
    for (const res of responses) {
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(400);
      expect(json.data.graded).toBe(100);
      expect(json.data.progress.length).toBe(20);
    }
  });

  // =========================================================================
  // Test 7: Reassignment Load Across 20-TA Pool
  // =========================================================================
  it('7. Concurrently reassigns allocations between TAs across the 20-TA pool preserving total counts', async () => {
    await seedAnswerScripts(200);
    const taIdStrings = tas.map((t) => t._id.toString());
    await AllocationService.allocateEqual(exam._id.toString(), taIdStrings, prof._id.toString());

    // Initially each TA has 10 allocations (200 / 20 = 10)
    // Concurrently reassign 1 allocation from TA-01 to TA-02, TA-03 to TA-04, ..., TA-19 to TA-20 (10 reassignments)
    const reassignPromises: Promise<any>[] = [];
    for (let i = 0; i < 10; i++) {
      const sourceTa = tas[i * 2];
      const targetTa = tas[i * 2 + 1];

      const alloc = await Allocation.findOne({ exam: exam._id, ta: sourceTa._id, status: AllocationStatus.PENDING });
      expect(alloc).toBeDefined();

      reassignPromises.push(
        AllocationService.reassignAllocation(
          exam._id.toString(),
          alloc!._id.toString(),
          targetTa._id.toString(),
          prof._id.toString()
        )
      );
    }

    const reassignResults = await Promise.all(reassignPromises);
    expect(reassignResults.length).toBe(10);

    // Verify progress aggregation after reassignments
    const progress = await AllocationService.getProgress(exam._id.toString());
    expect(progress.total).toBe(200);
    expect(progress.graded).toBe(0);

    // Odd-index TAs (target TAs: TA-02, TA-04, etc.) should have 11 allocations
    // Even-index TAs (source TAs: TA-01, TA-03, etc.) should have 9 allocations
    for (let i = 0; i < 20; i++) {
      const ta = tas[i];
      const taProg = progress.progress.find((p: TaProgressResult) => p.taId === ta._id.toString());
      expect(taProg).toBeDefined();
      if (i % 2 === 0) {
        expect(taProg!.total).toBe(9);
      } else {
        expect(taProg!.total).toBe(11);
      }
    }
  });
});
