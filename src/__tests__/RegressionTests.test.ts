/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression Tests (Mentor Review)
 *
 * 1. ADMIN retains full access to all owner-scoped course and exam routes
 *    (GET/PUT/DELETE) – prevents deny-by-default regressions.
 *
 * 2. Concurrent enrollment – fires multiple simultaneous enrollment requests
 *    and verifies all enrollments persist (no lost updates, no duplicates).
 *
 * 3. GET /api/users never returns resetPasswordToken or resetPasswordExpires
 *    for any user in the response body.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam from '../models/Exam';
import User from '../models/User';
import StudentMapping from '../models/StudentMapping';
import { UserRole } from '../constants/permissions';

let mockSessionUser: any = null;

// Mock next-auth so each test can control the session freely
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

// ---------------------------------------------------------------------------
// Shared route handles (imported once for the whole suite)
// ---------------------------------------------------------------------------
describe('Regression Tests (Mentor Review)', () => {
  let courseDetailGET: any;
  let courseDetailPUT: any;
  let courseDetailDELETE: any;
  let examDetailGET: any;
  let examDetailPUT: any;
  let examDetailDELETE: any;
  let courseEnrollPOST: any;
  let examEnrollPOST: any;
  let usersGET: any;

  const adminId = new mongoose.Types.ObjectId('a00000000000000000000001');
  const professorId = new mongoose.Types.ObjectId('a00000000000000000000002');

  let testCourseId: mongoose.Types.ObjectId;
  let testExamId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    courseDetailGET = (await import('../app/api/courses/[id]/route')).GET;
    courseDetailPUT = (await import('../app/api/courses/[id]/route')).PUT;
    courseDetailDELETE = (await import('../app/api/courses/[id]/route')).DELETE;
    examDetailGET = (await import('../app/api/exams/[id]/route')).GET;
    examDetailPUT = (await import('../app/api/exams/[id]/route')).PUT;
    examDetailDELETE = (await import('../app/api/exams/[id]/route')).DELETE;
    courseEnrollPOST = (await import('../app/api/courses/[id]/enroll/route')).POST;
    examEnrollPOST = (await import('../app/api/exams/[id]/enroll/route')).POST;
    usersGET = (await import('../app/api/users/route')).GET;
  });

  beforeEach(async () => {
    // Seed a course owned by professorId (ADMIN is a different actor)
    const course = new Course({
      courseCode: 'REG101',
      courseName: 'Regression Course',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      isActive: true,
    });
    const savedCourse = await course.save();
    testCourseId = savedCourse._id as mongoose.Types.ObjectId;

    // Seed an exam belonging to that course / professor
    const exam = new Exam({
      title: 'Regression Exam',
      course: testCourseId,
      createdBy: professorId,
      examDate: new Date('2026-10-15T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 10,
      status: 'DRAFT',
      isActive: true,
    });
    const savedExam = await exam.save();
    testExamId = savedExam._id as mongoose.Types.ObjectId;
  });

  // =========================================================================
  // Regression 1 – ADMIN must not be blocked by owner-scoped routes
  // =========================================================================
  describe('Regression 1: ADMIN full access to owner-scoped course and exam routes', () => {
    beforeEach(() => {
      mockSessionUser = {
        id: adminId.toString(),
        email: 'admin@university.edu',
        name: 'Admin User',
        role: UserRole.ADMIN,
      };
    });

    // --- Course routes ---
    it('[ADMIN] GET /api/courses/:id returns 200 for a course owned by another professor', async () => {
      const res = await courseDetailGET(
        new Request(`http://localhost:3000/api/courses/${testCourseId}`),
        { params: Promise.resolve({ id: testCourseId.toString() }) }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data._id).toBe(testCourseId.toString());
    });

    it('[ADMIN] PUT /api/courses/:id returns 200 for a course owned by another professor', async () => {
      const req = new Request(`http://localhost:3000/api/courses/${testCourseId}`, {
        method: 'PUT',
        body: JSON.stringify({ courseName: 'Admin-Updated Name' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await courseDetailPUT(req as any, {
        params: Promise.resolve({ id: testCourseId.toString() }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.courseName).toBe('Admin-Updated Name');
    });

    it('[ADMIN] DELETE /api/courses/:id returns 200 for a course owned by another professor (no active exams)', async () => {
      // Deactivate the seeded exam so the deletion guard does not block
      await Exam.findByIdAndUpdate(testExamId, { isActive: false });

      const req = new Request(`http://localhost:3000/api/courses/${testCourseId}`, {
        method: 'DELETE',
      });
      const res = await courseDetailDELETE(req as any, {
        params: Promise.resolve({ id: testCourseId.toString() }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Confirm soft-delete in DB
      const dbCourse = await Course.findById(testCourseId);
      expect(dbCourse!.isActive).toBe(false);
    });

    // --- Exam routes ---
    it('[ADMIN] GET /api/exams/:id returns 200 for an exam created by another professor', async () => {
      const res = await examDetailGET(
        new Request(`http://localhost:3000/api/exams/${testExamId}`),
        { params: Promise.resolve({ id: testExamId.toString() }) }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data._id).toBe(testExamId.toString());
    });

    it('[ADMIN] PUT /api/exams/:id returns 200 for an exam created by another professor', async () => {
      const req = new Request(`http://localhost:3000/api/exams/${testExamId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: 'Admin-Updated Exam Title' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await examDetailPUT(req as any, {
        params: Promise.resolve({ id: testExamId.toString() }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.title).toBe('Admin-Updated Exam Title');
    });

    it('[ADMIN] DELETE /api/exams/:id returns 200 for an exam created by another professor', async () => {
      const req = new Request(`http://localhost:3000/api/exams/${testExamId}`, {
        method: 'DELETE',
      });
      const res = await examDetailDELETE(req as any, {
        params: Promise.resolve({ id: testExamId.toString() }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Confirm soft-delete in DB
      const dbExam = await Exam.findById(testExamId);
      expect(dbExam!.isActive).toBe(false);
    });
  });

  // =========================================================================
  // Regression 2 – Concurrent enrollment must not produce lost updates or
  //                duplicates (both course and exam enrollment paths)
  // =========================================================================
  describe('Regression 2: Concurrent enrollment – no lost updates, no duplicates', () => {
    let studentIds: string[];

    beforeEach(async () => {
      // Seed 5 students for the concurrency test
      studentIds = [];
      for (let i = 0; i < 5; i++) {
        const s = new User({
          name: `Concurrent Student ${i}`,
          email: `concstudent${i}@university.edu`,
          password: 'password123',
          role: UserRole.STUDENT,
          isActive: true,
        });
        const saved = await s.save();
        studentIds.push(saved._id.toString());
      }

      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@university.edu',
        name: 'Professor User',
        role: UserRole.PROFESSOR,
      };
    });

    it('concurrent course enrollment requests preserve all enrollments without duplicates', async () => {
      // Fire 5 simultaneous requests, each enrolling 1 distinct student
      const requests = studentIds.map((sid) => {
        const req = new Request(
          `http://localhost:3000/api/courses/${testCourseId}/enroll`,
          {
            method: 'POST',
            body: JSON.stringify({ studentIds: [sid] }),
            headers: { 'Content-Type': 'application/json' },
          }
        );
        return courseEnrollPOST(req as any, {
          params: Promise.resolve({ id: testCourseId.toString() }),
        });
      });

      const responses = await Promise.all(requests);

      // Every request must succeed
      for (const res of responses) {
        expect(res.status).toBe(200);
      }

      // Exactly 5 distinct students enrolled – no loss, no duplicates
      const dbCourse = await Course.findById(testCourseId);
      const enrolledIds = dbCourse!.enrolledStudents!.map((id) => id.toString());
      expect(enrolledIds.length).toBe(studentIds.length);
      for (const sid of studentIds) {
        expect(enrolledIds).toContain(sid);
      }
    });

    it('concurrent exam enrollment requests preserve all StudentMappings without duplicates', async () => {
      // Fire 5 simultaneous requests, each enrolling 1 distinct student
      const requests = studentIds.map((sid) => {
        const req = new Request(
          `http://localhost:3000/api/exams/${testExamId}/enroll`,
          {
            method: 'POST',
            body: JSON.stringify({ studentIds: [sid] }),
            headers: { 'Content-Type': 'application/json' },
          }
        );
        return examEnrollPOST(req as any, {
          params: Promise.resolve({ id: testExamId.toString() }),
        });
      });

      const responses = await Promise.all(requests);

      // Every request must succeed
      for (const res of responses) {
        expect(res.status).toBe(200);
      }

      // Exactly 5 StudentMapping documents – one per student, no duplicates
      const mappings = await StudentMapping.find({ exam: testExamId });
      const mappedStudentIds = mappings.map((m) => m.student.toString());
      expect(mappings.length).toBe(studentIds.length);
      for (const sid of studentIds) {
        expect(mappedStudentIds).toContain(sid);
      }

      // Verify the Exam document's enrolledStudents array is also correct
      const dbExam = await Exam.findById(testExamId);
      const examEnrolledIds = dbExam!.enrolledStudents!.map((id) => id.toString());
      expect(examEnrolledIds.length).toBe(studentIds.length);
      for (const sid of studentIds) {
        expect(examEnrolledIds).toContain(sid);
      }
    });

    it('concurrent enrollment of the SAME student by multiple requests causes no duplicate mappings', async () => {
      const singleStudentId = studentIds[0];

      // Fire 5 simultaneous requests all trying to enroll the same student
      const requests = Array.from({ length: 5 }, () => {
        const req = new Request(
          `http://localhost:3000/api/exams/${testExamId}/enroll`,
          {
            method: 'POST',
            body: JSON.stringify({ studentIds: [singleStudentId] }),
            headers: { 'Content-Type': 'application/json' },
          }
        );
        return examEnrollPOST(req as any, {
          params: Promise.resolve({ id: testExamId.toString() }),
        });
      });

      await Promise.all(requests);

      // Must produce exactly 1 StudentMapping for this student
      const mappings = await StudentMapping.find({
        exam: testExamId,
        student: new mongoose.Types.ObjectId(singleStudentId),
      });
      expect(mappings.length).toBe(1);

      // Exam.enrolledStudents must also have exactly 1 entry for this student
      const dbExam = await Exam.findById(testExamId);
      const enrolledForStudent = dbExam!.enrolledStudents!.filter(
        (id) => id.toString() === singleStudentId
      );
      expect(enrolledForStudent.length).toBe(1);
    });
  });

  // =========================================================================
  // Regression 3 – GET /api/users must never expose reset-password fields
  // =========================================================================
  describe('Regression 3: GET /api/users never exposes resetPasswordToken or resetPasswordExpires', () => {
    beforeEach(() => {
      // Authenticate as ADMIN (only ADMIN can call getAllUsers)
      mockSessionUser = {
        id: adminId.toString(),
        email: 'admin@university.edu',
        name: 'Admin User',
        role: UserRole.ADMIN,
      };
    });

    it('does not return resetPasswordToken or resetPasswordExpires for any user', async () => {
      // Seed a user and force-write reset-password fields directly to bypass
      // the schema's select:false, simulating a document that has these fields
      const userWithToken = new User({
        name: 'Reset Token User',
        email: 'resetuser@university.edu',
        password: 'hashedpassword',
        role: UserRole.STUDENT,
        isActive: true,
      });
      const savedUser = await userWithToken.save();

      await User.collection.updateOne(
        { _id: savedUser._id },
        {
          $set: {
            resetPasswordToken: 'super-secret-token-value',
            resetPasswordExpires: new Date(Date.now() + 3_600_000),
          },
        }
      );

      // Seed a second user without any token
      await new User({
        name: 'Normal User',
        email: 'normaluser@university.edu',
        password: 'hashedpassword',
        role: UserRole.PROFESSOR,
        isActive: true,
      }).save();

      const res = await usersGET();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.length).toBeGreaterThanOrEqual(2);

      // Assert that NO user object in the response carries sensitive reset fields
      for (const user of body.data) {
        expect(user).not.toHaveProperty('resetPasswordToken');
        expect(user).not.toHaveProperty('resetPasswordExpires');
        // Password must also be absent (sanity check alongside the main assertion)
        expect(user).not.toHaveProperty('password');
      }
    });
  });
});
