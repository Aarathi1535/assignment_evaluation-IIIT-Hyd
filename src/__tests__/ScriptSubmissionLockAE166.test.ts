/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import Page from '../models/Page';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Grade from '../models/Grade';
import User from '../models/User';
import AuditLog from '../models/AuditLog';
import gradingService from '../services/GradingService';
import annotationPersistenceService from '../services/AnnotationPersistenceService';
import { UserRole } from '../constants/permissions';

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

describe('AE-166: Submit and Lock Graded Script for Teaching Assistants', () => {
  let submitPOST: any;
  let gradesPOST: any;
  let annotationsPUT: any;

  let professorId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let otherTaId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let courseId: mongoose.Types.ObjectId;
  let scriptId: mongoose.Types.ObjectId;
  let rubricId: mongoose.Types.ObjectId;
  let page1Id: mongoose.Types.ObjectId;

  beforeAll(async () => {
    submitPOST = (await import('../app/api/scripts/[id]/submit/route')).POST;
    gradesPOST = (await import('../app/api/scripts/[id]/grades/route')).POST;
    annotationsPUT = (await import('../app/api/scripts/[id]/pages/[p]/annotations/route')).PUT;
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await AnswerScript.deleteMany({});
    await Page.deleteMany({});
    await Allocation.deleteMany({});
    await Grade.deleteMany({});
    await Rubric.deleteMany({});
    await AuditLog.deleteMany({});

    professorId = new mongoose.Types.ObjectId('000000000000000000000101');
    taId = new mongoose.Types.ObjectId('000000000000000000000102');
    otherTaId = new mongoose.Types.ObjectId('000000000000000000000103');
    studentId = new mongoose.Types.ObjectId('000000000000000000000104');

    // Create users in DB
    await User.create([
      {
        _id: professorId,
        name: 'Prof. Turing',
        email: 'turing@evaluator.edu',
        password: 'password123',
        role: UserRole.PROFESSOR,
        isActive: true,
      },
      {
        _id: taId,
        name: 'TA Ada',
        email: 'ada@evaluator.edu',
        password: 'password123',
        role: UserRole.TA,
        isActive: true,
      },
      {
        _id: otherTaId,
        name: 'TA Grace',
        email: 'grace@evaluator.edu',
        password: 'password123',
        role: UserRole.TA,
        isActive: true,
      },
      {
        _id: studentId,
        name: 'Student Alan',
        email: 'alan@evaluator.edu',
        password: 'password123',
        role: UserRole.STUDENT,
        isActive: true,
      },
    ]);

    // Create Course
    const course = await Course.create({
      courseCode: 'CS101',
      courseName: 'Computer Science Fundamentals',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [taId, otherTaId],
      enrolledStudents: [studentId],
      isActive: true,
    });
    courseId = course._id;

    // Create Exam
    examId = new mongoose.Types.ObjectId();
    const exam = await Exam.create({
      _id: examId,
      title: 'Midterm Exam',
      course: courseId,
      examDate: new Date(),
      status: ExamStatus.PUBLISHED,
      numberOfQuestions: 2,
      totalMarks: 20,
      createdBy: professorId,
      isActive: true,
    });

    // Create Rubric
    rubricId = new mongoose.Types.ObjectId();
    await Rubric.create({
      _id: rubricId,
      exam: exam._id,
      createdBy: professorId,
      scoreStep: 0.5,
      questions: [
        {
          questionNumber: 1,
          maxMarks: 10,
          criteria: [
            { criterionName: 'Logic', points: 6 },
            { criterionName: 'Clarity', points: 4 },
          ],
        },
        {
          questionNumber: 2,
          maxMarks: 10,
          criteria: [
            { criterionName: 'Correctness', points: 7 },
            { criterionName: 'Efficiency', points: 3 },
          ],
        },
      ],
      isActive: true,
    });

    // Create AnswerScript
    scriptId = new mongoose.Types.ObjectId();
    await AnswerScript.create({
      _id: scriptId,
      exam: exam._id,
      student: studentId,
      pageCount: 2,
      isActive: true,
    });

    // Create Page
    page1Id = new mongoose.Types.ObjectId();
    await Page.create({
      _id: page1Id,
      answerScript: scriptId,
      pageNumber: 1,
      imagePath: '/uploads/scripts/p1.png',
      isActive: true,
    });
  });

  describe('1. GradingService.submitScript() Core Logic', () => {
    it('successfully submits a fully graded whole-script allocation for an allocated TA', async () => {
      // 1. Create Allocation for taId
      const allocation = await Allocation.create({
        exam: examId,
        answerScript: scriptId,
        ta: taId,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.RANDOM,
        claimedAt: new Date(),
      });

      // 2. Save draft grades for Q1 and Q2
      await Grade.create([
        {
          answerScript: scriptId,
          rubric: rubricId,
          gradedBy: taId,
          question: 1,
          marksAwarded: [
            { criterionName: 'Logic', score: 5 },
            { criterionName: 'Clarity', score: 3 },
          ],
          totalScore: 8,
          feedback: 'Solid structure',
          isFinal: false,
        },
        {
          answerScript: scriptId,
          rubric: rubricId,
          gradedBy: taId,
          question: 2,
          marksAwarded: [
            { criterionName: 'Correctness', score: 6 },
            { criterionName: 'Efficiency', score: 2.5 },
          ],
          totalScore: 8.5,
          feedback: 'Good work',
          isFinal: false,
        },
      ]);

      // 3. Submit Script
      const result = await gradingService.submitScript({
        scriptId: scriptId.toString(),
        userId: taId.toString(),
        userRole: UserRole.TA,
      });

      expect(result.isSubmitted).toBe(true);
      expect(result.scriptId).toBe(scriptId.toString());
      expect(result.submittedBy).toBe(taId.toString());
      expect(result.totalScore).toBe(16.5);
      expect(result.finalizedQuestions).toEqual([1, 2]);
      expect(result.allocationCompleted).toBe(true);

      // Verify Allocation is COMPLETED with completedAt
      const updatedAlloc = await Allocation.findById(allocation._id);
      expect(updatedAlloc?.status).toBe(AllocationStatus.COMPLETED);
      expect(updatedAlloc?.completedAt).toBeInstanceOf(Date);

      // Verify Grades are marked isFinal: true
      const grades = await Grade.find({ answerScript: scriptId });
      expect(grades).toHaveLength(2);
      expect(grades.every((g) => g.isFinal === true)).toBe(true);

      // Verify AuditLog
      const logs = await AuditLog.find({
        action: 'SCRIPT_SUBMITTED',
        entityId: scriptId,
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].user.toString()).toBe(taId.toString());
      expect(logs[0].details?.totalScore).toBe(16.5);
    });

    it('rejects submission when incomplete/ungraded questions remain and leaves all draft questions unfinalized', async () => {
      // Create Allocation
      const alloc = await Allocation.create({
        exam: examId,
        answerScript: scriptId,
        ta: taId,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
      });

      // Grade only Question 1 (leaving Question 2 ungraded)
      const q1Grade = await Grade.create({
        answerScript: scriptId,
        rubric: rubricId,
        gradedBy: taId,
        question: 1,
        marksAwarded: [{ criterionName: 'Logic', score: 5 }, { criterionName: 'Clarity', score: 3 }],
        totalScore: 8,
        isFinal: false,
      });

      await expect(
        gradingService.submitScript({
          scriptId: scriptId.toString(),
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow(/Question\(s\) 2 must be graded before submission/i);

      // Verify atomic behavior: Question 1 grade is NOT finalized
      const refreshedGrade = await Grade.findById(q1Grade._id);
      expect(refreshedGrade?.isFinal).toBe(false);

      // Verify allocation remains IN_PROGRESS and completedAt is unset
      const refreshedAlloc = await Allocation.findById(alloc._id);
      expect(refreshedAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
      expect(refreshedAlloc?.completedAt).toBeFalsy();
    });

    it('rejects repeated submission of an already completed/submitted allocation with 409 Conflict', async () => {
      // Create COMPLETED allocation and finalized grades
      const completedAt = new Date(Date.now() - 10000);
      await Allocation.create({
        exam: examId,
        answerScript: scriptId,
        ta: taId,
        allocatedBy: professorId,
        status: AllocationStatus.COMPLETED,
        completedAt,
      });

      await Grade.create([
        {
          answerScript: scriptId,
          rubric: rubricId,
          gradedBy: taId,
          question: 1,
          marksAwarded: [{ criterionName: 'Logic', score: 6 }, { criterionName: 'Clarity', score: 4 }],
          totalScore: 10,
          isFinal: true,
        },
        {
          answerScript: scriptId,
          rubric: rubricId,
          gradedBy: taId,
          question: 2,
          marksAwarded: [{ criterionName: 'Correctness', score: 7 }, { criterionName: 'Efficiency', score: 3 }],
          totalScore: 10,
          isFinal: true,
        },
      ]);

      await expect(
        gradingService.submitScript({
          scriptId: scriptId.toString(),
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow(/already been submitted and completed/i);
    });

    it('rejects unallocated TAs and students with 403 Forbidden', async () => {
      // TA is not allocated
      await expect(
        gradingService.submitScript({
          scriptId: scriptId.toString(),
          userId: otherTaId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow(/You are not allocated to grade this answer script/i);

      // Student role
      await expect(
        gradingService.submitScript({
          scriptId: scriptId.toString(),
          userId: studentId.toString(),
          userRole: UserRole.STUDENT,
        })
      ).rejects.toThrow(/Students cannot submit grades/i);
    });
  });

  describe('2. Server-Side Locking Enforcements', () => {
    beforeEach(async () => {
      // Setup a submitted & completed script
      await Allocation.create({
        exam: examId,
        answerScript: scriptId,
        ta: taId,
        allocatedBy: professorId,
        status: AllocationStatus.COMPLETED,
        completedAt: new Date(),
      });

      await Grade.create({
        answerScript: scriptId,
        rubric: rubricId,
        gradedBy: taId,
        question: 1,
        marksAwarded: [{ criterionName: 'Logic', score: 5 }, { criterionName: 'Clarity', score: 3 }],
        totalScore: 8,
        feedback: 'Original TA feedback',
        isFinal: true,
      });
    });

    it('prevents TA from updating marks or feedback after submission (HTTP 409)', async () => {
      await expect(
        gradingService.saveGrade({
          scriptId: scriptId.toString(),
          question: 1,
          marksAwarded: [{ criterionName: 'Logic', score: 6 }, { criterionName: 'Clarity', score: 4 }],
          feedback: 'Attempted post-submission change',
          userId: taId.toString(),
          userRole: UserRole.TA,
          isFinal: false,
        })
      ).rejects.toThrow(/Cannot grade script: Allocation has already been marked as COMPLETED|This grade has been finalized/i);
    });

    it('prevents TA from saving page annotations after submission (HTTP 409)', async () => {
      await expect(
        annotationPersistenceService.savePageAnnotations({
          scriptId: scriptId.toString(),
          pageIdentifier: '1',
          payload: {
            annotations: [{ id: 'm1', tool: 'check', pageNumber: 1, x: 10, y: 10 }],
            strokes: [],
          },
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow(/This script allocation has already been submitted and locked/i);
    });

    it('preserves the original TA grade and marks unchanged for Professor review', async () => {
      const persistedGrade = await Grade.findOne({ answerScript: scriptId, question: 1 });
      expect(persistedGrade).not.toBeNull();
      expect(persistedGrade?.gradedBy.toString()).toBe(taId.toString());
      expect(persistedGrade?.totalScore).toBe(8);
      expect(persistedGrade?.feedback).toBe('Original TA feedback');
      expect(persistedGrade?.isFinal).toBe(true);

      // Professor can retrieve the original grade via getGradesForScript
      const gradesForProf = await gradingService.getGradesForScript(
        scriptId.toString(),
        professorId.toString(),
        UserRole.PROFESSOR
      );
      expect(gradesForProf).toHaveLength(1);
      expect(gradesForProf[0].totalScore).toBe(8);
      expect(gradesForProf[0].gradedBy.toString()).toBe(taId.toString());
    });
  });

  describe('3. API Route Integration: POST /api/scripts/[id]/submit', () => {
    it('submits and locks script via HTTP API route for authenticated TA', async () => {
      await Allocation.create({
        exam: examId,
        answerScript: scriptId,
        ta: taId,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        claimedAt: new Date(),
      });

      await Grade.create([
        {
          answerScript: scriptId,
          rubric: rubricId,
          gradedBy: taId,
          question: 1,
          marksAwarded: [{ criterionName: 'Logic', score: 5 }, { criterionName: 'Clarity', score: 3 }],
          totalScore: 8,
          isFinal: false,
        },
        {
          answerScript: scriptId,
          rubric: rubricId,
          gradedBy: taId,
          question: 2,
          marksAwarded: [{ criterionName: 'Correctness', score: 7 }, { criterionName: 'Efficiency', score: 3 }],
          totalScore: 10,
          isFinal: false,
        },
      ]);

      mockSessionUser = {
        id: taId.toString(),
        email: 'ada@evaluator.edu',
        role: UserRole.TA,
      };

      const req = new Request(`http://localhost:3000/api/scripts/${scriptId.toString()}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await submitPOST(req, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.isSubmitted).toBe(true);
      expect(json.data.totalScore).toBe(18);
      expect(json.data.allocationCompleted).toBe(true);
    });

    it('returns 409 Conflict via API route when questions are incomplete and identifies missing question', async () => {
      await Allocation.create({
        exam: examId,
        answerScript: scriptId,
        ta: taId,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        claimedAt: new Date(),
      });

      // Grade only Question 1
      await Grade.create({
        answerScript: scriptId,
        rubric: rubricId,
        gradedBy: taId,
        question: 1,
        marksAwarded: [{ criterionName: 'Logic', score: 5 }, { criterionName: 'Clarity', score: 3 }],
        totalScore: 8,
        isFinal: false,
      });

      mockSessionUser = {
        id: taId.toString(),
        email: 'ada@evaluator.edu',
        role: UserRole.TA,
      };

      const req = new Request(`http://localhost:3000/api/scripts/${scriptId.toString()}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await submitPOST(req, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toMatch(/Question\(s\) 2 must be graded before submission/i);
    });

    it('returns 409 Conflict via API route for repeated submission', async () => {
      await Allocation.create({
        exam: examId,
        answerScript: scriptId,
        ta: taId,
        allocatedBy: professorId,
        status: AllocationStatus.COMPLETED,
        completedAt: new Date(),
      });

      mockSessionUser = {
        id: taId.toString(),
        email: 'ada@evaluator.edu',
        role: UserRole.TA,
      };

      const req = new Request(`http://localhost:3000/api/scripts/${scriptId.toString()}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await submitPOST(req, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toMatch(/already been submitted and completed/i);
    });

    it('returns 403 Forbidden via API route for unallocated TA', async () => {
      mockSessionUser = {
        id: otherTaId.toString(),
        email: 'grace@evaluator.edu',
        role: UserRole.TA,
      };

      const req = new Request(`http://localhost:3000/api/scripts/${scriptId.toString()}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await submitPOST(req, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toMatch(/Forbidden/i);
    });

    it('rejects grade updates via API route after script is submitted (HTTP 409)', async () => {
      await Allocation.create({
        exam: examId,
        answerScript: scriptId,
        ta: taId,
        allocatedBy: professorId,
        status: AllocationStatus.COMPLETED,
        completedAt: new Date(),
      });

      await Grade.create({
        answerScript: scriptId,
        rubric: rubricId,
        gradedBy: taId,
        question: 1,
        marksAwarded: [{ criterionName: 'Logic', score: 5 }, { criterionName: 'Clarity', score: 3 }],
        totalScore: 8,
        isFinal: true,
      });

      mockSessionUser = {
        id: taId.toString(),
        email: 'ada@evaluator.edu',
        role: UserRole.TA,
      };

      const req = new Request(`http://localhost:3000/api/scripts/${scriptId.toString()}/grades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 1,
          marksAwarded: [{ criterionName: 'Logic', score: 6 }, { criterionName: 'Clarity', score: 4 }],
          isFinal: false,
        }),
      });

      const res = await gradesPOST(req, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('rejects annotation saves via API route after script is submitted (HTTP 409)', async () => {
      await Allocation.create({
        exam: examId,
        answerScript: scriptId,
        ta: taId,
        allocatedBy: professorId,
        status: AllocationStatus.COMPLETED,
        completedAt: new Date(),
      });

      mockSessionUser = {
        id: taId.toString(),
        email: 'ada@evaluator.edu',
        role: UserRole.TA,
      };

      const req = new Request(`http://localhost:3000/api/scripts/${scriptId.toString()}/pages/1/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annotations: [{ id: 'm1', tool: 'check', pageNumber: 1, x: 20, y: 20 }],
          strokes: [],
        }),
      });

      const res = await annotationsPUT(req, {
        params: Promise.resolve({ id: scriptId.toString(), p: '1' }),
      });

      expect(res.status).toBe(409);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toMatch(/submitted and locked/i);
    });
  });
});
