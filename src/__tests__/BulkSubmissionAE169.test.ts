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
import ScriptFlag, { FlagReason, FlagStatus } from '../models/ScriptFlag';
import gradingService from '../services/GradingService';
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

describe('AE-169: Bulk Script Submission (Service & API)', () => {
  let bulkPOST: typeof import('../app/api/exams/[id]/submissions/bulk/route').POST;

  let professorId: mongoose.Types.ObjectId;
  let ta1Id: mongoose.Types.ObjectId;
  let ta2Id: mongoose.Types.ObjectId;
  let student1Id: mongoose.Types.ObjectId;
  let student2Id: mongoose.Types.ObjectId;
  let student3Id: mongoose.Types.ObjectId;
  let student4Id: mongoose.Types.ObjectId;
  let student5Id: mongoose.Types.ObjectId;

  let courseId: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let rubricId: mongoose.Types.ObjectId;

  let script1Id: mongoose.Types.ObjectId;
  let script2Id: mongoose.Types.ObjectId;
  let script3Id: mongoose.Types.ObjectId;
  let script4Id: mongoose.Types.ObjectId;
  let script5Id: mongoose.Types.ObjectId;

  let alloc1Id: mongoose.Types.ObjectId;
  let alloc2Id: mongoose.Types.ObjectId;
  let alloc3Id: mongoose.Types.ObjectId;
  let alloc4Id: mongoose.Types.ObjectId;
  let alloc5Ta2Id: mongoose.Types.ObjectId;

  beforeAll(async () => {
    bulkPOST = (await import('../app/api/exams/[id]/submissions/bulk/route')).POST;

    await User.init();
    await Course.init();
    await Exam.init();
    await AnswerScript.init();
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

    await ScriptFlag.deleteMany({});
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

    const s1User = await User.create({
      name: 'Harry Potter',
      email: 'harry@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });
    student1Id = s1User._id as mongoose.Types.ObjectId;

    const s2User = await User.create({
      name: 'Neville Longbottom',
      email: 'neville@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });
    student2Id = s2User._id as mongoose.Types.ObjectId;

    const s3User = await User.create({
      name: 'Luna Lovegood',
      email: 'luna@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });
    student3Id = s3User._id as mongoose.Types.ObjectId;

    const s4User = await User.create({
      name: 'Draco Malfoy',
      email: 'draco@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });
    student4Id = s4User._id as mongoose.Types.ObjectId;

    const s5User = await User.create({
      name: 'Seamus Finnigan',
      email: 'seamus@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });
    student5Id = s5User._id as mongoose.Types.ObjectId;

    // 2. Course & Exam
    const course = await Course.create({
      courseCode: 'TRANS201',
      courseName: 'Advanced Transfiguration',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [ta1Id, ta2Id],
      enrolledStudents: [student1Id, student2Id, student3Id, student4Id, student5Id],
      isActive: true,
    });
    courseId = course._id as mongoose.Types.ObjectId;

    const exam = await Exam.create({
      title: 'Transfiguration Assessment',
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
            { criterionName: 'Theory', points: 5 },
            { criterionName: 'Technique', points: 5 },
          ],
        },
        {
          questionNumber: 2,
          maxMarks: 10,
          criteria: [
            { criterionName: 'Formulation', points: 5 },
            { criterionName: 'Precision', points: 5 },
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
      pageCount: 2,
      isActive: true,
    });
    script1Id = s1._id as mongoose.Types.ObjectId;

    const s2 = await AnswerScript.create({
      exam: examId,
      student: student2Id,
      filePath: 'uploads/s2.pdf',
      pageCount: 2,
      isActive: true,
    });
    script2Id = s2._id as mongoose.Types.ObjectId;

    const s3 = await AnswerScript.create({
      exam: examId,
      student: student3Id,
      filePath: 'uploads/s3.pdf',
      pageCount: 2,
      isActive: true,
    });
    script3Id = s3._id as mongoose.Types.ObjectId;

    const s4 = await AnswerScript.create({
      exam: examId,
      student: student4Id,
      filePath: 'uploads/s4.pdf',
      pageCount: 2,
      isActive: true,
    });
    script4Id = s4._id as mongoose.Types.ObjectId;

    const s5 = await AnswerScript.create({
      exam: examId,
      student: student5Id,
      filePath: 'uploads/s5.pdf',
      pageCount: 2,
      isActive: true,
    });
    script5Id = s5._id as mongoose.Types.ObjectId;

    // 5. Allocations: TA1 has Script 1, 2, 3, 4. TA2 has Script 5.
    const a1 = await Allocation.create({
      exam: examId,
      answerScript: script1Id,
      ta: ta1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
    });
    alloc1Id = a1._id as mongoose.Types.ObjectId;

    const a2 = await Allocation.create({
      exam: examId,
      answerScript: script2Id,
      ta: ta1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
    });
    alloc2Id = a2._id as mongoose.Types.ObjectId;

    const a3 = await Allocation.create({
      exam: examId,
      answerScript: script3Id,
      ta: ta1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
    });
    alloc3Id = a3._id as mongoose.Types.ObjectId;

    const a4 = await Allocation.create({
      exam: examId,
      answerScript: script4Id,
      ta: ta1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
    });
    alloc4Id = a4._id as mongoose.Types.ObjectId;

    const a5 = await Allocation.create({
      exam: examId,
      answerScript: script5Id,
      ta: ta2Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
    });
    alloc5Ta2Id = a5._id as mongoose.Types.ObjectId;
  });

  describe('1. Bulk Submission of Eligible Allocations', () => {
    it('submits and finalizes all eligible allocations for the requesting TA', async () => {
      // Seed complete grades for Script 1 and Script 2
      await Grade.create([
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 5 }, { criterionName: 'Technique', score: 4 }],
          totalScore: 9,
          isFinal: false,
        },
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 2,
          marksAwarded: [{ criterionName: 'Formulation', score: 4 }, { criterionName: 'Precision', score: 5 }],
          totalScore: 9,
          isFinal: false,
        },
        {
          answerScript: script2Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 4 }, { criterionName: 'Technique', score: 4 }],
          totalScore: 8,
          isFinal: false,
        },
        {
          answerScript: script2Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 2,
          marksAwarded: [{ criterionName: 'Formulation', score: 5 }, { criterionName: 'Precision', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
      ]);

      const result = await gradingService.bulkSubmit({
        examId: examId.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
        allocationIds: [alloc1Id.toString(), alloc2Id.toString()],
        confirmed: true,
      });

      expect(result.submittedCount).toBe(2);
      expect(result.alreadySubmittedCount).toBe(0);
      expect(result.incompleteCount).toBe(0);
      expect(result.openFlagCount).toBe(0);
      expect(result.failedCount).toBe(0);
      expect(result.submitted).toHaveLength(2);

      // Verify DB state: allocations are COMPLETED and grades finalized
      const refreshedAlloc1 = await Allocation.findById(alloc1Id);
      const refreshedAlloc2 = await Allocation.findById(alloc2Id);
      expect(refreshedAlloc1?.status).toBe(AllocationStatus.COMPLETED);
      expect(refreshedAlloc1?.completedAt).toBeInstanceOf(Date);
      expect(refreshedAlloc2?.status).toBe(AllocationStatus.COMPLETED);

      const s1Grades = await Grade.find({ answerScript: script1Id });
      expect(s1Grades.every((g) => g.isFinal === true)).toBe(true);

      const s2Grades = await Grade.find({ answerScript: script2Id });
      expect(s2Grades.every((g) => g.isFinal === true)).toBe(true);

      // Verify AuditLog
      const audit = await AuditLog.findOne({ action: 'BULK_SCRIPTS_SUBMITTED', entityId: examId });
      expect(audit).toBeDefined();
    });
  });

  describe('2. Incomplete Allocations Skipped', () => {
    it('skips allocations missing required question grades and reports missing question numbers', async () => {
      // Script 1 has Q1 and Q2 (Complete)
      // Script 2 has only Q1 (Missing Q2)
      await Grade.create([
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 5 }, { criterionName: 'Technique', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 2,
          marksAwarded: [{ criterionName: 'Formulation', score: 5 }, { criterionName: 'Precision', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
        {
          answerScript: script2Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 4 }, { criterionName: 'Technique', score: 4 }],
          totalScore: 8,
          isFinal: false,
        },
      ]);

      const result = await gradingService.bulkSubmit({
        examId: examId.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
        allocationIds: [alloc1Id.toString(), alloc2Id.toString()],
        confirmed: true,
      });

      expect(result.submittedCount).toBe(1);
      expect(result.incompleteCount).toBe(1);
      expect(result.incompleteSkipped).toHaveLength(1);
      expect(result.incompleteSkipped[0].allocationId).toBe(alloc2Id.toString());
      expect(result.incompleteSkipped[0].missingQuestions).toEqual([2]);

      // Script 2 allocation remains IN_PROGRESS
      const alloc2 = await Allocation.findById(alloc2Id);
      expect(alloc2?.status).toBe(AllocationStatus.IN_PROGRESS);
    });
  });

  describe('3. OPEN-Flag Allocations Skipped', () => {
    it('skips allocations with OPEN flags and reports them under openFlagSkipped', async () => {
      // Script 1 is fully graded but has an OPEN flag
      await Grade.create([
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 5 }, { criterionName: 'Technique', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 2,
          marksAwarded: [{ criterionName: 'Formulation', score: 5 }, { criterionName: 'Precision', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
      ]);

      const flag = await ScriptFlag.create({
        exam: examId,
        answerScript: script1Id,
        question: 1,
        raisedBy: ta1Id,
        reason: FlagReason.OTHER,
        note: 'Flagged for professor second opinion',
        status: FlagStatus.OPEN,
      });

      const result = await gradingService.bulkSubmit({
        examId: examId.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
        allocationIds: [alloc1Id.toString()],
        confirmed: true,
      });

      expect(result.submittedCount).toBe(0);
      expect(result.openFlagCount).toBe(1);
      expect(result.openFlagSkipped).toHaveLength(1);
      expect(result.openFlagSkipped[0].allocationId).toBe(alloc1Id.toString());
      expect(result.openFlagSkipped[0].flagId).toBe(flag._id.toString());
      expect(result.openFlagSkipped[0].flagReason).toBe(FlagReason.OTHER);

      const alloc1 = await Allocation.findById(alloc1Id);
      expect(alloc1?.status).toBe(AllocationStatus.IN_PROGRESS);
    });
  });

  describe('4. Already-Submitted Allocations Reported', () => {
    it('reports already COMPLETED allocations under alreadySubmitted without double-processing', async () => {
      await Allocation.updateOne({ _id: alloc1Id }, { $set: { status: AllocationStatus.COMPLETED, completedAt: new Date() } });

      const result = await gradingService.bulkSubmit({
        examId: examId.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
        allocationIds: [alloc1Id.toString()],
        confirmed: true,
      });

      expect(result.submittedCount).toBe(0);
      expect(result.alreadySubmittedCount).toBe(1);
      expect(result.alreadySubmitted).toHaveLength(1);
      expect(result.alreadySubmitted[0].allocationId).toBe(alloc1Id.toString());
    });
  });

  describe('5. Mixed-Batch Resilience & Categorization', () => {
    it('processes a mixed batch accurately without one failure aborting others', async () => {
      // Script 1: Eligible
      await Grade.create([
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 5 }, { criterionName: 'Technique', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 2,
          marksAwarded: [{ criterionName: 'Formulation', score: 5 }, { criterionName: 'Precision', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
      ]);

      // Script 2: Incomplete (Missing Q2)
      await Grade.create([
        {
          answerScript: script2Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 4 }, { criterionName: 'Technique', score: 4 }],
          totalScore: 8,
          isFinal: false,
        },
      ]);

      // Script 3: OPEN Flag
      await Grade.create([
        {
          answerScript: script3Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 5 }, { criterionName: 'Technique', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
        {
          answerScript: script3Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 2,
          marksAwarded: [{ criterionName: 'Formulation', score: 5 }, { criterionName: 'Precision', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
      ]);
      await ScriptFlag.create({
        exam: examId,
        answerScript: script3Id,
        raisedBy: ta1Id,
        reason: FlagReason.CHEATING_SUSPECTED,
        status: FlagStatus.OPEN,
      });

      // Script 4: Already Submitted
      await Allocation.updateOne(
        { _id: alloc4Id },
        { $set: { status: AllocationStatus.COMPLETED, completedAt: new Date() } }
      );

      const result = await gradingService.bulkSubmit({
        examId: examId.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
        allocationIds: [alloc1Id.toString(), alloc2Id.toString(), alloc3Id.toString(), alloc4Id.toString()],
        confirmed: true,
      });

      expect(result.totalProcessed).toBe(4);
      expect(result.submittedCount).toBe(1);
      expect(result.incompleteCount).toBe(1);
      expect(result.openFlagCount).toBe(1);
      expect(result.alreadySubmittedCount).toBe(1);
      expect(result.failedCount).toBe(0);

      expect(result.submitted[0].allocationId).toBe(alloc1Id.toString());
      expect(result.incompleteSkipped[0].allocationId).toBe(alloc2Id.toString());
      expect(result.openFlagSkipped[0].allocationId).toBe(alloc3Id.toString());
      expect(result.alreadySubmitted[0].allocationId).toBe(alloc4Id.toString());
    });
  });

  describe('6. Idempotency on Repeated Execution', () => {
    it('yields 0 submitted and all alreadySubmitted on immediate subsequent execution', async () => {
      // Seed complete grades for Script 1
      await Grade.create([
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 5 }, { criterionName: 'Technique', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 2,
          marksAwarded: [{ criterionName: 'Formulation', score: 5 }, { criterionName: 'Precision', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
      ]);

      // First run submits
      const firstRun = await gradingService.bulkSubmit({
        examId: examId.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
        allocationIds: [alloc1Id.toString()],
        confirmed: true,
      });
      expect(firstRun.submittedCount).toBe(1);

      // Second run reports alreadySubmitted
      const secondRun = await gradingService.bulkSubmit({
        examId: examId.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
        allocationIds: [alloc1Id.toString()],
        confirmed: true,
      });
      expect(secondRun.submittedCount).toBe(0);
      expect(secondRun.alreadySubmittedCount).toBe(1);
    });
  });

  describe('7. TA Authorization & Workload Isolation', () => {
    it('rejects student callers with 403 Forbidden', async () => {
      await expect(
        gradingService.bulkSubmit({
          examId: examId.toString(),
          userId: student1Id.toString(),
          userRole: UserRole.STUDENT,
          confirmed: true,
        })
      ).rejects.toThrow(/Students cannot submit grades/i);
    });

    it('rejects an unallocated TA attempting to submit another TA allocations with 403 Forbidden', async () => {
      await expect(
        gradingService.bulkSubmit({
          examId: examId.toString(),
          userId: ta1Id.toString(),
          userRole: UserRole.TA,
          allocationIds: [alloc5Ta2Id.toString()], // Belongs to TA2
          confirmed: true,
        })
      ).rejects.toThrow(/You are not allocated to grade these answer scripts/i);
    });

    it('does NOT modify or finalize other TAs allocations when TA1 bulk submits', async () => {
      // Seed complete grades for Script 1 (TA1)
      await Grade.create([
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 5 }, { criterionName: 'Technique', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 2,
          marksAwarded: [{ criterionName: 'Formulation', score: 5 }, { criterionName: 'Precision', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
      ]);

      // TA1 submits all their allocations for the exam
      await gradingService.bulkSubmit({
        examId: examId.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
        confirmed: true,
      });

      // TA2 allocation remains IN_PROGRESS
      const ta2Alloc = await Allocation.findById(alloc5Ta2Id);
      expect(ta2Alloc?.status).toBe(AllocationStatus.IN_PROGRESS);
      expect(ta2Alloc?.completedAt).toBeFalsy();
    });
  });

  describe('8. Preview & Confirmation Controls', () => {
    it('returns preview counts without making any database mutations when preview: true', async () => {
      // Seed complete grades for Script 1
      await Grade.create([
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 5 }, { criterionName: 'Technique', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 2,
          marksAwarded: [{ criterionName: 'Formulation', score: 5 }, { criterionName: 'Precision', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
      ]);

      const previewResult = await gradingService.bulkSubmit({
        examId: examId.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
        allocationIds: [alloc1Id.toString()],
        preview: true,
      });

      expect(previewResult.preview).toBe(true);
      expect(previewResult.submittedCount).toBe(1); // 1 eligible
      expect(previewResult.submitted).toHaveLength(1);

      // Verify NO DB mutation happened
      const alloc1 = await Allocation.findById(alloc1Id);
      expect(alloc1?.status).toBe(AllocationStatus.IN_PROGRESS);

      const grades = await Grade.find({ answerScript: script1Id });
      expect(grades.every((g) => g.isFinal === false)).toBe(true);
    });

    it('rejects execution with 400 Bad Request when confirmed: false and preview: false', async () => {
      await expect(
        gradingService.bulkSubmit({
          examId: examId.toString(),
          userId: ta1Id.toString(),
          userRole: UserRole.TA,
          confirmed: false,
          preview: false,
        })
      ).rejects.toThrow(/Explicit confirmation is required/i);
    });
  });

  describe('9. Batch Cap / Pagination', () => {
    it('caps execution to the specified limit parameter', async () => {
      // Seed complete grades for Script 1 and Script 2
      await Grade.create([
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 5 }, { criterionName: 'Technique', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 2,
          marksAwarded: [{ criterionName: 'Formulation', score: 5 }, { criterionName: 'Precision', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
        {
          answerScript: script2Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 5 }, { criterionName: 'Technique', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
        {
          answerScript: script2Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 2,
          marksAwarded: [{ criterionName: 'Formulation', score: 5 }, { criterionName: 'Precision', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
      ]);

      const result = await gradingService.bulkSubmit({
        examId: examId.toString(),
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
        allocationIds: [alloc1Id.toString(), alloc2Id.toString()],
        confirmed: true,
        limit: 1, // Cap to 1
      });

      expect(result.submittedCount).toBe(1);
      expect(result.submitted).toHaveLength(1);

      // First is completed, second is still in progress
      const alloc1 = await Allocation.findById(alloc1Id);
      const alloc2 = await Allocation.findById(alloc2Id);
      expect(alloc1?.status).toBe(AllocationStatus.COMPLETED);
      expect(alloc2?.status).toBe(AllocationStatus.IN_PROGRESS);
    });
  });

  describe('10. API Route Integration: POST /api/exams/[id]/submissions/bulk', () => {
    it('executes bulk submission via HTTP API for authenticated TA', async () => {
      mockSessionUser = {
        id: ta1Id.toString(),
        email: 'hermione@hogwarts.edu',
        role: UserRole.TA,
      };

      // Seed complete grades for Script 1
      await Grade.create([
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 1,
          marksAwarded: [{ criterionName: 'Theory', score: 5 }, { criterionName: 'Technique', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
        {
          answerScript: script1Id,
          rubric: rubricId,
          gradedBy: ta1Id,
          question: 2,
          marksAwarded: [{ criterionName: 'Formulation', score: 5 }, { criterionName: 'Precision', score: 5 }],
          totalScore: 10,
          isFinal: false,
        },
      ]);

      const req = new NextRequest(`http://localhost:3000/api/exams/${examId.toString()}/submissions/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocationIds: [alloc1Id.toString()],
          confirmed: true,
        }),
      });

      const res = await bulkPOST(req, {
        params: Promise.resolve({ id: examId.toString() }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.submittedCount).toBe(1);
      expect(json.data.submitted[0].allocationId).toBe(alloc1Id.toString());
    });

    it('returns 400 Bad Request via API when confirmation is missing', async () => {
      mockSessionUser = {
        id: ta1Id.toString(),
        email: 'hermione@hogwarts.edu',
        role: UserRole.TA,
      };

      const req = new NextRequest(`http://localhost:3000/api/exams/${examId.toString()}/submissions/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocationIds: [alloc1Id.toString()],
          confirmed: false,
        }),
      });

      const res = await bulkPOST(req, {
        params: Promise.resolve({ id: examId.toString() }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toMatch(/Explicit confirmation is required/i);
    });
  });
});
