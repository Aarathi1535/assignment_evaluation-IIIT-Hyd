import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam from '../models/Exam';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Rubric from '../models/Rubric';
import Grade from '../models/Grade';
import AuditLog from '../models/AuditLog';
import Notification from '../models/Notification';
import AllocationService from '../services/AllocationService';
import ProgressEventService, { ProgressUpdateEvent } from '../services/ProgressEventService';
import gradingService from '../services/GradingService';

let mockSessionUser: { id: string; role: string; email: string } | null = null;

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

describe('AE-168: Progress Propagation on Allocation Reopen', () => {
  let reopenPOST: typeof import('../app/api/allocations/[id]/reopen/route').POST;
  let progressGET: typeof import('../app/api/exams/[id]/progress/route').GET;

  let professorId: mongoose.Types.ObjectId;
  let ta1Id: mongoose.Types.ObjectId;
  let ta2Id: mongoose.Types.ObjectId;
  let student1Id: mongoose.Types.ObjectId;
  let student2Id: mongoose.Types.ObjectId;
  let student3Id: mongoose.Types.ObjectId;
  let student4Id: mongoose.Types.ObjectId;

  let courseId: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let rubricId: mongoose.Types.ObjectId;

  let script1Id: mongoose.Types.ObjectId;
  let script2Id: mongoose.Types.ObjectId;
  let script3Id: mongoose.Types.ObjectId;
  let script4Id: mongoose.Types.ObjectId;

  let allocTa1Script1Id: mongoose.Types.ObjectId;
  let allocTa1Script2Id: mongoose.Types.ObjectId;

  beforeAll(async () => {
    reopenPOST = (await import('../app/api/allocations/[id]/reopen/route')).POST;
    progressGET = (await import('../app/api/exams/[id]/progress/route')).GET;

    await User.init();
    await Course.init();
    await Exam.init();
    await AnswerScript.init();
    await Allocation.init();
    await Rubric.init();
    await Grade.init();
    await AuditLog.init();
    await Notification.init();
  });

  afterAll(async () => {
    ProgressEventService.clearListeners();
    await ProgressEventService.stopChangeStream();
  });

  beforeEach(async () => {
    ProgressEventService.clearListeners();
    mockSessionUser = null;

    await Notification.deleteMany({});
    await AuditLog.deleteMany({});
    await Grade.deleteMany({});
    await Allocation.deleteMany({});
    await AnswerScript.deleteMany({});
    await Rubric.deleteMany({});
    await Exam.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    // 1. Users
    const professor = await User.create({
      name: 'Professor McGonagall',
      email: 'mcgonagall@hogwarts.edu',
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true,
    });
    professorId = professor._id as mongoose.Types.ObjectId;

    const ta1 = await User.create({
      name: 'TA Hermione',
      email: 'hermione@hogwarts.edu',
      password: 'password123',
      role: UserRole.TA,
      isActive: true,
    });
    ta1Id = ta1._id as mongoose.Types.ObjectId;

    const ta2 = await User.create({
      name: 'TA Ron',
      email: 'ron@hogwarts.edu',
      password: 'password123',
      role: UserRole.TA,
      isActive: true,
    });
    ta2Id = ta2._id as mongoose.Types.ObjectId;

    const student1 = await User.create({
      name: 'Student Harry',
      email: 'harry@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });
    student1Id = student1._id as mongoose.Types.ObjectId;

    const student2 = await User.create({
      name: 'Student Neville',
      email: 'neville@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });
    student2Id = student2._id as mongoose.Types.ObjectId;

    const student3 = await User.create({
      name: 'Student Luna',
      email: 'luna@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });
    student3Id = student3._id as mongoose.Types.ObjectId;

    const student4 = await User.create({
      name: 'Student Draco',
      email: 'draco@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });
    student4Id = student4._id as mongoose.Types.ObjectId;

    // 2. Course & Exam
    const course = await Course.create({
      courseCode: 'TRANS101',
      courseName: 'Transfiguration Basics',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [ta1Id, ta2Id],
      enrolledStudents: [student1Id, student2Id, student3Id, student4Id],
      isActive: true,
    });
    courseId = course._id as mongoose.Types.ObjectId;

    const exam = await Exam.create({
      title: 'Transfiguration Midterm',
      course: courseId,
      createdBy: professorId,
      examDate: new Date(),
      gradingDeadline: new Date(Date.now() + 86400000 * 7),
      totalMarks: 10,
      numberOfQuestions: 1,
      isActive: true,
    });
    examId = exam._id as mongoose.Types.ObjectId;

    // 3. Rubric
    const rubric = await Rubric.create({
      exam: examId,
      createdBy: professorId,
      scoreStep: 0.5,
      questions: [
        {
          questionNumber: 1,
          maxMarks: 10,
          criteria: [
            { criterionName: 'Wand Technique', points: 5 },
            { criterionName: 'Incantation Accuracy', points: 5 },
          ],
        },
      ],
      isActive: true,
    });
    rubricId = rubric._id as mongoose.Types.ObjectId;

    // 4. AnswerScripts
    const s1 = await AnswerScript.create({
      exam: examId,
      student: student1Id,
      filePath: 'uploads/s1.pdf',
      pageCount: 1,
      isActive: true,
    });
    script1Id = s1._id as mongoose.Types.ObjectId;

    const s2 = await AnswerScript.create({
      exam: examId,
      student: student2Id,
      filePath: 'uploads/s2.pdf',
      pageCount: 1,
      isActive: true,
    });
    script2Id = s2._id as mongoose.Types.ObjectId;

    const s3 = await AnswerScript.create({
      exam: examId,
      student: student3Id,
      filePath: 'uploads/s3.pdf',
      pageCount: 1,
      isActive: true,
    });
    script3Id = s3._id as mongoose.Types.ObjectId;

    const s4 = await AnswerScript.create({
      exam: examId,
      student: student4Id,
      filePath: 'uploads/s4.pdf',
      pageCount: 1,
      isActive: true,
    });
    script4Id = s4._id as mongoose.Types.ObjectId;

    // 5. Allocations: TA1 gets Script 1 & 2; TA2 gets Script 3 & 4
    const a1 = await Allocation.create({
      exam: examId,
      answerScript: script1Id,
      ta: ta1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
    });
    allocTa1Script1Id = a1._id as mongoose.Types.ObjectId;

    const a2 = await Allocation.create({
      exam: examId,
      answerScript: script2Id,
      ta: ta1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
    });
    allocTa1Script2Id = a2._id as mongoose.Types.ObjectId;

    await Allocation.create({
      exam: examId,
      answerScript: script3Id,
      ta: ta2Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
    });

    await Allocation.create({
      exam: examId,
      answerScript: script4Id,
      ta: ta2Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
    });

    // 6. Seed saved grades for Script 1, 2, and 3
    await Grade.create([
      {
        answerScript: script1Id,
        rubric: rubricId,
        gradedBy: ta1Id,
        question: 1,
        marksAwarded: [
          { criterionName: 'Wand Technique', score: 5 },
          { criterionName: 'Incantation Accuracy', score: 5 },
        ],
        totalScore: 10,
        feedback: 'Flawless matchstick to needle',
        isFinal: false,
      },
      {
        answerScript: script2Id,
        rubric: rubricId,
        gradedBy: ta1Id,
        question: 1,
        marksAwarded: [
          { criterionName: 'Wand Technique', score: 4 },
          { criterionName: 'Incantation Accuracy', score: 4 },
        ],
        totalScore: 8,
        feedback: 'Good transformation',
        isFinal: false,
      },
      {
        answerScript: script3Id,
        rubric: rubricId,
        gradedBy: ta2Id,
        question: 1,
        marksAwarded: [
          { criterionName: 'Wand Technique', score: 4.5 },
          { criterionName: 'Incantation Accuracy', score: 4.5 },
        ],
        totalScore: 9,
        feedback: 'Creative flourish',
        isFinal: false,
      },
    ]);
  });

  describe('1. COMPLETED allocation → reopen → graded count decrements', () => {
    it('correctly increments upon submission and decrements upon reopen', async () => {
      // Step 1: Initial progress before submissions is 0/2 for TA1 and 0/4 overall
      let progress = await AllocationService.getProgress(examId.toString());
      expect(progress.total).toBe(4);
      expect(progress.graded).toBe(0);
      let ta1Progress = progress.progress.find((p) => p.taId === ta1Id.toString());
      expect(ta1Progress?.total).toBe(2);
      expect(ta1Progress?.graded).toBe(0);

      // Step 2: TA1 submits Script 1 -> graded becomes 1/2
      await gradingService.submitScript({
        scriptId: script1Id.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      });

      progress = await AllocationService.getProgress(examId.toString());
      expect(progress.graded).toBe(1);
      ta1Progress = progress.progress.find((p) => p.taId === ta1Id.toString());
      expect(ta1Progress?.graded).toBe(1);
      expect(ta1Progress?.completionRatio).toBe(0.5);

      // Step 3: TA1 submits Script 2 -> graded becomes 2/2 (100%)
      await gradingService.submitScript({
        scriptId: script2Id.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      });

      progress = await AllocationService.getProgress(examId.toString());
      expect(progress.graded).toBe(2);
      ta1Progress = progress.progress.find((p) => p.taId === ta1Id.toString());
      expect(ta1Progress?.graded).toBe(2);
      expect(ta1Progress?.completionRatio).toBe(1.0);

      // Step 4: Professor reopens Script 1 allocation -> TA1 graded decrements back to 1/2
      await AllocationService.reopenAllocation({
        allocationId: allocTa1Script1Id.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
        reason: 'Re-evaluating Script 1 technique',
      });

      progress = await AllocationService.getProgress(examId.toString());
      expect(progress.graded).toBe(1);
      ta1Progress = progress.progress.find((p) => p.taId === ta1Id.toString());
      expect(ta1Progress?.graded).toBe(1);
      expect(ta1Progress?.completionRatio).toBe(0.5);
    });
  });

  describe('2. Dashboard n/m updates and workload consistency', () => {
    it('accurately reflects n/m in both exam-wide and TA-specific workload endpoints after reopen', async () => {
      // TA1 submits both scripts
      await gradingService.submitScript({
        scriptId: script1Id.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      });
      await gradingService.submitScript({
        scriptId: script2Id.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      });

      // Verify TA workload before reopen
      let ta1Workload = await AllocationService.getTaAllocationsForExam(examId.toString(), ta1Id.toString());
      expect(ta1Workload.total).toBe(2);
      expect(ta1Workload.graded).toBe(2);
      expect(ta1Workload.inProgress).toBe(0);

      // Reopen Script 2
      await AllocationService.reopenAllocation({
        allocationId: allocTa1Script2Id.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
        reason: 'Adjusting marks for script 2',
      });

      // Verify TA workload after reopen
      ta1Workload = await AllocationService.getTaAllocationsForExam(examId.toString(), ta1Id.toString());
      expect(ta1Workload.total).toBe(2);
      expect(ta1Workload.graded).toBe(1);
      expect(ta1Workload.inProgress).toBe(1);

      const script2Item = ta1Workload.scripts.find((s) => s.allocationId === allocTa1Script2Id.toString());
      expect(script2Item?.status).toBe(AllocationStatus.IN_PROGRESS);
      expect(script2Item?.completedAt).toBeNull();
    });
  });

  describe('3. TA Isolation', () => {
    it('ensures reopening one TA allocation does NOT alter another TA completed or in-progress count', async () => {
      // TA1 submits Script 1 & 2 (2/2)
      await gradingService.submitScript({
        scriptId: script1Id.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      });
      await gradingService.submitScript({
        scriptId: script2Id.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      });

      // TA2 submits Script 3 (1/2)
      await gradingService.submitScript({
        scriptId: script3Id.toString(),
        userId: ta2Id.toString(),
        userRole: UserRole.TA,
      });

      // Verify intermediate state: TA1 = 2/2, TA2 = 1/2, Total = 3/4
      let progress = await AllocationService.getProgress(examId.toString());
      expect(progress.graded).toBe(3);
      expect(progress.total).toBe(4);

      let ta1 = progress.progress.find((p) => p.taId === ta1Id.toString());
      let ta2 = progress.progress.find((p) => p.taId === ta2Id.toString());
      expect(ta1?.graded).toBe(2);
      expect(ta2?.graded).toBe(1);

      // Reopen TA1 Script 1
      await AllocationService.reopenAllocation({
        allocationId: allocTa1Script1Id.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
        reason: 'Reopen TA1 only',
      });

      // Verify post-reopen state: TA1 = 1/2, TA2 remains strictly 1/2, Total = 2/4
      progress = await AllocationService.getProgress(examId.toString());
      expect(progress.graded).toBe(2);
      expect(progress.total).toBe(4);

      ta1 = progress.progress.find((p) => p.taId === ta1Id.toString());
      ta2 = progress.progress.find((p) => p.taId === ta2Id.toString());
      expect(ta1?.graded).toBe(1);
      expect(ta2?.graded).toBe(1);
      expect(ta2?.total).toBe(2);
    });
  });

  describe('4. Persisted State on Refresh', () => {
    it('returns exact decremented counts when queried afresh via HTTP API', async () => {
      // TA1 submits Script 1
      await gradingService.submitScript({
        scriptId: script1Id.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      });

      // Reopen Script 1 via API
      mockSessionUser = {
        id: professorId.toString(),
        email: 'mcgonagall@hogwarts.edu',
        role: UserRole.PROFESSOR,
      };

      const reopenReq = new NextRequest(
        `http://localhost:3000/api/allocations/${allocTa1Script1Id.toString()}/reopen`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'API Reopen test for refresh persistence' }),
        }
      );

      const reopenRes = await reopenPOST(reopenReq, {
        params: Promise.resolve({ id: allocTa1Script1Id.toString() }),
      });
      expect(reopenRes.status).toBe(200);

      // Simulate a fresh page refresh / query to GET /api/exams/[id]/progress
      const progressReq = new NextRequest(`http://localhost:3000/api/exams/${examId.toString()}/progress`, {
        method: 'GET',
      });

      const progressRes = await progressGET(progressReq, {
        params: Promise.resolve({ id: examId.toString() }),
      });

      expect(progressRes.status).toBe(200);
      const json = await progressRes.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(4);
      expect(json.data.graded).toBe(0);

      const ta1 = json.data.progress.find((p: { taId: string }) => p.taId === ta1Id.toString());
      expect(ta1.graded).toBe(0);
      expect(ta1.total).toBe(2);
    });
  });

  describe('5. SSE / Live Progress Event on Reopen', () => {
    it('emits a progress update event with decremented counts to subscribed SSE listeners', async () => {
      // TA1 submits Script 1
      await gradingService.submitScript({
        scriptId: script1Id.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      });

      const receivedEvents: ProgressUpdateEvent[] = [];
      const unsubscribe = ProgressEventService.subscribe(examId.toString(), (event) => {
        receivedEvents.push(event);
      });

      // Reopen Script 1
      await AllocationService.reopenAllocation({
        allocationId: allocTa1Script1Id.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
        reason: 'Live event verification',
      });

      expect(receivedEvents).toHaveLength(1);
      const event = receivedEvents[0];
      expect(event.examId).toBe(examId.toString());
      expect(event.taId).toBe(ta1Id.toString());
      expect(event.taProgress.graded).toBe(0);
      expect(event.taProgress.total).toBe(2);
      expect(event.examProgress.graded).toBe(0);
      expect(event.examProgress.total).toBe(4);

      unsubscribe();
    });
  });

  describe('6. Resubmission after Reopen Lifecycle', () => {
    it('safely handles submit -> reopen -> resubmit without double counting or stale state', async () => {
      // 1. Initial Submit -> 1/2
      await gradingService.submitScript({
        scriptId: script1Id.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      });

      let progress = await AllocationService.getProgress(examId.toString());
      let ta1 = progress.progress.find((p) => p.taId === ta1Id.toString());
      expect(ta1?.graded).toBe(1);

      // 2. Reopen -> 0/2
      await AllocationService.reopenAllocation({
        allocationId: allocTa1Script1Id.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
        reason: 'Lifecycle testing reopen',
      });

      progress = await AllocationService.getProgress(examId.toString());
      ta1 = progress.progress.find((p) => p.taId === ta1Id.toString());
      expect(ta1?.graded).toBe(0);

      // 3. TA edits and resubmits -> 1/2
      await gradingService.submitScript({
        scriptId: script1Id.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      });

      progress = await AllocationService.getProgress(examId.toString());
      ta1 = progress.progress.find((p) => p.taId === ta1Id.toString());
      expect(ta1?.graded).toBe(1);

      // 4. Repeated submission returns 409 and does not double count
      await expect(
        gradingService.submitScript({
          scriptId: script1Id.toString(),
          userId: ta1Id.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow(/already been submitted/i);

      progress = await AllocationService.getProgress(examId.toString());
      ta1 = progress.progress.find((p) => p.taId === ta1Id.toString());
      expect(ta1?.graded).toBe(1);
    });
  });
});
