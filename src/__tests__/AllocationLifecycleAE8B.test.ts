/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Grade from '../models/Grade';
import User, { UserRole } from '../models/User';
import gradingService from '../services/GradingService';
import AllocationService from '../services/AllocationService';
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

describe('AE-8B: Allocation Claim & Completion Lifecycle', () => {
  let completePOST: any;
  let questionGradePOST: any;

  let professorId: mongoose.Types.ObjectId;
  let ta1Id: mongoose.Types.ObjectId;
  let ta2Id: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let courseId: mongoose.Types.ObjectId;
  let scriptId: mongoose.Types.ObjectId;
  let rubricId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    completePOST = (await import('../app/api/allocations/[id]/complete/route')).POST;
    questionGradePOST = (await import('../app/api/scripts/[id]/questions/[questionNumber]/grade/route')).POST;
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await AnswerScript.deleteMany({});
    await Allocation.deleteMany({});
    await Grade.deleteMany({});
    await Rubric.deleteMany({});

    professorId = new mongoose.Types.ObjectId('000000000000000000000301');
    ta1Id = new mongoose.Types.ObjectId('000000000000000000000302');
    ta2Id = new mongoose.Types.ObjectId('000000000000000000000303');
    studentId = new mongoose.Types.ObjectId('000000000000000000000304');

    // Create users in DB
    await User.create([
      {
        _id: professorId,
        name: 'Professor Snape',
        email: 'snape@hogwarts.edu',
        password: 'password123',
        role: UserRole.PROFESSOR,
        isActive: true,
      },
      {
        _id: ta1Id,
        name: 'Hermione Granger',
        email: 'hermione@hogwarts.edu',
        password: 'password123',
        role: UserRole.TA,
        isActive: true,
      },
      {
        _id: ta2Id,
        name: 'Ron Weasley',
        email: 'ron@hogwarts.edu',
        password: 'password123',
        role: UserRole.TA,
        isActive: true,
      },
      {
        _id: studentId,
        name: 'Harry Potter',
        email: 'harry@hogwarts.edu',
        password: 'password123',
        role: UserRole.STUDENT,
        isActive: true,
      },
    ]);

    // Create Course
    const course = await Course.create({
      courseCode: 'CS301',
      courseName: 'Algorithms Design',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [ta1Id, ta2Id],
      enrolledStudents: [studentId],
      isActive: true,
    });
    courseId = course._id as mongoose.Types.ObjectId;

    // Create Exam
    const exam = new Exam({
      title: 'Midterm Exam',
      course: courseId,
      createdBy: professorId,
      examDate: new Date('2026-10-15T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 2,
      status: ExamStatus.PUBLISHED,
      isActive: true,
    });
    const savedExam = await exam.save();
    examId = savedExam._id as mongoose.Types.ObjectId;

    // Create Rubric
    const rubric = new Rubric({
      exam: examId,
      createdBy: professorId,
      questions: [
        {
          questionNumber: 1,
          maxMarks: 10,
          criteria: [
            { criterionName: 'Correctness', description: 'Logic correctness', points: 6 },
            { criterionName: 'Complexity', description: 'Optimal time bound', points: 4 },
          ],
        },
        {
          questionNumber: 2,
          maxMarks: 15,
          criteria: [
            { criterionName: 'Derivation', description: 'Step-by-step induction', points: 10 },
            { criterionName: 'Clarity', description: 'Clean presentation', points: 5 },
          ],
        },
      ],
      isActive: true,
    });
    const savedRubric = await rubric.save();
    rubricId = savedRubric._id as mongoose.Types.ObjectId;

    // Create AnswerScript
    const script = new AnswerScript({
      exam: examId,
      student: studentId,
      pageCount: 3,
      pages: [],
      isActive: true,
    });
    const savedScript = await script.save();
    scriptId = savedScript._id as mongoose.Types.ObjectId;
  });

  // 1. First successful grade save claims PENDING allocation
  it('1. claims PENDING allocation on first successful grade save and records claimedAt', async () => {
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
    });

    const result = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 5 },
        { criterionName: 'Complexity', score: 3 },
      ],
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    expect(result).toBeDefined();
    expect(result.totalScore).toBe(8);

    const updatedAlloc = await Allocation.findById(allocation._id);
    expect(updatedAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(updatedAlloc?.claimedAt).toBeDefined();
    expect(updatedAlloc?.claimedAt).toBeInstanceOf(Date);
  });

  // 2. Failed grade save does NOT claim allocation
  it('2. does NOT claim allocation if grade validation or save fails', async () => {
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
    });

    // Score exceeds rubric max points (Correctness max is 6)
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 99 },
        ],
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);

    const checkAlloc = await Allocation.findById(allocation._id);
    expect(checkAlloc?.status).toBe(AllocationStatus.PENDING);
    expect(checkAlloc?.claimedAt).toBeUndefined();
  });

  // 3. Already IN_PROGRESS allocation remains IN_PROGRESS and keeps claimedAt
  it('3. preserves existing claimedAt when grading an already IN_PROGRESS allocation', async () => {
    const initialClaimTime = new Date('2026-09-01T10:00:00.000Z');
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      claimedAt: initialClaimTime,
    });

    await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 4 },
        { criterionName: 'Complexity', score: 2 },
      ],
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    const checkAlloc = await Allocation.findById(allocation._id);
    expect(checkAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(checkAlloc?.claimedAt?.toISOString()).toBe(initialClaimTime.toISOString());
  });

  // 4. TA can complete their own finalized question-wise allocation via endpoint
  it('4. allows TA to complete their own IN_PROGRESS question-wise allocation with finalized grade via POST /api/allocations/[id]/complete', async () => {
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      claimedAt: new Date(),
    });

    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: ta1Id,
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      totalScore: 10,
      isFinal: true,
    });

    mockSessionUser = { id: ta1Id.toString(), role: UserRole.TA, email: 'hermione@hogwarts.edu' };

    const res = await completePOST(new Request('http://localhost'), {
      params: Promise.resolve({ id: allocation._id.toString() }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe(AllocationStatus.COMPLETED);
    expect(body.data.completedAt).toBeDefined();

    const dbAlloc = await Allocation.findById(allocation._id);
    expect(dbAlloc?.status).toBe(AllocationStatus.COMPLETED);
    expect(dbAlloc?.completedAt).toBeDefined();
  });

  // 4b. POST complete returns 409 for allocation with no grades
  it('4b. rejects POST complete with 409 if no grades exist for the allocation', async () => {
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      claimedAt: new Date(),
    });

    mockSessionUser = { id: ta1Id.toString(), role: UserRole.TA, email: 'hermione@hogwarts.edu' };

    const res = await completePOST(new Request('http://localhost'), {
      params: Promise.resolve({ id: allocation._id.toString() }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/all allocated questions must have finalized grades/i);

    const dbAlloc = await Allocation.findById(allocation._id);
    expect(dbAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(dbAlloc?.completedAt).toBeUndefined();
  });

  // 4c. POST complete returns 409 for draft-only allocation
  it('4c. rejects POST complete with 409 if grade is only a draft (isFinal === false)', async () => {
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      claimedAt: new Date(),
    });

    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: ta1Id,
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 5 },
      ],
      totalScore: 5,
      isFinal: false,
    });

    mockSessionUser = { id: ta1Id.toString(), role: UserRole.TA, email: 'hermione@hogwarts.edu' };

    const res = await completePOST(new Request('http://localhost'), {
      params: Promise.resolve({ id: allocation._id.toString() }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/all allocated questions must have finalized grades/i);

    const dbAlloc = await Allocation.findById(allocation._id);
    expect(dbAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(dbAlloc?.completedAt).toBeUndefined();
  });

  // 4d. POST complete returns 409 for partially finalized whole-script allocation
  it('4d. rejects POST complete with 409 for whole-script allocation when only some rubric questions are finalized', async () => {
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
      claimedAt: new Date(),
    });

    // Q1 is finalized
    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: ta1Id,
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      totalScore: 10,
      isFinal: true,
    });

    // Q2 is draft (isFinal: false)
    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: ta1Id,
      question: 2,
      marksAwarded: [
        { criterionName: 'Derivation', score: 8 },
      ],
      totalScore: 8,
      isFinal: false,
    });

    mockSessionUser = { id: ta1Id.toString(), role: UserRole.TA, email: 'hermione@hogwarts.edu' };

    const res = await completePOST(new Request('http://localhost'), {
      params: Promise.resolve({ id: allocation._id.toString() }),
    });

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toMatch(/all allocated questions must have finalized grades/i);

    const dbAlloc = await Allocation.findById(allocation._id);
    expect(dbAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(dbAlloc?.completedAt).toBeUndefined();
  });

  // 4e. POST complete succeeds for fully finalized whole-script allocation
  it('4e. allows completing whole-script allocation via POST complete when all rubric questions are finalized', async () => {
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
      claimedAt: new Date(),
    });

    // Q1 is finalized
    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: ta1Id,
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      totalScore: 10,
      isFinal: true,
    });

    // Q2 is finalized
    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: ta1Id,
      question: 2,
      marksAwarded: [
        { criterionName: 'Derivation', score: 10 },
        { criterionName: 'Clarity', score: 5 },
      ],
      totalScore: 15,
      isFinal: true,
    });

    mockSessionUser = { id: ta1Id.toString(), role: UserRole.TA, email: 'hermione@hogwarts.edu' };

    const res = await completePOST(new Request('http://localhost'), {
      params: Promise.resolve({ id: allocation._id.toString() }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe(AllocationStatus.COMPLETED);
    expect(body.data.completedAt).toBeDefined();

    const dbAlloc = await Allocation.findById(allocation._id);
    expect(dbAlloc?.status).toBe(AllocationStatus.COMPLETED);
    expect(dbAlloc?.completedAt).toBeDefined();
  });

  // 5. TA cannot complete another TA's allocation
  it('5. prevents TA from completing another TA\'s allocation', async () => {
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      claimedAt: new Date(),
    });

    // Finalized grade exists for Q1
    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: ta1Id,
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 6 }, { criterionName: 'Complexity', score: 4 }],
      totalScore: 10,
      isFinal: true,
    });

    // TA2 attempts to complete TA1's allocation
    mockSessionUser = { id: ta2Id.toString(), role: UserRole.TA, email: 'ron@hogwarts.edu' };

    const res = await completePOST(new Request('http://localhost'), {
      params: Promise.resolve({ id: allocation._id.toString() }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);

    const dbAlloc = await Allocation.findById(allocation._id);
    expect(dbAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
  });

  // 6. Unauthenticated completion request returns 401
  it('6. returns 401 for unauthenticated completion request', async () => {
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
    });

    mockSessionUser = null;

    const res = await completePOST(new Request('http://localhost'), {
      params: Promise.resolve({ id: allocation._id.toString() }),
    });

    expect(res.status).toBe(401);
  });

  // 7. Unauthorized completion returns 403
  it('7. returns 403 for unauthorized completion request (e.g. Student)', async () => {
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
    });

    mockSessionUser = { id: studentId.toString(), role: UserRole.STUDENT, email: 'harry@hogwarts.edu' };

    const res = await completePOST(new Request('http://localhost'), {
      params: Promise.resolve({ id: allocation._id.toString() }),
    });

    expect(res.status).toBe(403);
  });

  // 8. Final submission sets Grade.isFinal = true
  it('8. sets Grade.isFinal = true on final submission', async () => {
    await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
    });

    mockSessionUser = { id: ta1Id.toString(), role: UserRole.TA, email: 'hermione@hogwarts.edu' };

    const req = new Request(`http://localhost/api/scripts/${scriptId}/questions/1/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marksAwarded: [
          { criterionName: 'Correctness', score: 6 },
          { criterionName: 'Complexity', score: 4 },
        ],
        feedback: 'Excellent work!',
        isFinal: true,
      }),
    });

    const res = await questionGradePOST(req, {
      params: Promise.resolve({ id: scriptId.toString(), questionNumber: '1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.isFinal).toBe(true);

    const savedGrade = await Grade.findOne({ answerScript: scriptId, question: 1 });
    expect(savedGrade?.isFinal).toBe(true);
  });

  // 9. Final submission marks allocation COMPLETED
  // 10. completedAt is recorded
  it('9 & 10. marks allocation COMPLETED and records completedAt on final submission', async () => {
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
    });

    await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 3 },
      ],
      isFinal: true,
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    const updatedAlloc = await Allocation.findById(allocation._id);
    expect(updatedAlloc?.status).toBe(AllocationStatus.COMPLETED);
    expect(updatedAlloc?.completedAt).toBeDefined();
    expect(updatedAlloc?.completedAt).toBeInstanceOf(Date);
  });

  // 11. Failed final Grade save does NOT complete allocation
  it('11. does NOT complete allocation if final grade save fails validation', async () => {
    const allocation = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      claimedAt: new Date(),
    });

    // Invalid score exceeding criterion points
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 100 },
        ],
        isFinal: true,
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);

    const checkAlloc = await Allocation.findById(allocation._id);
    expect(checkAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(checkAlloc?.completedAt).toBeUndefined();
  });

  // 12. Completed allocation cannot be graded again
  it('12. rejects further grading edits on a COMPLETED allocation with 409', async () => {
    await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.COMPLETED,
      rule: AllocationRule.QUESTION,
      question: 1,
      completedAt: new Date(),
    });

    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5 },
        ],
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrowError(/Cannot grade script: Allocation has already been marked as COMPLETED/i);
  });

  // 13. Final Grade cannot be edited again
  it('13. rejects modifying a finalized Grade (Grade.isFinal = true) with 409', async () => {
    await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
    });

    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: ta1Id,
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 6 }],
      totalScore: 6,
      isFinal: true,
    });

    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5 },
        ],
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrowError(/Cannot edit grade: This grade has been finalized/i);
  });

  // 14. Question-wise Q1 completion does not complete Q2 allocation
  it('14. finalizing Question 1 allocation completes Q1 allocation without completing Q2 allocation', async () => {
    const allocQ1 = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      claimedAt: new Date(),
    });

    const allocQ2 = await Allocation.create({
      exam: examId,
      ta: ta2Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 2,
      claimedAt: new Date(),
    });

    // Finalize Question 1 by TA1
    await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      isFinal: true,
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    const checkQ1 = await Allocation.findById(allocQ1._id);
    const checkQ2 = await Allocation.findById(allocQ2._id);

    expect(checkQ1?.status).toBe(AllocationStatus.COMPLETED);
    expect(checkQ1?.completedAt).toBeDefined();

    expect(checkQ2?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(checkQ2?.completedAt).toBeUndefined();
  });

  // 15. Whole-script allocation completion: remains IN_PROGRESS on partial finalization, editable for remaining questions, and completes only when all rubric questions are final
  it('15. keeps whole-script allocation IN_PROGRESS on partial question finalization, allows remaining questions to be edited/finalized, and completes only when all questions are finalized', async () => {
    const wholeScriptAlloc = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.EQUAL,
    });

    // 1. First save (Q1 draft) claims whole-script allocation (PENDING -> IN_PROGRESS)
    await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 5 },
      ],
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    let allocState = await Allocation.findById(wholeScriptAlloc._id);
    expect(allocState?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(allocState?.claimedAt).toBeDefined();

    // 2. Finalize Question 1: allocation must remain IN_PROGRESS because Q2 is not yet final (1 of 2 questions final)
    await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      isFinal: true,
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    allocState = await Allocation.findById(wholeScriptAlloc._id);
    expect(allocState?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(allocState?.completedAt).toBeUndefined();

    // 3. Question 2 remains editable (save draft for Question 2)
    const q2Draft = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 2,
      marksAwarded: [
        { criterionName: 'Derivation', score: 8 },
        { criterionName: 'Clarity', score: 3 },
      ],
      isFinal: false,
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });
    expect(q2Draft.isFinal).toBe(false);
    expect(q2Draft.totalScore).toBe(11);

    allocState = await Allocation.findById(wholeScriptAlloc._id);
    expect(allocState?.status).toBe(AllocationStatus.IN_PROGRESS);

    // 4. Finalize Question 2 (last remaining rubric question -> 2 of 2 questions final): marks allocation COMPLETED
    await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 2,
      marksAwarded: [
        { criterionName: 'Derivation', score: 10 },
        { criterionName: 'Clarity', score: 5 },
      ],
      isFinal: true,
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    const completedAlloc = await Allocation.findById(wholeScriptAlloc._id);
    expect(completedAlloc?.status).toBe(AllocationStatus.COMPLETED);
    expect(completedAlloc?.completedAt).toBeDefined();
    expect(completedAlloc?.completedAt).toBeInstanceOf(Date);
  });

  // 16. Duplicate final submission is safely rejected / idempotent (returns 409)
  it('16. safely rejects duplicate final submission on already completed allocation / grade with 409', async () => {
    await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
    });

    // 1st submission
    await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      isFinal: true,
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    // 2nd duplicate final submission
    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 6 },
          { criterionName: 'Complexity', score: 4 },
        ],
        isFinal: true,
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);
  });

  // 17. Professor progress reflects completed allocation / grade
  it('17. accurately reflects completed allocations and timing in professor progress', async () => {
    const t0 = new Date(Date.now() - 3600000);

    const alloc1 = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      claimedAt: t0,
    });

    // Complete allocation 1
    await AllocationService.markCompleted(alloc1._id.toString(), {
      id: ta1Id.toString(),
      role: UserRole.TA,
    });

    const progress = await AllocationService.getProgress(examId.toString());
    expect(progress.total).toBe(1);
    expect(progress.graded).toBe(1);

    const ta1Progress = progress.progress.find((p) => p.taId === ta1Id.toString());
    expect(ta1Progress).toBeDefined();
    expect(ta1Progress?.graded).toBe(1);
    expect(ta1Progress?.total).toBe(1);
    expect(ta1Progress?.completionRatio).toBe(1);

    // TA Workload query check
    const workload = await AllocationService.getTaAllocationsForExam(examId.toString(), ta1Id.toString());
    expect(workload.total).toBe(1);
    expect(workload.graded).toBe(1);
    expect(workload.inProgress).toBe(0);
    expect(workload.pending).toBe(0);
    expect(workload.scripts[0].status).toBe(AllocationStatus.COMPLETED);
    expect(workload.scripts[0].completedAt).toBeDefined();
  });

  // 18. Critical Failure Test: Deliberate failure during allocation completion rolls back Grade.isFinal
  it('18. rolls back and does NOT persist Grade.isFinal = true if allocation completion fails during final submit', async () => {
    const alloc = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      claimedAt: new Date(),
    });

    // Mock markCompleted to simulate unexpected failure during completion
    const markCompletedSpy = vi.spyOn(AllocationService, 'markCompleted').mockRejectedValueOnce(
      new Error('Database write failure during markCompleted')
    );

    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 6 },
          { criterionName: 'Complexity', score: 4 },
        ],
        isFinal: true,
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrowError(/Database write failure during markCompleted/i);

    // Verify invariant: Grade is NOT final, Allocation is NOT COMPLETED
    const checkGrade = await Grade.findOne({ answerScript: scriptId, question: 1 });
    expect(checkGrade?.isFinal).toBeFalsy();

    const checkAlloc = await Allocation.findById(alloc._id);
    expect(checkAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(checkAlloc?.completedAt).toBeUndefined();

    markCompletedSpy.mockRestore();
  });

  // 19. Critical Failure Test: Existing draft grade is reverted if final submit completion fails
  it('19. reverts existing draft Grade.isFinal back to false if allocation completion fails during final submit', async () => {
    const alloc = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: scriptId,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      claimedAt: new Date(),
    });

    // Pre-existing draft grade
    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: ta1Id,
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 5 }, { criterionName: 'Complexity', score: 2 }],
      totalScore: 7,
      isFinal: false,
    });

    // Mock markCompleted failure
    const markCompletedSpy = vi.spyOn(AllocationService, 'markCompleted').mockRejectedValueOnce(
      new Error('Simulated network failure on completion')
    );

    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 6 },
          { criterionName: 'Complexity', score: 4 },
        ],
        isFinal: true,
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrowError(/Simulated network failure on completion/i);

    // Verify existing grade is NOT left with isFinal = true
    const checkGrade = await Grade.findOne({ answerScript: scriptId, question: 1 });
    expect(checkGrade?.isFinal).toBe(false);

    // Verify allocation is NOT COMPLETED
    const checkAlloc = await Allocation.findById(alloc._id);
    expect(checkAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(checkAlloc?.completedAt).toBeUndefined();

    markCompletedSpy.mockRestore();
  });
});
