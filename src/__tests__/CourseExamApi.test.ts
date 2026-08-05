/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam from '../models/Exam';
import AuditLog from '../models/AuditLog';
import User from '../models/User';
import StudentMapping from '../models/StudentMapping';
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
  let courseEnrollPOST: any;
  let examEnrollPOST: any;
  let examStudentsGET: any;
  let testStudentId1: string;
  let testStudentId2: string;

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
    courseEnrollPOST = (await import('../app/api/courses/[id]/enroll/route')).POST;
    examEnrollPOST = (await import('../app/api/exams/[id]/enroll/route')).POST;
    examStudentsGET = (await import('../app/api/exams/[id]/students/route')).GET;

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

    // Seed student users
    const student1 = new User({
      name: 'Student One',
      email: 'student1@university.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });
    const s1 = await student1.save();
    testStudentId1 = s1._id.toString();

    const student2 = new User({
      name: 'Student Two',
      email: 'student2@university.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });
    const s2 = await student2.save();
    testStudentId2 = s2._id.toString();
  });

  describe('Authorization and RBAC Enforcement', () => {
    it('should return 401 for GET /api/courses when unauthenticated', async () => {
      mockSessionUser = null;
      const res = await coursesGET();
      expect(res.status).toBe(401);
    });

    it('should return 403 Forbidden for Student creating a course (lacks CREATE_COURSE)', async () => {
      mockSessionUser = {
        id: testStudentId1,
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
        id: testStudentId1,
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
        id: testStudentId1,
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
        id: testStudentId1,
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
        id: testStudentId1,
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
        id: testStudentId1,
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
        id: professorId.toString(),
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
        academicYear: '2026-27',
        teachingAssistants: [],
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
      // Deactivate the active exam first to satisfy referential integrity check
      await Exam.findByIdAndUpdate(testExamId, { isActive: false });

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

  describe('Course and Exam Enrollments (AE-036)', () => {
    beforeEach(() => {
      // Set default authorized session user as professor
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@university.edu',
        name: 'Professor',
        role: UserRole.PROFESSOR,
      };
    });

    it('should return 403 Forbidden for Student enrolling into a course', async () => {
      mockSessionUser.role = UserRole.STUDENT;
      const req = new Request(`http://localhost:3000/api/courses/${testCourseId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ studentIds: [testStudentId1] }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await courseEnrollPOST(req as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(res.status).toBe(403);
    });

    it('should successfully enroll students into a course and write COURSE_ENROLLED audit log', async () => {
      const req = new Request(`http://localhost:3000/api/courses/${testCourseId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ studentIds: [testStudentId1, testStudentId2] }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await courseEnrollPOST(req as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(res.status).toBe(200);

      const dbCourse = await Course.findById(testCourseId);
      expect(dbCourse!.enrolledStudents?.length).toBe(2);
      expect(dbCourse!.enrolledStudents?.map(id => id.toString())).toContain(testStudentId1);

      // Check audit log
      const logs = await AuditLog.find({ entityId: testCourseId, action: 'COURSE_ENROLLED' });
      expect(logs.length).toBe(1);
      expect((logs[0].details as any).enrolledStudentCount).toBe(2);
    });

    it('should successfully enroll students into an exam (StudentMapping) and write EXAM_ENROLLED audit log', async () => {
      const req = new Request(`http://localhost:3000/api/exams/${testExamId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ studentIds: [testStudentId1, testStudentId2] }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await examEnrollPOST(req as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(res.status).toBe(200);

      const mappings = await StudentMapping.find({ exam: testExamId });
      expect(mappings.length).toBe(2);
      expect(mappings.map(m => m.student.toString())).toContain(testStudentId1);
      expect(mappings[0].anonymousId).toMatch(/^ANON-[0-9A-F]{6}$/);

      // Check audit log
      const logs = await AuditLog.find({ entityId: testExamId, action: 'EXAM_ENROLLED' });
      expect(logs.length).toBe(1);
    });

    it('should prevent duplicate mappings when enrolling already enrolled students', async () => {
      // First enrollment
      const req1 = new Request(`http://localhost:3000/api/exams/${testExamId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ studentIds: [testStudentId1] }),
        headers: { 'Content-Type': 'application/json' },
      });
      await examEnrollPOST(req1 as any, { params: Promise.resolve({ id: testExamId.toString() }) });

      // Second enrollment with duplicate student ID
      const req2 = new Request(`http://localhost:3000/api/exams/${testExamId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ studentIds: [testStudentId1, testStudentId2] }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await examEnrollPOST(req2 as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(res.status).toBe(200);

      const mappings = await StudentMapping.find({ exam: testExamId });
      expect(mappings.length).toBe(2); // Should only be 2, not 3
    });

    it('should reject enrollment if any user ID does not exist or is not a student', async () => {
      const invalidReq = new Request(`http://localhost:3000/api/exams/${testExamId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ studentIds: [testStudentId1, '000000000000000000000099'] }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await examEnrollPOST(invalidReq as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(res.status).toBe(400);
    });

    it('should successfully retrieve the enrolled student roster with populated user fields', async () => {
      // Seed mapping
      const mapping = new StudentMapping({
        exam: testExamId,
        student: new mongoose.Types.ObjectId(testStudentId1),
        anonymousId: 'ANON-TEST99',
        isVerified: true
      });
      await mapping.save();

      const req = new Request(`http://localhost:3000/api/exams/${testExamId}/students`);
      const res = await examStudentsGET(req as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(res.status).toBe(200);

      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.data.length).toBe(1);
      expect(resBody.data[0].anonymousId).toBe('ANON-TEST99');
      expect(resBody.data[0].student.name).toBe('Student One');
      expect(resBody.data[0].student.email).toBe('student1@university.edu');
    });
  });

  describe('Cross-Professor Horizontal Authorization & Access Control', () => {
    let courseBId: mongoose.Types.ObjectId;
    let examBId: mongoose.Types.ObjectId;
    const professorBId = new mongoose.Types.ObjectId('000000000000000000000009');

    beforeEach(async () => {
      // Seed Professor B's Course
      const courseB = new Course({
        courseCode: 'CS102-B',
        courseName: 'Professor B Course',
        semester: 1,
        academicYear: '2026-2027',
        professor: professorBId,
        isActive: true
      });
      const savedCourseB = await courseB.save();
      courseBId = savedCourseB._id as mongoose.Types.ObjectId;

      // Seed Professor B's Exam
      const examB = new Exam({
        title: 'Professor B Exam',
        course: courseBId,
        createdBy: professorBId,
        examDate: new Date('2026-10-15T09:00:00.000Z'),
        totalMarks: 100,
        numberOfQuestions: 10,
        status: 'DRAFT',
        isActive: true
      });
      const savedExamB = await examB.save();
      examBId = savedExamB._id as mongoose.Types.ObjectId;

      // Authenticate as Professor A
      mockSessionUser = {
        id: professorId.toString(), // Professor A
        email: 'profA@university.edu',
        name: 'Professor A',
        role: UserRole.PROFESSOR,
      };
    });

    it("should return 404 when Professor A tries to GET Professor B's course by ID", async () => {
      const res = await courseDetailGET(
        new Request(`http://localhost:3000/api/courses/${courseBId}`),
        { params: Promise.resolve({ id: courseBId.toString() }) }
      );
      expect(res.status).toBe(404);
    });

    it("should return 404 when Professor A tries to PUT Professor B's course", async () => {
      const req = new Request(`http://localhost:3000/api/courses/${courseBId}`, {
        method: 'PUT',
        body: JSON.stringify({ courseName: 'Hacked Name' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await courseDetailPUT(
        req as any,
        { params: Promise.resolve({ id: courseBId.toString() }) }
      );
      expect(res.status).toBe(404);
    });

    it("should return 404 when Professor A tries to DELETE Professor B's course", async () => {
      const req = new Request(`http://localhost:3000/api/courses/${courseBId}`, {
        method: 'DELETE',
      });
      const res = await courseDetailDELETE(
        req as any,
        { params: Promise.resolve({ id: courseBId.toString() }) }
      );
      expect(res.status).toBe(404);
    });

    it("should return 404 when Professor A tries to GET Professor B's exam by ID", async () => {
      const res = await examDetailGET(
        new Request(`http://localhost:3000/api/exams/${examBId}`),
        { params: Promise.resolve({ id: examBId.toString() }) }
      );
      expect(res.status).toBe(404);
    });

    it("should return 404 when Professor A tries to PUT Professor B's exam", async () => {
      const req = new Request(`http://localhost:3000/api/exams/${examBId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: 'Hacked Title' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await examDetailPUT(
        req as any,
        { params: Promise.resolve({ id: examBId.toString() }) }
      );
      expect(res.status).toBe(404);
    });

    it("should return 404 when Professor A tries to DELETE Professor B's exam", async () => {
      const req = new Request(`http://localhost:3000/api/exams/${examBId}`, {
        method: 'DELETE',
      });
      const res = await examDetailDELETE(
        req as any,
        { params: Promise.resolve({ id: examBId.toString() }) }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('Student Draft Visibility & Course Deletion Guard & Exam Transitions', () => {
    it('should prevent students from viewing draft exams', async () => {
      // Authenticate as Student
      mockSessionUser = {
        id: testStudentId1,
        email: 'student1@university.edu',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      // Attempt to GET the draft exam testExamId
      const res = await examDetailGET(
        new Request(`http://localhost:3000/api/exams/${testExamId}`),
        { params: Promise.resolve({ id: testExamId.toString() }) }
      );
      expect(res.status).toBe(404);

      // Enroll student in the exam
      const mapping = new StudentMapping({
        exam: testExamId,
        student: new mongoose.Types.ObjectId(testStudentId1),
        anonymousId: 'ANON-TEST11',
        isVerified: true
      });
      await mapping.save();

      // Still should return 404 because it is in DRAFT status
      const resEnrolledDraft = await examDetailGET(
        new Request(`http://localhost:3000/api/exams/${testExamId}`),
        { params: Promise.resolve({ id: testExamId.toString() }) }
      );
      expect(resEnrolledDraft.status).toBe(404);

      // Now transition exam to PUBLISHED
      const dbExam = await Exam.findById(testExamId);
      dbExam!.status = 'PUBLISHED' as any;
      await dbExam!.save();

      // Now student should be able to view it
      const resEnrolledPublished = await examDetailGET(
        new Request(`http://localhost:3000/api/exams/${testExamId}`),
        { params: Promise.resolve({ id: testExamId.toString() }) }
      );
      expect(resEnrolledPublished.status).toBe(200);
    });

    it('should prevent deleting a course if active exams still reference it', async () => {
      // Authenticate as Professor
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@university.edu',
        name: 'Professor User',
        role: UserRole.PROFESSOR,
      };

      const req = new Request(`http://localhost:3000/api/courses/${testCourseId}`, {
        method: 'DELETE',
      });

      const res = await courseDetailDELETE(req as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toContain('Cannot delete course: active exams still reference it');

      // Now deactivate the exam
      const dbExam = await Exam.findById(testExamId);
      dbExam!.isActive = false;
      await dbExam!.save();

      // Deleting course should now succeed
      const resAfter = await courseDetailDELETE(req as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(resAfter.status).toBe(200);
    });

    it('should prevent invalid exam status transitions', async () => {
      // Authenticate as Professor
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@university.edu',
        name: 'Professor User',
        role: UserRole.PROFESSOR,
      };

      // testExamId is currently DRAFT. Try to transition directly to PUBLISHED (invalid)
      const reqInvalid = new Request(`http://localhost:3000/api/exams/${testExamId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'PUBLISHED' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const resInvalid = await examDetailPUT(reqInvalid as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(resInvalid.status).toBe(400);
      const bodyInvalid = await resInvalid.json();
      expect(bodyInvalid.success).toBe(false);
      expect(bodyInvalid.message).toContain('Invalid status transition');

      // Try to transition to SCHEDULED (valid)
      const reqValid = new Request(`http://localhost:3000/api/exams/${testExamId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'SCHEDULED' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const resValid = await examDetailPUT(reqValid as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(resValid.status).toBe(200);
    });
  });
});
