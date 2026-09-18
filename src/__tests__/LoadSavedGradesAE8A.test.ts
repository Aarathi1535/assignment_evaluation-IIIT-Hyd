/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Grade from '../models/Grade';
import CommentTag, { TagScope } from '../models/CommentTag';
import gradingService from '../services/GradingService';
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

describe('AE-8A: Load Saved Grades (Service & API)', () => {
  let gradesGET: any;

  let professorId: mongoose.Types.ObjectId;
  let otherProfessorId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let otherTaId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let courseId: mongoose.Types.ObjectId;
  let scriptId: mongoose.Types.ObjectId;
  let rubricId: mongoose.Types.ObjectId;
  let tag1: any;
  let tag2: any;

  beforeAll(async () => {
    gradesGET = (await import('../app/api/scripts/[id]/grades/route')).GET;
  });

  beforeEach(async () => {
    professorId = new mongoose.Types.ObjectId('000000000000000000000301');
    otherProfessorId = new mongoose.Types.ObjectId('000000000000000000000302');
    taId = new mongoose.Types.ObjectId('000000000000000000000303');
    otherTaId = new mongoose.Types.ObjectId('000000000000000000000304');
    studentId = new mongoose.Types.ObjectId('000000000000000000000305');

    // 1. Create Course
    const course = new Course({
      courseCode: 'CS401',
      courseName: 'Algorithms Design',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [taId, otherTaId],
      enrolledStudents: [studentId],
      isActive: true,
    });
    const savedCourse = await course.save();
    courseId = savedCourse._id as mongoose.Types.ObjectId;

    // 2. Create Exam
    const exam = new Exam({
      title: 'Midterm Exam',
      course: courseId,
      createdBy: professorId,
      examDate: new Date('2026-10-15T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 3,
      status: 'PUBLISHED',
      isActive: true,
    });
    const savedExam = await exam.save();
    examId = savedExam._id as mongoose.Types.ObjectId;

    // 3. Create Rubric
    const rubric = new Rubric({
      exam: examId,
      createdBy: professorId,
      questions: [
        {
          questionNumber: 1,
          maxMarks: 10,
          criteria: [
            { criterionName: 'Logic', description: 'Logic correctness', points: 6 },
            { criterionName: 'Syntax', description: 'Syntax correctness', points: 4 },
          ],
        },
        {
          questionNumber: 2,
          maxMarks: 15,
          criteria: [
            { criterionName: 'Derivation', description: 'Step-by-step proof', points: 10 },
            { criterionName: 'Clarity', description: 'Clear notation', points: 5 },
          ],
        },
        {
          questionNumber: 3,
          maxMarks: 10,
          criteria: [
            { criterionName: 'Analysis', description: 'Time analysis', points: 10 },
          ],
        },
      ],
      isActive: true,
    });
    const savedRubric = await rubric.save();
    rubricId = savedRubric._id as mongoose.Types.ObjectId;

    // 4. Create AnswerScript
    const script = new AnswerScript({
      exam: examId,
      student: studentId,
      status: 'INGESTED',
      pageCount: 4,
      pages: [],
      isActive: true,
    });
    const savedScript = await script.save();
    scriptId = savedScript._id as mongoose.Types.ObjectId;

    // 5. Create Tags
    tag1 = await CommentTag.create({
      label: 'Good explanation.',
      scope: TagScope.GLOBAL,
      createdBy: professorId,
    });
    tag2 = await CommentTag.create({
      label: 'Optimal Method',
      scope: TagScope.EXAM,
      exam: examId,
      createdBy: professorId,
    });

    // 6. Allocations: TA allocated to Q1, otherTa allocated to Q2
    await Allocation.create({
      exam: examId,
      answerScript: scriptId,
      ta: taId,
      allocatedBy: professorId,
      question: 1,
      status: AllocationStatus.PENDING,
    });

    await Allocation.create({
      exam: examId,
      answerScript: scriptId,
      ta: otherTaId,
      allocatedBy: professorId,
      question: 2,
      status: AllocationStatus.PENDING,
    });
  });

  afterEach(async () => {
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await Rubric.deleteMany({});
    await AnswerScript.deleteMany({});
    await Allocation.deleteMany({});
    await Grade.deleteMany({});
    await CommentTag.deleteMany({});
    mockSessionUser = null;
  });

  // 1. Authenticated authorized professor loads all saved grades for an answer script
  it('1. allows authorized professor to load all saved grades for an answer script', async () => {
    // Create Grade for Q1
    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: taId,
      question: 1,
      marksAwarded: [
        { criterionName: 'Logic', score: 6 },
        { criterionName: 'Syntax', score: 3 },
      ],
      totalScore: 9,
      feedback: 'Good work on question 1. Good explanation.',
      tagIds: [tag1._id],
      isFinal: false,
    });

    // Create Grade for Q2
    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: otherTaId,
      question: 2,
      marksAwarded: [
        { criterionName: 'Derivation', score: 8 },
        { criterionName: 'Clarity', score: 4 },
      ],
      totalScore: 12,
      feedback: 'Accurate derivation. Optimal Method',
      tagIds: [tag2._id],
      isFinal: true,
    });

    const grades = await gradingService.getGradesForScript(
      scriptId.toString(),
      professorId.toString(),
      UserRole.PROFESSOR
    );

    expect(grades).toHaveLength(2);
    expect(grades[0].question).toBe(1);
    expect(grades[0].totalScore).toBe(9);
    expect(grades[0].feedback).toBe('Good work on question 1. Good explanation.');
    expect(grades[0].tagIds).toHaveLength(1);
    expect(grades[0].tagIds![0].toString()).toBe(tag1._id.toString());
    expect(grades[0].marksAwarded).toHaveLength(2);
    expect(grades[0].marksAwarded[0].criterionName).toBe('Logic');
    expect(grades[0].marksAwarded[0].score).toBe(6);

    expect(grades[1].question).toBe(2);
    expect(grades[1].totalScore).toBe(12);
    expect(grades[1].feedback).toBe('Accurate derivation. Optimal Method');
    expect(grades[1].tagIds).toHaveLength(1);
    expect(grades[1].tagIds![0].toString()).toBe(tag2._id.toString());
    expect(grades[1].isFinal).toBe(true);
  });

  // 2. Question-level scoping for TA: TA only receives grades for allocated question(s)
  it('2. respects TA question-level allocation scoping (only returns grades for allocated questions)', async () => {
    // Q1 grade (taId is allocated to Q1)
    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: taId,
      question: 1,
      marksAwarded: [{ criterionName: 'Logic', score: 5 }],
      totalScore: 5,
      feedback: 'Q1 Feedback',
      isFinal: false,
    });

    // Q2 grade (otherTaId is allocated to Q2, taId is NOT allocated to Q2)
    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: otherTaId,
      question: 2,
      marksAwarded: [{ criterionName: 'Derivation', score: 10 }],
      totalScore: 10,
      feedback: 'Q2 Secret Feedback from other TA',
      isFinal: false,
    });

    const taGrades = await gradingService.getGradesForScript(
      scriptId.toString(),
      taId.toString(),
      UserRole.TA
    );

    // TA should only receive Q1 grade
    expect(taGrades).toHaveLength(1);
    expect(taGrades[0].question).toBe(1);
    expect(taGrades[0].feedback).toBe('Q1 Feedback');
    expect(taGrades.some((g) => g.question === 2)).toBe(false);
  });

  // 3. Whole-script allocated TA can load all grades for the script
  it('3. allows whole-script allocated TA to load all grades for the script', async () => {
    const student2Id = new mongoose.Types.ObjectId();
    const wholeScript = new AnswerScript({
      exam: examId,
      student: student2Id,
      status: 'INGESTED',
      pageCount: 2,
      pages: [],
      isActive: true,
    });
    const savedWholeScript = await wholeScript.save();
    const wholeScriptId = savedWholeScript._id as mongoose.Types.ObjectId;

    // Whole-script allocation (question: null / undefined)
    await Allocation.create({
      exam: examId,
      answerScript: wholeScriptId,
      ta: taId,
      allocatedBy: professorId,
      status: AllocationStatus.PENDING,
    });

    await Grade.create({
      answerScript: wholeScriptId,
      rubric: rubricId,
      gradedBy: taId,
      marksAwarded: [{ criterionName: 'Logic', score: 6 }],
      totalScore: 6,
      feedback: 'Whole script graded',
      isFinal: false,
    });

    const grades = await gradingService.getGradesForScript(
      wholeScriptId.toString(),
      taId.toString(),
      UserRole.TA
    );

    expect(grades).toHaveLength(1);
    expect(grades[0].feedback).toBe('Whole script graded');
  });

  // 4. Ungraded questions return no fabricated Grade document on GET
  it('4. returns empty array when no questions are graded (no fabricated Grade documents)', async () => {
    const grades = await gradingService.getGradesForScript(
      scriptId.toString(),
      professorId.toString(),
      UserRole.PROFESSOR
    );

    expect(grades).toEqual([]);
    const countInDB = await Grade.countDocuments({ answerScript: scriptId });
    expect(countInDB).toBe(0);
  });

  // 5. Finalized grades load normally with isFinal: true
  it('5. loads finalized grade normally with isFinal preserved', async () => {
    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: taId,
      question: 1,
      marksAwarded: [
        { criterionName: 'Logic', score: 6 },
        { criterionName: 'Syntax', score: 4 },
      ],
      totalScore: 10,
      feedback: 'Finalized submission',
      isFinal: true,
    });

    const grades = await gradingService.getGradesForScript(
      scriptId.toString(),
      professorId.toString(),
      UserRole.PROFESSOR
    );

    expect(grades).toHaveLength(1);
    expect(grades[0].isFinal).toBe(true);
    expect(grades[0].totalScore).toBe(10);
  });

  // 6. Unauthorized TA (not allocated to this script) is rejected with 403
  it('6. rejects unauthorized TA not allocated to the answer script with 403', async () => {
    const unallocatedTaId = new mongoose.Types.ObjectId();

    await expect(
      gradingService.getGradesForScript(
        scriptId.toString(),
        unallocatedTaId.toString(),
        UserRole.TA
      )
    ).rejects.toThrow('Forbidden: You are not allocated to grade this answer script.');
  });

  // 7. Unauthorized Professor (different exam) is rejected with 403
  it('7. rejects professor who does not own the exam with 403', async () => {
    await expect(
      gradingService.getGradesForScript(
        scriptId.toString(),
        otherProfessorId.toString(),
        UserRole.PROFESSOR
      )
    ).rejects.toThrow('Forbidden: Access denied to the exam for this answer script.');
  });

  // 8. Non-existent script is rejected with 404
  it('8. rejects non-existent answer script with 404', async () => {
    const fakeScriptId = new mongoose.Types.ObjectId();

    await expect(
      gradingService.getGradesForScript(
        fakeScriptId.toString(),
        professorId.toString(),
        UserRole.PROFESSOR
      )
    ).rejects.toThrow('Answer script not found.');
  });

  // 9. API endpoint GET /api/scripts/[id]/grades returns 200 with saved grades for authenticated TA
  it('9. GET /api/scripts/[id]/grades returns 200 with saved Grade data for authenticated and allocated TA', async () => {
    mockSessionUser = {
      id: taId.toString(),
      name: 'TA User',
      email: 'ta@example.com',
      role: UserRole.TA,
    };

    await Grade.create({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: taId,
      question: 1,
      marksAwarded: [{ criterionName: 'Logic', score: 6 }],
      totalScore: 6,
      feedback: 'API loaded feedback',
      tagIds: [tag1._id],
      isFinal: false,
    });

    const req = new Request(`http://localhost:3000/api/scripts/${scriptId}/grades`, {
      method: 'GET',
    });

    const res = await gradesGET(req, {
      params: Promise.resolve({ id: scriptId.toString() }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(1);
    expect(json.data[0].question).toBe(1);
    expect(json.data[0].totalScore).toBe(6);
    expect(json.data[0].feedback).toBe('API loaded feedback');
    expect(json.data[0].tagIds).toHaveLength(1);
    expect(json.data[0].tagIds[0].toString()).toBe(tag1._id.toString());
  });

  // 10. API endpoint GET /api/scripts/[id]/grades returns 401 when unauthenticated
  it('10. GET /api/scripts/[id]/grades returns 401 when unauthenticated', async () => {
    mockSessionUser = null;

    const req = new Request(`http://localhost:3000/api/scripts/${scriptId}/grades`, {
      method: 'GET',
    });

    const res = await gradesGET(req, {
      params: Promise.resolve({ id: scriptId.toString() }),
    });

    expect(res.status).toBe(401);
  });
});
