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

describe('AE-157: Next-script auto-advance test suite', () => {
  let questionGradePOST: any;
  let nextAllocationGET: any;
  let completePOST: any;

  let professorId: mongoose.Types.ObjectId;
  let ta1Id: mongoose.Types.ObjectId;
  let ta2Id: mongoose.Types.ObjectId;
  let student1Id: mongoose.Types.ObjectId;
  let student2Id: mongoose.Types.ObjectId;
  let student3Id: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let otherExamId: mongoose.Types.ObjectId;
  let courseId: mongoose.Types.ObjectId;
  let script1Id: mongoose.Types.ObjectId;
  let script2Id: mongoose.Types.ObjectId;
  let script3Id: mongoose.Types.ObjectId;
  let rubricId: mongoose.Types.ObjectId;
  let otherExamScriptId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    questionGradePOST = (await import('../app/api/scripts/[id]/questions/[questionNumber]/grade/route')).POST;
    nextAllocationGET = (await import('../app/api/allocations/next/route')).GET;
    completePOST = (await import('../app/api/allocations/[id]/complete/route')).POST;
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await AnswerScript.deleteMany({});
    await Allocation.deleteMany({});
    await Grade.deleteMany({});
    await Rubric.deleteMany({});

    professorId = new mongoose.Types.ObjectId('000000000000000000000401');
    ta1Id = new mongoose.Types.ObjectId('000000000000000000000402');
    ta2Id = new mongoose.Types.ObjectId('000000000000000000000403');
    student1Id = new mongoose.Types.ObjectId('000000000000000000000404');
    student2Id = new mongoose.Types.ObjectId('000000000000000000000405');
    student3Id = new mongoose.Types.ObjectId('000000000000000000000406');

    // Create users in DB
    await User.create([
      {
        _id: professorId,
        name: 'Prof Snape',
        email: 'snape@univ.edu',
        password: 'password123',
        role: UserRole.PROFESSOR,
        isActive: true,
      },
      {
        _id: ta1Id,
        name: 'Hermione Granger',
        email: 'hermione@univ.edu',
        password: 'password123',
        role: UserRole.TA,
        isActive: true,
      },
      {
        _id: ta2Id,
        name: 'Ron Weasley',
        email: 'ron@univ.edu',
        password: 'password123',
        role: UserRole.TA,
        isActive: true,
      },
      {
        _id: student1Id,
        name: 'Student One',
        email: 'student1@univ.edu',
        password: 'password123',
        role: UserRole.STUDENT,
        isActive: true,
      },
      {
        _id: student2Id,
        name: 'Student Two',
        email: 'student2@univ.edu',
        password: 'password123',
        role: UserRole.STUDENT,
        isActive: true,
      },
      {
        _id: student3Id,
        name: 'Student Three',
        email: 'student3@univ.edu',
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
      enrolledStudents: [student1Id, student2Id, student3Id],
      isActive: true,
    });
    courseId = course._id as mongoose.Types.ObjectId;

    // Create Main Exam (2 questions in rubric)
    const exam = await Exam.create({
      title: 'Midterm Algorithms',
      course: courseId,
      createdBy: professorId,
      examDate: new Date('2026-10-15T09:00:00.000Z'),
      totalMarks: 25,
      numberOfQuestions: 2,
      status: ExamStatus.PUBLISHED,
      isActive: true,
    });
    examId = exam._id as mongoose.Types.ObjectId;

    // Create Other Exam for isolation test
    const otherExam = await Exam.create({
      title: 'Final Algorithms',
      course: courseId,
      createdBy: professorId,
      examDate: new Date('2026-12-15T09:00:00.000Z'),
      totalMarks: 50,
      numberOfQuestions: 1,
      status: ExamStatus.PUBLISHED,
      isActive: true,
    });
    otherExamId = otherExam._id as mongoose.Types.ObjectId;

    // Create Rubric for Main Exam (Q1: 10 marks, Q2: 15 marks)
    const savedRubric = await Rubric.create({
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
    rubricId = savedRubric._id as mongoose.Types.ObjectId;

    // Create Rubric for Other Exam
    await Rubric.create({
      exam: otherExamId,
      createdBy: professorId,
      questions: [
        {
          questionNumber: 1,
          maxMarks: 50,
          criteria: [
            { criterionName: 'Total', description: 'All', points: 50 },
          ],
        },
      ],
      isActive: true,
    });

    // Create AnswerScripts
    const script1 = await new AnswerScript({
      exam: examId,
      student: student1Id,
      pageCount: 3,
      isActive: true,
      scriptReference: 'SCRIPT-001',
    }).save();
    script1Id = script1._id as mongoose.Types.ObjectId;

    const script2 = await new AnswerScript({
      exam: examId,
      student: student2Id,
      pageCount: 3,
      isActive: true,
      scriptReference: 'SCRIPT-002',
    }).save();
    script2Id = script2._id as mongoose.Types.ObjectId;

    const script3 = await new AnswerScript({
      exam: examId,
      student: student3Id,
      pageCount: 3,
      isActive: true,
      scriptReference: 'SCRIPT-003',
    }).save();
    script3Id = script3._id as mongoose.Types.ObjectId;

    const otherScript = await new AnswerScript({
      exam: otherExamId,
      student: student1Id,
      pageCount: 2,
      isActive: true,
      scriptReference: 'OTHER-001',
    }).save();
    otherExamScriptId = otherScript._id as mongoose.Types.ObjectId;

    mockSessionUser = {
      id: ta1Id.toString(),
      name: 'Hermione Granger',
      email: 'hermione@univ.edu',
      role: UserRole.TA,
    };
  });

  // 1. Partial whole-script finalization does NOT auto-advance
  it('1. does not auto-advance when finalizing Q1 of a multi-question whole-script allocation (remains IN_PROGRESS)', async () => {
    // Whole-script allocation for Script 1
    const alloc1 = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    // Whole-script allocation for Script 2
    await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script2Id,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.EQUAL,
      createdAt: new Date('2026-09-01T10:01:00.000Z'),
    });

    // Finalize Q1 only (Q2 still unfinalized)
    const result: any = await gradingService.saveGrade({
      scriptId: script1Id.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      isFinal: true,
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    expect(result).toBeDefined();
    expect(result.isFinal).toBe(true);
    expect(result.allocationCompleted).toBe(false);
    expect(result.nextAllocation).toBeNull();

    // Verify DB allocation is still IN_PROGRESS
    const freshAlloc1 = await Allocation.findById(alloc1._id);
    expect(freshAlloc1?.status).toBe(AllocationStatus.IN_PROGRESS);
    expect(freshAlloc1?.completedAt).toBeUndefined();
  });

  // 2. Final required question finalized completes whole-script allocation and selects next allocation in dashboard order
  it('2. auto-advances to next allocation in dashboard order when all questions of a whole-script allocation are finalized', async () => {
    const alloc1 = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    const alloc2 = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script2Id,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.EQUAL,
      createdAt: new Date('2026-09-01T10:01:00.000Z'),
    });

    // Finalize Q1 first
    await gradingService.saveGrade({
      scriptId: script1Id.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      isFinal: true,
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    // Finalize Q2 (completing all required rubric questions)
    const result: any = await gradingService.saveGrade({
      scriptId: script1Id.toString(),
      question: 2,
      marksAwarded: [
        { criterionName: 'Derivation', score: 10 },
        { criterionName: 'Clarity', score: 5 },
      ],
      isFinal: true,
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    expect(result.isFinal).toBe(true);
    expect(result.allocationCompleted).toBe(true);
    expect(result.nextAllocation).toBeDefined();
    expect(result.nextAllocation.allocationId).toBe(alloc2._id.toString());
    expect(result.nextAllocation.scriptId).toBe(script2Id.toString());
    expect(result.nextAllocation.targetUrl).toBe(`/grading/${script2Id.toString()}`);

    // Verify DB allocation is COMPLETED
    const freshAlloc1 = await Allocation.findById(alloc1._id);
    expect(freshAlloc1?.status).toBe(AllocationStatus.COMPLETED);
    expect(freshAlloc1?.completedAt).toBeDefined();
  });

  // 3. Question-wise TA behavior: completing allocated question advances to next question-wise allocation
  it('3. advances to the next question-wise allocation when allocated question is finalized', async () => {
    // TA1 assigned Question 1 on Script 1 and Question 1 on Script 2
    const allocQ1Script1 = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    const allocQ1Script2 = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script2Id,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:05:00.000Z'),
    });

    const result: any = await gradingService.saveGrade({
      scriptId: script1Id.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 5 },
        { criterionName: 'Complexity', score: 3 },
      ],
      isFinal: true,
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    expect(result.allocationCompleted).toBe(true);
    expect(result.nextAllocation).toBeDefined();
    expect(result.nextAllocation.allocationId).toBe(allocQ1Script2._id.toString());
    expect(result.nextAllocation.scriptId).toBe(script2Id.toString());
    expect(result.nextAllocation.question).toBe(1);
    expect(result.nextAllocation.targetUrl).toBe(`/grading/${script2Id.toString()}/question/1`);

    const freshAlloc = await Allocation.findById(allocQ1Script1._id);
    expect(freshAlloc?.status).toBe(AllocationStatus.COMPLETED);
  });

  // 4. Save Draft must NEVER auto-advance
  it('4. never auto-advances on draft save (isFinal: false)', async () => {
    await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script1Id,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script2Id,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:05:00.000Z'),
    });

    const result: any = await gradingService.saveGrade({
      scriptId: script1Id.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 4 },
        { criterionName: 'Complexity', score: 2 },
      ],
      isFinal: false, // Save Draft
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    expect(result.isFinal).toBe(false);
    expect(result.allocationCompleted).toBe(false);
    expect(result.nextAllocation).toBeNull();
  });

  // 5. Failed final submission must NEVER auto-advance
  it('5. never auto-advances if final submission fails validation', async () => {
    const alloc1 = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script1Id,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
    });

    // Score 99 exceeds rubric max points (Correctness max is 6)
    await expect(
      gradingService.saveGrade({
        scriptId: script1Id.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 99 },
        ],
        isFinal: true,
        userId: ta1Id.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);

    const freshAlloc = await Allocation.findById(alloc1._id);
    expect(freshAlloc?.status).toBe(AllocationStatus.PENDING);
    expect(freshAlloc?.completedAt).toBeUndefined();
  });

  // 6. No remaining PENDING/IN_PROGRESS allocation -> nextAllocation is null, no navigation
  it('6. returns nextAllocation: null when there are no remaining allocations for the exam', async () => {
    // Only one allocation exists
    const alloc1 = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    const result: any = await gradingService.saveGrade({
      scriptId: script1Id.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      isFinal: true,
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    expect(result.allocationCompleted).toBe(true);
    expect(result.nextAllocation).toBeNull();

    const freshAlloc = await Allocation.findById(alloc1._id);
    expect(freshAlloc?.status).toBe(AllocationStatus.COMPLETED);
  });

  // 7. COMPLETED allocations are skipped when finding next allocation
  it('7. skips already COMPLETED allocations when selecting the next allocation', async () => {
    // Current allocation
    await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    // Already COMPLETED allocation
    await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script2Id,
      allocatedBy: professorId,
      status: AllocationStatus.COMPLETED,
      rule: AllocationRule.QUESTION,
      question: 1,
      completedAt: new Date('2026-09-01T10:05:00.000Z'),
      createdAt: new Date('2026-09-01T10:01:00.000Z'),
    });

    // Active PENDING allocation
    const alloc3 = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script3Id,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:02:00.000Z'),
    });

    const result: any = await gradingService.saveGrade({
      scriptId: script1Id.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      isFinal: true,
      userId: ta1Id.toString(),
      userRole: UserRole.TA,
    });

    expect(result.allocationCompleted).toBe(true);
    expect(result.nextAllocation).toBeDefined();
    // Must select alloc3 (PENDING), skipping alloc2 (COMPLETED)
    expect(result.nextAllocation.allocationId).toBe(alloc3._id.toString());
    expect(result.nextAllocation.scriptId).toBe(script3Id.toString());
  });

  // 8. Follows exact TA dashboard ordering: { createdAt: 1, _id: 1 }
  it('8. strictly respects TA dashboard ordering ({ createdAt: 1, _id: 1 }) when selecting next allocation', async () => {
    const currentAlloc = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    // Later created
    await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script3Id,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:30:00.000Z'),
    });

    // Earlier created
    const earlierAlloc = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script2Id,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:15:00.000Z'),
    });

    const next = await AllocationService.getNextAllocation(ta1Id, examId, currentAlloc._id);
    expect(next).toBeDefined();
    expect(next?.allocationId).toBe(earlierAlloc._id.toString());
    expect(next?.scriptId).toBe(script2Id.toString());
  });

  // 9. Different exams isolation
  it('9. never selects allocations from a different exam', async () => {
    const currentAlloc = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    // Allocation belonging to otherExamId
    await Allocation.create({
      exam: otherExamId,
      ta: ta1Id,
      answerScript: otherExamScriptId,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:01:00.000Z'),
    });

    const next = await AllocationService.getNextAllocation(ta1Id, examId, currentAlloc._id);
    // Should be null because no remaining allocations for examId
    expect(next).toBeNull();
  });

  // 10. API Route POST /api/scripts/[id]/questions/[questionNumber]/grade returns nextAllocation payload
  it('10. API route POST /api/scripts/[id]/questions/[questionNumber]/grade returns allocationCompleted and nextAllocation', async () => {
    await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    const nextAlloc = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script2Id,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:05:00.000Z'),
    });

    const req = new Request(`http://localhost:3000/api/scripts/${script1Id}/questions/1/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marksAwarded: [
          { criterionName: 'Correctness', score: 6 },
          { criterionName: 'Complexity', score: 4 },
        ],
        isFinal: true,
      }),
    });

    const res = await questionGradePOST(req, {
      params: Promise.resolve({ id: script1Id.toString(), questionNumber: '1' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.allocationCompleted).toBe(true);
    expect(json.data.nextAllocation).toBeDefined();
    expect(json.data.nextAllocation.allocationId).toBe(nextAlloc._id.toString());
    expect(json.data.nextAllocation.targetUrl).toBe(`/grading/${script2Id.toString()}/question/1`);
  });

  // 11. API Route GET /api/allocations/next returns next allocation for exam
  it('11. API route GET /api/allocations/next returns next active allocation', async () => {
    const currentAlloc = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    const nextAlloc = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script2Id,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:05:00.000Z'),
    });

    const req = new Request(
      `http://localhost:3000/api/allocations/next?examId=${examId.toString()}&currentAllocationId=${currentAlloc._id.toString()}`,
      { method: 'GET' }
    );

    const res = await nextAllocationGET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.allocationId).toBe(nextAlloc._id.toString());
    expect(json.data.targetUrl).toBe(`/grading/${script2Id.toString()}/question/1`);
  });

  // 12. Manual allocation completion via POST /api/allocations/[id]/complete returns nextAllocation
  it('12. manual completion via POST /api/allocations/[id]/complete returns nextAllocation', async () => {
    // Finalize grade first
    await Grade.create({
      answerScript: script1Id,
      rubric: rubricId,
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 6 }],
      totalScore: 6,
      gradedBy: ta1Id,
      isFinal: true,
    });

    const currentAlloc = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script1Id,
      allocatedBy: professorId,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:00:00.000Z'),
    });

    const nextAlloc = await Allocation.create({
      exam: examId,
      ta: ta1Id,
      answerScript: script2Id,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 1,
      createdAt: new Date('2026-09-01T10:05:00.000Z'),
    });

    const req = new Request(`http://localhost:3000/api/allocations/${currentAlloc._id}/complete`, {
      method: 'POST',
    });

    const res = await completePOST(req, {
      params: Promise.resolve({ id: currentAlloc._id.toString() }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.status).toBe(AllocationStatus.COMPLETED);
    expect(json.data.allocationCompleted).toBe(true);
    expect(json.data.nextAllocation).toBeDefined();
    expect(json.data.nextAllocation.allocationId).toBe(nextAlloc._id.toString());
  });

  // 13. Client navigation deduplication: repeated completion callback triggers push only once
  it('13. client workspace navigation handler ignores duplicate completion callbacks', () => {
    const routerPushSpy = vi.fn();
    const hasNavigatedRef = { current: false };

    const handleGradeSaved = (savedGrade: any) => {
      if (!savedGrade || typeof savedGrade !== 'object') return;
      if (savedGrade.allocationCompleted && savedGrade.nextAllocation?.targetUrl) {
        if (hasNavigatedRef.current) return;
        hasNavigatedRef.current = true;
        routerPushSpy(savedGrade.nextAllocation.targetUrl);
      }
    };

    const completionPayload = {
      allocationCompleted: true,
      nextAllocation: {
        allocationId: 'alloc-123',
        scriptId: 'script-456',
        targetUrl: '/grading/script-456',
      },
    };

    // First completion callback
    handleGradeSaved(completionPayload);
    expect(routerPushSpy).toHaveBeenCalledTimes(1);
    expect(routerPushSpy).toHaveBeenCalledWith('/grading/script-456');

    // Duplicate completion callback
    handleGradeSaved(completionPayload);
    expect(routerPushSpy).toHaveBeenCalledTimes(1); // Not called again
  });
});
