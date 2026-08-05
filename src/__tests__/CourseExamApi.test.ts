/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam from '../models/Exam';
import AuditLog from '../models/AuditLog';
import { UserRole } from '../constants/permissions';

let mockSessionUser: any = null;

// Mock next-auth to allow dynamic control of session users in RBAC testing
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

describe('Course and Exam API & RBAC Tests (AE-034)', () => {
  let coursesGET: any;
  let coursesPOST: any;
  let courseDetailPUT: any;
  let courseDetailDELETE: any;
  let courseDetailGET: any;

  let examsGET: any;
  let examsPOST: any;
  let examDetailPUT: any;
  let examDetailDELETE: any;
  let examDetailGET: any;

  let testCourseId: mongoose.Types.ObjectId;
  let testExamId: mongoose.Types.ObjectId;
  let professorId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    coursesGET = (await import('../app/api/courses/route')).GET;
    coursesPOST = (await import('../app/api/courses/route')).POST;
    courseDetailPUT = (await import('../app/api/courses/[id]/route')).PUT;
    courseDetailDELETE = (await import('../app/api/courses/[id]/route')).DELETE;
    courseDetailGET = (await import('../app/api/courses/[id]/route')).GET;

    examsGET = (await import('../app/api/exams/route')).GET;
    examsPOST = (await import('../app/api/exams/route')).POST;
    examDetailPUT = (await import('../app/api/exams/[id]/route')).PUT;
    examDetailDELETE = (await import('../app/api/exams/[id]/route')).DELETE;
    examDetailGET = (await import('../app/api/exams/[id]/route')).GET;

    professorId = new mongoose.Types.ObjectId('000000000000000000000003');
  });

  beforeEach(async () => {
    // Seed a course
    const course = new Course({
      courseCode: 'CS101',
      courseName: 'Intro to CS',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      isActive: true
    });
    const savedCourse = await course.save();
    testCourseId = savedCourse._id as mongoose.Types.ObjectId;

    // Seed an exam
    const exam = new Exam({
      title: 'Midterm Exam',
      course: testCourseId,
      createdBy: professorId,
      examDate: new Date('2026-10-15T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 10,
      status: 'DRAFT',
      isActive: true
    });
    const savedExam = await exam.save();
    testExamId = savedExam._id as mongoose.Types.ObjectId;
  });

  describe('Authorization and RBAC Enforcement', () => {
    it('should return 401 for GET /api/courses when unauthenticated', async () => {
      mockSessionUser = null;
      const res = await coursesGET();
      expect(res.status).toBe(401);
    });

    it('should return 403 Forbidden for Student creating a course (lacks CREATE_COURSE)', async () => {
      mockSessionUser = {
        id: 'student-id',
        email: 'student@university.edu',
        name: 'Student',
        role: UserRole.STUDENT,
      };

      const req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await coursesPOST(req as any);
      expect(res.status).toBe(403);
    });

    it('should return 403 Forbidden for Student editing a course (lacks EDIT_COURSE)', async () => {
      mockSessionUser = {
        id: 'student-id',
        email: 'student@university.edu',
        name: 'Student',
        role: UserRole.STUDENT,
      };

      const req = new Request(`http://localhost:3000/api/courses/${testCourseId}`, {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await courseDetailPUT(req as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(res.status).toBe(403);
    });

    it('should return 403 Forbidden for Student deleting a course (lacks DELETE_COURSE)', async () => {
      mockSessionUser = {
        id: 'student-id',
        email: 'student@university.edu',
        name: 'Student',
        role: UserRole.STUDENT,
      };

      const req = new Request(`http://localhost:3000/api/courses/${testCourseId}`, {
        method: 'DELETE',
      });
      const res = await courseDetailDELETE(req as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(res.status).toBe(403);
    });

    it('should return 403 Forbidden for Student creating an exam (lacks CREATE_EXAM)', async () => {
      mockSessionUser = {
        id: 'student-id',
        email: 'student@university.edu',
        name: 'Student',
        role: UserRole.STUDENT,
      };

      const req = new Request('http://localhost:3000/api/exams', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await examsPOST(req as any);
      expect(res.status).toBe(403);
    });

    it('should return 403 Forbidden for Student editing an exam (lacks EDIT_EXAM)', async () => {
      mockSessionUser = {
        id: 'student-id',
        email: 'student@university.edu',
        name: 'Student',
        role: UserRole.STUDENT,
      };

      const req = new Request(`http://localhost:3000/api/exams/${testExamId}`, {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await examDetailPUT(req as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(res.status).toBe(403);
    });

    it('should return 403 Forbidden for Student deleting an exam (lacks DELETE_EXAM)', async () => {
      mockSessionUser = {
        id: 'student-id',
        email: 'student@university.edu',
        name: 'Student',
        role: UserRole.STUDENT,
      };

      const req = new Request(`http://localhost:3000/api/exams/${testExamId}`, {
        method: 'DELETE',
      });
      const res = await examDetailDELETE(req as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(res.status).toBe(403);
    });
  });

  describe('Professor Operations (Authorized Courses & Exams)', () => {
    beforeEach(() => {
      mockSessionUser = {
        id: 'prof-id',
        email: 'prof@university.edu',
        name: 'Professor User',
        role: UserRole.PROFESSOR,
      };
    });

    it('should create a course and write COURSE_CREATED audit log', async () => {
      const payload = {
        courseCode: 'CS102',
        courseName: 'Data Structures',
        semester: '2',
        academicYear: '2026-2027',
        professor: professorId.toString(),
      };

      const req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await coursesPOST(req as any);
      expect(res.status).toBe(201);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);

      const dbCourse = await Course.findOne({ courseCode: 'CS102' });
      expect(dbCourse).not.toBeNull();

      // Check audit log
      const logs = await AuditLog.find({ entityId: dbCourse!._id, action: 'COURSE_CREATED' });
      expect(logs.length).toBe(1);
    });

    it('should retrieve a single course by ID', async () => {
      const res = await courseDetailGET(new Request(`http://localhost:3000/api/courses/${testCourseId}`), { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(res.status).toBe(200);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.data._id).toBe(testCourseId.toString());
    });

    it('should update a course and write COURSE_UPDATED audit log', async () => {
      const payload = {
        courseName: 'Intro to Computer Science',
      };

      const req = new Request(`http://localhost:3000/api/courses/${testCourseId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await courseDetailPUT(req as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(res.status).toBe(200);

      const dbCourse = await Course.findById(testCourseId);
      expect(dbCourse!.courseName).toBe('Intro to Computer Science');

      // Check audit log
      const logs = await AuditLog.find({ entityId: testCourseId, action: 'COURSE_UPDATED' });
      expect(logs.length).toBe(1);
      expect((logs[0].details as any).changedFields).toContain('courseName');
    });

    it('should delete a course and write COURSE_DELETED audit log', async () => {
      const req = new Request(`http://localhost:3000/api/courses/${testCourseId}`, {
        method: 'DELETE',
      });

      const res = await courseDetailDELETE(req as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(res.status).toBe(200);

      const dbCourse = await Course.findById(testCourseId);
      expect(dbCourse!.isActive).toBe(false);

      // Check audit log
      const logs = await AuditLog.find({ entityId: testCourseId, action: 'COURSE_DELETED' });
      expect(logs.length).toBe(1);
    });

    it('should retrieve list of exams', async () => {
      const res = await examsGET();
      expect(res.status).toBe(200);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.data.length).toBeGreaterThanOrEqual(1);
    });

    it('should retrieve a single exam by ID', async () => {
      const res = await examDetailGET(new Request(`http://localhost:3000/api/exams/${testExamId}`), { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(res.status).toBe(200);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.data._id).toBe(testExamId.toString());
    });

    it('should create an exam with numberOfQuestions and write EXAM_CREATED audit log', async () => {
      const payload = {
        title: 'Final Exam',
        course: testCourseId.toString(),
        createdBy: professorId.toString(),
        examDate: '2026-12-15T09:00:00.000Z',
        totalMarks: 100,
        numberOfQuestions: 20
      };

      const req = new Request('http://localhost:3000/api/exams', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await examsPOST(req as any);
      expect(res.status).toBe(201);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);

      const dbExam = await Exam.findOne({ title: 'Final Exam' });
      expect(dbExam).not.toBeNull();
      expect(dbExam!.numberOfQuestions).toBe(20);

      // Check audit log
      const logs = await AuditLog.find({ entityId: dbExam!._id, action: 'EXAM_CREATED' });
      expect(logs.length).toBe(1);
      expect((logs[0].details as any).numberOfQuestions).toBe(20);
    });

    it('should return 400 validation error when creating exam without numberOfQuestions', async () => {
      const payload = {
        title: 'Invalid Exam',
        course: testCourseId.toString(),
        createdBy: professorId.toString(),
        examDate: '2026-12-15T09:00:00.000Z',
        totalMarks: 100
      };

      const req = new Request('http://localhost:3000/api/exams', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await examsPOST(req as any);
      expect(res.status).toBe(400);
    });

    it('should update an exam and write EXAM_UPDATED audit log', async () => {
      const payload = {
        numberOfQuestions: 15,
        title: 'Midterm Exam Revised'
      };

      const req = new Request(`http://localhost:3000/api/exams/${testExamId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await examDetailPUT(req as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(res.status).toBe(200);

      const dbExam = await Exam.findById(testExamId);
      expect(dbExam!.numberOfQuestions).toBe(15);
      expect(dbExam!.title).toBe('Midterm Exam Revised');

      // Check audit log
      const logs = await AuditLog.find({ entityId: testExamId, action: 'EXAM_UPDATED' });
      expect(logs.length).toBe(1);
      expect((logs[0].details as any).changedFields).toContain('numberOfQuestions');
      expect((logs[0].details as any).changedFields).toContain('title');
    });

    it('should delete an exam and write EXAM_DELETED audit log', async () => {
      const req = new Request(`http://localhost:3000/api/exams/${testExamId}`, {
        method: 'DELETE',
      });

      const res = await examDetailDELETE(req as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(res.status).toBe(200);

      const dbExam = await Exam.findById(testExamId);
      expect(dbExam!.isActive).toBe(false);

      // Check audit log
      const logs = await AuditLog.find({ entityId: testExamId, action: 'EXAM_DELETED' });
      expect(logs.length).toBe(1);
    });
  });
});
