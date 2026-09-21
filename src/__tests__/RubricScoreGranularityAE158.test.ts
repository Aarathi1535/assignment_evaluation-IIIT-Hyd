/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Grade from '../models/Grade';
import gradingService, { isValidScoreStep, DEFAULT_SCORE_STEP } from '../services/GradingService';
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

describe('AE-158 / AE-159: Backend Rubric Score Granularity & Bounds', () => {
  let gradesPOST: any;
  let questionGradePOST: any;

  let professorId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let courseId: mongoose.Types.ObjectId;
  let scriptId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    gradesPOST = (await import('../app/api/scripts/[id]/grades/route')).POST;
    questionGradePOST = (await import('../app/api/scripts/[id]/questions/[questionNumber]/grade/route')).POST;
  });

  beforeEach(async () => {
    professorId = new mongoose.Types.ObjectId('000000000000000000000301');
    taId = new mongoose.Types.ObjectId('000000000000000000000302');
    studentId = new mongoose.Types.ObjectId('000000000000000000000303');

    // 1. Course
    const course = new Course({
      courseCode: 'CS450',
      courseName: 'Algorithms Evaluation',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [taId],
      enrolledStudents: [studentId],
      isActive: true,
    });
    const savedCourse = await course.save();
    courseId = savedCourse._id as mongoose.Types.ObjectId;

    // 2. Exam
    const exam = new Exam({
      title: 'Midterm Grading Bounds',
      course: courseId,
      createdBy: professorId,
      examDate: new Date('2026-10-15T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 2,
      status: 'PUBLISHED',
      isActive: true,
    });
    const savedExam = await exam.save();
    examId = savedExam._id as mongoose.Types.ObjectId;

    // 3. Rubric
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
            { criterionName: 'Derivation', description: 'Mathematical steps', points: 10 },
            { criterionName: 'PrecisionCriterion', description: 'Odd max points', points: 3.3 },
          ],
        },
      ],
      isActive: true,
    });
    await rubric.save();

    // 4. AnswerScript
    const script = new AnswerScript({
      exam: examId,
      student: studentId,
      status: 'INGESTED',
      pageCount: 3,
      pages: [],
      isActive: true,
    });
    const savedScript = await script.save();
    scriptId = savedScript._id as mongoose.Types.ObjectId;

    // 5. Allocation: TA allocated to Q1 and Q2
    const alloc1 = new Allocation({
      exam: examId,
      answerScript: scriptId,
      ta: taId,
      allocatedBy: professorId,
      question: 1,
      status: AllocationStatus.PENDING,
    });
    await alloc1.save();

    const alloc2 = new Allocation({
      exam: examId,
      answerScript: scriptId,
      ta: taId,
      allocatedBy: professorId,
      question: 2,
      status: AllocationStatus.PENDING,
    });
    await alloc2.save();
  });

  afterEach(async () => {
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await Rubric.deleteMany({});
    await AnswerScript.deleteMany({});
    await Allocation.deleteMany({});
    await Grade.deleteMany({});
    mockSessionUser = null;
  });

  describe('1. isValidScoreStep Helper & Precision Arithmetic', () => {
    it('validates default step (0.5) correctly', () => {
      expect(DEFAULT_SCORE_STEP).toBe(0.5);
      expect(isValidScoreStep(0, 0.5)).toBe(true);
      expect(isValidScoreStep(0.5, 0.5)).toBe(true);
      expect(isValidScoreStep(1.0, 0.5)).toBe(true);
      expect(isValidScoreStep(1.5, 0.5)).toBe(true);
      expect(isValidScoreStep(6.0, 0.5)).toBe(true);

      expect(isValidScoreStep(0.25, 0.5)).toBe(false);
      expect(isValidScoreStep(1.3, 0.5)).toBe(false);
      expect(isValidScoreStep(5.7, 0.5)).toBe(false);
    });

    it('validates custom step sizes (0.25, 0.1, 1.0)', () => {
      // Step 0.25
      expect(isValidScoreStep(0.25, 0.25)).toBe(true);
      expect(isValidScoreStep(0.75, 0.25)).toBe(true);
      expect(isValidScoreStep(1.0, 0.25)).toBe(true);
      expect(isValidScoreStep(0.3, 0.25)).toBe(false);

      // Step 0.1 with floating point edge cases (0.3 in IEEE 754)
      expect(isValidScoreStep(0.1, 0.1)).toBe(true);
      expect(isValidScoreStep(0.2, 0.1)).toBe(true);
      expect(isValidScoreStep(0.3, 0.1)).toBe(true); // 0.3 % 0.1 fails without epsilon
      expect(isValidScoreStep(0.7, 0.1)).toBe(true);
      expect(isValidScoreStep(0.35, 0.1)).toBe(false);

      // Step 1.0
      expect(isValidScoreStep(3, 1.0)).toBe(true);
      expect(isValidScoreStep(3.5, 1.0)).toBe(false);
    });

    it('rejects invalid inputs in isValidScoreStep', () => {
      expect(isValidScoreStep(NaN as any)).toBe(false);
      expect(isValidScoreStep(Infinity as any)).toBe(false);
      expect(isValidScoreStep(-Infinity as any)).toBe(false);
      expect(isValidScoreStep(2, 0)).toBe(false);
      expect(isValidScoreStep(2, -0.5)).toBe(false);
    });
  });

  describe('2. Backend Rubric Score Granularity & Bounds Validation in Service', () => {
    it('accepts valid score exactly at minimum (0)', async () => {
      const grade = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 0 },
          { criterionName: 'Complexity', score: 0 },
        ],
        userId: taId.toString(),
        userRole: UserRole.TA,
      });

      expect(grade.totalScore).toBe(0);
      expect(grade.marksAwarded[0].score).toBe(0);
    });

    it('accepts valid score exactly at criterion maximum', async () => {
      const grade = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 6 }, // exact max for Correctness (6)
          { criterionName: 'Complexity', score: 4 },  // exact max for Complexity (4)
        ],
        userId: taId.toString(),
        userRole: UserRole.TA,
      });

      expect(grade.totalScore).toBe(10);
    });

    it('accepts exact maximum score even when criterion points is not a multiple of step', async () => {
      // Question 2 has PrecisionCriterion with points = 3.3
      const grade = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 2,
        marksAwarded: [
          { criterionName: 'Derivation', score: 5.5 },
          { criterionName: 'PrecisionCriterion', score: 3.3 }, // exact max 3.3
        ],
        userId: taId.toString(),
        userRole: UserRole.TA,
      });

      expect(grade.totalScore).toBe(8.8);
    });

    it('accepts valid fractional scores lying on configured score step (0.5)', async () => {
      const grade = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 4.5 },
          { criterionName: 'Complexity', score: 2.5 },
        ],
        userId: taId.toString(),
        userRole: UserRole.TA,
      });

      expect(grade.totalScore).toBe(7);
    });

    it('rejects invalid score between steps (e.g. 1.3 on step 0.5)', async () => {
      await expect(
        gradingService.saveGrade({
          scriptId: scriptId.toString(),
          question: 1,
          marksAwarded: [
            { criterionName: 'Correctness', score: 1.3 }, // Invalid step
            { criterionName: 'Complexity', score: 2.0 },
          ],
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow('must be a multiple of the score step (0.5)');
    });

    it('rejects invalid negative scores', async () => {
      await expect(
        gradingService.saveGrade({
          scriptId: scriptId.toString(),
          question: 1,
          marksAwarded: [{ criterionName: 'Correctness', score: -0.5 }],
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow('cannot be negative');
    });

    it('rejects scores exceeding criterion maximum', async () => {
      await expect(
        gradingService.saveGrade({
          scriptId: scriptId.toString(),
          question: 1,
          marksAwarded: [
            { criterionName: 'Correctness', score: 6.5 }, // Exceeds max points of 6
            { criterionName: 'Complexity', score: 2.0 },
          ],
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow('exceeds maximum allowed points of 6');
    });

    it('rejects NaN, Infinity, and -Infinity scores', async () => {
      await expect(
        gradingService.saveGrade({
          scriptId: scriptId.toString(),
          question: 1,
          marksAwarded: [{ criterionName: 'Correctness', score: NaN }],
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow('Score must be a valid finite number');

      await expect(
        gradingService.saveGrade({
          scriptId: scriptId.toString(),
          question: 1,
          marksAwarded: [{ criterionName: 'Correctness', score: Infinity }],
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow('Score must be a valid finite number');

      await expect(
        gradingService.saveGrade({
          scriptId: scriptId.toString(),
          question: 1,
          marksAwarded: [{ criterionName: 'Correctness', score: -Infinity }],
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow('Score must be a valid finite number');
    });

    it('rejects when computed total exceeds question maxMarks', async () => {
      const mockRubric = {
        questions: [
          {
            questionNumber: 1,
            maxMarks: 5, // maxMarks is 5
            criteria: [
              { criterionName: 'C1', points: 4 },
              { criterionName: 'C2', points: 4 },
            ],
          },
        ],
      };

      expect(() => {
        gradingService.validateAndComputeQuestionTotal({
          rubric: mockRubric as any,
          questionNumber: 1,
          marksAwarded: [
            { criterionName: 'C1', score: 3 },
            { criterionName: 'C2', score: 3 }, // Total is 6 > 5
          ],
        });
      }).toThrow('exceeds maximum marks of 5 for Question 1');
    });

    it('supports configurable step sizes in internal validateAndComputeQuestionTotal helper', () => {
      const mockRubric = {
        questions: [
          {
            questionNumber: 1,
            maxMarks: 10,
            criteria: [
              { criterionName: 'Correctness', points: 6 },
              { criterionName: 'Complexity', points: 4 },
            ],
          },
        ],
      };

      // Step = 0.25 allows 1.25, 2.75
      const computed = gradingService.validateAndComputeQuestionTotal({
        rubric: mockRubric as any,
        questionNumber: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 1.25 },
          { criterionName: 'Complexity', score: 2.75 },
        ],
        scoreStep: 0.25,
      });

      expect(computed.totalScore).toBe(4);

      // Step = 0.25 rejects 1.3
      expect(() => {
        gradingService.validateAndComputeQuestionTotal({
          rubric: mockRubric as any,
          questionNumber: 1,
          marksAwarded: [
            { criterionName: 'Correctness', score: 1.3 },
            { criterionName: 'Complexity', score: 2.75 },
          ],
          scoreStep: 0.25,
        });
      }).toThrow('must be a multiple of the score step (0.25)');
    });

    it('enforces server DEFAULT_SCORE_STEP in saveGrade and rejects off-step (0.5) score', async () => {
      await expect(
        gradingService.saveGrade({
          scriptId: scriptId.toString(),
          question: 1,
          marksAwarded: [
            { criterionName: 'Correctness', score: 1.25 }, // Not on server default 0.5 step
            { criterionName: 'Complexity', score: 2.0 },
          ],
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow('must be a multiple of the score step (0.5)');
    });
  });

  describe('3. Auto-Sum & Authoritative Server Calculation (AE-159 Folded)', () => {
    it('authoritatively calculates totalScore ignoring client-supplied total', async () => {
      const grade = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 4.5 },
          { criterionName: 'Complexity', score: 3.5 },
        ],
        userId: taId.toString(),
        userRole: UserRole.TA,
        clientTotalScore: 9999, // spoofed client total
      });

      expect(grade.totalScore).toBe(8); // Authoritative server calculation 4.5 + 3.5 = 8
    });

    it('safely handles precision rounding for floating point criterion sums', () => {
      const total = gradingService.computeAuthoritativeTotal([
        { criterionName: 'C1', score: 0.1 },
        { criterionName: 'C2', score: 0.2 },
      ]);
      expect(total).toBe(0.3); // In JS 0.1 + 0.2 is 0.30000000000000004
    });
  });

  describe('4. Feedback & Remark Persistence / Clearing (AE-159 Folded)', () => {
    it('persists initial feedback/remark', async () => {
      const grade = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5 },
          { criterionName: 'Complexity', score: 3 },
        ],
        feedback: 'Excellent breakdown of complexity and edge cases.',
        userId: taId.toString(),
        userRole: UserRole.TA,
      });

      expect(grade.feedback).toBe('Excellent breakdown of complexity and edge cases.');
    });

    it('clears an existing remark when empty string is submitted', async () => {
      // First save with feedback
      await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5 },
          { criterionName: 'Complexity', score: 3 },
        ],
        feedback: 'Initial remarks to be removed.',
        userId: taId.toString(),
        userRole: UserRole.TA,
      });

      const savedBefore = await Grade.findOne({ answerScript: scriptId, question: 1 });
      expect(savedBefore?.feedback).toBe('Initial remarks to be removed.');

      // Second save with empty feedback
      const updated = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5 },
          { criterionName: 'Complexity', score: 3 },
        ],
        feedback: '', // Explicit clearing
        userId: taId.toString(),
        userRole: UserRole.TA,
      });

      expect(updated.feedback).toBe('');

      const savedAfter = await Grade.findOne({ answerScript: scriptId, question: 1 });
      expect(savedAfter?.feedback).toBe('');
    });

    it('preserves existing feedback when feedback field is undefined in update', async () => {
      // First save
      await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: 4 }],
        feedback: 'Keep this note.',
        userId: taId.toString(),
        userRole: UserRole.TA,
      });

      // Update scores only without providing feedback field
      const updated = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
        userId: taId.toString(),
        userRole: UserRole.TA,
      });

      expect(updated.feedback).toBe('Keep this note.');
    });
  });

  describe('5. API Route End-to-End Validation', () => {
    it('POST /api/scripts/[id]/grades enforces score step and returns 400 for off-step score', async () => {
      mockSessionUser = {
        id: taId.toString(),
        name: 'TA User',
        email: 'ta@example.com',
        role: UserRole.TA,
      };

      const req = new Request(`http://localhost:3000/api/scripts/${scriptId}/grades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 1,
          marksAwarded: [
            { criterionName: 'Correctness', score: 2.7 }, // Off step (default 0.5)
            { criterionName: 'Complexity', score: 2.0 },
          ],
        }),
      });

      const res = await gradesPOST(req, { params: Promise.resolve({ id: scriptId.toString() }) });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('must be a multiple of the score step (0.5)');
    });

    it('POST /api/scripts/[id]/questions/[questionNumber]/grade successfully saves on valid step and clears remark', async () => {
      mockSessionUser = {
        id: taId.toString(),
        name: 'TA User',
        email: 'ta@example.com',
        role: UserRole.TA,
      };

      // 1. Initial save with feedback
      const req1 = new Request(`http://localhost:3000/api/scripts/${scriptId}/questions/1/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marksAwarded: [
            { criterionName: 'Correctness', score: 5.5 },
            { criterionName: 'Complexity', score: 3.5 },
          ],
          feedback: 'Great job!',
        }),
      });

      const res1 = await questionGradePOST(req1, {
        params: Promise.resolve({ id: scriptId.toString(), questionNumber: '1' }),
      });
      expect(res1.status).toBe(200);
      const json1 = await res1.json();
      expect(json1.data.totalScore).toBe(9);
      expect(json1.data.feedback).toBe('Great job!');

      // 2. Update to clear feedback
      const req2 = new Request(`http://localhost:3000/api/scripts/${scriptId}/questions/1/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marksAwarded: [
            { criterionName: 'Correctness', score: 6.0 },
            { criterionName: 'Complexity', score: 4.0 },
          ],
          feedback: '',
        }),
      });

      const res2 = await questionGradePOST(req2, {
        params: Promise.resolve({ id: scriptId.toString(), questionNumber: '1' }),
      });
      expect(res2.status).toBe(200);
      const json2 = await res2.json();
      expect(json2.data.totalScore).toBe(10);
      expect(json2.data.feedback).toBe('');
    });

    it('rejects attempt to bypass server 0.5 step by client passing custom scoreStep in request', async () => {
      mockSessionUser = {
        id: taId.toString(),
        name: 'TA User',
        email: 'ta@example.com',
        role: UserRole.TA,
      };

      // Client attempts to send custom scoreStep: 0.25 to submit 1.25
      const req = new Request(`http://localhost:3000/api/scripts/${scriptId}/grades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 1,
          scoreStep: 0.25, // Malicious / untrusted client-provided scoreStep
          marksAwarded: [
            { criterionName: 'Correctness', score: 1.25 }, // Off server default 0.5 step
            { criterionName: 'Complexity', score: 2.0 },
          ],
        }),
      });

      const res = await gradesPOST(req, { params: Promise.resolve({ id: scriptId.toString() }) });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      // Confirms server enforces default 0.5 step and ignores client scoreStep
      expect(json.message).toContain('must be a multiple of the score step (0.5)');
    });
  });
});
