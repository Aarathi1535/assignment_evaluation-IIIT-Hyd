import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam from '../models/Exam';
import AnswerScript from '../models/AnswerScript';
import Page from '../models/Page';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Rubric from '../models/Rubric';
import Grade from '../models/Grade';
import AuditLog from '../models/AuditLog';
import Notification from '../models/Notification';
import ScriptFlag, { FlagReason, FlagStatus, FlagResolutionAction } from '../models/ScriptFlag';
import AllocationService from '../services/AllocationService';
import gradingService from '../services/GradingService';
import ScriptFlagService from '../services/ScriptFlagService';
import annotationPersistenceService from '../services/AnnotationPersistenceService';
import ProgressEventService from '../services/ProgressEventService';

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

describe('AE-167: Allocation-Level Reopen (Service & API)', () => {
  let reopenPOST: typeof import('../app/api/allocations/[id]/reopen/route').POST;

  let professorId: mongoose.Types.ObjectId;
  let otherProfessorId: mongoose.Types.ObjectId;
  let adminId: mongoose.Types.ObjectId;
  let ta1Id: mongoose.Types.ObjectId;
  let ta2Id: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;

  let courseId: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let rubricId: mongoose.Types.ObjectId;
  let scriptId: mongoose.Types.ObjectId;

  let alloc1Id: mongoose.Types.ObjectId;
  let alloc2Id: mongoose.Types.ObjectId;

  beforeAll(async () => {
    reopenPOST = (await import('../app/api/allocations/[id]/reopen/route')).POST;

    await User.init();
    await Course.init();
    await Exam.init();
    await AnswerScript.init();
    await Page.init();
    await Allocation.init();
    await Rubric.init();
    await Grade.init();
    await AuditLog.init();
    await Notification.init();
    await ScriptFlag.init();
  });

  afterAll(async () => {
    ProgressEventService.clearListeners();
    await ProgressEventService.stopChangeStream();
  });

  beforeEach(async () => {
    ProgressEventService.clearListeners();
    mockSessionUser = null;

    await Notification.deleteMany({});
    await ScriptFlag.deleteMany({});
    await AuditLog.deleteMany({});
    await Grade.deleteMany({});
    await Allocation.deleteMany({});
    await Page.deleteMany({});
    await AnswerScript.deleteMany({});
    await Rubric.deleteMany({});
    await Exam.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    // 1. Users
    const professor = await User.create({
      name: 'Professor Snape',
      email: 'snape@hogwarts.edu',
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true,
    });
    professorId = professor._id as mongoose.Types.ObjectId;

    const otherProfessor = await User.create({
      name: 'Professor Flitwick',
      email: 'flitwick@hogwarts.edu',
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true,
    });
    otherProfessorId = otherProfessor._id as mongoose.Types.ObjectId;

    const admin = await User.create({
      name: 'Headmaster Dumbledore',
      email: 'dumbledore@hogwarts.edu',
      password: 'password123',
      role: UserRole.ADMIN,
      isActive: true,
    });
    adminId = admin._id as mongoose.Types.ObjectId;

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

    const student = await User.create({
      name: 'Student Harry',
      email: 'harry@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });
    studentId = student._id as mongoose.Types.ObjectId;

    // 2. Course & Exam
    const course = await Course.create({
      courseCode: 'POT101',
      courseName: 'Potions Masterclass',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [ta1Id, ta2Id],
      enrolledStudents: [studentId],
      isActive: true,
    });
    courseId = course._id as mongoose.Types.ObjectId;

    const exam = await Exam.create({
      title: 'Midterm Potions Assessment',
      course: courseId,
      createdBy: professorId,
      examDate: new Date(),
      gradingDeadline: new Date(Date.now() + 86400000 * 7),
      totalMarks: 20,
      numberOfQuestions: 2,
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
            { criterionName: 'Brewing Technique', points: 5 },
            { criterionName: 'Color & Viscosity', points: 5 },
          ],
        },
        {
          questionNumber: 2,
          maxMarks: 10,
          criteria: [
            { criterionName: 'Safety Measures', points: 5 },
            { criterionName: 'Written Analysis', points: 5 },
          ],
        },
      ],
      isActive: true,
    });
    rubricId = rubric._id as mongoose.Types.ObjectId;

    // 4. AnswerScript & Page
    const script = await AnswerScript.create({
      exam: examId,
      student: studentId,
      filePath: 'uploads/s1.pdf',
      pageCount: 2,
      isActive: true,
    });
    scriptId = script._id as mongoose.Types.ObjectId;

    await Page.create({
      answerScript: scriptId,
      pageNumber: 1,
      imagePath: '/uploads/scripts/p1.png',
      isActive: true,
    });

    // 5. Question-wise Allocations (TA1 gets Q1; TA2 gets Q2)
    const a1 = await Allocation.create({
      exam: examId,
      answerScript: scriptId,
      ta: ta1Id,
      question: 1,
      allocatedBy: professorId,
      status: AllocationStatus.COMPLETED,
      completedAt: new Date(Date.now() - 60000),
      rule: AllocationRule.QUESTION,
    });
    alloc1Id = a1._id as mongoose.Types.ObjectId;

    const a2 = await Allocation.create({
      exam: examId,
      answerScript: scriptId,
      ta: ta2Id,
      question: 2,
      allocatedBy: professorId,
      status: AllocationStatus.COMPLETED,
      completedAt: new Date(Date.now() - 60000),
      rule: AllocationRule.QUESTION,
    });
    alloc2Id = a2._id as mongoose.Types.ObjectId;

    // 6. Grades for Q1 (TA1) and Q2 (TA2)
    await Grade.create([
      {
        answerScript: scriptId,
        rubric: rubricId,
        gradedBy: ta1Id,
        question: 1,
        marksAwarded: [
          { criterionName: 'Brewing Technique', score: 4.5 },
          { criterionName: 'Color & Viscosity', score: 4.0 },
        ],
        totalScore: 8.5,
        feedback: 'Good preliminary brew',
        isFinal: true,
      },
      {
        answerScript: scriptId,
        rubric: rubricId,
        gradedBy: ta2Id,
        question: 2,
        marksAwarded: [
          { criterionName: 'Safety Measures', score: 5.0 },
          { criterionName: 'Written Analysis', score: 4.5 },
        ],
        totalScore: 9.5,
        feedback: 'Excellent safety handling',
        isFinal: true,
      },
    ]);
  });

  describe('1. Authorization & Role Scoping', () => {
    it('allows exam-owning professor to reopen a completed allocation with reason', async () => {
      const result = await AllocationService.reopenAllocation({
        allocationId: alloc1Id.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
        reason: 'Question 1 requires re-evaluation of potion color criterion',
      });

      expect(result.allocationId).toBe(alloc1Id.toString());
      expect(result.status).toBe(AllocationStatus.IN_PROGRESS);
      expect(result.question).toBe(1);
      expect(result.reopenedBy).toBe(professorId.toString());
      expect(result.reason).toBe('Question 1 requires re-evaluation of potion color criterion');
    });

    it('allows system administrator to reopen a completed allocation', async () => {
      const result = await AllocationService.reopenAllocation({
        allocationId: alloc1Id.toString(),
        userId: adminId.toString(),
        userRole: UserRole.ADMIN,
        reason: 'Administrative dispute resolution',
      });

      expect(result.allocationId).toBe(alloc1Id.toString());
      expect(result.status).toBe(AllocationStatus.IN_PROGRESS);
    });

    it('rejects non-owning professor with 403 Forbidden and records audit log', async () => {
      await expect(
        AllocationService.reopenAllocation({
          allocationId: alloc1Id.toString(),
          userId: otherProfessorId.toString(),
          userRole: UserRole.PROFESSOR,
          reason: 'Attempted unauthorized reopen',
        })
      ).rejects.toThrow(/You do not own the exam for this allocation/i);

      const deniedLogs = await AuditLog.find({
        action: 'ALLOCATION_REOPEN_DENIED',
        outcome: 'FAILURE',
        entityId: alloc1Id,
      });
      expect(deniedLogs).toHaveLength(1);
      expect(deniedLogs[0].user.toString()).toBe(otherProfessorId.toString());
    });

    it('rejects TA callers with 403 Forbidden', async () => {
      await expect(
        AllocationService.reopenAllocation({
          allocationId: alloc1Id.toString(),
          userId: ta1Id.toString(),
          userRole: UserRole.TA,
          reason: 'Self-reopen attempt',
        })
      ).rejects.toThrow(/Only the exam-owning professor or an admin can reopen an allocation/i);
    });

    it('rejects Student callers with 403 Forbidden', async () => {
      await expect(
        AllocationService.reopenAllocation({
          allocationId: alloc1Id.toString(),
          userId: studentId.toString(),
          userRole: UserRole.STUDENT,
          reason: 'Student dispute',
        })
      ).rejects.toThrow(/Only the exam-owning professor or an admin can reopen an allocation/i);
    });

    it('rejects reopen request with 400 Bad Request when reason is missing or empty', async () => {
      await expect(
        AllocationService.reopenAllocation({
          allocationId: alloc1Id.toString(),
          userId: professorId.toString(),
          userRole: UserRole.PROFESSOR,
          reason: '   ',
        })
      ).rejects.toThrow(/Reopen reason is required/i);
    });
  });

  describe('2. Allocation Isolation & Atomic State Transitions', () => {
    it('reopens ONLY the targeted allocation while leaving another TA completed allocation intact', async () => {
      // Reopen TA1's allocation for Question 1
      await AllocationService.reopenAllocation({
        allocationId: alloc1Id.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
        reason: 'Re-evaluating Question 1 only',
      });

      // TA1's allocation (Q1) is now IN_PROGRESS with completedAt cleared
      const refreshedAlloc1 = await Allocation.findById(alloc1Id);
      expect(refreshedAlloc1?.status).toBe(AllocationStatus.IN_PROGRESS);
      expect(refreshedAlloc1?.completedAt).toBeFalsy();

      // TA2's allocation (Q2) remains COMPLETED with completedAt intact
      const refreshedAlloc2 = await Allocation.findById(alloc2Id);
      expect(refreshedAlloc2?.status).toBe(AllocationStatus.COMPLETED);
      expect(refreshedAlloc2?.completedAt).toBeInstanceOf(Date);

      // Question 1 grade is unfinalized (isFinal: false)
      const q1Grade = await Grade.findOne({ answerScript: scriptId, question: 1 });
      expect(q1Grade?.isFinal).toBe(false);

      // Question 2 grade remains finalized (isFinal: true)
      const q2Grade = await Grade.findOne({ answerScript: scriptId, question: 2 });
      expect(q2Grade?.isFinal).toBe(true);
    });

    it('captures pre-reopen grade snapshots in AuditLog before reopening', async () => {
      await AllocationService.reopenAllocation({
        allocationId: alloc1Id.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
        reason: 'Audit capture verification',
      });

      const logs = await AuditLog.find({
        action: 'ALLOCATION_REOPENED',
        entityId: alloc1Id,
      });
      expect(logs).toHaveLength(1);
      const details = logs[0].details as {
        reason: string;
        preReopenGrades: Array<{
          question?: number;
          totalScore?: number;
          feedback?: string;
          isFinal?: boolean;
        }>;
      };
      expect(details.reason).toBe('Audit capture verification');
      expect(details.preReopenGrades).toHaveLength(1);
      expect(details.preReopenGrades[0].question).toBe(1);
      expect(details.preReopenGrades[0].totalScore).toBe(8.5);
      expect(details.preReopenGrades[0].feedback).toBe('Good preliminary brew');
      expect(details.preReopenGrades[0].isFinal).toBe(true);
    });

    it('enables the allocated TA to edit marks, feedback, and page annotations after reopen', async () => {
      // Reopen TA1 allocation
      await AllocationService.reopenAllocation({
        allocationId: alloc1Id.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
        reason: 'Adjusting marks post review',
      });

      // TA1 updates grade marks & feedback
      const updatedGrade = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Brewing Technique', score: 5 },
          { criterionName: 'Color & Viscosity', score: 5 },
        ],
        feedback: 'Corrected after professor consultation',
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
        isFinal: false,
      });

      expect(updatedGrade.totalScore).toBe(10);
      expect(updatedGrade.feedback).toBe('Corrected after professor consultation');

      // TA1 saves page annotations successfully
      const annotationResult = await annotationPersistenceService.savePageAnnotations({
        scriptId: scriptId.toString(),
        pageIdentifier: '1',
        payload: {
          annotations: [
            {
              id: 'm1',
              pageKey: '1',
              type: 'check',
              x: 100,
              y: 100,
              size: 24,
              color: '#00ff00',
              createdAt: Date.now(),
            },
          ],
          strokes: [],
        },
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      });

      expect(annotationResult.totalAnnotations).toBe(1);
    });
  });

  describe('3. TA Notification & Reopen Reason', () => {
    it('sends an in-app notification to the affected TA containing the reopen reason', async () => {
      await AllocationService.reopenAllocation({
        allocationId: alloc1Id.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
        reason: 'Please review step 3 technique',
      });

      // Notification exists for TA1
      const ta1Notifications = await Notification.find({ recipient: ta1Id });
      expect(ta1Notifications).toHaveLength(1);
      expect(ta1Notifications[0].title).toBe('Allocation Reopened for Grading');
      expect(ta1Notifications[0].message).toContain('Please review step 3 technique');
      expect(ta1Notifications[0].allocation?.toString()).toBe(alloc1Id.toString());

      // No notification sent to TA2
      const ta2Notifications = await Notification.find({ recipient: ta2Id });
      expect(ta2Notifications).toHaveLength(0);
    });
  });

  describe('4. Day 1 Professor Override Precedence', () => {
    it('respects professor override until TA submits a fresh edit post-reopen', async () => {
      // 0. Ensure initial Grade has an older updatedAt
      await Grade.updateOne(
        { answerScript: scriptId, question: 1 },
        { $set: { updatedAt: new Date(Date.now() - 60000) } },
        { timestamps: false }
      );

      // 1. Professor overrides Question 1 score to 9.0 via ScriptFlag resolution
      await ScriptFlag.create({
        exam: examId,
        answerScript: scriptId,
        question: 1,
        raisedBy: professorId,
        reason: FlagReason.OTHER,
        status: FlagStatus.RESOLVED,
        resolution: {
          action: FlagResolutionAction.OVERRIDE,
          by: professorId,
          at: new Date(Date.now() - 30000),
          notes: 'Professor adjusted technique criterion',
          previousScore: 8.5,
          newScore: 9.0,
          criterionOverrides: [
            { criterionName: 'Brewing Technique', score: 5.0 },
            { criterionName: 'Color & Viscosity', score: 4.0 },
          ],
        },
      });

      // Prior to TA edit, getEffectiveGrade() returns the professor's override (9.0)
      let effective = await ScriptFlagService.getEffectiveGrade(scriptId.toString(), 1);
      expect(effective.isOverridden).toBe(true);
      expect(effective.totalScore).toBe(9.0);

      // 2. Professor reopens TA1 allocation
      await AllocationService.reopenAllocation({
        allocationId: alloc1Id.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
        reason: 'Reopened for TA to revise marks',
      });

      // 3. TA edits marks to 10.0 (updatedAt at current Date.now() > override at)
      await Grade.updateOne(
        { answerScript: scriptId, question: 1 },
        {
          $set: {
            totalScore: 10.0,
            marksAwarded: [
              { criterionName: 'Brewing Technique', score: 5.0 },
              { criterionName: 'Color & Viscosity', score: 5.0 },
            ],
            updatedAt: new Date(),
          },
        },
        { timestamps: false }
      );

      // Post-reopen TA edit now takes precedence (10.0)
      effective = await ScriptFlagService.getEffectiveGrade(scriptId.toString(), 1);
      expect(effective.isOverridden).toBe(false);
      expect(effective.totalScore).toBe(10.0);
    });
  });

  describe('5. State Preconditions & Repeated Reopen Handling', () => {
    it('rejects reopening when allocation is not currently COMPLETED (HTTP 409)', async () => {
      const student2 = await User.create({
        name: 'Neville Longbottom',
        email: 'neville@hogwarts.edu',
        password: 'password123',
        role: UserRole.STUDENT,
        isActive: true,
      });

      // Create a separate script and IN_PROGRESS allocation
      const script2 = await AnswerScript.create({
        exam: examId,
        student: student2._id,
        filePath: 'uploads/s2.pdf',
        pageCount: 1,
        isActive: true,
      });

      const pendingAlloc = await Allocation.create({
        exam: examId,
        answerScript: script2._id,
        ta: ta1Id,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
      });

      await expect(
        AllocationService.reopenAllocation({
          allocationId: pendingAlloc._id.toString(),
          userId: professorId.toString(),
          userRole: UserRole.PROFESSOR,
          reason: 'Premature reopen attempt',
        })
      ).rejects.toThrow(/Allocation is not completed/i);
    });

    it('handles repeated reopen attempts safely by rejecting subsequent attempt with 409 Conflict', async () => {
      // First reopen succeeds
      await AllocationService.reopenAllocation({
        allocationId: alloc1Id.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
        reason: 'First reopen',
      });

      // Second reopen attempt on the already IN_PROGRESS allocation fails with 409
      await expect(
        AllocationService.reopenAllocation({
          allocationId: alloc1Id.toString(),
          userId: professorId.toString(),
          userRole: UserRole.PROFESSOR,
          reason: 'Second reopen attempt',
        })
      ).rejects.toThrow(/Allocation is not completed/i);
    });
  });

  describe('6. API Route Integration: POST /api/allocations/[id]/reopen', () => {
    it('reopens allocation via HTTP API route for authenticated exam-owning professor', async () => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'snape@hogwarts.edu',
        role: UserRole.PROFESSOR,
      };

      const req = new NextRequest(`http://localhost:3000/api/allocations/${alloc1Id.toString()}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Reopened via API route' }),
      });

      const res = await reopenPOST(req, {
        params: Promise.resolve({ id: alloc1Id.toString() }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.allocationId).toBe(alloc1Id.toString());
      expect(json.data.status).toBe(AllocationStatus.IN_PROGRESS);
    });

    it('returns 400 Bad Request via API route when reason is missing', async () => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'snape@hogwarts.edu',
        role: UserRole.PROFESSOR,
      };

      const req = new NextRequest(`http://localhost:3000/api/allocations/${alloc1Id.toString()}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await reopenPOST(req, {
        params: Promise.resolve({ id: alloc1Id.toString() }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toMatch(/Reopen reason is required/i);
    });

    it('returns 403 Forbidden via API route for non-owning professor', async () => {
      mockSessionUser = {
        id: otherProfessorId.toString(),
        email: 'flitwick@hogwarts.edu',
        role: UserRole.PROFESSOR,
      };

      const req = new NextRequest(`http://localhost:3000/api/allocations/${alloc1Id.toString()}/reopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Unauthorized API reopen' }),
      });

      const res = await reopenPOST(req, {
        params: Promise.resolve({ id: alloc1Id.toString() }),
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toMatch(/You do not own the exam/i);
    });
  });
});
