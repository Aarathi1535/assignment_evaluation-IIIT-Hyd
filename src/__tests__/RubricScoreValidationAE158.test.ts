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
import { createRubricSchema, updateRubricSchema } from '../validations/rubricValidation';
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

describe('AE-158: Configurable Rubric ScoreStep & Authoritative Validation', () => {
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
    professorId = new mongoose.Types.ObjectId('000000000000000000000401');
    taId = new mongoose.Types.ObjectId('000000000000000000000402');
    studentId = new mongoose.Types.ObjectId('000000000000000000000403');

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
      title: 'Midterm Configurable Rubric Step',
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

    // 3. Rubric with default scoreStep
    const rubric = new Rubric({
      exam: examId,
      createdBy: professorId,
      scoreStep: 0.5,
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
            { criterionName: 'PrecisionCriterion', description: 'Non-step max points', points: 3.3 },
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

  describe('1. Rubric Model & Schema Defaults / Validation', () => {
    it('new rubric defaults scoreStep to 0.5 when not explicitly specified', async () => {
      const exam2 = await new Exam({
        title: 'Exam Default Step',
        course: courseId,
        createdBy: professorId,
        examDate: new Date(),
        totalMarks: 50,
        numberOfQuestions: 1,
        status: 'PUBLISHED',
      }).save();

      const newRubric = new Rubric({
        exam: exam2._id,
        createdBy: professorId,
        questions: [
          {
            questionNumber: 1,
            maxMarks: 5,
            criteria: [{ criterionName: 'Basics', points: 5 }],
          },
        ],
      });
      await newRubric.save();

      const fetched = await Rubric.findById(newRubric._id);
      expect(fetched?.scoreStep).toBe(0.5);
    });

    it('persists custom scoreStep = 0.25 when configured', async () => {
      const exam3 = await new Exam({
        title: 'Exam Custom Step',
        course: courseId,
        createdBy: professorId,
        examDate: new Date(),
        totalMarks: 50,
        numberOfQuestions: 1,
        status: 'PUBLISHED',
      }).save();

      const newRubric = new Rubric({
        exam: exam3._id,
        createdBy: professorId,
        scoreStep: 0.25,
        questions: [
          {
            questionNumber: 1,
            maxMarks: 5,
            criteria: [{ criterionName: 'Basics', points: 5 }],
          },
        ],
      });
      await newRubric.save();

      const fetched = await Rubric.findById(newRubric._id);
      expect(fetched?.scoreStep).toBe(0.25);
    });

    it('validates scoreStep in createRubricSchema and updateRubricSchema', () => {
      // Valid cases
      expect(createRubricSchema.safeParse({
        exam: new mongoose.Types.ObjectId().toString(),
        scoreStep: 0.5,
        questions: [{ questionNumber: 1, maxMarks: 5, criteria: [{ criterionName: 'C1', points: 5 }] }],
      }).success).toBe(true);

      expect(createRubricSchema.safeParse({
        exam: new mongoose.Types.ObjectId().toString(),
        scoreStep: 0.25,
        questions: [{ questionNumber: 1, maxMarks: 5, criteria: [{ criterionName: 'C1', points: 5 }] }],
      }).success).toBe(true);

      // Defaults to 0.5 when omitted
      const defaultParsed = createRubricSchema.safeParse({
        exam: new mongoose.Types.ObjectId().toString(),
        questions: [{ questionNumber: 1, maxMarks: 5, criteria: [{ criterionName: 'C1', points: 5 }] }],
      });
      expect(defaultParsed.success).toBe(true);
      if (defaultParsed.success) {
        expect(defaultParsed.data.scoreStep).toBe(0.5);
      }

      // Invalid cases
      const zeroParsed = createRubricSchema.safeParse({
        exam: new mongoose.Types.ObjectId().toString(),
        scoreStep: 0,
        questions: [{ questionNumber: 1, maxMarks: 5, criteria: [{ criterionName: 'C1', points: 5 }] }],
      });
      expect(zeroParsed.success).toBe(false);

      const negativeParsed = createRubricSchema.safeParse({
        exam: new mongoose.Types.ObjectId().toString(),
        scoreStep: -0.5,
        questions: [{ questionNumber: 1, maxMarks: 5, criteria: [{ criterionName: 'C1', points: 5 }] }],
      });
      expect(negativeParsed.success).toBe(false);

      const nanParsed = createRubricSchema.safeParse({
        exam: new mongoose.Types.ObjectId().toString(),
        scoreStep: NaN,
        questions: [{ questionNumber: 1, maxMarks: 5, criteria: [{ criterionName: 'C1', points: 5 }] }],
      });
      expect(nanParsed.success).toBe(false);

      const infParsed = createRubricSchema.safeParse({
        exam: new mongoose.Types.ObjectId().toString(),
        scoreStep: Infinity,
        questions: [{ questionNumber: 1, maxMarks: 5, criteria: [{ criterionName: 'C1', points: 5 }] }],
      });
      expect(infParsed.success).toBe(false);
    });

    it('rejects invalid scoreStep in updateRubricSchema', () => {
      const negativeUpdate = updateRubricSchema.safeParse({
        scoreStep: -0.25,
      });
      expect(negativeUpdate.success).toBe(false);

      const zeroUpdate = updateRubricSchema.safeParse({
        scoreStep: 0,
      });
      expect(zeroUpdate.success).toBe(false);

      const validUpdate = updateRubricSchema.safeParse({
        scoreStep: 0.25,
      });
      expect(validUpdate.success).toBe(true);
    });
  });

  describe('2. Configured Score Step Validation in GradingService', () => {
    it('accepts valid scores on configured step (0.5)', async () => {
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

      expect(grade.totalScore).toBe(7.0);
    });

    it('rejects invalid scores between configured steps (e.g. 1.3 on step 0.5)', async () => {
      await expect(
        gradingService.saveGrade({
          scriptId: scriptId.toString(),
          question: 1,
          marksAwarded: [
            { criterionName: 'Correctness', score: 1.3 },
            { criterionName: 'Complexity', score: 2.0 },
          ],
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow('must be a multiple of the score step (0.5)');
    });

    it('accepts valid score on custom rubric scoreStep = 0.25', async () => {
      // Update rubric to scoreStep = 0.25
      await Rubric.updateOne({ exam: examId }, { $set: { scoreStep: 0.25 } });

      const grade = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 1.25 },
          { criterionName: 'Complexity', score: 2.75 },
        ],
        userId: taId.toString(),
        userRole: UserRole.TA,
      });

      expect(grade.totalScore).toBe(4.0);
    });

    it('rejects invalid score between custom steps (e.g. 1.3 on step 0.25)', async () => {
      await Rubric.updateOne({ exam: examId }, { $set: { scoreStep: 0.25 } });

      await expect(
        gradingService.saveGrade({
          scriptId: scriptId.toString(),
          question: 1,
          marksAwarded: [
            { criterionName: 'Correctness', score: 1.3 },
            { criterionName: 'Complexity', score: 2.0 },
          ],
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow('must be a multiple of the score step (0.25)');
    });

    it('accepts exact criterion maximum even when it is not a multiple of the step', async () => {
      // Question 2 PrecisionCriterion points is 3.3 (not multiple of 0.5)
      const grade = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 2,
        marksAwarded: [
          { criterionName: 'Derivation', score: 5.5 },
          { criterionName: 'PrecisionCriterion', score: 3.3 }, // Exact max
        ],
        userId: taId.toString(),
        userRole: UserRole.TA,
      });

      expect(grade.totalScore).toBe(8.8);
    });

    it('rejects scores exceeding criterion maximum', async () => {
      await expect(
        gradingService.saveGrade({
          scriptId: scriptId.toString(),
          question: 1,
          marksAwarded: [
            { criterionName: 'Correctness', score: 6.5 },
            { criterionName: 'Complexity', score: 2.0 },
          ],
          userId: taId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow('exceeds maximum allowed points of 6');
    });

    it('rejects negative scores', async () => {
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

    it('rejects NaN and Infinity scores', async () => {
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
    });

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
        clientTotalScore: 9999,
      });

      expect(grade.totalScore).toBe(8.0);
    });
  });

  describe('3. Client Override Prevention & API Enforcement', () => {
    it('client-provided scoreStep in HTTP request cannot override persisted rubric scoreStep (0.5)', async () => {
      mockSessionUser = {
        id: taId.toString(),
        name: 'TA User',
        email: 'ta@example.com',
        role: UserRole.TA,
      };

      // Rubric has scoreStep = 0.5. Client sends scoreStep: 0.25 to try submitting 1.25.
      const req = new Request(`http://localhost:3000/api/scripts/${scriptId}/grades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 1,
          scoreStep: 0.25, // Attacker client attempts override
          marksAwarded: [
            { criterionName: 'Correctness', score: 1.25 },
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

    it('client-provided scoreStep cannot override custom persisted rubric scoreStep (0.25)', async () => {
      // Rubric has scoreStep = 0.25. Client sends scoreStep: 0.1 to try submitting 1.3.
      await Rubric.updateOne({ exam: examId }, { $set: { scoreStep: 0.25 } });

      mockSessionUser = {
        id: taId.toString(),
        name: 'TA User',
        email: 'ta@example.com',
        role: UserRole.TA,
      };

      const req = new Request(`http://localhost:3000/api/scripts/${scriptId}/questions/1/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scoreStep: 0.1, // Attacker client attempts override
          marksAwarded: [
            { criterionName: 'Correctness', score: 1.3 },
            { criterionName: 'Complexity', score: 2.0 },
          ],
        }),
      });

      const res = await questionGradePOST(req, {
        params: Promise.resolve({ id: scriptId.toString(), questionNumber: '1' }),
      });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('must be a multiple of the score step (0.25)');
    });
  });

  describe('4. Feedback & Remark Persistence / Clearing', () => {
    it('persists initial feedback and allows clearing with empty string', async () => {
      // 1. Initial save
      const grade1 = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5.0 },
          { criterionName: 'Complexity', score: 3.0 },
        ],
        feedback: 'Initial remark',
        userId: taId.toString(),
        userRole: UserRole.TA,
      });
      expect(grade1.feedback).toBe('Initial remark');

      // 2. Clear feedback
      const grade2 = await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5.0 },
          { criterionName: 'Complexity', score: 3.0 },
        ],
        feedback: '',
        userId: taId.toString(),
        userRole: UserRole.TA,
      });
      expect(grade2.feedback).toBe('');
    });
  });
});
