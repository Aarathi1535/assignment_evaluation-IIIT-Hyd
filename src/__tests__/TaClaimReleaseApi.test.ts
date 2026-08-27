/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
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

describe('TA Allocation Claim and Release API Tests (AE-096)', () => {
  let claimPOST: any;
  let releasePOST: any;

  // DB entities
  let course: any;
  let exam: any;
  let ta1: any;
  let ta2: any;
  let prof: any;
  
  let scriptWhole: any;
  let scriptQuestion: any;

  let allocPendingWhole: any;
  let allocPendingQuestion: any;
  let allocInProgress: any;
  let allocCompleted: any;

  beforeAll(async () => {
    claimPOST = (await import('../app/api/allocations/[id]/claim/route')).POST;
    releasePOST = (await import('../app/api/allocations/[id]/release/route')).POST;
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await AnswerScript.deleteMany({});
    await Allocation.deleteMany({});

    // Create users
    prof = await User.create({
      name: 'Professor Snape',
      email: 'snape@hogwarts.edu',
      password: 'password123',
      role: UserRole.PROFESSOR,
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

    const student1 = await User.create({
      name: 'Harry Potter',
      email: 'harry@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    const student2 = await User.create({
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

    const student4 = await User.create({
      name: 'Luna Lovegood',
      email: 'luna@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    // Create course
    course = await Course.create({
      courseCode: 'POT101',
      courseName: 'Potions',
      semester: 1,
      academicYear: '2026-2027',
      professor: prof._id,
      teachingAssistants: [ta1._id, ta2._id],
      enrolledStudents: [student1._id, student2._id, student3._id, student4._id],
      isActive: true
    });

    // Create Exam
    exam = await Exam.create({
      title: 'Potions Midterm',
      course: course._id,
      status: ExamStatus.PUBLISHED,
      blindGrading: true,
      numberOfQuestions: 5,
      createdBy: prof._id,
      examDate: new Date(),
      totalMarks: 100
    });

    // Create AnswerScripts
    scriptWhole = await AnswerScript.create({
      exam: exam._id,
      student: student1._id,
      filePath: '/scans/potions/script1.pdf',
      filename: 'script1.pdf',
      startPageNumber: 1,
      endPageNumber: 4,
      pageCount: 4,
      isActive: true
    });

    scriptQuestion = await AnswerScript.create({
      exam: exam._id,
      student: student2._id,
      filePath: '/scans/potions/script2.pdf',
      filename: 'script2.pdf',
      startPageNumber: 5,
      endPageNumber: 8,
      pageCount: 4,
      isActive: true
    });

    const scriptInProgress = await AnswerScript.create({
      exam: exam._id,
      student: student3._id,
      filePath: '/scans/potions/script3.pdf',
      filename: 'script3.pdf',
      startPageNumber: 9,
      endPageNumber: 12,
      pageCount: 4,
      isActive: true
    });

    const scriptCompleted = await AnswerScript.create({
      exam: exam._id,
      student: student4._id,
      filePath: '/scans/potions/script4.pdf',
      filename: 'script4.pdf',
      startPageNumber: 13,
      endPageNumber: 16,
      pageCount: 4,
      isActive: true
    });

    // Create Allocations
    allocPendingWhole = await Allocation.create({
      exam: exam._id,
      ta: ta1._id,
      answerScript: scriptWhole._id,
      allocatedBy: prof._id,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.EQUAL
    });

    allocPendingQuestion = await Allocation.create({
      exam: exam._id,
      ta: ta1._id,
      answerScript: scriptQuestion._id,
      allocatedBy: prof._id,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
      question: 3
    });

    allocInProgress = await Allocation.create({
      exam: exam._id,
      ta: ta1._id,
      answerScript: scriptInProgress._id,
      allocatedBy: prof._id,
      status: AllocationStatus.IN_PROGRESS,
      rule: AllocationRule.EQUAL
    });

    allocCompleted = await Allocation.create({
      exam: exam._id,
      ta: ta1._id,
      answerScript: scriptCompleted._id,
      allocatedBy: prof._id,
      status: AllocationStatus.COMPLETED,
      rule: AllocationRule.QUESTION,
      question: 1
    });
  });

  describe('Claiming Allocations (Locking)', () => {
    beforeEach(() => {
      mockSessionUser = {
        id: ta1._id.toString(),
        email: ta1.email,
        name: ta1.name,
        role: UserRole.TA
      };
    });

    it('should successfully claim a whole-script PENDING allocation', async () => {
      const res = await claimPOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocPendingWhole._id.toString() })
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe(AllocationStatus.IN_PROGRESS);

      // Verify DB persists the update
      const dbAlloc = await Allocation.findById(allocPendingWhole._id);
      expect(dbAlloc!.status).toBe(AllocationStatus.IN_PROGRESS);
      
      // Verify ownership remains unchanged
      expect(dbAlloc!.ta.toString()).toBe(ta1._id.toString());
      expect(dbAlloc!.rule).toBe(AllocationRule.EQUAL);
    });

    it('should successfully claim a question-wise PENDING allocation', async () => {
      const res = await claimPOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocPendingQuestion._id.toString() })
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.data.status).toBe(AllocationStatus.IN_PROGRESS);
      expect(body.data.question).toBe(3);

      const dbAlloc = await Allocation.findById(allocPendingQuestion._id);
      expect(dbAlloc!.status).toBe(AllocationStatus.IN_PROGRESS);
    });

    it('should reject a second claim on an already claimed allocation', async () => {
      const res = await claimPOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocInProgress._id.toString() })
      });
      expect(res.status).toBe(409); // Conflict

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('already in progress');
    });

    it('should reject claim on a COMPLETED allocation', async () => {
      const res = await claimPOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocCompleted._id.toString() })
      });
      expect(res.status).toBe(400); // Bad request

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('completed');
    });

    it('should prevent a TA from claiming another TA\'s allocation', async () => {
      // Act as ta2
      mockSessionUser = {
        id: ta2._id.toString(),
        email: ta2.email,
        name: ta2.name,
        role: UserRole.TA
      };

      const res = await claimPOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocPendingWhole._id.toString() })
      });
      expect(res.status).toBe(403); // Forbidden

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('belongs to another TA');
    });

    it('should result in exactly one successful claim and one conflict response under concurrent requests', async () => {
      const p1 = claimPOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocPendingWhole._id.toString() })
      });
      const p2 = claimPOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocPendingWhole._id.toString() })
      });

      const [res1, res2] = await Promise.all([p1, p2]);
      
      const statuses = [res1.status, res2.status].sort();
      // Exactly one must be 200 (Success) and one must be 409 (Conflict)
      expect(statuses).toEqual([200, 409]);
    });
  });

  describe('Releasing Allocations (Unlocking)', () => {
    beforeEach(() => {
      mockSessionUser = {
        id: ta1._id.toString(),
        email: ta1.email,
        name: ta1.name,
        role: UserRole.TA
      };
    });

    it('should successfully release an IN_PROGRESS allocation back to PENDING', async () => {
      const res = await releasePOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocInProgress._id.toString() })
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe(AllocationStatus.PENDING);

      const dbAlloc = await Allocation.findById(allocInProgress._id);
      expect(dbAlloc!.status).toBe(AllocationStatus.PENDING);
      
      // Ownership is preserved
      expect(dbAlloc!.ta.toString()).toBe(ta1._id.toString());
    });

    it('should prevent another TA from releasing the allocation', async () => {
      // Act as ta2
      mockSessionUser = {
        id: ta2._id.toString(),
        email: ta2.email,
        name: ta2.name,
        role: UserRole.TA
      };

      const res = await releasePOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocInProgress._id.toString() })
      });
      expect(res.status).toBe(403); // Forbidden

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('belongs to another TA');
    });

    it('should prevent releasing a COMPLETED allocation', async () => {
      const res = await releasePOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocCompleted._id.toString() })
      });
      expect(res.status).toBe(400);

      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('completed');
    });

    it('should allow a released allocation to be claimed again', async () => {
      // 1. Release
      const resRelease = await releasePOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocInProgress._id.toString() })
      });
      expect(resRelease.status).toBe(200);

      // 2. Claim again
      const resClaim = await claimPOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocInProgress._id.toString() })
      });
      expect(resClaim.status).toBe(200);

      const bodyClaim = await resClaim.json();
      expect(bodyClaim.data.status).toBe(AllocationStatus.IN_PROGRESS);
    });

    it('should allow a Professor/Admin to release another TA\'s IN_PROGRESS allocation', async () => {
      // Act as Professor Snape
      mockSessionUser = {
        id: prof._id.toString(),
        email: prof.email,
        name: prof.name,
        role: UserRole.PROFESSOR
      };

      const res = await releasePOST(new Request('http://localhost'), {
        params: Promise.resolve({ id: allocInProgress._id.toString() })
      });
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.status).toBe(AllocationStatus.PENDING);
    });
  });
});
