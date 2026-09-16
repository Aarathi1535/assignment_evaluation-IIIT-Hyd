/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Grade from '../models/Grade';
import AuditLog from '../models/AuditLog';
import gradingService from '../services/GradingService';
import { HttpError } from '../lib/errors';
import { UserRole } from '../constants/permissions';
import { RubricSidebar, RubricData } from '../components/grading/RubricSidebar';
import { insertTagIntoFeedback } from '../components/grading/PresetCommentChips';

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

const mockRubricData: RubricData = {
  _id: 'rubric-101',
  exam: 'exam-101',
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
        { criterionName: 'Derivation', description: 'Induction proof', points: 10 },
        { criterionName: 'Clarity', description: 'Clean presentation', points: 5 },
      ],
    },
  ],
};

describe('AE-148: Question-Level Custom Feedback', () => {
  let questionGradePOST: any;

  let professorId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let otherTaId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let courseId: mongoose.Types.ObjectId;
  let scriptId: mongoose.Types.ObjectId;
  let rubricId: mongoose.Types.ObjectId;
  let allocationDoc: any;

  beforeAll(async () => {
    const questionGradeRoute = await import('../app/api/scripts/[id]/questions/[questionNumber]/grade/route');
    questionGradePOST = questionGradeRoute.POST;
  });

  beforeEach(async () => {
    professorId = new mongoose.Types.ObjectId('000000000000000000000301');
    taId = new mongoose.Types.ObjectId('000000000000000000000302');
    otherTaId = new mongoose.Types.ObjectId('000000000000000000000303');
    studentId = new mongoose.Types.ObjectId('000000000000000000000304');

    // 1. Create Course
    const course = new Course({
      courseCode: 'CS501',
      courseName: 'Advanced Data Structures',
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
      title: 'Endterm Exam',
      course: courseId,
      createdBy: professorId,
      examDate: new Date('2026-11-20T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 2,
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
            { criterionName: 'Correctness', description: 'Logic correctness', points: 6 },
            { criterionName: 'Complexity', description: 'Optimal time bound', points: 4 },
          ],
        },
        {
          questionNumber: 2,
          maxMarks: 15,
          criteria: [
            { criterionName: 'Derivation', description: 'Induction proof', points: 10 },
            { criterionName: 'Clarity', description: 'Clean presentation', points: 5 },
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
      filePath: '/scripts/script_ae148.pdf',
      filename: 'script_ae148.pdf',
      pageCount: 4,
      isActive: true,
    });
    const savedScript = await script.save();
    scriptId = savedScript._id as mongoose.Types.ObjectId;

    // 5. Create Allocation: TA is allocated to Question 1 only (PENDING)
    const allocation = new Allocation({
      exam: examId,
      ta: taId,
      answerScript: scriptId,
      allocatedBy: professorId,
      question: 1,
      status: AllocationStatus.PENDING,
    });
    allocationDoc = await allocation.save();
  });

  afterEach(async () => {
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await Rubric.deleteMany({});
    await AnswerScript.deleteMany({});
    await Allocation.deleteMany({});
    await Grade.deleteMany({});
    await AuditLog.deleteMany({});
    mockSessionUser = null;
  });

  // 1. Existing Grade.feedback is displayed
  it('1. displays existing saved Grade.feedback in the UI', () => {
    const initialFeedback = {
      1: 'Student provided a thorough derivation with inductive reasoning.',
    };

    const html = renderToStaticMarkup(
      React.createElement(RubricSidebar, {
        initialRubric: mockRubricData,
        allocatedQuestionNumber: 1,
        initialFeedback,
      })
    );

    expect(html).toContain('Student provided a thorough derivation with inductive reasoning.');
    expect(html).toContain('data-testid="feedback-input-1"');
    expect(html).toContain('data-testid="feedback-char-counter-1"');
  });

  // 2. Empty feedback can be entered
  it('2. allows empty/new feedback to be entered and saved', async () => {
    const saved = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      feedback: '',
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(saved).toBeDefined();
    expect(saved.feedback).toBe('');
    expect(saved.totalScore).toBe(10);
  });

  // 3. Existing feedback can be edited
  it('3. allows existing saved feedback to be edited and updated', async () => {
    // Initial save
    const first = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 5 },
        { criterionName: 'Complexity', score: 3 },
      ],
      feedback: 'Initial brief evaluation.',
      userId: taId.toString(),
      userRole: UserRole.TA,
    });
    expect(first.feedback).toBe('Initial brief evaluation.');

    // Edit feedback
    const updated = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 5 },
        { criterionName: 'Complexity', score: 3 },
      ],
      feedback: 'Expanded feedback: Step 2 was partially correct, but missing amortized analysis.',
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(updated._id.toString()).toBe(first._id.toString());
    expect(updated.feedback).toBe(
      'Expanded feedback: Step 2 was partially correct, but missing amortized analysis.'
    );
  });

  // 4. Feedback can be cleared
  it('4. allows feedback to be cleared (set to empty string)', async () => {
    // Initial save with feedback
    await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 4 },
        { criterionName: 'Complexity', score: 2 },
      ],
      feedback: 'Feedback to be cleared.',
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    // Clear feedback
    const cleared = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 4 },
        { criterionName: 'Complexity', score: 2 },
      ],
      feedback: '',
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(cleared.feedback).toBe('');

    // Fetch from database to ensure persistence
    const fetched = await Grade.findById(cleared._id);
    expect(fetched?.feedback).toBe('');
  });

  // 5. Feedback is trimmed before persistence
  it('5. trims leading and trailing whitespace from feedback before persisting', async () => {
    const saved = await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      feedback: '   \n  Excellent response with clear explanations.  \t  \n',
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    expect(saved.feedback).toBe('Excellent response with clear explanations.');
  });

  // 6. Feedback over 2000 characters is rejected server-side
  it('6. rejects feedback exceeding 2000 characters with HTTP 400 (no silent truncation)', async () => {
    const longFeedback = 'A'.repeat(2001);

    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5 },
          { criterionName: 'Complexity', score: 3 },
        ],
        feedback: longFeedback,
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);

    try {
      await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5 },
          { criterionName: 'Complexity', score: 3 },
        ],
        feedback: longFeedback,
        userId: taId.toString(),
        userRole: UserRole.TA,
      });
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toContain('2000 characters');
    }
  });

  // 7. Valid feedback saves through AE-145 API
  it('7. saves valid feedback through POST /api/scripts/[id]/questions/[questionNumber]/grade', async () => {
    mockSessionUser = { id: taId.toString(), role: UserRole.TA, email: 'ta@test.com' };

    const req = new Request(
      `http://localhost:3000/api/scripts/${scriptId}/questions/1/grade`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marksAwarded: [
            { criterionName: 'Correctness', score: 6 },
            { criterionName: 'Complexity', score: 4 },
          ],
          feedback: 'Comprehensive solution with correct asymptotic analysis.',
        }),
      }
    );

    const res = await questionGradePOST(req, {
      params: Promise.resolve({ id: scriptId.toString(), questionNumber: '1' }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.feedback).toBe(
      'Comprehensive solution with correct asymptotic analysis.'
    );
    expect(json.data.totalScore).toBe(10);
  });

  // 8. Unallocated TA cannot modify feedback for unallocated questions
  it('8. rejects unallocated TA attempting to save feedback for unallocated question with HTTP 403', async () => {
    mockSessionUser = { id: otherTaId.toString(), role: UserRole.TA, email: 'otherta@test.com' };

    const req = new Request(
      `http://localhost:3000/api/scripts/${scriptId}/questions/1/grade`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
          feedback: 'Unauthorized feedback attempt.',
        }),
      }
    );

    const res = await questionGradePOST(req, {
      params: Promise.resolve({ id: scriptId.toString(), questionNumber: '1' }),
    });

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.message).toContain('Forbidden');
  });

  // 9. Finalized Grade cannot be edited
  it('9. prevents editing feedback on a finalized Grade (HTTP 409)', async () => {
    // Create finalized grade
    const finalizedGrade = new Grade({
      answerScript: scriptId,
      rubric: rubricId,
      gradedBy: taId,
      question: 1,
      marksAwarded: [
        { criterionName: 'Correctness', score: 6 },
        { criterionName: 'Complexity', score: 4 },
      ],
      totalScore: 10,
      feedback: 'Finalized grade feedback.',
      isFinal: true,
    });
    await finalizedGrade.save();

    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 6 },
          { criterionName: 'Complexity', score: 4 },
        ],
        feedback: 'Attempting to overwrite finalized feedback.',
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);

    try {
      await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 6 },
          { criterionName: 'Complexity', score: 4 },
        ],
        feedback: 'Attempting to overwrite finalized feedback.',
        userId: taId.toString(),
        userRole: UserRole.TA,
      });
    } catch (err: any) {
      expect(err.statusCode).toBe(409);
      expect(err.message).toContain('finalized');
    }
  });

  // 10. Completed allocation cannot be edited
  it('10. prevents editing feedback when allocation status is COMPLETED (HTTP 409)', async () => {
    allocationDoc.status = AllocationStatus.COMPLETED;
    await allocationDoc.save();

    await expect(
      gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5 },
          { criterionName: 'Complexity', score: 3 },
        ],
        feedback: 'Attempting to grade completed allocation.',
        userId: taId.toString(),
        userRole: UserRole.TA,
      })
    ).rejects.toThrow(HttpError);

    try {
      await gradingService.saveGrade({
        scriptId: scriptId.toString(),
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 5 },
          { criterionName: 'Complexity', score: 3 },
        ],
        feedback: 'Attempting to grade completed allocation.',
        userId: taId.toString(),
        userRole: UserRole.TA,
      });
    } catch (err: any) {
      expect(err.statusCode).toBe(409);
      expect(err.message).toContain('COMPLETED');
    }
  });

  // 11. AE-147 chips continue to append to custom feedback without overwriting
  it('11. preserves custom feedback when preset comment chips are inserted', () => {
    const customText = 'Student provided an unconventional recursive solution.';
    const tagToInsert = 'Well documented code.';

    const { updatedFeedback, isDuplicate } = insertTagIntoFeedback(customText, tagToInsert);

    expect(isDuplicate).toBe(false);
    expect(updatedFeedback).toBe(
      'Student provided an unconventional recursive solution. Well documented code.'
    );
    expect(updatedFeedback).toContain(customText);
    expect(updatedFeedback).toContain(tagToInsert);
  });

  // 12. Feedback remains accessible and keyboard usable
  it('12. renders accessible markup including label association, character counter, and aria attributes', () => {
    const html = renderToStaticMarkup(
      React.createElement(RubricSidebar, {
        initialRubric: mockRubricData,
        allocatedQuestionNumber: 1,
        initialFeedback: { 1: 'Good work!' },
      })
    );

    // Question Feedback section test id
    expect(html).toContain('data-testid="question-feedback-section-1"');

    // Label with htmlFor
    expect(html).toContain('for="feedback-input-1"');
    expect(html).toContain('Question Feedback');

    // Textarea with id, aria-label, and character limit
    expect(html).toContain('id="feedback-input-1"');
    expect(html).toContain('aria-label="Feedback for Question 1"');
    expect(html).toMatch(/maxlength="2000"/i);

    // Character counter
    expect(html).toContain('data-testid="feedback-char-counter-1"');
    expect(html).toContain('10/2000');

    // Live announcement container
    expect(html).toContain('data-testid="tag-live-announcement-1"');
    expect(html).toContain('aria-live="polite"');
  });
});

describe('AE-8A (Isolated Saved-Grade Loading Capability)', () => {
  let gradesGET: any;
  let professorId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let otherTaId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let courseId: mongoose.Types.ObjectId;
  let scriptId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    const gradesRoute = await import('../app/api/scripts/[id]/grades/route');
    gradesGET = gradesRoute.GET;
  });

  beforeEach(async () => {
    professorId = new mongoose.Types.ObjectId('000000000000000000000401');
    taId = new mongoose.Types.ObjectId('000000000000000000000402');
    otherTaId = new mongoose.Types.ObjectId('000000000000000000000403');
    studentId = new mongoose.Types.ObjectId('000000000000000000000404');

    const course = new Course({
      courseCode: 'CS502',
      courseName: 'Algorithms',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [taId, otherTaId],
      enrolledStudents: [studentId],
      isActive: true,
    });
    const savedCourse = await course.save();
    courseId = savedCourse._id as mongoose.Types.ObjectId;

    const exam = new Exam({
      title: 'Exam 2',
      course: courseId,
      createdBy: professorId,
      examDate: new Date('2026-11-20T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 1,
      status: 'PUBLISHED',
      isActive: true,
    });
    const savedExam = await exam.save();
    examId = savedExam._id as mongoose.Types.ObjectId;

    const rubric = new Rubric({
      exam: examId,
      createdBy: professorId,
      questions: [
        {
          questionNumber: 1,
          maxMarks: 10,
          criteria: [{ criterionName: 'Correctness', points: 10 }],
        },
      ],
      isActive: true,
    });
    await rubric.save();

    const script = new AnswerScript({
      exam: examId,
      student: studentId,
      filePath: '/scripts/script_ae8a.pdf',
      filename: 'script_ae8a.pdf',
      pageCount: 2,
      isActive: true,
    });
    const savedScript = await script.save();
    scriptId = savedScript._id as mongoose.Types.ObjectId;

    const allocation = new Allocation({
      exam: examId,
      ta: taId,
      answerScript: scriptId,
      allocatedBy: professorId,
      question: 1,
      status: AllocationStatus.PENDING,
    });
    await allocation.save();
  });

  afterEach(async () => {
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await Rubric.deleteMany({});
    await AnswerScript.deleteMany({});
    await Allocation.deleteMany({});
    await Grade.deleteMany({});
    await AuditLog.deleteMany({});
    mockSessionUser = null;
  });

  // Isolated saved-grade loading test for AE-8A
  it('retrieves saved grades and feedback via canonical GET /api/scripts/[id]/grades', async () => {
    await gradingService.saveGrade({
      scriptId: scriptId.toString(),
      question: 1,
      marksAwarded: [{ criterionName: 'Correctness', score: 9 }],
      feedback: 'AE-8A saved grade loading test feedback.',
      userId: taId.toString(),
      userRole: UserRole.TA,
    });

    mockSessionUser = { id: taId.toString(), role: UserRole.TA, email: 'ta@test.com' };

    const req = new Request(`http://localhost:3000/api/scripts/${scriptId}/grades`, {
      method: 'GET',
    });

    const res = await gradesGET(req, {
      params: Promise.resolve({ id: scriptId.toString() }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].question).toBe(1);
    expect(json.data[0].feedback).toBe('AE-8A saved grade loading test feedback.');
    expect(json.data[0].totalScore).toBe(9);
  });
});


