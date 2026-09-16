/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import Exam, { ExamStatus, IngestionApprovalStatus } from '../models/Exam';
import User from '../models/User';
import AnswerScript from '../models/AnswerScript';
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

  const profId = new mongoose.Types.ObjectId('a00000000000000000000001');

  beforeAll(async () => {
    usersGET = (await import('../app/api/users/route')).GET;
    coursesPOST = (await import('../app/api/courses/route')).POST;
    examAllocateGET = (await import('../app/api/exams/[id]/allocate/route')).GET;
    examAllocatePOST = (await import('../app/api/exams/[id]/allocate/route')).POST;
    examAllocatePreviewPOST = (await import('../app/api/exams/[id]/allocate/preview/route')).POST;
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
        teachingAssistants: [newTa._id.toString()],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const courseRes = await coursesPOST(courseReq as any);
    expect(courseRes.status).toBe(201);
    const courseData = await courseRes.json();
    expect(courseData.success).toBe(true);
    const createdCourseId = courseData.data._id;

    // 4. Create an Exam for this course with approved ingestion
    const exam: any = await Exam.create({
      title: 'Midterm Exam 2026',
      course: new mongoose.Types.ObjectId(createdCourseId),
      createdBy: profId,
      examDate: new Date(),
      numberOfQuestions: 3,
      totalMarks: 100,
      status: ExamStatus.PUBLISHED,
      ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
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

    // 5. Professor accesses the Script Allocation page: GET /api/exams/[id]/allocate
    const allocateSettingsRes = await examAllocateGET(
      new Request(`http://localhost:3000/api/exams/${exam._id}/allocate`) as any,
      { params: Promise.resolve({ id: exam._id.toString() }) }
    );
    expect(allocateSettingsRes.status).toBe(200);
    const allocateSettingsData = await allocateSettingsRes.json();
    expect(allocateSettingsData.success).toBe(true);

    const eligibleTas = allocateSettingsData.data.teachingAssistants;
    expect(eligibleTas.length).toBe(1);
    expect(eligibleTas[0]._id.toString()).toBe(newTa._id.toString());
    expect(eligibleTas[0].name).toBe('Newly Created TA');

    // 6. Professor previews allocation with this TA
    const previewReq = new Request(`http://localhost:3000/api/exams/${exam._id}/allocate/preview`, {
      method: 'POST',
      body: JSON.stringify({
        rule: 'EQUAL',
        taIds: [newTa._id.toString()],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const previewRes = await examAllocatePreviewPOST(previewReq as any, {
      params: Promise.resolve({ id: exam._id.toString() }),
    });
    expect(previewRes.status).toBe(200);
    const previewData = await previewRes.json();
    expect(previewData.success).toBe(true);
    expect(previewData.data.allocationCounts[newTa._id.toString()]).toBe(2);

    // 7. Professor executes script allocation for this TA
    const allocateReq = new Request(`http://localhost:3000/api/exams/${exam._id}/allocate`, {
      method: 'POST',
      body: JSON.stringify({
        rule: 'EQUAL',
        taIds: [newTa._id.toString()],
      }),
      headers: { 'Content-Type': 'application/json' },
    });
    const allocateRes = await examAllocatePOST(allocateReq as any, {
      params: Promise.resolve({ id: exam._id.toString() }),
    });
    expect(allocateRes.status).toBe(200);
    const allocateResult = await allocateRes.json();
    expect(allocateResult.success).toBe(true);
    expect(allocateResult.data.length).toBe(2);
    expect(allocateResult.data[0].ta.toString()).toBe(newTa._id.toString());
    expect(allocateResult.data[1].ta.toString()).toBe(newTa._id.toString());
  });
});
