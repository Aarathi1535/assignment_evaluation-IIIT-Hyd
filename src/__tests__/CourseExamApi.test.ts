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

    it('should return 409 when creating a course with a duplicate courseCode', async () => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@university.edu',
        name: 'Professor User',
        role: UserRole.PROFESSOR,
      };

      const payload = {
        courseCode: 'CS101', // already seeded in beforeEach
        courseName: 'Another CS',
        semester: '2',
        academicYear: '2026-2027',
      };

      const req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await coursesPOST(req as any);
      expect(res.status).toBe(409);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toBe('Course code already exists');
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

    it('should return 409 when updating a course to a duplicate courseCode', async () => {
      // Seed another course
      const otherCourse = new Course({
        courseCode: 'CS103',
        courseName: 'Other Course',
        semester: 1,
        academicYear: '2026-2027',
        professor: professorId,
        isActive: true
      });
      await otherCourse.save();

      const req = new Request(`http://localhost:3000/api/courses/${testCourseId}`, {
        method: 'PUT',
        body: JSON.stringify({ courseCode: 'CS103' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await courseDetailPUT(req as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(res.status).toBe(409);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toBe('Course code already exists');
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
      const logs = await AuditLog.find({ entityId: testCourseId, action: 'STUDENTS_ENROLLED_TO_COURSE' });
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
      const logs = await AuditLog.find({ entityId: testExamId, action: 'STUDENTS_ENROLLED_TO_EXAM' });
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

      const dbExam = await Exam.findById(testExamId);
      expect(dbExam!.enrolledStudents!.length).toBe(2); // Verify no duplicates in the array
    });

    it('should prevent duplicate course enrollments', async () => {
      // First enrollment
      const req1 = new Request(`http://localhost:3000/api/courses/${testCourseId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ studentIds: [testStudentId1] }),
        headers: { 'Content-Type': 'application/json' },
      });
      await courseEnrollPOST(req1 as any, { params: Promise.resolve({ id: testCourseId.toString() }) });

      // Second enrollment with duplicate student ID
      const req2 = new Request(`http://localhost:3000/api/courses/${testCourseId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ studentIds: [testStudentId1, testStudentId2] }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await courseEnrollPOST(req2 as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(res.status).toBe(200);

      const dbCourse = await Course.findById(testCourseId);
      expect(dbCourse!.enrolledStudents!.length).toBe(2); // Verify no duplicates in the array
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
      expect(resBody.data[0].id).toBe(testStudentId1);
      expect(resBody.data[0].name).toBe('Student One');
      expect(resBody.data[0].email).toBe('student1@university.edu');
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

    it("should return 404 when Professor A tries to create an exam on Professor B's course", async () => {
      const req = new Request('http://localhost:3000/api/exams', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Exam on B Course',
          course: courseBId.toString(),
          examDate: '2026-10-15T09:00:00.000Z',
          totalMarks: 100,
          numberOfQuestions: 10
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await examsPOST(req as any);
      expect(res.status).toBe(404);
    });

    it("should return 404 when Professor A tries to move an existing exam onto Professor B's course", async () => {
      const req = new Request(`http://localhost:3000/api/exams/${testExamId}`, {
        method: 'PUT',
        body: JSON.stringify({ course: courseBId.toString() }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await examDetailPUT(req as any, { params: Promise.resolve({ id: testExamId.toString() }) });
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

  describe('Student Enrollment Tests (AE-036)', () => {
    beforeEach(() => {
      // Log in as Professor by default
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@university.edu',
        name: 'Professor User',
        role: UserRole.PROFESSOR,
      };
    });

    it('should successfully enroll students to course and exam', async () => {
      // 1. Course Enrollment
      const payload = {
        studentIds: [testStudentId1, testStudentId2]
      };
      const reqCourse = new Request(`http://localhost:3000/api/courses/${testCourseId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const resCourse = await courseEnrollPOST(reqCourse as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(resCourse.status).toBe(200);
      const bodyCourse = await resCourse.json();
      expect(bodyCourse.success).toBe(true);

      const dbCourse = await Course.findById(testCourseId);
      expect(dbCourse!.enrolledStudents!.map(id => id.toString())).toContain(testStudentId1);
      expect(dbCourse!.enrolledStudents!.map(id => id.toString())).toContain(testStudentId2);

      // Verify audit log
      const auditCourse = await AuditLog.find({ action: 'STUDENTS_ENROLLED_TO_COURSE', outcome: 'SUCCESS' });
      expect(auditCourse.length).toBe(1);
      expect(auditCourse[0].entityId!.toString()).toBe(testCourseId.toString());

      // 2. Exam Enrollment
      const reqExam = new Request(`http://localhost:3000/api/exams/${testExamId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const resExam = await examEnrollPOST(reqExam as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(resExam.status).toBe(200);
      const bodyExam = await resExam.json();
      expect(bodyExam.success).toBe(true);

      const dbExam = await Exam.findById(testExamId);
      expect(dbExam!.enrolledStudents!.map(id => id.toString())).toContain(testStudentId1);
      expect(dbExam!.enrolledStudents!.map(id => id.toString())).toContain(testStudentId2);

      // Verify student mapping created
      const mappings = await StudentMapping.find({ exam: testExamId });
      expect(mappings.length).toBe(2);

      // Verify audit log
      const auditExam = await AuditLog.find({ action: 'STUDENTS_ENROLLED_TO_EXAM', outcome: 'SUCCESS' });
      expect(auditExam.length).toBe(1);
      expect(auditExam[0].entityId!.toString()).toBe(testExamId.toString());

      // 3. Exam Students GET
      const reqStudents = new Request(`http://localhost:3000/api/exams/${testExamId}/students`, {
        method: 'GET'
      });

      const resStudents = await examStudentsGET(reqStudents as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(resStudents.status).toBe(200);
      const bodyStudents = await resStudents.json();
      expect(bodyStudents.success).toBe(true);
      expect(bodyStudents.data.length).toBe(2);
      expect(bodyStudents.data[0]).toHaveProperty('id');
      expect(bodyStudents.data[0]).toHaveProperty('name');
      expect(bodyStudents.data[0]).toHaveProperty('email');
      expect(bodyStudents.data[0]).not.toHaveProperty('role'); // make sure only id, name, email are returned
    });

    it('should reject duplicate student IDs in payload', async () => {
      const payload = {
        studentIds: [testStudentId1, testStudentId1]
      };
      
      const reqCourse = new Request(`http://localhost:3000/api/courses/${testCourseId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const resCourse = await courseEnrollPOST(reqCourse as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(resCourse.status).toBe(400);

      const reqExam = new Request(`http://localhost:3000/api/exams/${testExamId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const resExam = await examEnrollPOST(reqExam as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(resExam.status).toBe(400);
    });

    it('should reject invalid student ID formats', async () => {
      const payload = {
        studentIds: ['invalid-id-format']
      };

      const reqCourse = new Request(`http://localhost:3000/api/courses/${testCourseId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const resCourse = await courseEnrollPOST(reqCourse as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(resCourse.status).toBe(400);
    });

    it('should reject inactive student enrollment', async () => {
      // Make student2 inactive
      await User.findByIdAndUpdate(testStudentId2, { isActive: false });

      const payload = {
        studentIds: [testStudentId1, testStudentId2]
      };

      const reqCourse = new Request(`http://localhost:3000/api/courses/${testCourseId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const resCourse = await courseEnrollPOST(reqCourse as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(resCourse.status).toBe(400);

      // Verify audit log failure
      const auditCourse = await AuditLog.find({ action: 'STUDENTS_ENROLLED_TO_COURSE', outcome: 'FAILURE' });
      expect(auditCourse.length).toBe(1);

      const reqExam = new Request(`http://localhost:3000/api/exams/${testExamId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const resExam = await examEnrollPOST(reqExam as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(resExam.status).toBe(400);

      // Verify audit log failure
      const auditExam = await AuditLog.find({ action: 'STUDENTS_ENROLLED_TO_EXAM', outcome: 'FAILURE' });
      expect(auditExam.length).toBe(1);
    });

    it('should prevent cross-professor access (404) for course/exam enrollment and roster retrieval', async () => {
      // Authenticate as another professor
      const otherProfId = new mongoose.Types.ObjectId('000000000000000000000099');
      mockSessionUser = {
        id: otherProfId.toString(),
        email: 'otherprof@university.edu',
        name: 'Other Professor',
        role: UserRole.PROFESSOR,
      };

      const payload = {
        studentIds: [testStudentId1]
      };

      // 1. Course Enroll
      const reqCourse = new Request(`http://localhost:3000/api/courses/${testCourseId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const resCourse = await courseEnrollPOST(reqCourse as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(resCourse.status).toBe(404);

      // Verify audit log failure
      const auditCourse = await AuditLog.find({ action: 'STUDENTS_ENROLLED_TO_COURSE', outcome: 'FAILURE' });
      expect(auditCourse.length).toBe(1);
      expect(auditCourse[0].details).toMatchObject({ reason: 'Ownership check failed' });

      // 2. Exam Enroll
      const reqExam = new Request(`http://localhost:3000/api/exams/${testExamId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const resExam = await examEnrollPOST(reqExam as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(resExam.status).toBe(404);

      // Verify audit log failure
      const auditExam = await AuditLog.find({ action: 'STUDENTS_ENROLLED_TO_EXAM', outcome: 'FAILURE' });
      expect(auditExam.length).toBe(1);
      expect(auditExam[0].details).toMatchObject({ reason: 'Ownership check failed' });

      // 3. Exam Students GET
      const reqStudents = new Request(`http://localhost:3000/api/exams/${testExamId}/students`, {
        method: 'GET'
      });
      const resStudents = await examStudentsGET(reqStudents as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(resStudents.status).toBe(404);
    });

    it('should enforce RBAC checks: Students and TAs must get 403 Forbidden', async () => {
      // 1. Authenticate as student
      mockSessionUser = {
        id: testStudentId1,
        email: 'student1@university.edu',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      const payload = {
        studentIds: [testStudentId2]
      };

      const reqCourseS = new Request(`http://localhost:3000/api/courses/${testCourseId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const resCourseS = await courseEnrollPOST(reqCourseS as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(resCourseS.status).toBe(403);

      const reqExamS = new Request(`http://localhost:3000/api/exams/${testExamId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const resExamS = await examEnrollPOST(reqExamS as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(resExamS.status).toBe(403);

      const reqStudentsS = new Request(`http://localhost:3000/api/exams/${testExamId}/students`, {
        method: 'GET'
      });
      const resStudentsS = await examStudentsGET(reqStudentsS as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(resStudentsS.status).toBe(403);

      // 2. Authenticate as TA
      const taId = new mongoose.Types.ObjectId('000000000000000000000010');
      mockSessionUser = {
        id: taId.toString(),
        email: 'ta@university.edu',
        name: 'TA User',
        role: UserRole.TA,
      };

      const reqCourseT = new Request(`http://localhost:3000/api/courses/${testCourseId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const resCourseT = await courseEnrollPOST(reqCourseT as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(resCourseT.status).toBe(403);

      const reqExamT = new Request(`http://localhost:3000/api/exams/${testExamId}/enroll`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const resExamT = await examEnrollPOST(reqExamT as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(resExamT.status).toBe(403);

      const reqStudentsT = new Request(`http://localhost:3000/api/exams/${testExamId}/students`, {
        method: 'GET'
      });
      const resStudentsT = await examStudentsGET(reqStudentsT as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(resStudentsT.status).toBe(403);
    });
  });

  describe('Validation and Edge Cases (AE-037)', () => {
    beforeEach(() => {
      // Set to Professor
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@university.edu',
        name: 'Professor User',
        role: UserRole.PROFESSOR,
      };
    });

    it('should reject invalid course creation payloads', async () => {
      // Missing courseCode
      const payload1 = {
        courseName: 'Test Course Name',
        semester: '1',
        academicYear: '2026-2027',
      };
      let req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify(payload1),
        headers: { 'Content-Type': 'application/json' },
      });
      let res = await coursesPOST(req as any);
      expect(res.status).toBe(400);

      // Invalid semester format (non-integer/negative)
      const payload2 = {
        courseCode: 'CS102',
        courseName: 'Test Course Name',
        semester: '-3',
        academicYear: '2026-2027',
      };
      req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify(payload2),
        headers: { 'Content-Type': 'application/json' },
      });
      res = await coursesPOST(req as any);
      expect(res.status).toBe(400);

      // Invalid academic year format
      const payload3 = {
        courseCode: 'CS102',
        courseName: 'Test Course Name',
        semester: '1',
        academicYear: '2026/2027',
      };
      req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify(payload3),
        headers: { 'Content-Type': 'application/json' },
      });
      res = await coursesPOST(req as any);
      expect(res.status).toBe(400);

      // Duplicate TAs
      const payload4 = {
        courseCode: 'CS102',
        courseName: 'Test Course Name',
        semester: '1',
        academicYear: '2026-2027',
        teachingAssistants: ['000000000000000000000010', '000000000000000000000010'],
      };
      req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify(payload4),
        headers: { 'Content-Type': 'application/json' },
      });
      res = await coursesPOST(req as any);
      expect(res.status).toBe(400);

      // Extra unknown fields (strict check)
      const payload5 = {
        courseCode: 'CS102',
        courseName: 'Test Course Name',
        semester: '1',
        academicYear: '2026-2027',
        unknownExtraField: 'someValue',
      };
      req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify(payload5),
        headers: { 'Content-Type': 'application/json' },
      });
      res = await coursesPOST(req as any);
      expect(res.status).toBe(400);
    });

    it('should reject invalid course update payloads', async () => {
      // Extra unknown fields (strict check)
      const payload = {
        extraField: 'notAllowed',
      };
      const req = new Request(`http://localhost:3000/api/courses/${testCourseId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await courseDetailPUT(req as any, { params: Promise.resolve({ id: testCourseId.toString() }) });
      expect(res.status).toBe(400);
    });

    it('should reject invalid exam creation payloads', async () => {
      // Invalid date format
      const payload1 = {
        title: 'Midterm Exam Title',
        course: testCourseId.toString(),
        examDate: 'not-a-date',
        totalMarks: 100,
        numberOfQuestions: 10,
      };
      let req = new Request('http://localhost:3000/api/exams', {
        method: 'POST',
        body: JSON.stringify(payload1),
        headers: { 'Content-Type': 'application/json' },
      });
      let res = await examsPOST(req as any);
      expect(res.status).toBe(400);

      // Negative marks
      const payload2 = {
        title: 'Midterm Exam Title',
        course: testCourseId.toString(),
        examDate: '2026-08-10',
        totalMarks: -5,
        numberOfQuestions: 10,
      };
      req = new Request('http://localhost:3000/api/exams', {
        method: 'POST',
        body: JSON.stringify(payload2),
        headers: { 'Content-Type': 'application/json' },
      });
      res = await examsPOST(req as any);
      expect(res.status).toBe(400);

      // Float number of questions
      const payload3 = {
        title: 'Midterm Exam Title',
        course: testCourseId.toString(),
        examDate: '2026-08-10',
        totalMarks: 100,
        numberOfQuestions: 10.5,
      };
      req = new Request('http://localhost:3000/api/exams', {
        method: 'POST',
        body: JSON.stringify(payload3),
        headers: { 'Content-Type': 'application/json' },
      });
      res = await examsPOST(req as any);
      expect(res.status).toBe(400);

      // Extra unknown fields
      const payload4 = {
        title: 'Midterm Exam Title',
        course: testCourseId.toString(),
        examDate: '2026-08-10',
        totalMarks: 100,
        numberOfQuestions: 10,
        someExtraParam: true,
      };
      req = new Request('http://localhost:3000/api/exams', {
        method: 'POST',
        body: JSON.stringify(payload4),
        headers: { 'Content-Type': 'application/json' },
      });
      res = await examsPOST(req as any);
      expect(res.status).toBe(400);
    });

    it('should reject invalid exam update payloads', async () => {
      // Extra unknown fields
      const payload = {
        extraParam: 'val',
      };
      const req = new Request(`http://localhost:3000/api/exams/${testExamId}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await examDetailPUT(req as any, { params: Promise.resolve({ id: testExamId.toString() }) });
      expect(res.status).toBe(400);
    });

    it('should reject invalid ObjectIds in URL paths with 400', async () => {
      const invalidId = 'invalid-id-123';

      // Course GET
      let req = new Request(`http://localhost:3000/api/courses/${invalidId}`);
      let res = await courseDetailGET(req as any, { params: Promise.resolve({ id: invalidId }) });
      expect(res.status).toBe(400);

      // Course PUT
      req = new Request(`http://localhost:3000/api/courses/${invalidId}`, {
        method: 'PUT',
        body: JSON.stringify({ courseName: 'New Name' }),
        headers: { 'Content-Type': 'application/json' },
      });
      res = await courseDetailPUT(req as any, { params: Promise.resolve({ id: invalidId }) });
      expect(res.status).toBe(400);

      // Course DELETE
      req = new Request(`http://localhost:3000/api/courses/${invalidId}`, { method: 'DELETE' });
      res = await courseDetailDELETE(req as any, { params: Promise.resolve({ id: invalidId }) });
      expect(res.status).toBe(400);

      // Course Enroll
      req = new Request(`http://localhost:3000/api/courses/${invalidId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ studentIds: [] }),
        headers: { 'Content-Type': 'application/json' },
      });
      res = await courseEnrollPOST(req as any, { params: Promise.resolve({ id: invalidId }) });
      expect(res.status).toBe(400);

      // Exam GET
      req = new Request(`http://localhost:3000/api/exams/${invalidId}`);
      res = await examDetailGET(req as any, { params: Promise.resolve({ id: invalidId }) });
      expect(res.status).toBe(400);

      // Exam PUT
      req = new Request(`http://localhost:3000/api/exams/${invalidId}`, {
        method: 'PUT',
        body: JSON.stringify({ title: 'New Exam Title' }),
        headers: { 'Content-Type': 'application/json' },
      });
      res = await examDetailPUT(req as any, { params: Promise.resolve({ id: invalidId }) });
      expect(res.status).toBe(400);

      // Exam DELETE
      req = new Request(`http://localhost:3000/api/exams/${invalidId}`, { method: 'DELETE' });
      res = await examDetailDELETE(req as any, { params: Promise.resolve({ id: invalidId }) });
      expect(res.status).toBe(400);

      // Exam Enroll
      req = new Request(`http://localhost:3000/api/exams/${invalidId}/enroll`, {
        method: 'POST',
        body: JSON.stringify({ studentIds: [] }),
        headers: { 'Content-Type': 'application/json' },
      });
      res = await examEnrollPOST(req as any, { params: Promise.resolve({ id: invalidId }) });
      expect(res.status).toBe(400);

      // Exam Students
      req = new Request(`http://localhost:3000/api/exams/${invalidId}/students`);
      res = await examStudentsGET(req as any, { params: Promise.resolve({ id: invalidId }) });
      expect(res.status).toBe(400);
    });
  });

  describe('Harden authorization scoping tests', () => {
    it('Student GET non-enrolled course -> 404', async () => {
      mockSessionUser = {
        id: testStudentId1,
        email: 'student1@university.edu',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      const res = await courseDetailGET(
        new Request('http://localhost:3000/api/courses/' + testCourseId),
        { params: Promise.resolve({ id: testCourseId.toString() }) }
      );
      expect(res.status).toBe(404);
    });

    it('Student GET non-enrolled exam -> 404', async () => {
      mockSessionUser = {
        id: testStudentId1,
        email: 'student1@university.edu',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      const res = await examDetailGET(
        new Request('http://localhost:3000/api/exams/' + testExamId),
        { params: Promise.resolve({ id: testExamId.toString() }) }
      );
      expect(res.status).toBe(404);
    });

    it('TA GET unrelated course -> 404', async () => {
      const taId = new mongoose.Types.ObjectId('000000000000000000000010');
      mockSessionUser = {
        id: taId.toString(),
        email: 'ta@university.edu',
        name: 'TA User',
        role: UserRole.TA,
      };

      const res = await courseDetailGET(
        new Request('http://localhost:3000/api/courses/' + testCourseId),
        { params: Promise.resolve({ id: testCourseId.toString() }) }
      );
      expect(res.status).toBe(404);
    });

    it('TA GET unrelated draft exam -> 404', async () => {
      const taId = new mongoose.Types.ObjectId('000000000000000000000010');
      mockSessionUser = {
        id: taId.toString(),
        email: 'ta@university.edu',
        name: 'TA User',
        role: UserRole.TA,
      };

      const res = await examDetailGET(
        new Request('http://localhost:3000/api/exams/' + testExamId),
        { params: Promise.resolve({ id: testExamId.toString() }) }
      );
      expect(res.status).toBe(404);
    });
  });

  describe('AE-040 Restricting enrolledStudents Roster from Students', () => {
    beforeEach(async () => {
      // Enroll a student in the test course
      await Course.findByIdAndUpdate(testCourseId, {
        $push: { enrolledStudents: new mongoose.Types.ObjectId(testStudentId1) }
      });
    });

    it('should allow Professor to receive the full enrolledStudents roster when reading course details', async () => {
      mockSessionUser = {
        id: professorId.toString(),
        email: 'prof@university.edu',
        name: 'Professor User',
        role: UserRole.PROFESSOR,
      };

      // Retrieve course detail
      const resDetail = await courseDetailGET(
        new Request(`http://localhost:3000/api/courses/${testCourseId}`),
        { params: Promise.resolve({ id: testCourseId.toString() }) }
      );
      expect(resDetail.status).toBe(200);
      const bodyDetail = await resDetail.json();
      expect(bodyDetail.success).toBe(true);
      expect(bodyDetail.data.enrolledStudents).toBeDefined();
      expect(bodyDetail.data.enrolledStudents.length).toBe(1);
      expect(bodyDetail.data.enrolledStudents[0]._id).toBe(testStudentId1);

      // Retrieve all courses
      const resAll = await coursesGET();
      expect(resAll.status).toBe(200);
      const bodyAll = await resAll.json();
      expect(bodyAll.success).toBe(true);
      const matched = bodyAll.data.find((c: any) => c._id === testCourseId.toString());
      expect(matched.enrolledStudents).toBeDefined();
    });

    it('should project away/remove enrolledStudents field when the acting user is a STUDENT', async () => {
      mockSessionUser = {
        id: testStudentId1,
        email: 'student1@university.edu',
        name: 'Student One',
        role: UserRole.STUDENT,
      };

      // Retrieve course detail as student
      const resDetail = await courseDetailGET(
        new Request(`http://localhost:3000/api/courses/${testCourseId}`),
        { params: Promise.resolve({ id: testCourseId.toString() }) }
      );
      expect(resDetail.status).toBe(200);
      const bodyDetail = await resDetail.json();
      expect(bodyDetail.success).toBe(true);
      // The enrolledStudents field should be undefined or not present
      expect(bodyDetail.data.enrolledStudents).toBeUndefined();

      // Retrieve all courses as student
      const resAll = await coursesGET();
      expect(resAll.status).toBe(200);
      const bodyAll = await resAll.json();
      expect(bodyAll.success).toBe(true);
      const matched = bodyAll.data.find((c: any) => c._id === testCourseId.toString());
      expect(matched.enrolledStudents).toBeUndefined();
    });
  });
});
