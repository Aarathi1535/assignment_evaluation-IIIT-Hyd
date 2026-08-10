/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam from '../models/Exam';
import Rubric from '../models/Rubric';
import { UserRole } from '../constants/permissions';
import { validateRubricClient, Question } from '../utils/rubricBuilderUtils';

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

describe('Rubric Validation Consistency Regression Tests', () => {
  let rubricsPOST: any;
  let testCourseId: mongoose.Types.ObjectId;
  let testExamId: mongoose.Types.ObjectId;
  let professorId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    rubricsPOST = (await import('../app/api/rubrics/route')).POST;
    professorId = new mongoose.Types.ObjectId('000000000000000000000100');
  });

  beforeEach(async () => {
    // Seed database items
    const course = new Course({
      courseCode: 'CS303-REG',
      courseName: 'Regression CS',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      isActive: true
    });
    const savedCourse = await course.save();
    testCourseId = savedCourse._id as mongoose.Types.ObjectId;

    const exam = new Exam({
      title: 'Regression Midterm',
      course: testCourseId,
      createdBy: professorId,
      examDate: new Date('2026-10-15T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 3,
      status: 'DRAFT',
      isActive: true
    });
    const savedExam = await exam.save();
    testExamId = savedExam._id as mongoose.Types.ObjectId;

    // Default acting user is professor (authorized to write rubrics)
    mockSessionUser = {
      id: professorId.toString(),
      email: 'professor@university.edu',
      name: 'Professor User',
      role: UserRole.PROFESSOR,
    };
  });

  afterEach(async () => {
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await Rubric.deleteMany({});
  });

  const testPayloads = [
    {
      name: 'duplicate question numbers',
      payload: {
        questions: [
          {
            questionNumber: 1,
            maxMarks: 10,
            criteria: [{ criterionName: 'Logic', points: 10 }]
          },
          {
            questionNumber: 1,
            maxMarks: 20,
            criteria: [{ criterionName: 'Correctness', points: 20 }]
          }
        ]
      }
    },
    {
      name: 'invalid question number (zero)',
      payload: {
        questions: [
          {
            questionNumber: 0,
            maxMarks: 10,
            criteria: [{ criterionName: 'Logic', points: 10 }]
          }
        ]
      }
    },
    {
      name: 'invalid max marks (negative)',
      payload: {
        questions: [
          {
            questionNumber: 1,
            maxMarks: -5,
            criteria: [{ criterionName: 'Logic', points: 10 }]
          }
        ]
      }
    },
    {
      name: 'missing required criterion name',
      payload: {
        questions: [
          {
            questionNumber: 1,
            maxMarks: 10,
            criteria: [{ criterionName: '   ', points: 10 }]
          }
        ]
      }
    },
    {
      name: 'negative criterion points',
      payload: {
        questions: [
          {
            questionNumber: 1,
            maxMarks: 10,
            criteria: [{ criterionName: 'Logic', points: -2 }]
          }
        ]
      }
    },
    {
      name: 'criteria points exceeding question max marks',
      payload: {
        questions: [
          {
            questionNumber: 1,
            maxMarks: 10,
            criteria: [
              { criterionName: 'Logic', points: 8 },
              { criterionName: 'Formatting', points: 4 }
            ]
          }
        ]
      }
    }
  ];

  testPayloads.forEach(({ name, payload }) => {
    it(`should consistently reject ${name} on client and server`, async () => {
      // 1. Client-side assertion
      const clientErrors = validateRubricClient(payload.questions as Question[]);
      expect(clientErrors.length).toBeGreaterThan(0);

      // 2. Server-side assertion
      const fullPayload = {
        exam: testExamId.toString(),
        questions: payload.questions
      };

      const req = new Request('http://localhost:3000/api/rubrics', {
        method: 'POST',
        body: JSON.stringify(fullPayload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await rubricsPOST(req as any);
      expect(res.status).toBe(400);

      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toContain('Validation failed');
    });
  });
});
