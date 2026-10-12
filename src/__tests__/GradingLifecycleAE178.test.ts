import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';

import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus, IngestionApprovalStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import Page from '../models/Page';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Grade from '../models/Grade';
import AuditLog from '../models/AuditLog';
import Notification from '../models/Notification';
import ProgressEventService from '../services/ProgressEventService';

let mockSessionUser: { id: string; role: string; email: string; name?: string } | null = null;

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

describe('AE-178: Complete TA Grading Lifecycle Integration (allocate -> grade -> submit -> locked)', () => {
  let replSet: MongoMemoryReplSet;

  let allocatePOST: typeof import('../app/api/exams/[id]/allocate/route').POST;
  let allocationsGET: typeof import('../app/api/allocations/route').GET;
  let scriptGET: typeof import('../app/api/scripts/[id]/route').GET;
  let gradesPOST: typeof import('../app/api/scripts/[id]/grades/route').POST;
  let gradesGET: typeof import('../app/api/scripts/[id]/grades/route').GET;
  let annotationsPUT: typeof import('../app/api/scripts/[id]/pages/[p]/annotations/route').PUT;
  let annotationsGET: typeof import('../app/api/scripts/[id]/pages/[p]/annotations/route').GET;
  let submitPOST: typeof import('../app/api/scripts/[id]/submit/route').POST;
  let reopenPOST: typeof import('../app/api/allocations/[id]/reopen/route').POST;
  let progressGET: typeof import('../app/api/exams/[id]/progress/route').GET;

  let owningProfId: mongoose.Types.ObjectId;
  let otherProfId: mongoose.Types.ObjectId;
  let ta1Id: mongoose.Types.ObjectId;
  let ta2Id: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;

  let courseId: mongoose.Types.ObjectId;
  let examId: mongoose.Types.ObjectId;
  let rubricId: mongoose.Types.ObjectId;
  let scriptId: mongoose.Types.ObjectId;
  let pageId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const uri = replSet.getUri();
    await mongoose.connect(uri);

    // Import real route handlers dynamically
    allocatePOST = (await import('../app/api/exams/[id]/allocate/route')).POST;
    allocationsGET = (await import('../app/api/allocations/route')).GET;
    scriptGET = (await import('../app/api/scripts/[id]/route')).GET;
    gradesPOST = (await import('../app/api/scripts/[id]/grades/route')).POST;
    gradesGET = (await import('../app/api/scripts/[id]/grades/route')).GET;
    annotationsPUT = (await import('../app/api/scripts/[id]/pages/[p]/annotations/route')).PUT;
    annotationsGET = (await import('../app/api/scripts/[id]/pages/[p]/annotations/route')).GET;
    submitPOST = (await import('../app/api/scripts/[id]/submit/route')).POST;
    reopenPOST = (await import('../app/api/allocations/[id]/reopen/route')).POST;
    progressGET = (await import('../app/api/exams/[id]/progress/route')).GET;
  }, 60000);

  afterAll(async () => {
    ProgressEventService.clearListeners();
    await ProgressEventService.stopChangeStream();

    await mongoose.disconnect();
    if (replSet) {
      await replSet.stop();
    }

    const fallbackUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test-placeholder-safety';
    try {
      await mongoose.connect(fallbackUri);
    } catch {
      // ignore fallback reconnect
    }
  }, 60000);

  beforeEach(async () => {
    ProgressEventService.clearListeners();
    mockSessionUser = null;

    // Clean all collections in replica set (using collection.deleteMany for append-only AuditLog)
    await Notification.deleteMany({});
    await Grade.deleteMany({});
    await Allocation.deleteMany({});
    await Page.deleteMany({});
    await IngestionPage.deleteMany({});
    await AnswerScript.deleteMany({});
    await Rubric.deleteMany({});
    await Exam.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});
    await AuditLog.collection.deleteMany({});

    // 1. Seed Users
    owningProfId = new mongoose.Types.ObjectId('000000000000000000000201');
    otherProfId = new mongoose.Types.ObjectId('000000000000000000000202');
    ta1Id = new mongoose.Types.ObjectId('000000000000000000000203');
    ta2Id = new mongoose.Types.ObjectId('000000000000000000000204');
    studentId = new mongoose.Types.ObjectId('000000000000000000000205');

    await User.create([
      {
        _id: owningProfId,
        name: 'Prof. Xavier',
        email: 'xavier@university.edu',
        password: 'password123',
        role: UserRole.PROFESSOR,
        isActive: true,
      },
      {
        _id: otherProfId,
        name: 'Prof. Magneto',
        email: 'magneto@university.edu',
        password: 'password123',
        role: UserRole.PROFESSOR,
        isActive: true,
      },
      {
        _id: ta1Id,
        name: 'TA Scott',
        email: 'scott@university.edu',
        password: 'password123',
        role: UserRole.TA,
        isActive: true,
      },
      {
        _id: ta2Id,
        name: 'TA Jean',
        email: 'jean@university.edu',
        password: 'password123',
        role: UserRole.TA,
        isActive: true,
      },
      {
        _id: studentId,
        name: 'Student Peter',
        email: 'peter@university.edu',
        password: 'password123',
        role: UserRole.STUDENT,
        isActive: true,
      },
    ]);

    // 2. Seed Course
    courseId = new mongoose.Types.ObjectId('000000000000000000000210');
    await Course.create({
      _id: courseId,
      courseCode: 'CS201',
      courseName: 'Data Structures and Algorithms',
      semester: 1,
      academicYear: '2026-2027',
      professor: owningProfId,
      teachingAssistants: [ta1Id, ta2Id],
      enrolledStudents: [studentId],
      isActive: true,
    });

    // 3. Seed Exam with two questions, published, and approved ingestion
    examId = new mongoose.Types.ObjectId('000000000000000000000220');
    await Exam.create({
      _id: examId,
      title: 'Midterm Algorithms',
      course: courseId,
      examDate: new Date('2026-11-15'),
      status: ExamStatus.PUBLISHED,
      ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
      numberOfQuestions: 2,
      totalMarks: 20,
      createdBy: owningProfId,
      isActive: true,
    });

    // 4. Seed Rubric for the two questions
    rubricId = new mongoose.Types.ObjectId('000000000000000000000230');
    await Rubric.create({
      _id: rubricId,
      exam: examId,
      createdBy: owningProfId,
      scoreStep: 0.5,
      questions: [
        {
          questionNumber: 1,
          maxMarks: 10,
          criteria: [
            { criterionName: 'Logic', points: 6 },
            { criterionName: 'Clarity', points: 4 },
          ],
        },
        {
          questionNumber: 2,
          maxMarks: 10,
          criteria: [
            { criterionName: 'Correctness', points: 7 },
            { criterionName: 'Efficiency', points: 3 },
          ],
        },
      ],
      isActive: true,
    });

    // 5. Seed AnswerScript (identified student, eligible for allocation)
    scriptId = new mongoose.Types.ObjectId('000000000000000000000240');
    await AnswerScript.create({
      _id: scriptId,
      exam: examId,
      student: studentId,
      pageCount: 1,
      needsManualId: false,
      isActive: true,
    });

    // 6. Seed Page and IngestionPage for Page 1
    pageId = new mongoose.Types.ObjectId('000000000000000000000250');
    await Page.create({
      _id: pageId,
      answerScript: scriptId,
      pageNumber: 1,
      imagePath: '/uploads/scripts/cs201_p1.png',
      annotations: { annotations: [], strokes: [] },
      isActive: true,
    });

    await IngestionPage.create({
      answerScript: scriptId,
      batchId: 'batch-cs201-1',
      job: new mongoose.Types.ObjectId(),
      fileId: 'file-cs201-1',
      storageKey: 'batches/batch-cs201-1/pages/1/page.png',
      pageNumber: 1,
      fileIndex: 0,
      thumbnailKey: 'thumb-cs201-p1',
      width: 800,
      height: 1200,
      status: PageProcessingStatus.PROCESSED,
    });
  });

  describe('1. Allocation and Authorization', () => {
    it('allows owning professor to allocate script; TA-1 sees PENDING and accesses script; TA-2 receives 403', async () => {
      // 1. Owning professor allocates script to TA-1
      mockSessionUser = {
        id: owningProfId.toString(),
        email: 'xavier@university.edu',
        role: UserRole.PROFESSOR,
      };

      const allocateReq = new NextRequest(
        `http://localhost:3000/api/exams/${examId.toString()}/allocate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rule: AllocationRule.EQUAL,
            taIds: [ta1Id.toString()],
          }),
        }
      );

      const allocRes = await allocatePOST(allocateReq, {
        params: Promise.resolve({ id: examId.toString() }),
      });

      expect(allocRes.status).toBe(200);
      const allocJson = await allocRes.json();
      expect(allocJson.success).toBe(true);

      // Verify allocation in database is created in PENDING status
      const createdAlloc = await Allocation.findOne({ exam: examId, answerScript: scriptId });
      expect(createdAlloc).not.toBeNull();
      expect(createdAlloc?.ta.toString()).toBe(ta1Id.toString());
      expect(createdAlloc?.status).toBe(AllocationStatus.PENDING);

      // 2. TA-1 sees the allocation as PENDING in their allocations list
      mockSessionUser = {
        id: ta1Id.toString(),
        email: 'scott@university.edu',
        role: UserRole.TA,
      };

      const taAllocationsReq = new NextRequest('http://localhost:3000/api/allocations', {
        method: 'GET',
      });
      const taAllocRes = await allocationsGET(taAllocationsReq);
      expect(taAllocRes.status).toBe(200);
      const taAllocJson = await taAllocRes.json();
      expect(taAllocJson.success).toBe(true);
      expect(taAllocJson.data.allocations).toHaveLength(1);
      expect(taAllocJson.data.allocations[0].status).toBe(AllocationStatus.PENDING);
      expect(taAllocJson.data.allocations[0].answerScript._id).toBe(scriptId.toString());

      // TA-1 can access the script metadata and page view
      const ta1ScriptReq = new NextRequest(`http://localhost:3000/api/scripts/${scriptId.toString()}`, {
        method: 'GET',
      });
      const ta1ScriptRes = await scriptGET(ta1ScriptReq, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });
      expect(ta1ScriptRes.status).toBe(200);
      const ta1ScriptJson = await ta1ScriptRes.json();
      expect(ta1ScriptJson.success).toBe(true);
      expect(ta1ScriptJson.data._id).toBe(scriptId.toString());
      expect(ta1ScriptJson.data.allocationStatus).toBe(AllocationStatus.PENDING);

      // 3. TA-2 receives 403 Forbidden
      mockSessionUser = {
        id: ta2Id.toString(),
        email: 'jean@university.edu',
        role: UserRole.TA,
      };

      const ta2ScriptReq = new NextRequest(`http://localhost:3000/api/scripts/${scriptId.toString()}`, {
        method: 'GET',
      });
      const ta2ScriptRes = await scriptGET(ta2ScriptReq, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });
      expect(ta2ScriptRes.status).toBe(403);
      const ta2ScriptJson = await ta2ScriptRes.json();
      expect(ta2ScriptJson.success).toBe(false);
      expect(ta2ScriptJson.message).toMatch(/Forbidden: You are not allocated to grade this answer script/i);
    });
  });

  describe('2. Draft Grading and Validation', () => {
    let allocationId: string;

    beforeEach(async () => {
      // Allocate to TA-1
      mockSessionUser = {
        id: owningProfId.toString(),
        email: 'xavier@university.edu',
        role: UserRole.PROFESSOR,
      };

      const allocateReq = new NextRequest(
        `http://localhost:3000/api/exams/${examId.toString()}/allocate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            rule: AllocationRule.EQUAL,
            taIds: [ta1Id.toString()],
          }),
        }
      );
      await allocatePOST(allocateReq, {
        params: Promise.resolve({ id: examId.toString() }),
      });

      const alloc = await Allocation.findOne({ exam: examId, answerScript: scriptId });
      allocationId = alloc!._id.toString();
    });

    it('saves draft grades, transitions to IN_PROGRESS, saves page annotations, and rejects incomplete submission with 409', async () => {
      mockSessionUser = {
        id: ta1Id.toString(),
        email: 'scott@university.edu',
        role: UserRole.TA,
      };

      // 1. TA-1 saves draft grades for Question 1
      const gradeQ1Req = new NextRequest(`http://localhost:3000/api/scripts/${scriptId.toString()}/grades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 1,
          marksAwarded: [
            { criterionName: 'Logic', score: 5 },
            { criterionName: 'Clarity', score: 3 },
          ],
          feedback: 'Solid deductive logic; clean presentation.',
          isFinal: false,
        }),
      });

      const gradeQ1Res = await gradesPOST(gradeQ1Req, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });
      expect(gradeQ1Res.status).toBe(200);
      const gradeQ1Json = await gradeQ1Res.json();
      expect(gradeQ1Json.success).toBe(true);
      expect(gradeQ1Json.data.totalScore).toBe(8);
      expect(gradeQ1Json.data.isFinal).toBe(false);

      // Verify allocation transitioned from PENDING -> IN_PROGRESS on first grade save
      const allocAfterQ1 = await Allocation.findById(allocationId);
      expect(allocAfterQ1?.status).toBe(AllocationStatus.IN_PROGRESS);
      expect(allocAfterQ1?.claimedAt).toBeDefined();

      // 2. TA-1 saves vector page annotations
      const pageDoc = await Page.findById(pageId);
      const baseUpdatedAt = pageDoc!.updatedAt.toISOString();

      const annotationReq = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/pages/1/annotations`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            annotations: [
              {
                id: 'stamp-1',
                type: 'check',
                pageKey: pageId.toString(),
                x: 120,
                y: 150,
                size: 24,
                color: '#16a34a',
                createdAt: Date.now(),
              },
            ],
            strokes: [],
            baseUpdatedAt,
          }),
        }
      );

      const annotationRes = await annotationsPUT(annotationReq, {
        params: Promise.resolve({ id: scriptId.toString(), p: '1' }),
      });
      expect(annotationRes.status).toBe(200);
      const annotationJson = await annotationRes.json();
      expect(annotationJson.success).toBe(true);

      // Verify annotation persistence via GET
      const annotationGetReq = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/pages/1/annotations`,
        { method: 'GET' }
      );
      const annotationGetRes = await annotationsGET(annotationGetReq, {
        params: Promise.resolve({ id: scriptId.toString(), p: '1' }),
      });
      expect(annotationGetRes.status).toBe(200);
      const annotationGetJson = await annotationGetRes.json();
      expect(annotationGetJson.data.annotations).toHaveLength(1);
      expect(annotationGetJson.data.annotations[0].id).toBe('stamp-1');

      // 3. Attempt submission while Question 2 is missing -> 409 Conflict identifying Question 2
      const incompleteSubmitReq = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );

      const incompleteSubmitRes = await submitPOST(incompleteSubmitReq, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });
      expect(incompleteSubmitRes.status).toBe(409);
      const incompleteSubmitJson = await incompleteSubmitRes.json();
      expect(incompleteSubmitJson.success).toBe(false);
      expect(incompleteSubmitJson.message).toMatch(/Question\(s\) 2 must be graded before submission/i);

      // Verify grades are NOT finalized and allocation remains IN_PROGRESS
      const q1GradeCheck = await Grade.findOne({ answerScript: scriptId, question: 1 });
      expect(q1GradeCheck?.isFinal).toBe(false);
      const allocStillInProgress = await Allocation.findById(allocationId);
      expect(allocStillInProgress?.status).toBe(AllocationStatus.IN_PROGRESS);

      // 4. TA-1 saves Question 2 draft grade
      const gradeQ2Req = new NextRequest(`http://localhost:3000/api/scripts/${scriptId.toString()}/grades`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 2,
          marksAwarded: [
            { criterionName: 'Correctness', score: 6.5 },
            { criterionName: 'Efficiency', score: 2.5 },
          ],
          feedback: 'Optimal solution with minor asymptotic constant factor.',
          isFinal: false,
        }),
      });

      const gradeQ2Res = await gradesPOST(gradeQ2Req, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });
      expect(gradeQ2Res.status).toBe(200);

      // 5. Verify persisted marks and feedback for both questions
      const getGradesReq = new NextRequest(`http://localhost:3000/api/scripts/${scriptId.toString()}/grades`, {
        method: 'GET',
      });
      const getGradesRes = await gradesGET(getGradesReq, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });
      expect(getGradesRes.status).toBe(200);
      const getGradesJson = await getGradesRes.json();
      expect(getGradesJson.success).toBe(true);
      expect(getGradesJson.data).toHaveLength(2);

      const g1 = getGradesJson.data.find((g: { question: number }) => g.question === 1);
      const g2 = getGradesJson.data.find((g: { question: number }) => g.question === 2);
      expect(g1.totalScore).toBe(8);
      expect(g1.feedback).toBe('Solid deductive logic; clean presentation.');
      expect(g1.isFinal).toBe(false);
      expect(g2.totalScore).toBe(9);
      expect(g2.feedback).toBe('Optimal solution with minor asymptotic constant factor.');
      expect(g2.isFinal).toBe(false);
    });
  });

  describe('3. Submission and Locking', () => {
    let allocationId: string;

    beforeEach(async () => {
      // Allocate and draft-grade both questions
      mockSessionUser = {
        id: owningProfId.toString(),
        email: 'xavier@university.edu',
        role: UserRole.PROFESSOR,
      };

      await allocatePOST(
        new NextRequest(`http://localhost:3000/api/exams/${examId.toString()}/allocate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule: AllocationRule.EQUAL, taIds: [ta1Id.toString()] }),
        }),
        { params: Promise.resolve({ id: examId.toString() }) }
      );

      const alloc = await Allocation.findOne({ exam: examId, answerScript: scriptId });
      allocationId = alloc!._id.toString();

      mockSessionUser = {
        id: ta1Id.toString(),
        email: 'scott@university.edu',
        role: UserRole.TA,
      };

      // Draft Grade Q1
      await gradesPOST(
        new NextRequest(`http://localhost:3000/api/scripts/${scriptId.toString()}/grades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: 1,
            marksAwarded: [{ criterionName: 'Logic', score: 5 }, { criterionName: 'Clarity', score: 3 }],
            feedback: 'Initial Q1 feedback',
            isFinal: false,
          }),
        }),
        { params: Promise.resolve({ id: scriptId.toString() }) }
      );

      // Draft Grade Q2
      await gradesPOST(
        new NextRequest(`http://localhost:3000/api/scripts/${scriptId.toString()}/grades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: 2,
            marksAwarded: [{ criterionName: 'Correctness', score: 6 }, { criterionName: 'Efficiency', score: 3 }],
            feedback: 'Initial Q2 feedback',
            isFinal: false,
          }),
        }),
        { params: Promise.resolve({ id: scriptId.toString() }) }
      );
    });

    it('submits script (200), finalizes grades, completes allocation, and locks subsequent modifications (409)', async () => {
      mockSessionUser = {
        id: ta1Id.toString(),
        email: 'scott@university.edu',
        role: UserRole.TA,
      };

      // 1. Submit complete script
      const submitReq = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );

      const submitRes = await submitPOST(submitReq, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });
      expect(submitRes.status).toBe(200);
      const submitJson = await submitRes.json();
      expect(submitJson.success).toBe(true);
      expect(submitJson.data.isSubmitted).toBe(true);
      expect(submitJson.data.totalScore).toBe(17); // 8 + 9
      expect(submitJson.data.allocationCompleted).toBe(true);

      // 2. Verify grades are finalized and allocation is COMPLETED
      const finalGrades = await Grade.find({ answerScript: scriptId });
      expect(finalGrades).toHaveLength(2);
      expect(finalGrades.every((g) => g.isFinal === true)).toBe(true);

      const completedAlloc = await Allocation.findById(allocationId);
      expect(completedAlloc?.status).toBe(AllocationStatus.COMPLETED);
      expect(completedAlloc?.completedAt).toBeDefined();

      // 3. Subsequent grade update returns 409 without changing stored grades
      const postSubmitGradeReq = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/grades`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: 1,
            marksAwarded: [{ criterionName: 'Logic', score: 6 }, { criterionName: 'Clarity', score: 4 }],
            feedback: 'Attempted modification after submission',
            isFinal: false,
          }),
        }
      );

      const postSubmitGradeRes = await gradesPOST(postSubmitGradeReq, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });
      expect(postSubmitGradeRes.status).toBe(409);

      // Verify stored grade remained unchanged
      const q1Stored = await Grade.findOne({ answerScript: scriptId, question: 1 });
      expect(q1Stored?.totalScore).toBe(8);
      expect(q1Stored?.feedback).toBe('Initial Q1 feedback');

      // 4. Subsequent page annotation save returns 409 Conflict (isLocked: true)
      const pageDoc = await Page.findById(pageId);
      const postSubmitAnnotationReq = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/pages/1/annotations`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            annotations: [{ id: 'illegal-post-lock', tool: 'check', pageNumber: 1, x: 10, y: 10 }],
            strokes: [],
            baseUpdatedAt: pageDoc!.updatedAt.toISOString(),
          }),
        }
      );

      const postSubmitAnnotationRes = await annotationsPUT(postSubmitAnnotationReq, {
        params: Promise.resolve({ id: scriptId.toString(), p: '1' }),
      });
      expect(postSubmitAnnotationRes.status).toBe(409);
      const postSubmitAnnotationJson = await postSubmitAnnotationRes.json();
      expect(postSubmitAnnotationJson.isLocked).toBe(true);

      // 5. Subsequent duplicate submission returns 409 Conflict
      const duplicateSubmitReq = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      const duplicateSubmitRes = await submitPOST(duplicateSubmitReq, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });
      expect(duplicateSubmitRes.status).toBe(409);
      const duplicateSubmitJson = await duplicateSubmitRes.json();
      expect(duplicateSubmitJson.message).toMatch(/already been submitted and completed/i);
    });
  });

  describe('4. Reopening, Resubmission, and Progress Tracking', () => {
    let allocationId: string;

    beforeEach(async () => {
      // Allocate, grade, and submit
      mockSessionUser = {
        id: owningProfId.toString(),
        email: 'xavier@university.edu',
        role: UserRole.PROFESSOR,
      };

      await allocatePOST(
        new NextRequest(`http://localhost:3000/api/exams/${examId.toString()}/allocate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule: AllocationRule.EQUAL, taIds: [ta1Id.toString()] }),
        }),
        { params: Promise.resolve({ id: examId.toString() }) }
      );

      const alloc = await Allocation.findOne({ exam: examId, answerScript: scriptId });
      allocationId = alloc!._id.toString();

      mockSessionUser = {
        id: ta1Id.toString(),
        email: 'scott@university.edu',
        role: UserRole.TA,
      };

      await gradesPOST(
        new NextRequest(`http://localhost:3000/api/scripts/${scriptId.toString()}/grades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: 1,
            marksAwarded: [{ criterionName: 'Logic', score: 5 }, { criterionName: 'Clarity', score: 3 }],
            feedback: 'Initial Q1 feedback',
            isFinal: false,
          }),
        }),
        { params: Promise.resolve({ id: scriptId.toString() }) }
      );

      await gradesPOST(
        new NextRequest(`http://localhost:3000/api/scripts/${scriptId.toString()}/grades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: 2,
            marksAwarded: [{ criterionName: 'Correctness', score: 6 }, { criterionName: 'Efficiency', score: 3 }],
            feedback: 'Initial Q2 feedback',
            isFinal: false,
          }),
        }),
        { params: Promise.resolve({ id: scriptId.toString() }) }
      );

      await submitPOST(
        new NextRequest(`http://localhost:3000/api/scripts/${scriptId.toString()}/submit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ id: scriptId.toString() }) }
      );
    });

    it('enforces RBAC on reopen, notifies TA, permits resubmission, and maintains accurate single-count progress', async () => {
      // 1. TA attempt to reopen is forbidden (403)
      mockSessionUser = {
        id: ta1Id.toString(),
        email: 'scott@university.edu',
        role: UserRole.TA,
      };

      const taReopenReq = new NextRequest(
        `http://localhost:3000/api/allocations/${allocationId}/reopen`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'TA wants to regrade' }),
        }
      );
      const taReopenRes = await reopenPOST(taReopenReq, {
        params: Promise.resolve({ id: allocationId }),
      });
      expect(taReopenRes.status).toBe(403);

      // 2. Non-owning professor attempt to reopen is forbidden (403)
      mockSessionUser = {
        id: otherProfId.toString(),
        email: 'magneto@university.edu',
        role: UserRole.PROFESSOR,
      };

      const otherProfReopenReq = new NextRequest(
        `http://localhost:3000/api/allocations/${allocationId}/reopen`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Other professor wants to reopen' }),
        }
      );
      const otherProfReopenRes = await reopenPOST(otherProfReopenReq, {
        params: Promise.resolve({ id: allocationId }),
      });
      expect(otherProfReopenRes.status).toBe(403);
      const otherProfJson = await otherProfReopenRes.json();
      expect(otherProfJson.message).toMatch(/do not own the exam for this allocation/i);

      // 3. Owning professor attempt missing reopen reason returns 400 Bad Request
      mockSessionUser = {
        id: owningProfId.toString(),
        email: 'xavier@university.edu',
        role: UserRole.PROFESSOR,
      };

      const emptyReasonReq = new NextRequest(
        `http://localhost:3000/api/allocations/${allocationId}/reopen`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: '   ' }),
        }
      );
      const emptyReasonRes = await reopenPOST(emptyReasonReq, {
        params: Promise.resolve({ id: allocationId }),
      });
      expect(emptyReasonRes.status).toBe(400);
      const emptyReasonJson = await emptyReasonRes.json();
      expect(emptyReasonJson.message).toMatch(/Reopen reason is required/i);

      // 4. Owning professor successfully reopens with non-empty reason
      const validReopenReq = new NextRequest(
        `http://localhost:3000/api/allocations/${allocationId}/reopen`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Student flagged Question 1 rubric application inconsistency' }),
        }
      );
      const validReopenRes = await reopenPOST(validReopenReq, {
        params: Promise.resolve({ id: allocationId }),
      });
      expect(validReopenRes.status).toBe(200);
      const validReopenJson = await validReopenRes.json();
      expect(validReopenJson.success).toBe(true);
      expect(validReopenJson.data.status).toBe(AllocationStatus.IN_PROGRESS);
      expect(validReopenJson.data.reopenedBy).toBe(owningProfId.toString());

      // Verify allocation state in database
      const reopenedAlloc = await Allocation.findById(allocationId);
      expect(reopenedAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
      expect(reopenedAlloc?.completedAt).toBeFalsy();

      // Verify grades are no longer marked final
      const reopenedGrades = await Grade.find({ answerScript: scriptId });
      expect(reopenedGrades.every((g) => g.isFinal === false)).toBe(true);

      // 5. Verify TA notification was created
      const taNotification = await Notification.findOne({
        recipient: ta1Id,
        allocation: new mongoose.Types.ObjectId(allocationId),
        title: 'Allocation Reopened for Grading',
      });
      expect(taNotification).not.toBeNull();
      expect(taNotification?.message).toMatch(/Student flagged Question 1 rubric application inconsistency/i);

      // 6. TA-1 can now successfully edit marks and feedback
      mockSessionUser = {
        id: ta1Id.toString(),
        email: 'scott@university.edu',
        role: UserRole.TA,
      };

      const editQ1Req = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/grades`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: 1,
            marksAwarded: [
              { criterionName: 'Logic', score: 6 },
              { criterionName: 'Clarity', score: 3.5 },
            ],
            feedback: 'Revised after rubric consistency check: awarded full marks on Logic.',
            isFinal: false,
          }),
        }
      );

      const editQ1Res = await gradesPOST(editQ1Req, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });
      expect(editQ1Res.status).toBe(200);
      const editQ1Json = await editQ1Res.json();
      expect(editQ1Json.data.totalScore).toBe(9.5);

      // 7. TA-1 resubmits the script
      const resubmitReq = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );
      const resubmitRes = await submitPOST(resubmitReq, {
        params: Promise.resolve({ id: scriptId.toString() }),
      });
      expect(resubmitRes.status).toBe(200);
      const resubmitJson = await resubmitRes.json();
      expect(resubmitJson.data.isSubmitted).toBe(true);
      expect(resubmitJson.data.totalScore).toBe(18.5); // 9.5 + 9.0

      // Verify allocation is COMPLETED again
      const resubmittedAlloc = await Allocation.findById(allocationId);
      expect(resubmittedAlloc?.status).toBe(AllocationStatus.COMPLETED);

      // 8. Progress endpoint counts the script only once
      mockSessionUser = {
        id: owningProfId.toString(),
        email: 'xavier@university.edu',
        role: UserRole.PROFESSOR,
      };

      const progressReq = new NextRequest(
        `http://localhost:3000/api/exams/${examId.toString()}/progress`,
        { method: 'GET' }
      );
      const progressRes = await progressGET(progressReq, {
        params: Promise.resolve({ id: examId.toString() }),
      });
      expect(progressRes.status).toBe(200);
      const progressJson = await progressRes.json();
      expect(progressJson.success).toBe(true);
      expect(progressJson.data.total).toBe(1);
      expect(progressJson.data.graded).toBe(1);
    });
  });

  describe('5. Conflicts and Concurrency', () => {
    beforeEach(async () => {
      // Allocate and set up draft grades
      mockSessionUser = {
        id: owningProfId.toString(),
        email: 'xavier@university.edu',
        role: UserRole.PROFESSOR,
      };

      await allocatePOST(
        new NextRequest(`http://localhost:3000/api/exams/${examId.toString()}/allocate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule: AllocationRule.EQUAL, taIds: [ta1Id.toString()] }),
        }),
        { params: Promise.resolve({ id: examId.toString() }) }
      );

      mockSessionUser = {
        id: ta1Id.toString(),
        email: 'scott@university.edu',
        role: UserRole.TA,
      };

      await gradesPOST(
        new NextRequest(`http://localhost:3000/api/scripts/${scriptId.toString()}/grades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: 1,
            marksAwarded: [{ criterionName: 'Logic', score: 5 }, { criterionName: 'Clarity', score: 3 }],
            isFinal: false,
          }),
        }),
        { params: Promise.resolve({ id: scriptId.toString() }) }
      );

      await gradesPOST(
        new NextRequest(`http://localhost:3000/api/scripts/${scriptId.toString()}/grades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: 2,
            marksAwarded: [{ criterionName: 'Correctness', score: 6 }, { criterionName: 'Efficiency', score: 3 }],
            isFinal: false,
          }),
        }),
        { params: Promise.resolve({ id: scriptId.toString() }) }
      );
    });

    it('concurrent annotation saves on same base produce exactly one 200 and one 409 with current data & serverUpdatedAt', async () => {
      mockSessionUser = {
        id: ta1Id.toString(),
        email: 'scott@university.edu',
        role: UserRole.TA,
      };

      // Read current baseUpdatedAt
      const pageDoc = await Page.findById(pageId);
      const baseUpdatedAt = pageDoc!.updatedAt.toISOString();

      const save1Req = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/pages/1/annotations`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            annotations: [
              {
                id: 'a1',
                type: 'check',
                pageKey: pageId.toString(),
                x: 10,
                y: 10,
                size: 20,
                color: '#16a34a',
                createdAt: Date.now(),
              },
            ],
            strokes: [],
            baseUpdatedAt,
          }),
        }
      );

      const save2Req = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/pages/1/annotations`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            annotations: [
              {
                id: 'a2',
                type: 'cross',
                pageKey: pageId.toString(),
                x: 80,
                y: 80,
                size: 20,
                color: '#dc2626',
                createdAt: Date.now(),
              },
            ],
            strokes: [],
            baseUpdatedAt,
          }),
        }
      );

      const [res1, res2] = await Promise.all([
        annotationsPUT(save1Req, { params: Promise.resolve({ id: scriptId.toString(), p: '1' }) }),
        annotationsPUT(save2Req, { params: Promise.resolve({ id: scriptId.toString(), p: '1' }) }),
      ]);

      const statuses = [res1.status, res2.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);

      const conflictRes = res1.status === 409 ? res1 : res2;
      const conflictJson = await conflictRes.json();

      expect(conflictJson.success).toBe(false);
      expect(conflictJson.conflict).toBe(true);
      expect(conflictJson.data).toBeDefined();
      expect(conflictJson.data.annotations).toBeDefined();
      expect(conflictJson.serverUpdatedAt).toBeDefined();
      expect(typeof conflictJson.serverUpdatedAt).toBe('string');
    });

    it('concurrent submissions produce exactly one 200 and one 409', async () => {
      mockSessionUser = {
        id: ta1Id.toString(),
        email: 'scott@university.edu',
        role: UserRole.TA,
      };

      const submit1Req = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );

      const submit2Req = new NextRequest(
        `http://localhost:3000/api/scripts/${scriptId.toString()}/submit`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }
      );

      const [subRes1, subRes2] = await Promise.all([
        submitPOST(submit1Req, { params: Promise.resolve({ id: scriptId.toString() }) }),
        submitPOST(submit2Req, { params: Promise.resolve({ id: scriptId.toString() }) }),
      ]);

      const statuses = [subRes1.status, subRes2.status];
      expect(statuses).toContain(200);
      expect(statuses).toContain(409);

      const okRes = subRes1.status === 200 ? subRes1 : subRes2;
      const conflictRes = subRes1.status === 409 ? subRes1 : subRes2;

      const okJson = await okRes.json();
      expect(okJson.success).toBe(true);
      expect(okJson.data.allocationCompleted).toBe(true);

      const conflictJson = await conflictRes.json();
      expect(conflictJson.success).toBe(false);
      expect(conflictJson.message).toMatch(/already been submitted and completed/i);
    });
  });
});
