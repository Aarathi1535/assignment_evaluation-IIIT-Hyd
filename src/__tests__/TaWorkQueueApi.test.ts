/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import StudentMapping from '../models/StudentMapping';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';

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

describe('TA Work Queue API Tests (AE-094)', () => {
  let allocationsGET: any;

  // DB entities
  let course: any;
  let examBlind: any;
  let examNonBlind: any;
  
  let taUser1: any;
  let taUser2: any;
  let profUser: any;
  let studentUser1: any;
  let studentUser2: any;

  let script1: any;
  let script2: any;
  let script3: any;

  let allocWholeScript: any;
  let allocQuestionWise: any;
  let allocOtherTa: any;

  beforeAll(async () => {
    // Import API route handler
    allocationsGET = (await import('../app/api/allocations/route')).GET;

    // Set HMAC secret environment variables for anonymizer
    process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'test-storage-hmac-secret-32-chars';
    process.env.ANONYMIZED_REFERENCE_HMAC_SECRET = 'test-anonymized-hmac-secret-32-chars';
  });

  beforeEach(async () => {
    // Clear collections
    await User.deleteMany({});
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await AnswerScript.deleteMany({});
    await StudentMapping.deleteMany({});
    await Allocation.deleteMany({});

    // Create users first
    profUser = await User.create({
      name: 'Professor Severus',
      email: 'severus@hogwarts.edu',
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true
    });

    taUser1 = await User.create({
      name: 'Hermione Granger',
      email: 'hermione@hogwarts.edu',
      password: 'password123',
      role: UserRole.TA,
      isActive: true
    });

    taUser2 = await User.create({
      name: 'Ron Weasley',
      email: 'ron@hogwarts.edu',
      password: 'password123',
      role: UserRole.TA,
      isActive: true
    });

    studentUser1 = await User.create({
      name: 'Harry Potter',
      email: 'harry@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    studentUser2 = await User.create({
      name: 'Draco Malfoy',
      email: 'draco@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    // Create course with correct fields
    course = await Course.create({
      courseCode: 'CS101',
      courseName: 'Introduction to Computer Science',
      semester: 1,
      academicYear: '2026-2027',
      professor: profUser._id,
      teachingAssistants: [taUser1._id, taUser2._id],
      enrolledStudents: [studentUser1._id, studentUser2._id],
      isActive: true
    });

    // Create Exams (one blind, one non-blind)
    examBlind = await Exam.create({
      title: 'Potions Midterm',
      course: course._id,
      status: ExamStatus.PUBLISHED,
      blindGrading: true,
      numberOfQuestions: 5,
      createdBy: profUser._id,
      examDate: new Date(),
      totalMarks: 100
    });

    examNonBlind = await Exam.create({
      title: 'Charms Quiz',
      course: course._id,
      status: ExamStatus.PUBLISHED,
      blindGrading: false,
      numberOfQuestions: 3,
      createdBy: profUser._id,
      examDate: new Date(),
      totalMarks: 100
    });

    // Create Student Mappings
    await StudentMapping.create({
      exam: examBlind._id,
      student: studentUser1._id,
      anonymousId: 'ANON-POTTER-777'
    });

    await StudentMapping.create({
      exam: examBlind._id,
      student: studentUser2._id,
      anonymousId: 'ANON-MALFOY-888'
    });

    // Create AnswerScripts
    script1 = await AnswerScript.create({
      exam: examBlind._id,
      student: studentUser1._id,
      filePath: '/scans/potions/script1.pdf',
      filename: 'script1.pdf',
      startPageNumber: 1,
      endPageNumber: 4,
      pageCount: 4,
      isActive: true,
      candidateStudentId: `CAND-${studentUser1._id}`,
      qrStudentId: 'QR-POTTER',
      omrStudentId: 'OMR-POTTER'
    });

    script2 = await AnswerScript.create({
      exam: examNonBlind._id,
      student: studentUser1._id,
      filePath: '/scans/charms/script2.pdf',
      filename: 'script2.pdf',
      startPageNumber: 1,
      endPageNumber: 2,
      pageCount: 2,
      isActive: true,
      candidateStudentId: `CAND-${studentUser1._id}`
    });

    script3 = await AnswerScript.create({
      exam: examBlind._id,
      student: studentUser2._id,
      filePath: '/scans/potions/script3.pdf',
      filename: 'script3.pdf',
      startPageNumber: 1,
      endPageNumber: 4,
      pageCount: 4,
      isActive: true,
      candidateStudentId: `CAND-${studentUser2._id}`,
      qrStudentId: 'QR-MALFOY',
      omrStudentId: 'OMR-MALFOY'
    });

    // Create Allocations
    // 1. Whole-script allocation for TA1 (Exam 1 - Blind)
    allocWholeScript = await Allocation.create({
      exam: examBlind._id,
      ta: taUser1._id,
      answerScript: script1._id,
      allocatedBy: profUser._id,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.EQUAL
    });

    // 2. Question-wise allocation for TA1 (Exam 2 - Non-Blind)
    allocQuestionWise = await Allocation.create({
      exam: examNonBlind._id,
      ta: taUser1._id,
      answerScript: script2._id,
      allocatedBy: profUser._id,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 2
    });

    // 3. Allocation belonging to TA2 (Ron)
    allocOtherTa = await Allocation.create({
      exam: examBlind._id,
      ta: taUser2._id,
      answerScript: script3._id,
      allocatedBy: profUser._id,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.EQUAL
    });
  });

  describe('Authorization & Permissions', () => {
    it('should reject unauthenticated requests with 401 Unauthorized', async () => {
      mockSessionUser = null;
      const req = new Request('http://localhost:3000/api/allocations');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toBe('Unauthorized');
    });

    it('should reject student access with 403 Forbidden', async () => {
      mockSessionUser = {
        id: studentUser1._id.toString(),
        email: studentUser1.email,
        name: studentUser1.name,
        role: UserRole.STUDENT
      };
      const req = new Request('http://localhost:3000/api/allocations');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toBe('Forbidden');
    });

    it('should reject professor access with 403 Forbidden (since they do not grade assigned scripts)', async () => {
      mockSessionUser = {
        id: profUser._id.toString(),
        email: profUser.email,
        name: profUser.name,
        role: UserRole.PROFESSOR
      };
      const req = new Request('http://localhost:3000/api/allocations');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(403);
    });
  });

  describe('Work-Queue Retrieval', () => {
    beforeEach(() => {
      mockSessionUser = {
        id: taUser1._id.toString(),
        email: taUser1.email,
        name: taUser1.name,
        role: UserRole.TA
      };
    });

    it('should return only allocations belonging to the authenticated TA across all exams when no examId is supplied', async () => {
      const req = new Request('http://localhost:3000/api/allocations');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.allocations).toHaveLength(2);

      // Verify Ron's (TA2) allocation is never returned
      const returnedIds = body.data.allocations.map((a: any) => a._id);
      expect(returnedIds).toContain(allocWholeScript._id.toString());
      expect(returnedIds).toContain(allocQuestionWise._id.toString());
      expect(returnedIds).not.toContain(allocOtherTa._id.toString());
    });

    it('should support optional examId query filtering and return only allocations for that exam', async () => {
      // Filter for Potions Midterm (Blind)
      const req = new Request(`http://localhost:3000/api/allocations?examId=${examBlind._id.toString()}`);
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.allocations).toHaveLength(1);
      expect(body.data.allocations[0]._id).toBe(allocWholeScript._id.toString());
    });

    it('should return 400 Bad Request when an invalid examId format is supplied', async () => {
      const req = new Request('http://localhost:3000/api/allocations?examId=invalid-id');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('Invalid Exam ID format');
    });

    it('should return question-wise allocation context (question number) correctly', async () => {
      const req = new Request(`http://localhost:3000/api/allocations?examId=${examNonBlind._id.toString()}`);
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.allocations[0].question).toBe(2);
      expect(body.data.allocations[0].status).toBe(AllocationStatus.IN_PROGRESS);
    });

    it('should run answer scripts through the anonymizer and return blind-mode allowlisted output for blind-graded exams', async () => {
      const req = new Request(`http://localhost:3000/api/allocations?examId=${examBlind._id.toString()}`);
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      const scriptData = body.data.allocations[0].answerScript;

      expect(scriptData).toBeDefined();
      expect(scriptData.anonymousId).toBe('ANON-POTTER-777');
      expect(scriptData.scriptReference).toBe('Script #ANON-POTTER-777');

      // Verify strict allowlist mapping (PII fields omitted)
      const allowedKeys = [
        '_id',
        'exam',
        'anonymousId',
        'scriptReference',
        'startPageNumber',
        'endPageNumber',
        'pageCount',
        'isActive',
        'createdAt',
        'updatedAt'
      ];
      expect(Object.keys(scriptData).sort()).toEqual(allowedKeys.sort());

      // Explicitly check for absence of PII
      expect(scriptData.student).toBeUndefined();
      expect(scriptData.filePath).toBeUndefined();
      expect(scriptData.filename).toBeUndefined();
      expect(scriptData.qrStudentId).toBeUndefined();
      expect(scriptData.omrStudentId).toBeUndefined();
      expect(scriptData.candidateStudentId).toBeUndefined();
    });

    it('should return un-anonymized answer script details for non-blind exams', async () => {
      const req = new Request(`http://localhost:3000/api/allocations?examId=${examNonBlind._id.toString()}`);
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      const scriptData = body.data.allocations[0].answerScript;

      expect(scriptData).toBeDefined();
      // Non-blind allows full details
      expect(scriptData.student.toString()).toBe(studentUser1._id.toString());
      expect(scriptData.filePath).toBe('/scans/charms/script2.pdf');
      expect(scriptData.filename).toBe('script2.pdf');
      expect(scriptData.candidateStudentId).toBe(`CAND-${studentUser1._id}`);
    });

    it('should support mixed blind and non-blind exams in the list, resolving blind-grading per script/exam correctly', async () => {
      const req = new Request('http://localhost:3000/api/allocations');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.allocations).toHaveLength(2);

      const blindAlloc = body.data.allocations.find((a: any) => a._id === allocWholeScript._id.toString());
      const nonBlindAlloc = body.data.allocations.find((a: any) => a._id === allocQuestionWise._id.toString());

      // Blind checks
      expect(blindAlloc.answerScript.anonymousId).toBe('ANON-POTTER-777');
      expect(blindAlloc.answerScript.student).toBeUndefined();
      expect(blindAlloc.answerScript.filePath).toBeUndefined();

      // Non-blind checks
      expect(nonBlindAlloc.answerScript.student.toString()).toBe(studentUser1._id.toString());
      expect(nonBlindAlloc.answerScript.filePath).toBe('/scans/charms/script2.pdf');
    });
  });

  describe('Pagination & Validation', () => {
    beforeEach(() => {
      mockSessionUser = {
        id: taUser1._id.toString(),
        email: taUser1.email,
        name: taUser1.name,
        role: UserRole.TA
      };
    });

    it('should return default pagination when page and limit are omitted', async () => {
      const req = new Request('http://localhost:3000/api/allocations');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false
      });
      expect(body.data.allocations).toHaveLength(2);
    });

    it('should support explicit page and limit parameters', async () => {
      const req = new Request('http://localhost:3000/api/allocations?page=1&limit=1');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.pagination).toEqual({
        page: 1,
        limit: 1,
        total: 2,
        totalPages: 2,
        hasNextPage: true,
        hasPreviousPage: false
      });
      expect(body.data.allocations).toHaveLength(1);
    });

    it('should paginate correctly across multiple pages', async () => {
      // Page 1
      let req = new Request('http://localhost:3000/api/allocations?page=1&limit=1');
      let res = await allocationsGET(req as any);
      const body1 = await res.json();
      expect(body1.data.allocations).toHaveLength(1);
      const firstAllocId = body1.data.allocations[0]._id;

      // Page 2
      req = new Request('http://localhost:3000/api/allocations?page=2&limit=1');
      res = await allocationsGET(req as any);
      const body2 = await res.json();
      expect(body2.data.pagination).toEqual({
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true
      });
      expect(body2.data.allocations).toHaveLength(1);
      const secondAllocId = body2.data.allocations[0]._id;

      // Verify deterministic order pagination (different allocations)
      expect(firstAllocId).not.toBe(secondAllocId);
    });

    it('should reject invalid page parameter with 400 Bad Request', async () => {
      const invalidPages = ['0', '-1', 'abc', '1.5', 'NaN', ''];
      for (const p of invalidPages) {
        const req = new Request(`http://localhost:3000/api/allocations?page=${p}`);
        const res = await allocationsGET(req as any);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toContain('Invalid page parameter');
      }
    });

    it('should reject invalid limit parameter with 400 Bad Request', async () => {
      const invalidLimits = ['0', '-5', 'xyz', '2.5', 'NaN', ''];
      for (const l of invalidLimits) {
        const req = new Request(`http://localhost:3000/api/allocations?limit=${l}`);
        const res = await allocationsGET(req as any);
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toContain('Invalid limit parameter');
      }
    });

    it('should return empty result with 200 OK when examId is valid but has no allocations', async () => {
      // Create a new exam with no allocations
      const otherExam = await Exam.create({
        title: 'Empty Exam',
        course: course._id,
        status: ExamStatus.PUBLISHED,
        createdBy: profUser._id,
        examDate: new Date(),
        totalMarks: 50,
        numberOfQuestions: 2
      });

      const req = new Request(`http://localhost:3000/api/allocations?examId=${otherExam._id.toString()}`);
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.allocations).toHaveLength(0);
      expect(body.data.pagination.total).toBe(0);
      expect(body.data.pagination.totalPages).toBe(0);
    });

    it('should resolve blindGrading in batch and not perform Exam lookup per script (N+1 lookups avoided)', async () => {
      const findByIdSpy = vi.spyOn(Exam, 'findById');
      const findSpy = vi.spyOn(Exam, 'find');

      const req = new Request('http://localhost:3000/api/allocations');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      // Verify that findById was not called during serialization of answer scripts
      expect(findByIdSpy).toHaveBeenCalledTimes(0);
      // Verify that Exam.find was called for resolving batch statuses
      expect(findSpy).toHaveBeenCalled();

      findByIdSpy.mockRestore();
      findSpy.mockRestore();
    });
  });
});
