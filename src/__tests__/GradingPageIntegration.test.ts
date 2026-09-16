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

    it('renders AnswerSheetCanvas and RubricSidebar side-by-side in functional grading workspace', async () => {
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

      const { GradingWorkspace } = await import('../components/grading/GradingWorkspace');

      // Create a component instance simulating script loaded with pages
      const html = renderToStaticMarkup(
        React.createElement(GradingWorkspace, {
          scriptId: answerScript._id.toString(),
          allocatedQuestionNumber: 2,
        })
      );

      // Verify the page structure
      expect(html).toContain('Grading Portal');
      expect(html).toContain('Back to Work Queue');
      expect(html).not.toContain('Grading Portal Placeholder');
    });

    it('reaches functional grading workspace with question context when navigating to question-wise route', async () => {
      const QuestionGradingPage = (
        await import('../app/(dashboard)/grading/[scriptId]/question/[questionNumber]/page')
      ).default;

      mockParams = {
        scriptId: answerScript._id.toString(),
        questionNumber: '2',
      };

      const html = renderToStaticMarkup(React.createElement(QuestionGradingPage));

      // Must be the functional workspace and NOT the placeholder
      expect(html).not.toContain('Grading Portal Placeholder');
      expect(html).not.toContain('This is a minimal placeholder route');
      expect(html).toContain('Grading Portal');
      expect(html).toContain('Back to Work Queue');
      expect(html).toContain('Loading Answer Script...');
    });
  });

  describe('3. Rubric API & TA Access Integration (AE-142)', () => {
    let rubricGET: any;
    let rubric: any;

    beforeAll(async () => {
      const rubricsRoute = await import('../app/api/rubrics/route');
      rubricGET = rubricsRoute.GET;
    });

    beforeEach(async () => {
      const Rubric = (await import('../models/Rubric')).default;
      await Rubric.deleteMany({});

      rubric = await Rubric.create({
        exam: exam._id,
        createdBy: prof._id,
        questions: [
          {
            questionNumber: 1,
            maxMarks: 20,
            criteria: [
              {
                criterionName: 'Potion Boiling Point Theory',
                description: 'Detailed analysis of temperature curve',
                points: 12,
              },
              {
                criterionName: 'Ingredient Compatibility',
                description: 'Handling volatile components safely',
                points: 8,
              },
            ],
          },
          {
            questionNumber: 2,
            maxMarks: 30,
            criteria: [
              {
                criterionName: 'Stirring Technique & Direction',
                description: 'Counter-clockwise stir frequency',
                points: 15,
              },
              {
                criterionName: 'Color Shift Precision',
                description: 'Pearl sheen transition verification',
                points: 15,
              },
            ],
          },
        ],
      });
    });

    it('returns rubric questions and criteria to an allocated TA via GET /api/rubrics?exam=<id>', async () => {
      mockSessionUser = {
        id: taAllocated._id.toString(),
        email: taAllocated.email,
        name: taAllocated.name,
        role: UserRole.TA,
      };

      const req = new NextRequest(`http://localhost:3000/api/rubrics?exam=${exam._id}`);
      const res = await rubricGET(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.questions).toHaveLength(2);
      expect(json.data.questions[0].questionNumber).toBe(1);
      expect(json.data.questions[0].maxMarks).toBe(20);
      expect(json.data.questions[0].criteria).toHaveLength(2);
      expect(json.data.questions[1].questionNumber).toBe(2);
      expect(json.data.questions[1].maxMarks).toBe(30);
    });

    it('returns null data with 200 when exam has no rubric', async () => {
      mockSessionUser = {
        id: taAllocated._id.toString(),
        email: taAllocated.email,
        name: taAllocated.name,
        role: UserRole.TA,
      };

      const Rubric = (await import('../models/Rubric')).default;
      await Rubric.deleteMany({});

      const req = new NextRequest(`http://localhost:3000/api/rubrics?exam=${exam._id}`);
      const res = await rubricGET(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeNull();
      expect(json.message).toContain('No rubric found');
    });
  });
});

