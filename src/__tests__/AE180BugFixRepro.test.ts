/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import User from '../models/User';
import Course from '../models/Course';
import Exam from '../models/Exam';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus } from '../models/Allocation';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import { UserRole } from '../constants/permissions';
import {
  clearAllMemoryDrafts,
  setCurrentDraftUser,
} from '../lib/offlineDrafts';

// Mock session user for API authentication
let mockSessionUser: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
} | null = null;

vi.mock('../lib/apiAuth', () => ({
  requireGradingOrAnnotationAccess: vi.fn(async () => {
    if (!mockSessionUser) {
      return {
        authorized: false,
        response: new Response(
          JSON.stringify({ success: false, message: 'Unauthorized' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        ),
      };
    }
    return {
      authorized: true,
      user: mockSessionUser,
    };
  }),
}));

describe('AE-180: Grading Bugs Reproduction Tests', () => {
  let scriptGET: any;
  let prof: any;
  let ta1: any;
  let ta2: any;
  let course: any;
  let exam: any;
  let answerScript: any;
  let q1Alloc: any;
  let q2Alloc: any;

  beforeAll(async () => {
    const scriptRoute = await import('../app/api/scripts/[id]/route');
    scriptGET = scriptRoute.GET;
  });

  beforeEach(async () => {
    await User.collection.deleteMany({});
    await Course.collection.deleteMany({});
    await Exam.collection.deleteMany({});
    await AnswerScript.collection.deleteMany({});
    await IngestionPage.collection.deleteMany({});
    await Allocation.collection.deleteMany({});
    clearAllMemoryDrafts();
    setCurrentDraftUser('test-user');

    // 1. Create Users
    prof = await User.create({
      name: 'Professor Dumbledore',
      email: `prof-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true,
    });

    ta1 = await User.create({
      name: 'TA Remus',
      email: `ta1-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.TA,
      isActive: true,
    });

    ta2 = await User.create({
      name: 'TA Sirius',
      email: `ta2-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.TA,
      isActive: true,
    });

    // 2. Create Course and Exam
    course = await Course.create({
      courseCode: `CS-AE180-${Date.now()}`,
      courseName: 'Defense Against the Dark Arts',
      semester: 1,
      academicYear: '2026-2027',
      professor: prof._id,
      teachingAssistants: [ta1._id, ta2._id],
      isActive: true,
    });

    exam = await Exam.create({
      title: 'AE-180 Test Exam',
      course: course._id,
      createdBy: prof._id,
      totalMarks: 100,
      numberOfQuestions: 2,
      examDate: new Date('2026-06-15'),
      isActive: true,
    });

    // 3. Create AnswerScript
    answerScript = await AnswerScript.create({
      exam: exam._id,
      student: new mongoose.Types.ObjectId(),
      batchId: 'batch-ae180',
      fileIndex: 0,
      startPageNumber: 1,
      endPageNumber: 2,
      pageCount: 2,
      isActive: true,
    });

    await IngestionPage.create({
      batchId: 'batch-ae180',
      job: new mongoose.Types.ObjectId(),
      fileId: 'file-1',
      fileIndex: 0,
      storageKey: 'batches/batch-ae180/derived/file-1/1/page.png',
      width: 1200,
      height: 1600,
      pageNumber: 1,
      status: PageProcessingStatus.PROCESSED,
      answerScript: answerScript._id,
    });

    // 4. Create Question-wise allocations:
    // Q1 is COMPLETED
    q1Alloc = await Allocation.create({
      exam: exam._id,
      ta: ta1._id,
      answerScript: answerScript._id,
      question: 1,
      status: AllocationStatus.COMPLETED,
      allocatedBy: prof._id,
    });

    // Q2 is IN_PROGRESS
    q2Alloc = await Allocation.create({
      exam: exam._id,
      ta: ta2._id,
      answerScript: answerScript._id,
      question: 2,
      status: AllocationStatus.IN_PROGRESS,
      allocatedBy: prof._id,
    });

    mockSessionUser = {
      id: prof._id.toString(),
      email: prof.email,
      name: prof.name,
      role: UserRole.PROFESSOR,
    };
  });

  afterEach(async () => {
    clearAllMemoryDrafts();
  });

  describe('Bug 1: Arbitrary allocation selection in professor whole-script view', () => {
    it('Bug 1A Reproduction: professor whole-script view without target question or allocationId should NOT arbitrarily select a question-wise allocation', async () => {
      // Professor accesses whole-script view (no ?question=... and no ?allocationId=...)
      const req = new NextRequest(`http://localhost:3000/api/scripts/${answerScript._id}`);
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: answerScript._id.toString() }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // On buggy code: json.data.allocationId is arbitrarily q1Alloc._id (or q2Alloc._id) and allocationStatus is 'COMPLETED'
      // This causes whole-script view to lock grading because Q1 happens to be COMPLETED!
      // On fixed code: whole-script view without a whole-script allocation or explicit allocationId should NOT select an arbitrary question allocation
      expect(json.data.allocationId).toBeUndefined();
      expect(json.data.allocationStatus).toBeUndefined();
    });

    it('Bug 1B Reproduction: professor whole-script view with allocationId should consistently load the specified allocation', async () => {
      // Professor explicitly requested Q2 allocation context (?allocationId=q2Alloc._id)
      const req = new NextRequest(
        `http://localhost:3000/api/scripts/${answerScript._id}?allocationId=${q2Alloc._id.toString()}`
      );
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: answerScript._id.toString() }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // On buggy code: allocationId query param is ignored; Allocation.findOne({ answerScript }) arbitrarily picks Q1!
      // On fixed code: it loads q2Alloc
      expect(json.data.allocationId).toBe(q2Alloc._id.toString());
      expect(json.data.allocationStatus).toBe(AllocationStatus.IN_PROGRESS);
    });

    it('Bug 1C: professor whole-script view loads the whole-script allocation when one exists', async () => {
      // Clear question allocations and create a whole-script allocation
      await Allocation.collection.deleteMany({});
      const wholeScriptAlloc = await Allocation.create({
        exam: exam._id,
        ta: ta1._id,
        answerScript: answerScript._id,
        status: AllocationStatus.IN_PROGRESS,
        allocatedBy: prof._id,
      });

      const req = new NextRequest(`http://localhost:3000/api/scripts/${answerScript._id}`);
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: answerScript._id.toString() }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.allocationId).toBe(wholeScriptAlloc._id.toString());
      expect(json.data.allocationStatus).toBe(AllocationStatus.IN_PROGRESS);
    });

    it('Bug 1D: rejects/ignores allocationId belonging to another answer script', async () => {
      // Create another script and allocation
      const otherScript = await AnswerScript.create({
        exam: exam._id,
        student: new mongoose.Types.ObjectId(),
        batchId: 'batch-ae180-other',
        fileIndex: 1,
        startPageNumber: 1,
        endPageNumber: 2,
        pageCount: 2,
        isActive: true,
      });

      const otherAlloc = await Allocation.create({
        exam: exam._id,
        ta: ta1._id,
        answerScript: otherScript._id,
        question: 1,
        status: AllocationStatus.IN_PROGRESS,
        allocatedBy: prof._id,
      });

      // Request original script with other script's allocationId
      const req = new NextRequest(
        `http://localhost:3000/api/scripts/${answerScript._id}?allocationId=${otherAlloc._id.toString()}`
      );
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: answerScript._id.toString() }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      // Must NOT return the other script's allocation
      expect(json.data.allocationId).toBeUndefined();
    });

    it('Bug 1E: question-scoped view returns the target question allocation', async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/scripts/${answerScript._id}?question=1`
      );
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: answerScript._id.toString() }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.allocationId).toBe(q1Alloc._id.toString());
      expect(json.data.allocationStatus).toBe(AllocationStatus.COMPLETED);
    });

    it('Bug 1F: safely handles invalid allocationId parameter format', async () => {
      const req = new NextRequest(
        `http://localhost:3000/api/scripts/${answerScript._id}?allocationId=not-a-valid-object-id`
      );
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: answerScript._id.toString() }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      // Malformed allocationId falls back to whole-script query and does not return arbitrary question allocation
      expect(json.data.allocationId).toBeUndefined();
    });
  });
});
