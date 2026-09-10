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

describe('AE-135: PUT /scripts/[id]/pages/[p]/annotations (Save Annotations API)', () => {
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
    saveAnnotationsPUT = (
      await import('../app/api/scripts/[id]/pages/[p]/annotations/route')
    ).PUT;
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
      name: 'Professor Dumbledore',
      email: `prof-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true,
    });

    ta = await User.create({
      name: 'Percy Weasley',
      email: `ta-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.TA,
      isActive: true,
    });

    student = await User.create({
      name: 'Harry Potter',
      email: `student-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });

    // 2. Create Course and Exam
    course = await Course.create({
      courseCode: `CS-101-${Date.now()}`,
      courseName: 'Algorithms',
      semester: 1,
      academicYear: '2026-2027',
      professor: prof._id,
      teachingAssistants: [ta._id],
      enrolledStudents: [student._id],
      isActive: true,
    });

    exam = await Exam.create({
      title: 'Midterm Exam',
      course: course._id,
      createdBy: prof._id,
      totalMarks: 100,
      numberOfQuestions: 5,
      examDate: new Date('2026-05-15'),
      isActive: true,
    });

    // 3. Create AnswerScript and Pages
    answerScript = await AnswerScript.create({
      exam: exam._id,
      student: student._id,
      filePath: '/storage/scripts/script1.pdf',
      filename: 'script1.pdf',
      pageCount: 2,
      isActive: true,
    });

    page1 = await Page.create({
      answerScript: answerScript._id,
      pageNumber: 1,
      imagePath: '/storage/images/page1.png',
      isActive: true,
    });

    page2 = await Page.create({
      answerScript: answerScript._id,
      pageNumber: 2,
      imagePath: '/storage/images/page2.png',
      isActive: true,
    });

    // 4. Create another script and page for isolation checks
    otherScript = await AnswerScript.create({
      exam: exam._id,
      filePath: '/storage/scripts/other.pdf',
      filename: 'other.pdf',
      pageCount: 1,
      isActive: true,
    });

    otherPage = await Page.create({
      answerScript: otherScript._id,
      pageNumber: 1,
      imagePath: '/storage/images/other_page1.png',
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

  it('1. successfully saves annotations for an answer script page by pageNumber directly to Page.annotations', async () => {
    const check = createCheckAnnotation(page1._id.toString(), { x: 120, y: 340 }, { size: 28, color: '#16a34a' });
    const hl = createHighlightAnnotation(page1._id.toString(), { x: 50, y: 100, width: 200, height: 40 });
    const text = createTextNoteAnnotation(page1._id.toString(), { x: 200, y: 250 }, 'Great derivation');
    const stroke = createStroke(page1._id.toString(), { x: 10, y: 10 }, { color: '#e11d48', strokeWidth: 3 });
    stroke.points = [10, 10, 20, 20, 30, 30];

    const payload = {
      annotations: [check, hl, text],
      strokes: [stroke],
    };

    const req = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const res = await saveAnnotationsPUT(req, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.message).toBe('Annotations saved successfully');
    expect(body.data.scriptId).toBe(answerScript._id.toString());
    expect(body.data.pageNumber).toBe(1);
    expect(body.data.totalAnnotations).toBe(3);
    expect(body.data.totalStrokes).toBe(1);

    // Verify DB persistence on Page as Single Source of Truth
    const updatedPage = await Page.findById(page1._id);
    expect(updatedPage?.annotations).toBeDefined();
    expect(updatedPage?.annotations?.annotations.length).toBe(3);
    expect(updatedPage?.annotations?.strokes.length).toBe(1);
    expect(updatedPage?.annotatedBy?.toString()).toBe(ta._id.toString());

    // Verify NO Annotation collection documents are created as a side effect
    expect(await Annotation.countDocuments({})).toBe(0);
  });

  it('2. successfully saves annotations using Page ObjectId as identifier', async () => {
    const cross = createCrossAnnotation(page2._id.toString(), { x: 80, y: 90 });
    const payload = {
      annotations: [cross],
      strokes: [],
    };

    const req = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/${page2._id}/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const res = await saveAnnotationsPUT(req, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: page2._id.toString() }),
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.pageId).toBe(page2._id.toString());
    expect(body.data.totalAnnotations).toBe(1);

    const updatedPage2 = await Page.findById(page2._id);
    expect(updatedPage2?.annotations?.annotations.length).toBe(1);
    expect(await Annotation.countDocuments({})).toBe(0);
  });

  it('3. repeated PUT replaces the existing annotation state on the same Page document rather than duplicating it (idempotency)', async () => {
    const check1 = createCheckAnnotation(page1._id.toString(), { x: 50, y: 50 });
    const payload1 = { annotations: [check1], strokes: [] };

    const req1 = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload1),
      }
    );
    await saveAnnotationsPUT(req1, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    // First save: 1 annotation on page1
    const pageAfterFirst = await Page.findById(page1._id);
    expect(pageAfterFirst?.annotations?.annotations.length).toBe(1);
    expect(pageAfterFirst?.annotations?.annotations[0].type).toBe('check');

    // Second PUT with different annotation: replaces state on the same page document
    const cross2 = createCrossAnnotation(page1._id.toString(), { x: 99, y: 99 });
    const payload2 = { annotations: [cross2], strokes: [] };

    const req2 = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload2),
      }
    );
    const res2 = await saveAnnotationsPUT(req2, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    const body2 = await res2.json();
    expect(res2.status).toBe(200);
    expect(body2.data.totalAnnotations).toBe(1);
    expect(body2.data.annotations[0].type).toBe('cross');

    // Total pages for this script remains 2 (no duplicate Page documents created)
    expect(await Page.countDocuments({ answerScript: answerScript._id })).toBe(2);

    const pageAfterSecond = await Page.findById(page1._id);
    expect(pageAfterSecond?.annotations?.annotations.length).toBe(1);
    expect(pageAfterSecond?.annotations?.annotations[0].type).toBe('cross');

    // Still 0 Annotation collection documents created
    expect(await Annotation.countDocuments({})).toBe(0);
  });

  it('4. rejects invalid annotation payload with 400 Bad Request', async () => {
    const invalidPayload = {
      annotations: [
        {
          id: 'bad_ann',
          type: 'invalid_shape_type',
          x: 'not_a_number',
          y: 50,
        },
      ],
    };

    const req = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(invalidPayload),
      }
    );

    const res = await saveAnnotationsPUT(req, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toContain('Invalid annotation payload');
  });

  it('5. rejects invalid script ID or page identifier format with 400 Bad Request', async () => {
    // Bad script ID
    const req1 = new NextRequest('http://localhost:3000/api/scripts/invalid_id/pages/1/annotations', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ annotations: [] }),
    });
    const res1 = await saveAnnotationsPUT(req1, {
      params: Promise.resolve({ id: 'invalid_id', p: '1' }),
    });
    expect(res1.status).toBe(400);

    // Bad page identifier (non-numeric string that is not ObjectId)
    const req2 = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/not-a-page/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [] }),
      }
    );
    const res2 = await saveAnnotationsPUT(req2, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: 'not-a-page' }),
    });
    expect(res2.status).toBe(400);
  });

  it('6. returns 400/404 when requested page belongs to a different script', async () => {
    // Attempting to save otherPage on answerScript (cross-script page mismatch)
    const req = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/${otherPage._id}/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [] }),
      }
    );

    const res = await saveAnnotationsPUT(req, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: otherPage._id.toString() }),
    });

    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.success).toBe(false);
    expect(body.message).toContain('Page does not belong to the requested answer script');
  });

  it('7. rejects unauthenticated requests with 401 Unauthorized', async () => {
    mockSessionUser = null; // simulate logged out user

    const req = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [] }),
      }
    );

    const res = await saveAnnotationsPUT(req, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    const body = await res.json();
    expect(res.status).toBe(401);
    expect(body.success).toBe(false);
  });

  it('8. rejects unauthorized user roles (Student) with 403 Forbidden', async () => {
    mockSessionUser = {
      id: student._id.toString(),
      email: student.email,
      name: student.name,
      role: UserRole.STUDENT,
    };

    const req = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [] }),
      }
    );

    const res = await saveAnnotationsPUT(req, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    const body = await res.json();
    expect(res.status).toBe(403);
    expect(body.success).toBe(false);
  });

  it('9. confirms source page image storage path remains completely untouched and immutable', async () => {
    const originalImagePath = page1.imagePath;

    const check = createCheckAnnotation(page1._id.toString(), { x: 10, y: 10 });
    const req = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [check] }),
      }
    );

    await saveAnnotationsPUT(req, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    const pageAfter = await Page.findById(page1._id);
    expect(pageAfter?.imagePath).toBe(originalImagePath);
  });

  it('10. preserves all supported AE-134 annotation types and styling properties across persistence', async () => {
    const check = createCheckAnnotation(page1._id.toString(), { x: 100, y: 150 }, { size: 36, color: '#16a34a' });
    const cross = createCrossAnnotation(page1._id.toString(), { x: 200, y: 250 }, { size: 30, color: '#dc2626' });
    const hl = createHighlightAnnotation(page1._id.toString(), { x: 50, y: 60, width: 300, height: 50 }, { color: '#fde047', opacity: 0.5 });
    const text = createTextNoteAnnotation(
      page1._id.toString(),
      { x: 350, y: 400 },
      'Check formula on line 3',
      { fontSize: 18, color: '#0f172a', backgroundColor: '#fef9c3', borderColor: '#fde047' }
    );
    const stroke = createStroke(page1._id.toString(), { x: 10, y: 10 }, { color: '#2563eb', strokeWidth: 5 });
    stroke.points = [10, 10, 20, 20, 30, 30];

    const payload = {
      annotations: [check, cross, hl, text],
      strokes: [stroke],
    };

    const req = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const res = await saveAnnotationsPUT(req, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);

    const pageDoc = await Page.findById(page1._id);
    const savedAnnotations = pageDoc?.annotations?.annotations || [];
    const savedStrokes = pageDoc?.annotations?.strokes || [];

    expect(savedAnnotations.length).toBe(4);
    expect(savedStrokes.length).toBe(1);

    const checkAnn = savedAnnotations[0] as CheckAnnotation;
    const crossAnn = savedAnnotations[1] as CrossAnnotation;
    const hlAnn = savedAnnotations[2] as HighlightAnnotation;
    const textAnn = savedAnnotations[3] as TextNoteAnnotation;
    const strokeAnn = savedStrokes[0] as FreehandStroke;

    // Check styling
    expect(checkAnn.size).toBe(36);
    expect(checkAnn.color).toBe('#16a34a');

    // Cross styling
    expect(crossAnn.size).toBe(30);
    expect(crossAnn.color).toBe('#dc2626');

    // Highlight styling
    expect(hlAnn.width).toBe(300);
    expect(hlAnn.height).toBe(50);
    expect(hlAnn.opacity).toBe(0.5);

    // Text note styling
    expect(textAnn.text).toBe('Check formula on line 3');
    expect(textAnn.fontSize).toBe(18);
    expect(textAnn.backgroundColor).toBe('#fef9c3');

    // Stroke points & width
    expect(strokeAnn.points).toEqual([10, 10, 20, 20, 30, 30]);
    expect(strokeAnn.strokeWidth).toBe(5);
    expect(strokeAnn.color).toBe('#2563eb');
  });

  it('11. verifies that the Annotation collection is not modified and Page.annotations is the sole single source of truth', async () => {
    // Perform multiple saves across page1 and page2
    const check = createCheckAnnotation(page1._id.toString(), { x: 50, y: 50 });
    const req1 = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/1/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [check], strokes: [] }),
      }
    );
    await saveAnnotationsPUT(req1, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '1' }),
    });

    const cross = createCrossAnnotation(page2._id.toString(), { x: 75, y: 75 });
    const req2 = new NextRequest(
      `http://localhost:3000/api/scripts/${answerScript._id}/pages/2/annotations`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: [cross], strokes: [] }),
      }
    );
    await saveAnnotationsPUT(req2, {
      params: Promise.resolve({ id: answerScript._id.toString(), p: '2' }),
    });

    // Verify Page documents have their respective annotations
    const dbPage1 = await Page.findById(page1._id);
    const dbPage2 = await Page.findById(page2._id);
    expect(dbPage1?.annotations?.annotations[0].type).toBe('check');
    expect(dbPage2?.annotations?.annotations[0].type).toBe('cross');

    // Verify zero documents in Annotation collection
    const annotationCount = await Annotation.countDocuments({});
    expect(annotationCount).toBe(0);
  });
});
