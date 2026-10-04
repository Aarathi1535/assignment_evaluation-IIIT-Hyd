/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import Exam, { ExamStatus, IngestionApprovalStatus } from '../models/Exam';
import User from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Batch from '../models/Batch';
import IngestionJob from '../models/IngestionJob';
import IngestionPage from '../models/IngestionPage';
import { UserRole } from '../constants/permissions';
import bcrypt from 'bcryptjs';

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

describe('TA Creation and Script Allocation End-to-End Flow', () => {
  let usersGET: any;
  let coursesPOST: any;
  let examAllocateGET: any;
  let examAllocatePOST: any;
  let examAllocatePreviewPOST: any;
  let approveIngestionPOST: any;
  let allocationsGET: any;
  let allocationReassignPUT: any;

  const profId = new mongoose.Types.ObjectId('a00000000000000000000001');

  beforeAll(async () => {
    usersGET = (await import('../app/api/users/route')).GET;
    coursesPOST = (await import('../app/api/courses/route')).POST;
    examAllocateGET = (await import('../app/api/exams/[id]/allocate/route')).GET;
    examAllocatePOST = (await import('../app/api/exams/[id]/allocate/route')).POST;
    examAllocatePreviewPOST = (await import('../app/api/exams/[id]/allocate/preview/route')).POST;
    approveIngestionPOST = (await import('../app/api/exams/[id]/approve-ingestion/route')).POST;
    allocationsGET = (await import('../app/api/allocations/route')).GET;
    allocationReassignPUT = (await import('../app/api/exams/[id]/allocate/reassign/route')).PUT;
    process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'test-assembly-approval-secret-32-chars';
  });

  beforeEach(async () => {
    mockSessionUser = {
      id: profId.toString(),
      email: 'professor@iiit.ac.in',
      name: 'Prof. Albus',
      role: UserRole.PROFESSOR,
    };
  });

  it('allows Professor to discover a newly created TA, assign them to a course, and allocate exam scripts to them', async () => {
    // 1. Create a new active TA in the database
    const passwordHash = await bcrypt.hash('securePassword123', 10);
    const newTa = await User.create({
      name: 'Newly Created TA',
      email: 'newta@iiit.ac.in',
      password: passwordHash,
      role: UserRole.TA,
      isActive: true,
    });
    const secondTa = await User.create({
      name: 'Second Newly Created TA',
      email: 'secondnewta@iiit.ac.in',
      password: passwordHash,
      role: UserRole.TA,
      isActive: true,
    });

    // 2. Professor lists TAs to populate course TA selection dropdown
    const usersReq = new Request('http://localhost:3000/api/users?role=TA');
    const usersRes = await usersGET(usersReq as any);
    expect(usersRes.status).toBe(200);
    const usersData = await usersRes.json();
    expect(usersData.success).toBe(true);

    const foundTa = usersData.data.find((u: any) => u._id.toString() === newTa._id.toString());
    expect(foundTa).toBeDefined();
    expect(foundTa.name).toBe('Newly Created TA');
    expect(foundTa.email).toBe('newta@iiit.ac.in');
    expect(foundTa.role).toBe(UserRole.TA);

    // 3. Professor creates a course with the newly created TA
    const courseReq = new Request('http://localhost:3000/api/courses', {
      method: 'POST',
      body: JSON.stringify({
        courseCode: 'CS301-NEWTA',
        courseName: 'Advanced Algorithms',
        semester: '5',
        academicYear: '2026-27',
        teachingAssistants: [newTa._id.toString(), secondTa._id.toString()],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const courseRes = await coursesPOST(courseReq as any);
    expect(courseRes.status).toBe(201);
    const courseData = await courseRes.json();
    expect(courseData.success).toBe(true);
    const createdCourseId = courseData.data._id;

    // Course membership grants course access only; it must not create grading work.
    mockSessionUser = {
      id: newTa._id.toString(),
      email: newTa.email,
      name: newTa.name,
      role: UserRole.TA,
    };
    const courseOnlyQueueRes = await allocationsGET(
      new Request('http://localhost:3000/api/allocations') as any
    );
    expect(courseOnlyQueueRes.status).toBe(200);
    const courseOnlyQueue = await courseOnlyQueueRes.json();
    expect(courseOnlyQueue.data.allocations).toHaveLength(0);
    expect(courseOnlyQueue.data.stats).toMatchObject({
      assignedExams: 0,
      pending: 0,
    });
    mockSessionUser = {
      id: profId.toString(),
      email: 'professor@iiit.ac.in',
      name: 'Prof. Albus',
      role: UserRole.PROFESSOR,
    };

    // 4. Create an Exam for this course with approved ingestion
    const exam: any = await Exam.create({
      title: 'Midterm Exam 2026',
      course: new mongoose.Types.ObjectId(createdCourseId),
      createdBy: profId,
      examDate: new Date(),
      numberOfQuestions: 3,
      totalMarks: 100,
      status: ExamStatus.PUBLISHED,
      ingestionApprovalStatus: IngestionApprovalStatus.PENDING_REVIEW,
      isActive: true,
    });

    // Create 2 answer scripts for this exam
    const student1: any = await User.create({
      name: 'Student One',
      email: 's1@iiit.ac.in',
      password: passwordHash,
      role: UserRole.STUDENT,
      isActive: true,
    });
    const student2: any = await User.create({
      name: 'Student Two',
      email: 's2@iiit.ac.in',
      password: passwordHash,
      role: UserRole.STUDENT,
      isActive: true,
    });

    await AnswerScript.create({
      exam: exam._id,
      student: student1._id,
      candidateStudentId: 'S1',
      isActive: true,
    });

    await AnswerScript.create({
      exam: exam._id,
      student: student2._id,
      candidateStudentId: 'S2',
      isActive: true,
    });

    const approveReq = new Request(`http://localhost:3000/api/exams/${exam._id}/approve-ingestion`, {
      method: 'POST',
    });
    const approveRes = await approveIngestionPOST(approveReq as any, {
      params: Promise.resolve({ id: exam._id.toString() }),
    });
    expect(approveRes.status).toBe(200);
    const approvedExam = await Exam.findById(exam._id).lean();
    expect(approvedExam?.ingestionApprovalStatus).toBe(IngestionApprovalStatus.APPROVED);
    expect(approvedExam?.approvedBy?.toString()).toBe(profId.toString());
    expect(approvedExam?.approvedAt).toBeInstanceOf(Date);
    expect(approvedExam?.assemblySeal).toBeTruthy();
    expect(approvedExam?.assemblySealAt).toBeInstanceOf(Date);

    // 5. Professor accesses the Script Allocation page: GET /api/exams/[id]/allocate
    const allocateSettingsRes = await examAllocateGET(
      new Request(`http://localhost:3000/api/exams/${exam._id}/allocate`) as any,
      { params: Promise.resolve({ id: exam._id.toString() }) }
    );
    expect(allocateSettingsRes.status).toBe(200);
    const allocateSettingsData = await allocateSettingsRes.json();
    expect(allocateSettingsData.success).toBe(true);

    const eligibleTas = allocateSettingsData.data.teachingAssistants;
    expect(eligibleTas).toHaveLength(2);
    expect(eligibleTas.map((ta: any) => ta._id.toString())).toContain(newTa._id.toString());

    // 6. Professor previews allocation with this TA
    const previewReq = new Request(`http://localhost:3000/api/exams/${exam._id}/allocate/preview`, {
      method: 'POST',
      body: JSON.stringify({
        rule: 'EQUAL',
        taIds: [newTa._id.toString(), secondTa._id.toString()],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const previewRes = await examAllocatePreviewPOST(previewReq as any, {
      params: Promise.resolve({ id: exam._id.toString() }),
    });
    expect(previewRes.status).toBe(200);
    const previewData = await previewRes.json();
    expect(previewData.success).toBe(true);
    expect(previewData.data.allocationCounts[newTa._id.toString()]).toBe(1);
    expect(previewData.data.allocationCounts[secondTa._id.toString()]).toBe(1);

    // 7. Professor executes script allocation for this TA
    const allocateReq = new Request(`http://localhost:3000/api/exams/${exam._id}/allocate`, {
      method: 'POST',
      body: JSON.stringify({
        rule: 'EQUAL',
        taIds: [newTa._id.toString(), secondTa._id.toString()],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const batchCountBefore = await Batch.countDocuments({ exam: exam._id });
    const jobCountBefore = await IngestionJob.countDocuments({});
    const pageCountBefore = await IngestionPage.countDocuments({});
    const scriptCountBefore = await AnswerScript.countDocuments({ exam: exam._id });
    const allocateRes = await examAllocatePOST(allocateReq as any, {
      params: Promise.resolve({ id: exam._id.toString() }),
    });
    expect(allocateRes.status).toBe(200);
    const allocateResult = await allocateRes.json();
    expect(allocateResult.success).toBe(true);
    expect(allocateResult.data.length).toBe(2);
    expect(allocateResult.data.map((allocation: any) => allocation.ta.toString()).sort()).toEqual(
      [newTa._id.toString(), secondTa._id.toString()].sort()
    );

    const examAfterAllocation = await Exam.findById(exam._id).lean();
    expect(examAfterAllocation?.ingestionApprovalStatus).toBe(IngestionApprovalStatus.APPROVED);
    expect(examAfterAllocation?.approvedBy?.toString()).toBe(approvedExam?.approvedBy?.toString());
    expect(examAfterAllocation?.approvedAt?.toISOString()).toBe(approvedExam?.approvedAt?.toISOString());
    expect(examAfterAllocation?.assemblySeal).toBe(approvedExam?.assemblySeal);
    expect(examAfterAllocation?.assemblySealAt?.toISOString()).toBe(
      approvedExam?.assemblySealAt?.toISOString()
    );
    expect(await Batch.countDocuments({ exam: exam._id })).toBe(batchCountBefore);
    expect(await IngestionJob.countDocuments({})).toBe(jobCountBefore);
    expect(await IngestionPage.countDocuments({})).toBe(pageCountBefore);
    expect(await AnswerScript.countDocuments({ exam: exam._id })).toBe(scriptCountBefore);

    const persistedAllocation = await Allocation.findOne({
      exam: exam._id,
      ta: newTa._id,
    });
    expect(persistedAllocation).not.toBeNull();
    expect(persistedAllocation?.exam.toString()).toBe(exam._id.toString());
    expect(persistedAllocation?.ta.toString()).toBe(newTa._id.toString());
    expect(persistedAllocation?.answerScript.toString()).toBe(
      allocateResult.data[0].answerScript.toString()
    );
    expect(persistedAllocation?.status).toBe(AllocationStatus.PENDING);
    const secondTaAllocation = await Allocation.findOne({
      exam: exam._id,
      ta: secondTa._id,
    });
    expect(secondTaAllocation).not.toBeNull();
    expect(secondTaAllocation?.ta.toString()).toBe(secondTa._id.toString());
    expect(secondTaAllocation?.answerScript.toString()).toBe(
      allocateResult.data.find((allocation: any) =>
        allocation.ta.toString() === secondTa._id.toString()
      ).answerScript.toString()
    );

    mockSessionUser = {
      id: newTa._id.toString(),
      email: newTa.email,
      name: newTa.name,
      role: UserRole.TA,
    };
    const taAQueueRes = await allocationsGET(
      new Request('http://localhost:3000/api/allocations') as any
    );
    expect(taAQueueRes.status).toBe(200);
    const taAQueue = await taAQueueRes.json();
    expect(taAQueue.data.allocations).toHaveLength(1);
    expect(taAQueue.data.stats).toMatchObject({
      assignedExams: 1,
      pending: 1,
    });
    expect(taAQueue.data.allocations).toContainEqual(
      expect.objectContaining({
        _id: persistedAllocation?._id.toString(),
        exam: exam._id.toString(),
        status: AllocationStatus.PENDING,
        answerScript: expect.objectContaining({
          _id: persistedAllocation?.answerScript.toString(),
        }),
      })
    );

    mockSessionUser = {
      id: secondTa._id.toString(),
      email: secondTa.email,
      name: secondTa.name,
      role: UserRole.TA,
    };
    const taBInitialQueueRes = await allocationsGET(
      new Request('http://localhost:3000/api/allocations') as any
    );
    expect(taBInitialQueueRes.status).toBe(200);
    const taBInitialQueue = await taBInitialQueueRes.json();
    expect(taBInitialQueue.data.allocations).toHaveLength(1);
    expect(taBInitialQueue.data.stats).toMatchObject({
      assignedExams: 1,
      pending: 1,
    });
    expect(taBInitialQueue.data.allocations).toContainEqual(
      expect.objectContaining({
        _id: secondTaAllocation?._id.toString(),
        exam: exam._id.toString(),
        status: AllocationStatus.PENDING,
        answerScript: expect.objectContaining({
          _id: secondTaAllocation?.answerScript.toString(),
        }),
      })
    );

    mockSessionUser = {
      id: profId.toString(),
      email: 'professor@iiit.ac.in',
      name: 'Prof. Albus',
      role: UserRole.PROFESSOR,
    };
    const reassignRes = await allocationReassignPUT(
      new Request(`http://localhost:3000/api/exams/${exam._id}/allocate/reassign`, {
        method: 'PUT',
        body: JSON.stringify({
          allocationId: persistedAllocation?._id.toString(),
          targetTaId: secondTa._id.toString(),
        }),
        headers: { 'Content-Type': 'application/json' },
      }) as any,
      { params: Promise.resolve({ id: exam._id.toString() }) }
    );
    expect(reassignRes.status).toBe(200);

    mockSessionUser = {
      id: newTa._id.toString(),
      email: newTa.email,
      name: newTa.name,
      role: UserRole.TA,
    };
    const taAQueueAfterReassignRes = await allocationsGET(
      new Request('http://localhost:3000/api/allocations') as any
    );
    const taAQueueAfterReassign = await taAQueueAfterReassignRes.json();
    expect(taAQueueAfterReassign.data.allocations).toHaveLength(0);
    expect(
      taAQueueAfterReassign.data.allocations.some(
        (allocation: any) => allocation._id === persistedAllocation?._id.toString()
      )
    ).toBe(false);

    mockSessionUser = {
      id: secondTa._id.toString(),
      email: secondTa.email,
      name: secondTa.name,
      role: UserRole.TA,
    };
    const taBQueueRes = await allocationsGET(
      new Request('http://localhost:3000/api/allocations') as any
    );
    expect(taBQueueRes.status).toBe(200);
    const taBQueue = await taBQueueRes.json();
    expect(taBQueue.data.allocations).toHaveLength(2);
    expect(taBQueue.data.allocations).toContainEqual(expect.objectContaining({
      _id: persistedAllocation?._id.toString(),
      exam: exam._id.toString(),
      status: AllocationStatus.PENDING,
      answerScript: expect.objectContaining({
        _id: persistedAllocation?.answerScript.toString(),
      }),
    }));
  });
});
