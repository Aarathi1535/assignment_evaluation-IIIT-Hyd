/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam from '../models/Exam';
import AnswerScript from '../models/AnswerScript';
import Page from '../models/Page';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import { createCheckAnnotation, createTextNoteAnnotation } from '../lib/stampTool';
import { createStroke } from '../lib/penTool';

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

describe('AE-135/AE-136 P2: TA Annotation Access is Allocation-Scoped', () => {
  let loadAnnotationsGET: any;
  let saveAnnotationsPUT: any;

  let prof: any;
  let admin: any;
  let taA: any;
  let taB: any;
  let student: any;

  let course: any;
  let exam: any;

  let scriptWhole: any;
  let pageWhole1: any;

  let scriptQuestion: any;
  let pageQuestion1: any;

  beforeAll(async () => {
    const route = await import('../app/api/scripts/[id]/pages/[p]/annotations/route');
    loadAnnotationsGET = route.GET;
    saveAnnotationsPUT = route.PUT;
  });

  beforeEach(async () => {
    mockSessionUser = null;

    await Allocation.deleteMany({});
    await Page.deleteMany({});
    await AnswerScript.deleteMany({});
    await Exam.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    // 1. Create Users (Professor, Admin, Two TAs on same course, Student)
    prof = await User.create({
      name: 'Professor Flitwick',
      email: `prof-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true,
    });

    admin = await User.create({
      name: 'Admin Dumbledore',
      email: `admin-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.ADMIN,
      isActive: true,
    });

    taA = await User.create({
      name: 'TA-A (Draco Malfoy)',
      email: `ta-a-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.TA,
      isActive: true,
    });

    taB = await User.create({
      name: 'TA-B (Hermione Granger)',
      email: `ta-b-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.TA,
      isActive: true,
    });

    const student1 = await User.create({
      name: 'Student Harry Potter',
      email: `student1-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });

    const student2 = await User.create({
      name: 'Student Neville Longbottom',
      email: `student2-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });

    student = student1;

    // 2. Create Course with BOTH TAs registered
    course = await Course.create({
      courseCode: `CS-301-${Date.now()}`,
      courseName: 'Advanced Charms',
      semester: 1,
      academicYear: '2026-2027',
      professor: prof._id,
      teachingAssistants: [taA._id, taB._id],
      enrolledStudents: [student1._id, student2._id],
      isActive: true,
    });

    exam = await Exam.create({
      title: 'Charms Midterm',
      course: course._id,
      createdBy: prof._id,
      totalMarks: 100,
      numberOfQuestions: 3,
      examDate: new Date('2026-06-15'),
      isActive: true,
    });

    // 3. Script 1: Whole-Script Allocation to TA-B only
    scriptWhole = await AnswerScript.create({
      exam: exam._id,
      student: student1._id,
      filePath: '/storage/scripts/script_whole.pdf',
      filename: 'script_whole.pdf',
      pageCount: 2,
      isActive: true,
    });

    pageWhole1 = await Page.create({
      answerScript: scriptWhole._id,
      pageNumber: 1,
      imagePath: '/storage/images/script_whole_p1.png',
      isActive: true,
    });

    await Allocation.create({
      exam: exam._id,
      ta: taB._id,
      answerScript: scriptWhole._id,
      allocatedBy: prof._id,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.EQUAL,
    });

    // 4. Script 2: Question-Wise Allocation (Q1 -> TA-B, Q2 -> TA-A)
    scriptQuestion = await AnswerScript.create({
      exam: exam._id,
      student: student2._id,
      filePath: '/storage/scripts/script_question.pdf',
      filename: 'script_question.pdf',
      pageCount: 2,
      isActive: true,
    });

    pageQuestion1 = await Page.create({
      answerScript: scriptQuestion._id,
      pageNumber: 1,
      imagePath: '/storage/images/script_question_p1.png',
      isActive: true,
    });

    await Allocation.create({
      exam: exam._id,
      ta: taB._id,
      answerScript: scriptQuestion._id,
      allocatedBy: prof._id,
      question: 1,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
    });

    await Allocation.create({
      exam: exam._id,
      ta: taA._id,
      answerScript: scriptQuestion._id,
      allocatedBy: prof._id,
      question: 2,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.QUESTION,
    });
  });

  // ==========================================
  // SECTION 1: Whole-Script Allocation Tests
  // ==========================================

  it('1. allows TA-B (owner of whole-script allocation) to GET annotations', async () => {
    mockSessionUser = {
      id: taB._id.toString(),
      email: taB.email,
      name: taB.name,
      role: UserRole.TA,
    };

    const req = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptWhole._id}/pages/1/annotations`,
      { method: 'GET' }
    );
    const res = await loadAnnotationsGET(req, {
      params: Promise.resolve({ id: scriptWhole._id.toString(), p: '1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.scriptId).toBe(scriptWhole._id.toString());
  });

  it('2. allows TA-B (owner of whole-script allocation) to PUT annotations', async () => {
    mockSessionUser = {
      id: taB._id.toString(),
      email: taB.email,
      name: taB.name,
      role: UserRole.TA,
    };

    const check = createCheckAnnotation(pageWhole1._id.toString(), { x: 100, y: 150 });
    const req = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptWhole._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [check], strokes: [] }),
      }
    );
    const res = await saveAnnotationsPUT(req, {
      params: Promise.resolve({ id: scriptWhole._id.toString(), p: '1' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.totalAnnotations).toBe(1);
  });

  it('3. rejects TA-A (same course, but NOT allocated to script) with 403 on GET annotations', async () => {
    mockSessionUser = {
      id: taA._id.toString(),
      email: taA.email,
      name: taA.name,
      role: UserRole.TA,
    };

    const req = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptWhole._id}/pages/1/annotations`,
      { method: 'GET' }
    );
    const res = await loadAnnotationsGET(req, {
      params: Promise.resolve({ id: scriptWhole._id.toString(), p: '1' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('not allocated to grade this answer script');
  });

  it('4. rejects TA-A (same course, but NOT allocated to script) with 403 on PUT annotations', async () => {
    mockSessionUser = {
      id: taA._id.toString(),
      email: taA.email,
      name: taA.name,
      role: UserRole.TA,
    };

    const check = createCheckAnnotation(pageWhole1._id.toString(), { x: 100, y: 150 });
    const req = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptWhole._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [check], strokes: [] }),
      }
    );
    const res = await saveAnnotationsPUT(req, {
      params: Promise.resolve({ id: scriptWhole._id.toString(), p: '1' }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toContain('not allocated to grade this answer script');
  });

  // ==========================================
  // SECTION 2: Question-Wise Allocation Tests
  // ==========================================

  it('5. allows TA-B to GET/PUT annotations for Question 1 (allocated to TA-B)', async () => {
    mockSessionUser = {
      id: taB._id.toString(),
      email: taB.email,
      name: taB.name,
      role: UserRole.TA,
    };

    // GET with ?question=1
    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptQuestion._id}/pages/1/annotations?question=1`,
      { method: 'GET' }
    );
    const getRes = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: scriptQuestion._id.toString(), p: '1' }),
    });
    expect(getRes.status).toBe(200);

    // PUT with question in query / body
    const stroke = createStroke(pageQuestion1._id.toString(), { x: 10, y: 10 });
    const putReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptQuestion._id}/pages/1/annotations?question=1`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [], strokes: [stroke], question: 1 }),
      }
    );
    const putRes = await saveAnnotationsPUT(putReq, {
      params: Promise.resolve({ id: scriptQuestion._id.toString(), p: '1' }),
    });
    expect(putRes.status).toBe(200);
  });

  it('6. rejects TA-B with 403 when trying to access Question 2 (allocated to TA-A)', async () => {
    mockSessionUser = {
      id: taB._id.toString(),
      email: taB.email,
      name: taB.name,
      role: UserRole.TA,
    };

    // GET with ?question=2
    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptQuestion._id}/pages/1/annotations?question=2`,
      { method: 'GET' }
    );
    const getRes = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: scriptQuestion._id.toString(), p: '1' }),
    });
    expect(getRes.status).toBe(403);

    // PUT with ?question=2
    const putReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptQuestion._id}/pages/1/annotations?question=2`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [], strokes: [], question: 2 }),
      }
    );
    const putRes = await saveAnnotationsPUT(putReq, {
      params: Promise.resolve({ id: scriptQuestion._id.toString(), p: '1' }),
    });
    expect(putRes.status).toBe(403);
  });

  it('7. allows TA-A to GET/PUT annotations for Question 2 (allocated to TA-A)', async () => {
    mockSessionUser = {
      id: taA._id.toString(),
      email: taA.email,
      name: taA.name,
      role: UserRole.TA,
    };

    // GET with ?question=2
    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptQuestion._id}/pages/1/annotations?question=2`,
      { method: 'GET' }
    );
    const getRes = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: scriptQuestion._id.toString(), p: '1' }),
    });
    expect(getRes.status).toBe(200);

    // PUT with ?question=2
    const text = createTextNoteAnnotation(pageQuestion1._id.toString(), { x: 50, y: 50 }, 'Question 2 correct');
    const putReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptQuestion._id}/pages/1/annotations?question=2`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [text], strokes: [], question: 2 }),
      }
    );
    const putRes = await saveAnnotationsPUT(putReq, {
      params: Promise.resolve({ id: scriptQuestion._id.toString(), p: '1' }),
    });
    expect(putRes.status).toBe(200);
  });

  it('8. rejects TA-A with 403 when trying to access Question 1 (allocated to TA-B)', async () => {
    mockSessionUser = {
      id: taA._id.toString(),
      email: taA.email,
      name: taA.name,
      role: UserRole.TA,
    };

    // GET with ?question=1
    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptQuestion._id}/pages/1/annotations?question=1`,
      { method: 'GET' }
    );
    const getRes = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: scriptQuestion._id.toString(), p: '1' }),
    });
    expect(getRes.status).toBe(403);

    // PUT with ?question=1
    const putReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptQuestion._id}/pages/1/annotations?question=1`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [], strokes: [], question: 1 }),
      }
    );
    const putRes = await saveAnnotationsPUT(putReq, {
      params: Promise.resolve({ id: scriptQuestion._id.toString(), p: '1' }),
    });
    expect(putRes.status).toBe(403);
  });

  // ==========================================
  // SECTION 3: Professor & Admin Broader Access
  // ==========================================

  it('9. preserves broader Professor access (can GET and PUT without personal allocation)', async () => {
    mockSessionUser = {
      id: prof._id.toString(),
      email: prof.email,
      name: prof.name,
      role: UserRole.PROFESSOR,
    };

    // GET
    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptWhole._id}/pages/1/annotations`,
      { method: 'GET' }
    );
    const getRes = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: scriptWhole._id.toString(), p: '1' }),
    });
    expect(getRes.status).toBe(200);

    // PUT
    const check = createCheckAnnotation(pageWhole1._id.toString(), { x: 50, y: 50 });
    const putReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptWhole._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [check], strokes: [] }),
      }
    );
    const putRes = await saveAnnotationsPUT(putReq, {
      params: Promise.resolve({ id: scriptWhole._id.toString(), p: '1' }),
    });
    expect(putRes.status).toBe(200);
  });

  it('10. preserves broader Admin access (can GET and PUT without personal allocation)', async () => {
    mockSessionUser = {
      id: admin._id.toString(),
      email: admin.email,
      name: admin.name,
      role: UserRole.ADMIN,
    };

    // GET
    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptWhole._id}/pages/1/annotations`,
      { method: 'GET' }
    );
    const getRes = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: scriptWhole._id.toString(), p: '1' }),
    });
    expect(getRes.status).toBe(200);

    // PUT
    const check = createCheckAnnotation(pageWhole1._id.toString(), { x: 80, y: 80 });
    const putReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptWhole._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [check], strokes: [] }),
      }
    );
    const putRes = await saveAnnotationsPUT(putReq, {
      params: Promise.resolve({ id: scriptWhole._id.toString(), p: '1' }),
    });
    expect(putRes.status).toBe(200);
  });

  // ==========================================
  // SECTION 4: Student & Unauthenticated Access
  // ==========================================

  it('11. rejects Student with 403 Forbidden', async () => {
    mockSessionUser = {
      id: student._id.toString(),
      email: student.email,
      name: student.name,
      role: UserRole.STUDENT,
    };

    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptWhole._id}/pages/1/annotations`,
      { method: 'GET' }
    );
    const getRes = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: scriptWhole._id.toString(), p: '1' }),
    });
    expect(getRes.status).toBe(403);
  });

  it('12. rejects unauthenticated request with 401 Unauthorized', async () => {
    mockSessionUser = null;

    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${scriptWhole._id}/pages/1/annotations`,
      { method: 'GET' }
    );
    const getRes = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: scriptWhole._id.toString(), p: '1' }),
    });
    expect(getRes.status).toBe(401);
  });
});
