/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import User from '../models/User';
import Exam, { IngestionApprovalStatus } from '../models/Exam';
import Course from '../models/Course';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import StudentMapping from '../models/StudentMapping';
import { UserRole } from '../constants/permissions';
import { GET as allocationsGET } from '../app/api/allocations/route';

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

describe('AE-097a TA Work Queue Sorting API', () => {
  let taUser1: any;
  let taUser2: any;
  let profUser: any;
  let studentUser: any;
  let studentUser2: any;

  let course: any;
  let examBlind: any;
  let examNonBlind: any;

  let script1: any;
  let script2: any;
  let script3: any;

  let allocA: any;
  let allocB: any;
  let allocC: any;
  let allocOtherTa: any;

  beforeEach(async () => {
    mockSessionUser = null;

    // 1. Create Users
    taUser1 = await User.create({
      name: 'TA Hermione',
      email: 'hermione@hogwarts.edu',
      password: 'password123',
      role: UserRole.TA,
      isActive: true
    });

    taUser2 = await User.create({
      name: 'TA Ron',
      email: 'ron@hogwarts.edu',
      password: 'password123',
      role: UserRole.TA,
      isActive: true
    });

    profUser = await User.create({
      name: 'Professor Snape',
      email: 'snape@hogwarts.edu',
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true
    });

    studentUser = await User.create({
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

    // 2. Create Course and register TAs
    course = await Course.create({
      courseCode: 'POT101',
      courseName: 'Introduction to Potions',
      semester: 1,
      academicYear: '2026-2027',
      professor: profUser._id,
      teachingAssistants: [taUser1._id, taUser2._id],
      isActive: true
    });

    // 3. Create Exams
    examBlind = await Exam.create({
      title: 'Potions Midterm (Blind)',
      course: course._id,
      numberOfQuestions: 3,
      blindGrading: true,
      ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
      createdBy: profUser._id,
      isActive: true,
      examDate: new Date(),
      totalMarks: 100
    });

    examNonBlind = await Exam.create({
      title: 'Potions Final (Non-Blind)',
      course: course._id,
      numberOfQuestions: 3,
      blindGrading: false,
      ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
      createdBy: profUser._id,
      isActive: true,
      examDate: new Date(),
      totalMarks: 100
    });

    // 4. Create AnswerScripts
    script1 = await AnswerScript.create({
      exam: examBlind._id,
      student: studentUser._id,
      startPageNumber: 1,
      endPageNumber: 4,
      pageCount: 4,
      isActive: true,
      candidateStudentId: `CAND-${studentUser._id}`,
      qrStudentId: 'QR-HARRY',
      omrStudentId: 'OMR-HARRY'
    });

    script2 = await AnswerScript.create({
      exam: examNonBlind._id,
      student: studentUser._id,
      startPageNumber: 1,
      endPageNumber: 4,
      pageCount: 4,
      isActive: true,
      candidateStudentId: `CAND-${studentUser._id}`,
      qrStudentId: 'QR-HARRY',
      omrStudentId: 'OMR-HARRY'
    });

    script3 = await AnswerScript.create({
      exam: examBlind._id,
      student: studentUser2._id,
      startPageNumber: 5,
      endPageNumber: 8,
      pageCount: 4,
      isActive: true,
      candidateStudentId: `CAND-${studentUser2._id}`,
      qrStudentId: 'QR-DRACO',
      omrStudentId: 'OMR-DRACO'
    });

    // 5. Create Student Mappings for blind grading
    await StudentMapping.create({
      exam: examBlind._id,
      student: studentUser._id,
      anonymousId: 'ANON-POTTER-777',
      rollNumber: 'ROLL-HARRY'
    });

    await StudentMapping.create({
      exam: examBlind._id,
      student: studentUser2._id,
      anonymousId: 'ANON-MALFOY-888',
      rollNumber: 'ROLL-DRACO'
    });

    // 6. Create Allocations (created in order: allocA, allocB, allocC)
    // A: oldest (10 mins ago), C: middle (5 mins ago), B: newest (1 min ago)
    const now = Date.now();

    allocA = await Allocation.create({
      exam: examBlind._id,
      ta: taUser1._id,
      answerScript: script1._id,
      allocatedBy: profUser._id,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.EQUAL,
      createdAt: new Date(now - 600000)
    });

    allocB = await Allocation.create({
      exam: examNonBlind._id,
      ta: taUser1._id,
      answerScript: script2._id,
      allocatedBy: profUser._id,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.QUESTION,
      question: 2,
      createdAt: new Date(now - 60000)
    });

    allocC = await Allocation.create({
      exam: examBlind._id,
      ta: taUser1._id,
      answerScript: script3._id,
      allocatedBy: profUser._id,
      status: AllocationStatus.COMPLETED,
      rule: AllocationRule.EQUAL,
      createdAt: new Date(now - 300000)
    });

    allocOtherTa = await Allocation.create({
      exam: examBlind._id,
      ta: taUser2._id,
      answerScript: script1._id,
      allocatedBy: profUser._id,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.EQUAL,
      createdAt: new Date(now)
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
        id: studentUser._id.toString(),
        email: studentUser.email,
        name: studentUser.name,
        role: UserRole.STUDENT
      };
      const req = new Request('http://localhost:3000/api/allocations');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(403);
    });

    it('should reject professor access with 403 Forbidden', async () => {
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

  describe('Scoping & Filtering', () => {
    beforeEach(() => {
      mockSessionUser = {
        id: taUser1._id.toString(),
        email: taUser1.email,
        name: taUser1.name,
        role: UserRole.TA
      };
    });

    it('should return only allocations belonging to the authenticated TA', async () => {
      const req = new Request('http://localhost:3000/api/allocations');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(3);

      const returnedIds = body.data.map((a: any) => a._id);
      expect(returnedIds).toContain(allocA._id.toString());
      expect(returnedIds).toContain(allocB._id.toString());
      expect(returnedIds).toContain(allocC._id.toString());
      expect(returnedIds).not.toContain(allocOtherTa._id.toString());
    });

    it('should support exam filtering', async () => {
      const req = new Request(`http://localhost:3000/api/allocations?examId=${examNonBlind._id.toString()}`);
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]._id).toBe(allocB._id.toString());
    });

    it('should support status filtering', async () => {
      const req = new Request(`http://localhost:3000/api/allocations?status=COMPLETED`);
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]._id).toBe(allocC._id.toString());
    });

    it('should return 400 Bad Request for invalid examId format', async () => {
      const req = new Request('http://localhost:3000/api/allocations?examId=invalid-format');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(400);
    });

    it('should return 400 Bad Request for invalid status value', async () => {
      const req = new Request('http://localhost:3000/api/allocations?status=INVALID_STATUS');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(400);
    });
  });

  describe('Sorting Behavior', () => {
    beforeEach(() => {
      mockSessionUser = {
        id: taUser1._id.toString(),
        email: taUser1.email,
        name: taUser1.name,
        role: UserRole.TA
      };
    });

    it('should sort oldest-first by default (A, C, B)', async () => {
      const req = new Request('http://localhost:3000/api/allocations');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(3);
      // Order: A (oldest, 10m ago) -> C (middle, 5m ago) -> B (newest, 1m ago)
      expect(body.data[0]._id).toBe(allocA._id.toString());
      expect(body.data[1]._id).toBe(allocC._id.toString());
      expect(body.data[2]._id).toBe(allocB._id.toString());
    });

    it('should support explicit oldest sorting via sort=oldest', async () => {
      const req = new Request('http://localhost:3000/api/allocations?sort=oldest');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data[0]._id).toBe(allocA._id.toString());
      expect(body.data[1]._id).toBe(allocC._id.toString());
      expect(body.data[2]._id).toBe(allocB._id.toString());
    });

    it('should support explicit oldest-first sorting via sort=oldest-first', async () => {
      const req = new Request('http://localhost:3000/api/allocations?sort=oldest-first');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data[0]._id).toBe(allocA._id.toString());
    });

    it('should support explicit sorting via sortBy=createdAt', async () => {
      const req = new Request('http://localhost:3000/api/allocations?sortBy=createdAt');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data[0]._id).toBe(allocA._id.toString());
    });

    it('should return HTTP 400 Bad Request for any invalid sort value (e.g. difficulty)', async () => {
      const req = new Request('http://localhost:3000/api/allocations?sort=difficulty');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('Invalid sort value: difficulty');
    });

    it('should return HTTP 400 Bad Request for sort=newest', async () => {
      const req = new Request('http://localhost:3000/api/allocations?sort=newest');
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(400);
    });

    it('should sort correctly in tandem with exam filtering', async () => {
      const req = new Request(`http://localhost:3000/api/allocations?examId=${examBlind._id.toString()}&sort=oldest`);
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(2); // allocA, allocC
      expect(body.data[0]._id).toBe(allocA._id.toString());
      expect(body.data[1]._id).toBe(allocC._id.toString());
    });

    it('should sort correctly in tandem with status filtering', async () => {
      // allocA: PENDING (10m ago), allocC: COMPLETED (5m ago) - wait, only allocA is PENDING for TA1
      const req = new Request(`http://localhost:3000/api/allocations?status=PENDING&sort=oldest`);
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0]._id).toBe(allocA._id.toString());
    });
  });

  describe('Anonymization & PII Leak Prevention', () => {
    beforeEach(() => {
      mockSessionUser = {
        id: taUser1._id.toString(),
        email: taUser1.email,
        name: taUser1.name,
        role: UserRole.TA
      };
    });

    it('should anonymize blind-graded exams and exclude all PII attributes', async () => {
      // allocA is examBlind
      const req = new Request(`http://localhost:3000/api/allocations?examId=${examBlind._id.toString()}`);
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      const answerScriptObj = body.data[0].answerScript;

      expect(answerScriptObj.anonymousId).toBe('ANON-POTTER-777');
      expect(answerScriptObj.scriptReference).toBe('Script #ANON-POTTER-777');

      // Check allowlist attributes
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
      expect(Object.keys(answerScriptObj).sort()).toEqual(allowedKeys.sort());

      // Confirm absolute absence of difficulty-related proxy fields or scoring models
      expect(answerScriptObj.difficulty).toBeUndefined();
      expect(answerScriptObj.score).toBeUndefined();
      expect(answerScriptObj.complexity).toBeUndefined();
    });

    it('should return un-anonymized answer script details for non-blind exams', async () => {
      // allocB is examNonBlind
      const req = new Request(`http://localhost:3000/api/allocations?examId=${examNonBlind._id.toString()}`);
      const res = await allocationsGET(req as any);
      expect(res.status).toBe(200);

      const body = await res.json();
      const answerScriptObj = body.data[0].answerScript;

      expect(answerScriptObj.student.toString()).toBe(studentUser._id.toString());
      expect(answerScriptObj.qrStudentId).toBe('QR-HARRY');
      expect(answerScriptObj.omrStudentId).toBe('OMR-HARRY');
    });
  });
});
