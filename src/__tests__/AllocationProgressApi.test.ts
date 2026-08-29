/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AllocationService from '../services/AllocationService';

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

describe('Professor Progress Aggregation API Tests (AE-098)', () => {
  let progressGET: any;

  let prof: any;
  let admin: any;
  let ta1: any;
  let ta2: any;
  let student1: any;
  let student2: any;

  let course: any;
  let exam1: any;
  let exam2: any;

  let script1: any;
  let script2: any;
  let script3: any;
  let script4: any;

  beforeAll(async () => {
    progressGET = (await import('../app/api/exams/[id]/progress/route')).GET;
  });

  beforeEach(async () => {
    await Allocation.deleteMany({});
    await AnswerScript.deleteMany({});
    await Exam.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    // Create Users
    prof = await User.create({
      name: 'Professor Snape',
      email: 'snape@hogwarts.edu',
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true
    });

    admin = await User.create({
      name: 'Admin Albus',
      email: 'albus@hogwarts.edu',
      password: 'password123',
      role: UserRole.ADMIN,
      isActive: true
    });

    ta1 = await User.create({
      name: 'Hermione Granger',
      email: 'hermione@hogwarts.edu',
      password: 'password123',
      role: UserRole.TA,
      isActive: true
    });

    ta2 = await User.create({
      name: 'Ron Weasley',
      email: 'ron@hogwarts.edu',
      password: 'password123',
      role: UserRole.TA,
      isActive: true
    });

    student1 = await User.create({
      name: 'Harry Potter',
      email: 'harry@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    student2 = await User.create({
      name: 'Draco Malfoy',
      email: 'draco@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    const student3 = await User.create({
      name: 'Neville Longbottom',
      email: 'neville@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    // Create Course
    course = await Course.create({
      courseCode: 'POT101',
      courseName: 'Potions',
      semester: 1,
      academicYear: '2026-2027',
      professor: prof._id,
      teachingAssistants: [ta1._id, ta2._id],
      enrolledStudents: [student1._id, student2._id, student3._id],
      isActive: true
    });

    // Create Exams
    exam1 = await Exam.create({
      title: 'Potions Midterm',
      course: course._id,
      status: ExamStatus.PUBLISHED,
      createdBy: prof._id,
      examDate: new Date(),
      totalMarks: 100,
      numberOfQuestions: 3
    });

    exam2 = await Exam.create({
      title: 'Potions Final',
      course: course._id,
      status: ExamStatus.PUBLISHED,
      createdBy: prof._id,
      examDate: new Date(),
      totalMarks: 100,
      numberOfQuestions: 1
    });

    // Create AnswerScripts
    script1 = await AnswerScript.create({
      exam: exam1._id,
      student: student1._id,
      filePath: '/scans/potions/script1.pdf',
      filename: 'script1.pdf',
      startPageNumber: 1,
      endPageNumber: 4,
      pageCount: 4,
      isActive: true
    });

    script2 = await AnswerScript.create({
      exam: exam1._id,
      student: student2._id,
      filePath: '/scans/potions/script2.pdf',
      filename: 'script2.pdf',
      startPageNumber: 5,
      endPageNumber: 8,
      pageCount: 4,
      isActive: true
    });

    script3 = await AnswerScript.create({
      exam: exam2._id,
      student: student1._id,
      filePath: '/scans/potions/script3.pdf',
      filename: 'script3.pdf',
      startPageNumber: 9,
      endPageNumber: 12,
      pageCount: 4,
      isActive: true
    });

    script4 = await AnswerScript.create({
      exam: exam1._id,
      student: student3._id,
      filePath: '/scans/potions/script4.pdf',
      filename: 'script4.pdf',
      startPageNumber: 13,
      endPageNumber: 16,
      pageCount: 4,
      isActive: true
    });

    // Default auth as Professor
    mockSessionUser = {
      id: prof._id.toString(),
      email: prof.email,
      name: prof.name,
      role: UserRole.PROFESSOR
    };
  });

  describe('1. Authorization & Role Checks', () => {
    it('allows a Professor to retrieve progress', async () => {
      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`),
        { params: Promise.resolve({ id: exam1._id.toString() }) }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.examId).toBe(exam1._id.toString());
    });

    it('allows an Admin to retrieve progress', async () => {
      mockSessionUser = {
        id: admin._id.toString(),
        email: admin.email,
        name: admin.name,
        role: UserRole.ADMIN
      };

      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`),
        { params: Promise.resolve({ id: exam1._id.toString() }) }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
    });

    it('rejects a TA with 403 Forbidden', async () => {
      mockSessionUser = {
        id: ta1._id.toString(),
        email: ta1.email,
        name: ta1.name,
        role: UserRole.TA
      };

      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`),
        { params: Promise.resolve({ id: exam1._id.toString() }) }
      );
      expect(res.status).toBe(403);
    });

    it('rejects a Student with 403 Forbidden', async () => {
      mockSessionUser = {
        id: student1._id.toString(),
        email: student1.email,
        name: student1.name,
        role: UserRole.STUDENT
      };

      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`),
        { params: Promise.resolve({ id: exam1._id.toString() }) }
      );
      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      mockSessionUser = null;

      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`),
        { params: Promise.resolve({ id: exam1._id.toString() }) }
      );
      expect(res.status).toBe(401);
    });
  });

  describe('2. Validation & Error Handling', () => {
    it('returns 400 Bad Request for invalid Exam ID format', async () => {
      const res = await progressGET(
        new NextRequest('http://localhost:3000/api/exams/invalid-id/progress'),
        { params: Promise.resolve({ id: 'invalid-id' }) }
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('Invalid ID format');
    });

    it('returns 404 Not Found when the exam does not exist', async () => {
      const nonExistentId = '000000000000000000000999';
      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${nonExistentId}/progress`),
        { params: Promise.resolve({ id: nonExistentId }) }
      );
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('Exam not found');
    });
  });

  describe('3. Progress Aggregation Logic', () => {
    it('correctly aggregates multiple TAs with COMPLETED vs non-COMPLETED counts (whole-script)', async () => {
      // ta1: 2 completed, 1 in progress (total 3)
      await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL
      });
      await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script2._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL
      });
      await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script4._id,
        allocatedBy: prof._id,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL
      });

      // ta2: 0 completed, 1 pending (total 1)
      await Allocation.create({
        exam: exam1._id,
        ta: ta2._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.PENDING,
        rule: AllocationRule.EQUAL
      });

      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`),
        { params: Promise.resolve({ id: exam1._id.toString() }) }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      const data = body.data;
      expect(data.total).toBe(4);
      expect(data.graded).toBe(2);

      const ta1Progress = data.progress.find((p: any) => p.taId === ta1._id.toString());
      expect(ta1Progress).toBeDefined();
      expect(ta1Progress.name).toBe('Hermione Granger');
      expect(ta1Progress.email).toBeUndefined();
      expect(ta1Progress.graded).toBe(2);
      expect(ta1Progress.total).toBe(3);

      const ta2Progress = data.progress.find((p: any) => p.taId === ta2._id.toString());
      expect(ta2Progress).toBeDefined();
      expect(ta2Progress.name).toBe('Ron Weasley');
      expect(ta2Progress.email).toBeUndefined();
      expect(ta2Progress.graded).toBe(0);
      expect(ta2Progress.total).toBe(1);
    });

    it('correctly aggregates question-wise allocations', async () => {
      // ta1: Q1 completed, Q2 in_progress (total 2, graded 1)
      await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.QUESTION,
        question: 1
      });
      await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.QUESTION,
        question: 2
      });

      // ta2: Q3 pending (total 1, graded 0)
      await Allocation.create({
        exam: exam1._id,
        ta: ta2._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.PENDING,
        rule: AllocationRule.QUESTION,
        question: 3
      });

      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`),
        { params: Promise.resolve({ id: exam1._id.toString() }) }
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.total).toBe(3);
      expect(body.data.graded).toBe(1);
    });

    it('scopes aggregation strictly to the requested exam', async () => {
      // Allocations for exam1
      await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL
      });

      // Allocations for exam2 (must not be included in exam1 results)
      await Allocation.create({
        exam: exam2._id,
        ta: ta1._id,
        answerScript: script3._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL
      });
      await Allocation.create({
        exam: exam2._id,
        ta: ta2._id,
        answerScript: script3._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL
      });

      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`),
        { params: Promise.resolve({ id: exam1._id.toString() }) }
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.data.examId).toBe(exam1._id.toString());
      expect(body.data.total).toBe(1);
      expect(body.data.graded).toBe(1);
    });

    it('handles zero-completion case (all PENDING or IN_PROGRESS)', async () => {
      await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.PENDING,
        rule: AllocationRule.EQUAL
      });
      await Allocation.create({
        exam: exam1._id,
        ta: ta2._id,
        answerScript: script2._id,
        allocatedBy: prof._id,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL
      });

      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`),
        { params: Promise.resolve({ id: exam1._id.toString() }) }
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.data.total).toBe(2);
      expect(body.data.graded).toBe(0);
      expect(body.data.progress[0].graded).toBe(0);
      expect(body.data.progress[1].graded).toBe(0);
    });

    it('handles zero-allocation case (exam with no allocations)', async () => {
      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`),
        { params: Promise.resolve({ id: exam1._id.toString() }) }
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.data.total).toBe(0);
      expect(body.data.graded).toBe(0);
      expect(body.data.progress).toEqual([]);
    });

    it('does not expose student PII in the response', async () => {
      await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL
      });

      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/progress`),
        { params: Promise.resolve({ id: exam1._id.toString() }) }
      );
      const text = await res.text();

      // Ensure student names/PII/IDs are not leaked in the payload
      expect(text).not.toContain('Harry Potter');
      expect(text).not.toContain('harry@hogwarts.edu');
      expect(text).not.toContain(student1._id.toString());
      expect(text).not.toContain('script1.pdf');
      expect(text).not.toContain('/scans/potions');
    });

    it('executes MongoDB aggregation pipeline rather than loading allocations into memory', async () => {
      await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL
      });

      const aggregateSpy = vi.spyOn(Allocation, 'aggregate');
      const findSpy = vi.spyOn(Allocation, 'find');

      await AllocationService.getProgress(exam1._id.toString());

      expect(aggregateSpy).toHaveBeenCalledTimes(1);
      const pipeline = aggregateSpy.mock.calls[0][0] as any[];
      expect(pipeline.some(stage => stage.$match !== undefined)).toBe(true);
      expect(pipeline.some(stage => stage.$group !== undefined)).toBe(true);
      expect(findSpy).not.toHaveBeenCalled();

      aggregateSpy.mockRestore();
      findSpy.mockRestore();
    });

    it('reflects completions performed via AllocationService.markCompleted()', async () => {
      const alloc = await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL
      });

      // Before markCompleted
      let progress = await AllocationService.getProgress(exam1._id.toString());
      expect(progress.graded).toBe(0);
      expect(progress.total).toBe(1);

      // Execute markCompleted
      await AllocationService.markCompleted(alloc._id.toString(), {
        actingUserId: ta1._id.toString(),
        actingUserRole: UserRole.TA
      });

      // After markCompleted
      progress = await AllocationService.getProgress(exam1._id.toString());
      expect(progress.graded).toBe(1);
      expect(progress.total).toBe(1);
    });
  });
});
