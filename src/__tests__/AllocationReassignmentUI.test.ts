/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import Allocation, { AllocationRule, AllocationStatus } from '../models/Allocation';
import AnswerScript from '../models/AnswerScript';
import Exam from '../models/Exam';
import Course from '../models/Course';
import User, { UserRole } from '../models/User';
import AuditLog from '../models/AuditLog';
import Grade from '../models/Grade';
import {
  filterEligibleReplacementTas,
  isAllocationReassignable,
  getReassignmentScopeText,
  formatReassignSuccessMessage,
  EligibleTa,
} from '../components/ReassignModal';

// Mock NextAuth session
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

describe('AE-110: Reassignment UI Helpers & End-to-End Reassignment Flow', () => {
  describe('Reassignment UI Helper Functions', () => {
    const mockTas: EligibleTa[] = [
      { id: 'ta-1', name: 'Hermione Granger', email: 'hermione@hogwarts.edu', isActive: true },
      { id: 'ta-2', name: 'Ron Weasley', email: 'ron@hogwarts.edu', isActive: true },
      { id: 'ta-3', name: 'Draco Malfoy', email: 'draco@hogwarts.edu', isActive: true },
      { id: 'ta-4', name: 'Inactive TA', email: 'inactive@hogwarts.edu', isActive: false },
    ];

    it('1. filterEligibleReplacementTas excludes the current TA from the options', () => {
      const eligible = filterEligibleReplacementTas(mockTas, 'ta-1');
      expect(eligible.map((t) => t.id)).toEqual(['ta-2', 'ta-3']);
      expect(eligible.find((t) => t.id === 'ta-1')).toBeUndefined();
    });

    it('2. filterEligibleReplacementTas excludes inactive TAs from the options', () => {
      const eligible = filterEligibleReplacementTas(mockTas, 'ta-1');
      expect(eligible.find((t) => t.id === 'ta-4')).toBeUndefined();
    });

    it('3. filterEligibleReplacementTas handles _id and id interchangeably', () => {
      const mixedTas: EligibleTa[] = [
        { _id: 'ta-1', name: 'Hermione', isActive: true },
        { _id: 'ta-2', name: 'Ron', isActive: true },
      ];
      const eligible = filterEligibleReplacementTas(mixedTas, 'ta-1');
      expect(eligible).toHaveLength(1);
      expect(eligible[0]._id).toBe('ta-2');
    });

    it('4. filterEligibleReplacementTas returns empty array for null/empty input', () => {
      expect(filterEligibleReplacementTas([], 'ta-1')).toEqual([]);
      expect(filterEligibleReplacementTas(null as any, 'ta-1')).toEqual([]);
    });

    it('5. isAllocationReassignable allows ONLY PENDING allocations', () => {
      expect(isAllocationReassignable('PENDING')).toBe(true);
      expect(isAllocationReassignable('IN_PROGRESS')).toBe(false);
      expect(isAllocationReassignable('COMPLETED')).toBe(false);
      expect(isAllocationReassignable('GRADED')).toBe(false);
      expect(isAllocationReassignable(null)).toBe(false);
      expect(isAllocationReassignable(undefined)).toBe(false);
    });

    it('6. getReassignmentScopeText formats Whole Script vs Question number correctly', () => {
      expect(getReassignmentScopeText(null)).toBe('Whole Script');
      expect(getReassignmentScopeText(undefined)).toBe('Whole Script');
      expect(getReassignmentScopeText(1)).toBe('Question 1');
      expect(getReassignmentScopeText(5)).toBe('Question 5');
    });

    it('7. formatReassignSuccessMessage produces a friendly confirmation message', () => {
      expect(formatReassignSuccessMessage('SCRIPT-001', 'Ron Weasley')).toBe(
        'Successfully reassigned SCRIPT-001 to Ron Weasley.'
      );
    });
  });

  describe('Reassignment API Integration & Security Guards', () => {
    let reassignPUT: any;
    let testExamId: mongoose.Types.ObjectId;
    let testCourseId: mongoose.Types.ObjectId;
    let professorId: mongoose.Types.ObjectId;
    let taId1: mongoose.Types.ObjectId;
    let taId2: mongoose.Types.ObjectId;
    let taId3: mongoose.Types.ObjectId;
    let studentId: mongoose.Types.ObjectId;
    let scriptId1: mongoose.Types.ObjectId;

    beforeAll(async () => {
      reassignPUT = (await import('../app/api/exams/[id]/allocate/reassign/route')).PUT;

      await Allocation.init();
      await AnswerScript.init();
      await AuditLog.init();
      await Course.init();
      await Exam.init();
      await User.init();
      await Grade.init();

      professorId = new mongoose.Types.ObjectId('000000000000000000000200');
      taId1 = new mongoose.Types.ObjectId('000000000000000000000201');
      taId2 = new mongoose.Types.ObjectId('000000000000000000000202');
      taId3 = new mongoose.Types.ObjectId('000000000000000000000203');
      studentId = new mongoose.Types.ObjectId('000000000000000000000204');
    });

    beforeEach(async () => {
      await Course.deleteMany({});
      await Exam.deleteMany({});
      await Allocation.deleteMany({});
      await AnswerScript.deleteMany({});
      await User.deleteMany({});
      await AuditLog.deleteMany({});
      await Grade.deleteMany({});

      // Create Users
      await new User({ _id: professorId, name: 'Prof. McGonagall', email: 'prof@iiit.ac.in', role: UserRole.PROFESSOR, password: 'password123', isActive: true }).save();
      await new User({ _id: taId1, name: 'Hermione Granger', email: 'hermione@iiit.ac.in', role: UserRole.TA, password: 'password123', isActive: true }).save();
      await new User({ _id: taId2, name: 'Ron Weasley', email: 'ron@iiit.ac.in', role: UserRole.TA, password: 'password123', isActive: true }).save();
      await new User({ _id: taId3, name: 'Draco Malfoy', email: 'draco@iiit.ac.in', role: UserRole.TA, password: 'password123', isActive: true }).save();
      await new User({ _id: studentId, name: 'Harry Potter', email: 'harry@iiit.ac.in', role: UserRole.STUDENT, password: 'password123', isActive: true }).save();

      mockSessionUser = {
        id: professorId.toString(),
        role: UserRole.PROFESSOR,
        email: 'prof@iiit.ac.in',
        name: 'Prof. McGonagall',
      };

      const course = new Course({
        courseCode: 'CS201',
        courseName: 'Data Structures',
        semester: 1,
        academicYear: '2026-2027',
        professor: professorId,
        teachingAssistants: [taId1, taId2, taId3],
        enrolledStudents: [studentId],
        isActive: true,
      });
      const savedCourse = await course.save();
      testCourseId = savedCourse._id as mongoose.Types.ObjectId;

      const exam = new Exam({
        title: 'Midterm 2026',
        course: testCourseId,
        createdBy: professorId,
        examDate: new Date('2026-09-15T09:00:00.000Z'),
        totalMarks: 50,
        numberOfQuestions: 4,
        status: 'PUBLISHED',
        ingestionApprovalStatus: 'APPROVED',
        isActive: true,
      });
      const savedExam = await exam.save();
      testExamId = savedExam._id as mongoose.Types.ObjectId;

      const script = new AnswerScript({
        exam: testExamId,
        student: studentId,
        batchId: 'batch-1',
        fileIndex: 0,
        startPageNumber: 1,
        endPageNumber: 2,
        pageCount: 2,
        isActive: true,
      });
      const savedScript = await script.save();
      scriptId1 = savedScript._id as mongoose.Types.ObjectId;
    });

    function makeRequest(url: string, body: any) {
      return new NextRequest(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    }

    function makeContext(examId: string) {
      return { params: Promise.resolve({ id: examId }) };
    }

    it('8. Successfully reassigns a PENDING allocation from TA-1 to TA-2 and returns 200 with updated allocation', async () => {
      const allocation = await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        allocatedBy: professorId,
        status: AllocationStatus.PENDING,
        rule: AllocationRule.EQUAL,
      });

      const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
        allocationId: allocation._id.toString(),
        targetTaId: taId2.toString(),
      });

      const res = await reassignPUT(req, makeContext(testExamId.toString()));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.message).toBe('Allocation reassigned successfully');
      expect(json.data.ta).toBe(taId2.toString());

      // DB verification
      const updatedInDb = await Allocation.findById(allocation._id);
      expect(updatedInDb!.ta.toString()).toBe(taId2.toString());
      expect(updatedInDb!.allocatedBy.toString()).toBe(professorId.toString());
      expect(updatedInDb!.status).toBe(AllocationStatus.PENDING);
    });

    it('9. Rejects reassignment when allocation is IN_PROGRESS with meaningful 400 error message', async () => {
      const allocation = await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL,
        claimedAt: new Date(),
      });

      const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
        allocationId: allocation._id.toString(),
        targetTaId: taId2.toString(),
      });

      const res = await reassignPUT(req, makeContext(testExamId.toString()));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('Cannot reassign allocation: grading/work has already started');

      // Allocation remains with TA-1
      const unchanged = await Allocation.findById(allocation._id);
      expect(unchanged!.ta.toString()).toBe(taId1.toString());
    });

    it('10. Rejects reassignment when allocation is COMPLETED with meaningful 400 error message', async () => {
      const allocation = await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        allocatedBy: professorId,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL,
        completedAt: new Date(),
      });

      const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
        allocationId: allocation._id.toString(),
        targetTaId: taId2.toString(),
      });

      const res = await reassignPUT(req, makeContext(testExamId.toString()));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('Cannot reassign allocation: grading/work has already started');
    });

    it('11. Rejects reassignment if target TA is not registered on the course', async () => {
      const allocation = await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        allocatedBy: professorId,
        status: AllocationStatus.PENDING,
        rule: AllocationRule.EQUAL,
      });

      const nonCourseTaId = new mongoose.Types.ObjectId().toString();

      const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
        allocationId: allocation._id.toString(),
        targetTaId: nonCourseTaId,
      });

      const res = await reassignPUT(req, makeContext(testExamId.toString()));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('is not a teaching assistant for this course');
    });

    it('12. Rejects request with missing allocationId or targetTaId', async () => {
      const reqMissingTa = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
        allocationId: new mongoose.Types.ObjectId().toString(),
      });
      const resMissingTa = await reassignPUT(reqMissingTa, makeContext(testExamId.toString()));
      expect(resMissingTa.status).toBe(400);
      const jsonMissingTa = await resMissingTa.json();
      expect(jsonMissingTa.message).toBe('Target TA ID is required');

      const reqMissingAlloc = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
        targetTaId: taId2.toString(),
      });
      const resMissingAlloc = await reassignPUT(reqMissingAlloc, makeContext(testExamId.toString()));
      expect(resMissingAlloc.status).toBe(400);
      const jsonMissingAlloc = await resMissingAlloc.json();
      expect(jsonMissingAlloc.message).toBe('Allocation ID is required');
    });

    it('13. Enforces authorization guard: rejects non-professor / unauthorized TA sessions with 403', async () => {
      mockSessionUser = {
        id: taId1.toString(),
        role: UserRole.TA,
        email: 'hermione@iiit.ac.in',
        name: 'Hermione Granger',
      };

      const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
        allocationId: new mongoose.Types.ObjectId().toString(),
        targetTaId: taId2.toString(),
      });

      const res = await reassignPUT(req, makeContext(testExamId.toString()));
      expect(res.status).toBe(403);
    });
  });
});
