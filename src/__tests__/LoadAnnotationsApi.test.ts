/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam from '../models/Exam';
import AnswerScript from '../models/AnswerScript';
import Page from '../models/Page';
import Annotation from '../models/Annotation';
import {
  createCheckAnnotation,
  createCrossAnnotation,
  createHighlightAnnotation,
  createTextNoteAnnotation,
  CheckAnnotation,
  CrossAnnotation,
  HighlightAnnotation,
  TextNoteAnnotation,
} from '../lib/stampTool';
import { createStroke, FreehandStroke } from '../lib/penTool';

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

describe('AE-136: GET /scripts/[id]/pages/[p]/annotations (Load Annotations API)', () => {
  let loadAnnotationsGET: any;
  let saveAnnotationsPUT: any;

  let prof: any;
  let ta: any;
  let student: any;
  let course: any;
  let exam: any;
  let answerScript: any;
  let page1: any;
  let page2: any;
  let otherScript: any;
  let otherPage: any;

  beforeAll(async () => {
    const route = await import('../app/api/scripts/[id]/pages/[p]/annotations/route');
    loadAnnotationsGET = route.GET;
    saveAnnotationsPUT = route.PUT;
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await AnswerScript.deleteMany({});
    await Page.deleteMany({});
    await Annotation.deleteMany({});

    // 1. Create Users
    prof = await User.create({
      name: 'Professor McGonagall',
      email: `prof-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true,
    });

    ta = await User.create({
      name: 'Hermione Granger',
      email: `ta-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.TA,
      isActive: true,
    });

    student = await User.create({
      name: 'Ron Weasley',
      email: `student-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });

    // 2. Create Course and Exam
    course = await Course.create({
      courseCode: `CS-201-${Date.now()}`,
      courseName: 'Transfiguration Algorithms',
      semester: 1,
      academicYear: '2026-2027',
      professor: prof._id,
      teachingAssistants: [ta._id],
      enrolledStudents: [student._id],
      isActive: true,
    });

    exam = await Exam.create({
      title: 'Final Examination',
      course: course._id,
      createdBy: prof._id,
      totalMarks: 100,
      numberOfQuestions: 5,
      examDate: new Date('2026-06-15'),
      isActive: true,
    });

    // 3. Create AnswerScript and Pages
    answerScript = await AnswerScript.create({
      exam: exam._id,
      student: student._id,
      filePath: '/storage/scripts/exam1.pdf',
      filename: 'exam1.pdf',
      pageCount: 2,
      isActive: true,
    });

    page1 = await Page.create({
      answerScript: answerScript._id,
      pageNumber: 1,
      imagePath: '/storage/images/exam1_p1.png',
      isActive: true,
    });

    page2 = await Page.create({
      answerScript: answerScript._id,
      pageNumber: 2,
      imagePath: '/storage/images/exam1_p2.png',
      isActive: true,
    });

    // 4. Create another script for cross-script isolation checks
    otherScript = await AnswerScript.create({
      exam: exam._id,
      filePath: '/storage/scripts/exam2.pdf',
      filename: 'exam2.pdf',
      pageCount: 1,
      isActive: true,
    });

    otherPage = await Page.create({
      answerScript: otherScript._id,
      pageNumber: 1,
      imagePath: '/storage/images/exam2_p1.png',
      isActive: true,
    });

    // Default to TA session
    mockSessionUser = {
      id: ta._id.toString(),
      email: ta.email,
      name: ta.name,
      role: UserRole.TA,
    };
  });

  it('1. successfully loads saved annotations for an answer script page by pageNumber', async () => {
    // 1. Save annotations via PUT
    const check = createCheckAnnotation(page1._id.toString(), { x: 150, y: 250 }, { size: 30, color: '#16a34a' });
    const stroke = createStroke(page1._id.toString(), { x: 20, y: 30 }, { color: '#e11d48', strokeWidth: 4 });
    stroke.points = [20, 30, 40, 50];

    const putReq = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [check], strokes: [stroke] }),
      }
    );
    await saveAnnotationsPUT(putReq, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    // 2. Load annotations via GET
    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      { method: 'GET' }
    );
    const res = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Annotations loaded successfully');
    expect(body.data.scriptId).toBe(answerScript._id.toString());
    expect(body.data.pageId).toBe(page1._id.toString());
    expect(body.data.pageNumber).toBe(1);
    expect(body.data.totalAnnotations).toBe(1);
    expect(body.data.totalStrokes).toBe(1);
    expect(body.data.annotations[0].type).toBe('check');
    expect(body.data.strokes[0].points).toEqual([20, 30, 40, 50]);
    expect(body.data.annotatedBy).toBe(ta._id.toString());
  });

  it('2. successfully loads saved annotations using Page ObjectId as identifier', async () => {
    const cross = createCrossAnnotation(page2._id.toString(), { x: 100, y: 100 }, { size: 24, color: '#dc2626' });

    page2.annotations = { annotations: [cross], strokes: [] };
    page2.annotatedBy = ta._id;
    await page2.save();

    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/${page2._id}/annotations`,
      { method: 'GET' }
    );
    const res = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: page2._id.toString() }),
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.pageId).toBe(page2._id.toString());
    expect(body.data.totalAnnotations).toBe(1);
    expect(body.data.annotations[0].type).toBe('cross');
  });

  it('3. returns empty annotation and stroke collections when a page has no saved annotations (200 OK)', async () => {
    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/2/annotations`,
      { method: 'GET' }
    );
    const res = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '2' }),
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.totalAnnotations).toBe(0);
    expect(body.data.totalStrokes).toBe(0);
    expect(body.data.annotations).toEqual([]);
    expect(body.data.strokes).toEqual([]);
    expect(body.data.annotatedBy).toBeNull();
  });

  it('4. preserves and hydrates all supported AE-134 annotation types (check, cross, highlight, text note, pen stroke) and styles', async () => {
    const check = createCheckAnnotation(page1._id.toString(), { x: 50, y: 60 }, { size: 32, color: '#16a34a' });
    const cross = createCrossAnnotation(page1._id.toString(), { x: 70, y: 80 }, { size: 28, color: '#dc2626' });
    const hl = createHighlightAnnotation(
      page1._id.toString(),
      { x: 100, y: 120, width: 250, height: 45 },
      { color: '#fde047', opacity: 0.6 }
    );
    const text = createTextNoteAnnotation(
      page1._id.toString(),
      { x: 300, y: 400 },
      'Check lemma step 2',
      { fontSize: 16, color: '#0f172a', backgroundColor: '#fef9c3', borderColor: '#fde047' }
    );
    const stroke = createStroke(page1._id.toString(), { x: 10, y: 20 }, { color: '#2563eb', strokeWidth: 5 });
    stroke.points = [10, 20, 30, 40, 50, 60];

    page1.annotations = {
      annotations: [check, cross, hl, text],
      strokes: [stroke],
    };
    await page1.save();

    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      { method: 'GET' }
    );
    const res = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.totalAnnotations).toBe(4);
    expect(body.data.totalStrokes).toBe(1);

    const checkRes = body.data.annotations[0] as CheckAnnotation;
    const crossRes = body.data.annotations[1] as CrossAnnotation;
    const hlRes = body.data.annotations[2] as HighlightAnnotation;
    const textRes = body.data.annotations[3] as TextNoteAnnotation;
    const strokeRes = body.data.strokes[0] as FreehandStroke;

    expect(checkRes.type).toBe('check');
    expect(checkRes.size).toBe(32);
    expect(checkRes.color).toBe('#16a34a');

    expect(crossRes.type).toBe('cross');
    expect(crossRes.size).toBe(28);
    expect(crossRes.color).toBe('#dc2626');

    expect(hlRes.type).toBe('highlight');
    expect(hlRes.width).toBe(250);
    expect(hlRes.height).toBe(45);
    expect(hlRes.opacity).toBe(0.6);

    expect(textRes.type).toBe('text');
    expect(textRes.text).toBe('Check lemma step 2');
    expect(textRes.fontSize).toBe(16);
    expect(textRes.backgroundColor).toBe('#fef9c3');

    expect(strokeRes.strokeWidth).toBe(5);
    expect(strokeRes.color).toBe('#2563eb');
    expect(strokeRes.points).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('5. safely handles malformed / corrupt Page.annotations in database by falling back to empty collection', async () => {
    // Inject invalid raw structure into Page.annotations
    page1.annotations = { annotations: 'invalid_not_array' as any, strokes: null as any };
    await page1.save();

    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      { method: 'GET' }
    );
    const res = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.totalAnnotations).toBe(0);
    expect(body.data.totalStrokes).toBe(0);
    expect(body.data.annotations).toEqual([]);
    expect(body.data.strokes).toEqual([]);
  });

  it('6. rejects invalid script ID or page identifier format with 400 Bad Request', async () => {
    // Bad script ID
    const getReq1 = new NextRequest(
      'http://localhost:3000/api/scripts/invalid_script_id/pages/1/annotations',
      { method: 'GET' }
    );
    const res1 = await loadAnnotationsGET(getReq1, {
      params: Promise.resolve({ id: 'invalid_script_id', p: '1' }),
    });
    expect(res1.status).toBe(400);

    // Bad page identifier (non-numeric, non-ObjectId)
    const getReq2 = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/not-a-valid-page/annotations`,
      { method: 'GET' }
    );
    const res2 = await loadAnnotationsGET(getReq2, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: 'not-a-valid-page' }),
    });
    expect(res2.status).toBe(400);
  });

  it('7. returns 400 Bad Request when requested page belongs to a different script', async () => {
    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/${otherPage._id}/annotations`,
      { method: 'GET' }
    );
    const res = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: otherPage._id.toString() }),
    });

    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toContain('Page does not belong to the requested answer script');
  });

  it('8. returns 404 when script or page does not exist', async () => {
    // Non-existent script
    const fakeScriptId = '507f1f77bcf86cd799439011';
    const getReq1 = new NextRequest(
      `http://localhost:3000/api/scripts/${fakeScriptId}/pages/1/annotations`,
      { method: 'GET' }
    );
    const res1 = await loadAnnotationsGET(getReq1, {
      params: Promise.resolve({ id: fakeScriptId, p: '1' }),
    });
    expect(res1.status).toBe(404);

    // Non-existent page number
    const getReq2 = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/99/annotations`,
      { method: 'GET' }
    );
    const res2 = await loadAnnotationsGET(getReq2, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '99' }),
    });
    expect(res2.status).toBe(404);
  });

  it('9. rejects unauthenticated requests with 401 Unauthorized', async () => {
    mockSessionUser = null;

    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      { method: 'GET' }
    );
    const res = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    expect(res.status).toBe(401);
  });

  it('10. rejects unauthorized user roles (Student) with 403 Forbidden', async () => {
    mockSessionUser = {
      id: student._id.toString(),
      email: student.email,
      name: student.name,
      role: UserRole.STUDENT,
    };

    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      { method: 'GET' }
    );
    const res = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    expect(res.status).toBe(403);
  });

  it('11. verifies that the Annotation collection is not queried or modified', async () => {
    const check = createCheckAnnotation(page1._id.toString(), { x: 50, y: 50 });
    page1.annotations = { annotations: [check], strokes: [] };
    await page1.save();

    const getReq = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      { method: 'GET' }
    );
    const res = await loadAnnotationsGET(getReq, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.totalAnnotations).toBe(1);

    // Verify Annotation collection was never touched
    expect(await Annotation.countDocuments({})).toBe(0);
  });
});
