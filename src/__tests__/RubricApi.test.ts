/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam from '../models/Exam';
import Rubric from '../models/Rubric';
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

describe('Rubric API & RBAC Tests (AE-038)', () => {
  let rubricsPOST: any;
  let rubricDetailGET: any;
  let rubricDetailPUT: any;

  let testCourseId: mongoose.Types.ObjectId;
  let testExamId: mongoose.Types.ObjectId;
  let professorId: mongoose.Types.ObjectId;
  let otherProfessorId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let adminId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    rubricsPOST = (await import('../app/api/rubrics/route')).POST;
    rubricDetailGET = (await import('../app/api/rubrics/[id]/route')).GET;
    rubricDetailPUT = (await import('../app/api/rubrics/[id]/route')).PUT;

    professorId = new mongoose.Types.ObjectId('000000000000000000000100');
    otherProfessorId = new mongoose.Types.ObjectId('000000000000000000000101');
    studentId = new mongoose.Types.ObjectId('000000000000000000000102');
    taId = new mongoose.Types.ObjectId('000000000000000000000103');
    adminId = new mongoose.Types.ObjectId('000000000000000000000104');
  });

  beforeEach(async () => {
    // Seed database items
    const course = new Course({
      courseCode: 'CS302',
      courseName: 'Advanced Databases',
      semester: 2,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [taId],
      enrolledStudents: [studentId],
      isActive: true
    });
    const savedCourse = await course.save();
    testCourseId = savedCourse._id as mongoose.Types.ObjectId;

    const exam = new Exam({
      title: 'Final Exam',
      course: testCourseId,
      createdBy: professorId,
      examDate: new Date('2026-12-15T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 3,
      status: 'DRAFT',
      isActive: true
    });
    const savedExam = await exam.save();
    testExamId = savedExam._id as mongoose.Types.ObjectId;

    // Exam created by other professor to test ownership
    const exam2 = new Exam({
      title: 'Other Final Exam',
      course: testCourseId,
      createdBy: otherProfessorId,
      examDate: new Date('2026-12-15T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 3,
      status: 'DRAFT',
      isActive: true
    });
    await exam2.save();
  });

  afterEach(async () => {
    // Clean up
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await Rubric.deleteMany({});
  });

  describe('Authorization and RBAC Enforcement', () => {
    it('should return 401 Unauthorized for POST /api/rubrics when unauthenticated', async () => {
      mockSessionUser = null;
      const req = new Request('http://localhost:3000/api/rubrics', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await rubricsPOST(req as any);
      expect(res.status).toBe(401);
    });

    it('should return 403 Forbidden for Student creating a rubric (lacks CREATE_RUBRIC)', async () => {
      mockSessionUser = {
        id: studentId.toString(),
        email: 'student@university.edu',
        name: 'Student User',
        role: UserRole.STUDENT,
      };

      const req = new Request('http://localhost:3000/api/rubrics', {
        method: 'POST',
        body: JSON.stringify({
          exam: testExamId.toString(),
          questions: [
            {
              questionNumber: 1,
              maxMarks: 10,
              criteria: [{ criterionName: 'Correctness', points: 10 }]
            }
          ]
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await rubricsPOST(req as any);
      expect(res.status).toBe(403);
    });

    it('should return 403 Forbidden for TA creating a rubric (lacks CREATE_RUBRIC)', async () => {
      mockSessionUser = {
        id: taId.toString(),
        email: 'ta@university.edu',
        name: 'TA User',
        role: UserRole.TA,
      };

      const req = new Request('http://localhost:3000/api/rubrics', {
        method: 'POST',
        body: JSON.stringify({
          exam: testExamId.toString(),
          questions: [
            {
              questionNumber: 1,
              maxMarks: 10,
              criteria: [{ criterionName: 'Correctness', points: 10 }]
            }
          ]
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await rubricsPOST(req as any);
      expect(res.status).toBe(403);
    });
  });

  describe('Professor and Admin Operations (Happy Paths & Validations)', () => {
    beforeEach(() => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@university.edu',
        name: 'Professor User',
        role: UserRole.PROFESSOR,
      };
    });

    it('should successfully create a rubric and return 201', async () => {
      const payload = {
        exam: testExamId.toString(),
        questions: [
          {
            questionNumber: 1,
            maxMarks: 20,
            criteria: [
              { criterionName: 'Logic', description: 'Logical correctness', points: 15 },
              { criterionName: 'Style', points: 5 }
            ]
          },
          {
            questionNumber: 2,
            maxMarks: 10,
            criteria: [
              { criterionName: 'Explanation', points: 10 }
            ]
          }
        ]
      };

      const req = new Request('http://localhost:3000/api/rubrics', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await rubricsPOST(req as any);
      expect(res.status).toBe(201);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.data.exam).toBe(testExamId.toString());
      expect(resBody.data.questions.length).toBe(2);
      expect(resBody.data.questions[0].criteria.length).toBe(2);
    });

    it('should return 400 validation failure for missing required fields', async () => {
      const req = new Request('http://localhost:3000/api/rubrics', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await rubricsPOST(req as any);
      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toContain('Validation failed');
    });

    it('should return 400 validation failure for negative or zero marks/points', async () => {
      const payload = {
        exam: testExamId.toString(),
        questions: [
          {
            questionNumber: 1,
            maxMarks: -10,
            criteria: [
              { criterionName: 'Logic', points: 0 }
            ]
          }
        ]
      };

      const req = new Request('http://localhost:3000/api/rubrics', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await rubricsPOST(req as any);
      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
    });

    it('should return 400 validation failure for duplicate question numbers', async () => {
      const payload = {
        exam: testExamId.toString(),
        questions: [
          {
            questionNumber: 1,
            maxMarks: 10,
            criteria: [{ criterionName: 'Logic', points: 10 }]
          },
          {
            questionNumber: 1,
            maxMarks: 15,
            criteria: [{ criterionName: 'Logic', points: 15 }]
          }
        ]
      };

      const req = new Request('http://localhost:3000/api/rubrics', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await rubricsPOST(req as any);
      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
    });

    it('should return 400 validation failure if sum of criteria points exceeds question maxMarks', async () => {
      const payload = {
        exam: testExamId.toString(),
        questions: [
          {
            questionNumber: 1,
            maxMarks: 10,
            criteria: [
              { criterionName: 'Logic', points: 8 },
              { criterionName: 'Style', points: 4 }
            ]
          }
        ]
      };

      const req = new Request('http://localhost:3000/api/rubrics', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await rubricsPOST(req as any);
      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
    });

    it('should return 400 validation failure for unknown fields (.strict())', async () => {
      const payload = {
        exam: testExamId.toString(),
        questions: [
          {
            questionNumber: 1,
            maxMarks: 10,
            criteria: [{ criterionName: 'Logic', points: 10 }],
            extraField: 'unknown'
          }
        ]
      };

      const req = new Request('http://localhost:3000/api/rubrics', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await rubricsPOST(req as any);
      expect(res.status).toBe(400);
    });
  });

  describe('Ownership and Access Rules (Owner vs Non-Owner)', () => {
    let seededRubricId: string;

    beforeEach(async () => {
      const rubric = new Rubric({
        exam: testExamId,
        questions: [
          {
            questionNumber: 1,
            maxMarks: 10,
            criteria: [{ criterionName: 'Logic', points: 10 }]
          }
        ],
        createdBy: professorId,
        isActive: true
      });
      const saved = await rubric.save();
      seededRubricId = saved._id.toString();
    });

    it('should deny GET /api/rubrics/:id for unassociated/non-owner Professor', async () => {
      mockSessionUser = {
        id: otherProfessorId.toString(),
        email: 'other_prof@university.edu',
        name: 'Other Professor',
        role: UserRole.PROFESSOR,
      };

      const res = await rubricDetailGET(new Request(`http://localhost:3000/api/rubrics/${seededRubricId}`), {
        params: Promise.resolve({ id: seededRubricId })
      });
      expect(res.status).toBe(404);
    });

    it('should deny PUT /api/rubrics/:id for unassociated/non-owner Professor', async () => {
      mockSessionUser = {
        id: otherProfessorId.toString(),
        email: 'other_prof@university.edu',
        name: 'Other Professor',
        role: UserRole.PROFESSOR,
      };

      const res = await rubricDetailPUT(new Request(`http://localhost:3000/api/rubrics/${seededRubricId}`, {
        method: 'PUT',
        body: JSON.stringify({
          questions: [
            {
              questionNumber: 1,
              maxMarks: 8,
              criteria: [{ criterionName: 'Logic', points: 8 }]
            }
          ]
        })
      }), {
        params: Promise.resolve({ id: seededRubricId })
      });
      expect(res.status).toBe(404);
    });

    it('should allow GET /api/rubrics/:id for owner Professor', async () => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@university.edu',
        name: 'Professor User',
        role: UserRole.PROFESSOR,
      };

      const res = await rubricDetailGET(new Request(`http://localhost:3000/api/rubrics/${seededRubricId}`), {
        params: Promise.resolve({ id: seededRubricId })
      });
      expect(res.status).toBe(200);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.data._id).toBe(seededRubricId);
    });

    it('should allow PUT /api/rubrics/:id for owner Professor', async () => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@university.edu',
        name: 'Professor User',
        role: UserRole.PROFESSOR,
      };

      const res = await rubricDetailPUT(new Request(`http://localhost:3000/api/rubrics/${seededRubricId}`, {
        method: 'PUT',
        body: JSON.stringify({
          questions: [
            {
              questionNumber: 1,
              maxMarks: 8,
              criteria: [{ criterionName: 'Logic updated', points: 8 }]
            }
          ]
        }),
        headers: { 'Content-Type': 'application/json' }
      }), {
        params: Promise.resolve({ id: seededRubricId })
      });
      expect(res.status).toBe(200);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.data.questions[0].maxMarks).toBe(8);
      expect(resBody.data.questions[0].criteria[0].criterionName).toBe('Logic updated');
    });

    it('should allow GET /api/rubrics/:id for Admin', async () => {
      mockSessionUser = {
        id: adminId.toString(),
        email: 'admin@university.edu',
        name: 'Admin User',
        role: UserRole.ADMIN,
      };

      const res = await rubricDetailGET(new Request(`http://localhost:3000/api/rubrics/${seededRubricId}`), {
        params: Promise.resolve({ id: seededRubricId })
      });
      expect(res.status).toBe(200);
    });

    it('should allow PUT /api/rubrics/:id for Admin', async () => {
      mockSessionUser = {
        id: adminId.toString(),
        email: 'admin@university.edu',
        name: 'Admin User',
        role: UserRole.ADMIN,
      };

      const res = await rubricDetailPUT(new Request(`http://localhost:3000/api/rubrics/${seededRubricId}`, {
        method: 'PUT',
        body: JSON.stringify({
          questions: [
            {
              questionNumber: 1,
              maxMarks: 5,
              criteria: [{ criterionName: 'Logic', points: 5 }]
            }
          ]
        }),
        headers: { 'Content-Type': 'application/json' }
      }), {
        params: Promise.resolve({ id: seededRubricId })
      });
      expect(res.status).toBe(200);
    });

    it('should allow GET /api/rubrics/:id for TA associated with course', async () => {
      mockSessionUser = {
        id: taId.toString(),
        email: 'ta@university.edu',
        name: 'TA User',
        role: UserRole.TA,
      };

      const res = await rubricDetailGET(new Request(`http://localhost:3000/api/rubrics/${seededRubricId}`), {
        params: Promise.resolve({ id: seededRubricId })
      });
      expect(res.status).toBe(200);
    });

    it('should deny GET /api/rubrics/:id for Student if Exam is not published', async () => {
      mockSessionUser = {
        id: studentId.toString(),
        email: 'student@university.edu',
        name: 'Student User',
        role: UserRole.STUDENT,
      };

      const res = await rubricDetailGET(new Request(`http://localhost:3000/api/rubrics/${seededRubricId}`), {
        params: Promise.resolve({ id: seededRubricId })
      });
      expect(res.status).toBe(404);
    });

    it('should allow GET /api/rubrics/:id for Student if Exam is published', async () => {
      mockSessionUser = {
        id: studentId.toString(),
        email: 'student@university.edu',
        name: 'Student User',
        role: UserRole.STUDENT,
      };

      await Exam.findByIdAndUpdate(testExamId, { status: 'PUBLISHED' });

      const res = await rubricDetailGET(new Request(`http://localhost:3000/api/rubrics/${seededRubricId}`), {
        params: Promise.resolve({ id: seededRubricId })
      });
      expect(res.status).toBe(200);
    });
  });
});
