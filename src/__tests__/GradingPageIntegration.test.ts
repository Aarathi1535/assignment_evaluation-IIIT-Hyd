/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam from '../models/Exam';
import AnswerScript from '../models/AnswerScript';
import IngestionJob from '../models/IngestionJob';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import Allocation, { AllocationStatus } from '../models/Allocation';
import GradingPage from '../app/(dashboard)/grading/[scriptId]/page';
import { AnswerSheetCanvas } from '../components/canvas/AnswerSheetCanvas';
import type { AnswerSheetPage } from '../lib/pageNavigation';

let mockSessionUser: any = null;
let mockParams: { scriptId?: string } = {};

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

vi.mock('next/navigation', () => ({
  useParams: () => mockParams,
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

describe('Grading Page & AnswerSheetCanvas Integration', () => {
  let scriptGET: any;
  let pagesGET: any;

  let prof: any;
  let otherProf: any;
  let taAllocated: any;
  let taUnallocated: any;
  let student: any;
  let course: any;
  let exam: any;
  let answerScript: any;
  let page1: any;
  let page2: any;

  beforeAll(async () => {
    const scriptRoute = await import('../app/api/scripts/[id]/route');
    scriptGET = scriptRoute.GET;

    const pagesRoute = await import('../app/api/scripts/[id]/pages/route');
    pagesGET = pagesRoute.GET;
  });

  beforeEach(async () => {
    await User.deleteMany({});
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await AnswerScript.deleteMany({});
    await IngestionJob.deleteMany({});
    await IngestionPage.deleteMany({});
    await Allocation.deleteMany({});

    // 1. Create Users
    prof = await User.create({
      name: 'Professor Severus Snape',
      email: `prof-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true,
    });

    otherProf = await User.create({
      name: 'Professor Minerva McGonagall',
      email: `other-prof-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true,
    });

    taAllocated = await User.create({
      name: 'Hermione Granger (Allocated TA)',
      email: `ta-alloc-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.TA,
      isActive: true,
    });

    taUnallocated = await User.create({
      name: 'Draco Malfoy (Unallocated TA)',
      email: `ta-unalloc-${Date.now()}@hogwarts.edu`,
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
      courseCode: `CS-POTIONS-${Date.now()}`,
      courseName: 'Advanced Potions Algorithms',
      semester: 1,
      academicYear: '2026-2027',
      professor: prof._id,
      teachingAssistants: [taAllocated._id, taUnallocated._id],
      enrolledStudents: [student._id],
      isActive: true,
    });

    exam = await Exam.create({
      title: 'Potions Midterm Exam',
      course: course._id,
      createdBy: prof._id,
      totalMarks: 100,
      numberOfQuestions: 3,
      examDate: new Date('2026-06-15'),
      isActive: true,
      blindGrading: true,
    });

    // 3. Create AnswerScript
    answerScript = await AnswerScript.create({
      exam: exam._id,
      student: student._id,
      batchId: 'batch-potions-101',
      fileIndex: 0,
      startPageNumber: 1,
      endPageNumber: 2,
      pageCount: 2,
      candidateStudentId: 'POTTER-777',
      isActive: true,
    });

    // 4. Create IngestionPages with dummy job ID
    const dummyJobId = new mongoose.Types.ObjectId();

    page1 = await IngestionPage.create({
      batchId: 'batch-potions-101',
      job: dummyJobId,
      fileId: 'file-1',
      fileIndex: 0,
      storageKey: 'batches/batch-potions-101/derived/file-1/1/page.png',
      width: 1200,
      height: 1600,
      pageNumber: 1,
      status: PageProcessingStatus.PROCESSED,
      answerScript: answerScript._id,
    });

    page2 = await IngestionPage.create({
      batchId: 'batch-potions-101',
      job: dummyJobId,
      fileId: 'file-1',
      fileIndex: 0,
      storageKey: 'batches/batch-potions-101/derived/file-1/2/page.png',
      width: 1200,
      height: 1600,
      pageNumber: 2,
      status: PageProcessingStatus.PROCESSED,
      answerScript: answerScript._id,
    });

    // 5. Allocate AnswerScript to taAllocated
    await Allocation.create({
      exam: exam._id,
      ta: taAllocated._id,
      answerScript: answerScript._id,
      status: AllocationStatus.PENDING,
      allocatedBy: prof._id,
    });

    mockSessionUser = {
      id: taAllocated._id.toString(),
      email: taAllocated.email,
      name: taAllocated.name,
      role: UserRole.TA,
    };
    mockParams = { scriptId: answerScript._id.toString() };
  });

  describe('1. Server-Side Script & Pages Authorization API', () => {
    it('returns 401 Unauthorized when unauthenticated', async () => {
      mockSessionUser = null;
      const req = new NextRequest(`http://localhost:3000/api/scripts/${answerScript._id}`);
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: answerScript._id.toString() }),
      });
      expect(res.status).toBe(401);
    });

    it('returns 400 Bad Request for invalid script ID format', async () => {
      const req = new NextRequest('http://localhost:3000/api/scripts/not-a-valid-id');
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: 'not-a-valid-id' }),
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.message).toContain('Invalid AnswerScript ID format');
    });

    it('returns 404 Not Found for non-existent answer script', async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const req = new NextRequest(`http://localhost:3000/api/scripts/${fakeId}`);
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: fakeId }),
      });
      expect(res.status).toBe(404);
    });

    it('returns 403 Forbidden when unallocated TA attempts to access the script', async () => {
      mockSessionUser = {
        id: taUnallocated._id.toString(),
        email: taUnallocated.email,
        name: taUnallocated.name,
        role: UserRole.TA,
      };

      const req = new NextRequest(`http://localhost:3000/api/scripts/${answerScript._id}`);
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: answerScript._id.toString() }),
      });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.message).toContain('Forbidden');
    });

    it('returns 403 Forbidden when an unauthorized Professor attempts to access the script', async () => {
      mockSessionUser = {
        id: otherProf._id.toString(),
        email: otherProf.email,
        name: otherProf.name,
        role: UserRole.PROFESSOR,
      };

      const req = new NextRequest(`http://localhost:3000/api/scripts/${answerScript._id}`);
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: answerScript._id.toString() }),
      });
      expect(res.status).toBe(403);
    });

    it('returns 200 with script data and pages for an allocated TA', async () => {
      mockSessionUser = {
        id: taAllocated._id.toString(),
        email: taAllocated.email,
        name: taAllocated.name,
        role: UserRole.TA,
      };

      const req = new NextRequest(`http://localhost:3000/api/scripts/${answerScript._id}`);
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: answerScript._id.toString() }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data._id).toBe(answerScript._id.toString());
      expect(json.data.pages).toHaveLength(2);

      // Verify page properties
      const p1 = json.data.pages[0];
      expect(p1._id).toBe(page1._id.toString());
      expect(p1.pageNumber).toBe(1);
      expect(p1.imageUrl).toBe(`/api/ingest/batch-potions-101/pages/${page1._id}/image`);

      // Verify student PII is not exposed to TA in blind mode
      expect(json.data.student).toBeUndefined();
    });

    it('returns 200 from /api/scripts/[id]/pages for an allocated TA', async () => {
      mockSessionUser = {
        id: taAllocated._id.toString(),
        email: taAllocated.email,
        name: taAllocated.name,
        role: UserRole.TA,
      };

      const req = new NextRequest(`http://localhost:3000/api/scripts/${answerScript._id}/pages`);
      const res = await pagesGET(req, {
        params: Promise.resolve({ id: answerScript._id.toString() }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(2);
      expect(json.data[0].imageUrl).toBe(`/api/ingest/batch-potions-101/pages/${page1._id}/image`);
      expect(json.data[1].imageUrl).toBe(`/api/ingest/batch-potions-101/pages/${page2._id}/image`);
    });

    it('returns 200 for the course professor', async () => {
      mockSessionUser = {
        id: prof._id.toString(),
        email: prof.email,
        name: prof.name,
        role: UserRole.PROFESSOR,
      };

      const req = new NextRequest(`http://localhost:3000/api/scripts/${answerScript._id}`);
      const res = await scriptGET(req, {
        params: Promise.resolve({ id: answerScript._id.toString() }),
      });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.pages).toHaveLength(2);
    });
  });

  describe('2. Grading Page & AnswerSheetCanvas UI Integration', () => {
    it('does NOT render the old "Grading Portal Placeholder" text', () => {
      const html = renderToStaticMarkup(React.createElement(GradingPage));
      expect(html).not.toContain('Grading Portal Placeholder');
      expect(html).not.toContain('This is a minimal placeholder route matching the routing requirements of');
    });

    it('renders the DashboardLayout with header and Back to Work Queue link', () => {
      const html = renderToStaticMarkup(React.createElement(GradingPage));
      expect(html).toContain('Grading Portal');
      expect(html).toContain('Evaluate and grade full exam script submissions.');
      expect(html).toContain('Back to Work Queue');
      expect(html).toContain('href="/ta"');
    });

    it('renders loading state cleanly when data is being fetched', () => {
      const html = renderToStaticMarkup(React.createElement(GradingPage));
      expect(html).toContain('Loading Answer Script...');
      expect(html).toContain('data-testid="grading-loading-state"');
    });

    it('renders AnswerSheetCanvas with complete toolbars, navigation, and persistence wiring', () => {
      const samplePages: AnswerSheetPage[] = [
        {
          _id: page1._id.toString(),
          pageNumber: 1,
          fileIndex: 0,
          imageUrl: `/api/ingest/batch-potions-101/pages/${page1._id}/image`,
        },
        {
          _id: page2._id.toString(),
          pageNumber: 2,
          fileIndex: 0,
          imageUrl: `/api/ingest/batch-potions-101/pages/${page2._id}/image`,
        },
      ];

      const html = renderToStaticMarkup(
        React.createElement(AnswerSheetCanvas, {
          scriptId: answerScript._id.toString(),
          pages: samplePages,
          showPageNavigation: true,
          enablePanZoom: true,
          showZoomControls: true,
          enableSelect: true,
          enablePenTool: true,
          enableEraserTool: true,
          enableStamps: true,
          enableHighlight: true,
          enableTextNote: true,
          enableUndoRedo: true,
          enableOverlayToggle: true,
          enableAnnotationLoading: true,
          enableAutosave: true,
        })
      );

      // Verify canvas wrapper and stage containers are present
      expect(html).toContain('data-testid="answer-sheet-canvas-wrapper"');
      expect(html).toContain('data-testid="canvas-stage-container"');

      // Verify multi-page navigation controls
      expect(html).toContain('data-testid="page-navigation-controls"');
      expect(html).toContain('Page 1 of 2');
      expect(html).toContain('aria-label="Previous Page"');
      expect(html).toContain('aria-label="Next Page"');

      // Verify autosave status wrapper and loading overlay
      expect(html).toContain('data-testid="autosave-status-wrapper"');
      expect(html).toContain('data-testid="canvas-loading-overlay"');
      expect(html).toContain('Loading page image...');
    });

    it('passes scriptId and page identifiers correctly for annotation loading and autosave', () => {
      const samplePages: AnswerSheetPage[] = [
        {
          _id: 'page-abc-123',
          pageNumber: 1,
          imageUrl: '/api/ingest/batch-1/pages/page-abc-123/image',
        },
      ];

      const onAnnotationsLoadedMock = vi.fn();
      const onSaveSuccessMock = vi.fn();

      const element = React.createElement(AnswerSheetCanvas, {
        scriptId: 'script-xyz-789',
        pages: samplePages,
        enableAnnotationLoading: true,
        enableAutosave: true,
        onAnnotationsLoaded: onAnnotationsLoadedMock,
        onSaveSuccess: onSaveSuccessMock,
      });

      expect(element.props.scriptId).toBe('script-xyz-789');
      expect(element.props.pages).toEqual(samplePages);
      expect(element.props.enableAnnotationLoading).toBe(true);
      expect(element.props.enableAutosave).toBe(true);
    });
  });
});
