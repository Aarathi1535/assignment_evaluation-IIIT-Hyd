/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AllocationService from '../services/AllocationService';
import ProgressEventService from '../services/ProgressEventService';
import { 
  formatTaProgressLabel, 
  calculateProgressPercentage,
  TaProgress,
  ExamProgressData
} from '../components/TaLiveProgressView';

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

describe('AE-106: Professor Dashboard Per-TA Live Progress Tests', () => {
  let progressGET: any;
  let streamGET: any;

  let prof: any;
  let admin: any;
  let ta1: any;
  let ta2: any;
  let ta3: any;
  let student1: any;
  let student2: any;
  let student3: any;

  let course: any;
  let exam: any;
  let script1: any;
  let script2: any;
  let script3: any;

  beforeAll(async () => {
    progressGET = (await import('../app/api/exams/[id]/progress/route')).GET;
    streamGET = (await import('../app/api/exams/[id]/progress/stream/route')).GET;

    await User.init();
    await Course.init();
    await Exam.init();
    await AnswerScript.init();
    await Allocation.init();
  });

  beforeEach(async () => {
    ProgressEventService.clearListeners();
    mockSessionUser = null;

    await Allocation.deleteMany({});
    await AnswerScript.deleteMany({});
    await Exam.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    prof = await User.create({
      name: 'Professor Snape',
      email: 'snape@hogwarts.edu',
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true
    });

    admin = await User.create({
      name: 'Admin Albus',
      email: 'albus@hogwarts.edu',
      password: 'password123',
      role: UserRole.ADMIN,
      isActive: true
    });

    ta1 = await User.create({
      name: 'Hermione Granger',
      email: 'hermione@hogwarts.edu',
      password: 'password123',
      role: UserRole.TA,
      isActive: true
    });

    ta2 = await User.create({
      name: 'Ron Weasley',
      email: 'ron@hogwarts.edu',
      password: 'password123',
      role: UserRole.TA,
      isActive: true
    });

    ta3 = await User.create({
      name: 'Draco Malfoy',
      email: 'draco@hogwarts.edu',
      password: 'password123',
      role: UserRole.TA,
      isActive: true
    });

    student1 = await User.create({
      name: 'Harry Potter',
      email: 'harry@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    student2 = await User.create({
      name: 'Neville Longbottom',
      email: 'neville@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    student3 = await User.create({
      name: 'Luna Lovegood',
      email: 'luna@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    course = await Course.create({
      courseCode: 'POT101',
      courseName: 'Potions',
      semester: 1,
      academicYear: '2026-2027',
      professor: prof._id,
      teachingAssistants: [ta1._id, ta2._id, ta3._id],
      enrolledStudents: [student1._id, student2._id, student3._id],
      isActive: true
    });

    exam = await Exam.create({
      title: 'Potions Midterm',
      course: course._id,
      status: ExamStatus.PUBLISHED,
      createdBy: prof._id,
      examDate: new Date(),
      totalMarks: 100,
      numberOfQuestions: 3
    });

    script1 = await AnswerScript.create({
      exam: exam._id,
      student: student1._id,
      filePath: '/scans/potions/script1.pdf',
      filename: 'script1.pdf',
      startPageNumber: 1,
      endPageNumber: 4,
      pageCount: 4,
      isActive: true
    });

    script2 = await AnswerScript.create({
      exam: exam._id,
      student: student2._id,
      filePath: '/scans/potions/script2.pdf',
      filename: 'script2.pdf',
      startPageNumber: 5,
      endPageNumber: 8,
      pageCount: 4,
      isActive: true
    });

    script3 = await AnswerScript.create({
      exam: exam._id,
      student: student3._id,
      filePath: '/scans/potions/script3.pdf',
      filename: 'script3.pdf',
      startPageNumber: 9,
      endPageNumber: 12,
      pageCount: 4,
      isActive: true
    });

    mockSessionUser = {
      id: prof._id.toString(),
      email: prof.email,
      name: prof.name,
      role: UserRole.PROFESSOR
    };
  });

  describe('1. Formatting and Progress Calculation Helpers', () => {
    it('formats per-TA progress label in exact "TA name — graded / total" format', () => {
      expect(formatTaProgressLabel('TA A', 45, 60)).toBe('TA A — 45/60');
      expect(formatTaProgressLabel('Hermione Granger', 8, 10)).toBe('Hermione Granger — 8/10');
      expect(formatTaProgressLabel('Ron Weasley', 0, 5)).toBe('Ron Weasley — 0/5');
    });

    it('calculates progress percentage correctly from graded and total or completionRatio', () => {
      expect(calculateProgressPercentage(45, 60)).toBe(75);
      expect(calculateProgressPercentage(0, 10)).toBe(0);
      expect(calculateProgressPercentage(10, 10)).toBe(100);
      expect(calculateProgressPercentage(0, 0)).toBe(0);
      expect(calculateProgressPercentage(1, 3)).toBe(33);

      // Using completionRatio when available
      expect(calculateProgressPercentage(0, 0, 0.75)).toBe(75);
      expect(calculateProgressPercentage(0, 0, 1.0)).toBe(100);
    });
  });

  describe('2. Consuming Progress REST API (GET /api/exams/[id]/progress)', () => {
    it('fetches per-TA progress and formats values matching backend aggregation', async () => {
      // ta1: 2 completed out of 2
      await Allocation.create({
        exam: exam._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL
      });
      await Allocation.create({
        exam: exam._id,
        ta: ta1._id,
        answerScript: script2._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL
      });

      // ta2: 1 completed out of 2 (1 in_progress)
      await Allocation.create({
        exam: exam._id,
        ta: ta2._id,
        answerScript: script3._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL
      });
      await Allocation.create({
        exam: exam._id,
        ta: ta2._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL
      });

      // ta3: 0 completed out of 1 (1 pending)
      await Allocation.create({
        exam: exam._id,
        ta: ta3._id,
        answerScript: script2._id,
        allocatedBy: prof._id,
        status: AllocationStatus.PENDING,
        rule: AllocationRule.EQUAL
      });

      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      const data: ExamProgressData = json.data;

      expect(data.total).toBe(5);
      expect(data.graded).toBe(3);
      expect(data.progress.length).toBe(3);

      const ta1Prog = data.progress.find((t: TaProgress) => t.taId === ta1._id.toString());
      expect(ta1Prog).toBeDefined();
      expect(formatTaProgressLabel(ta1Prog!.name, ta1Prog!.graded, ta1Prog!.total)).toBe('Hermione Granger — 2/2');
      expect(calculateProgressPercentage(ta1Prog!.graded, ta1Prog!.total)).toBe(100);

      const ta2Prog = data.progress.find((t: TaProgress) => t.taId === ta2._id.toString());
      expect(ta2Prog).toBeDefined();
      expect(formatTaProgressLabel(ta2Prog!.name, ta2Prog!.graded, ta2Prog!.total)).toBe('Ron Weasley — 1/2');
      expect(calculateProgressPercentage(ta2Prog!.graded, ta2Prog!.total)).toBe(50);

      const ta3Prog = data.progress.find((t: TaProgress) => t.taId === ta3._id.toString());
      expect(ta3Prog).toBeDefined();
      expect(formatTaProgressLabel(ta3Prog!.name, ta3Prog!.graded, ta3Prog!.total)).toBe('Draco Malfoy — 0/1');
      expect(calculateProgressPercentage(ta3Prog!.graded, ta3Prog!.total)).toBe(0);
    });
  });

  describe('3. Consuming Live SSE Stream (GET /api/exams/[id]/progress/stream)', () => {
    it('receives initial progress snapshot and streams live updates upon completion', async () => {
      const alloc = await Allocation.create({
        exam: exam._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL
      });

      const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress/stream`);
      const res = await streamGET(req, {
        params: Promise.resolve({ id: exam._id.toString() })
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/event-stream');

      const reader = res.body!.getReader();

      // Read initial event
      const initialChunk = await reader.read();
      const initialText = new TextDecoder().decode(initialChunk.value);
      expect(initialText).toContain('event: initial');
      expect(initialText).toContain(exam._id.toString());

      // Complete allocation
      await AllocationService.markCompleted(alloc._id.toString(), {
        actingUserId: ta1._id.toString(),
        actingUserRole: UserRole.TA
      });

      // Read events until progress is received
      let streamedText = '';
      while (!streamedText.includes('event: progress')) {
        const chunk = await reader.read();
        if (chunk.done) break;
        streamedText += new TextDecoder().decode(chunk.value);
      }

      expect(streamedText).toContain('event: progress');
      expect(streamedText).toContain('Hermione Granger');

      reader.releaseLock();
      await res.body!.cancel();
    });
  });

  describe('4. Handling live_updates_unavailable State', () => {
    it('SSE stream provides live_updates_unavailable event and preserves latest progress data', async () => {
      await Allocation.create({
        exam: exam._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL
      });

      const unavailablePromise = new Promise<any>((resolve) => {
        ProgressEventService.subscribeLiveUpdatesUnavailable(resolve);
      });

      // Trigger change stream attempt (which encounters standalone Mongo in test env and triggers degraded mode)
      await ProgressEventService.startChangeStream();
      await unavailablePromise;
      expect(ProgressEventService.isDegradedMode()).toBe(true);

      const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress/stream`);
      const res = await streamGET(req, {
        params: Promise.resolve({ id: exam._id.toString() })
      });

      expect(res.status).toBe(200);
      const reader = res.body!.getReader();

      // Read initial snapshot
      const initial = await reader.read();
      const initialText = new TextDecoder().decode(initial.value);
      expect(initialText).toContain('event: initial');
      expect(initialText).toContain('Hermione Granger');

      // Read degraded notification event
      const degraded = await reader.read();
      const degradedText = new TextDecoder().decode(degraded.value);
      expect(degradedText).toContain('event: live_updates_unavailable');
      expect(degradedText).toContain('Live updates unavailable — refresh to see progress.');

      reader.releaseLock();
      await res.body!.cancel();
    });
  });

  describe('5. Authorization Preservation', () => {
    it('allows Professor and Admin to access progress endpoint and SSE stream', async () => {
      // Professor
      mockSessionUser = {
        id: prof._id.toString(),
        role: UserRole.PROFESSOR,
        email: prof.email
      };

      const profProgRes = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(profProgRes.status).toBe(200);

      const profStreamRes = await streamGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress/stream`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(profStreamRes.status).toBe(200);
      await profStreamRes.body!.cancel();

      // Admin
      mockSessionUser = {
        id: admin._id.toString(),
        role: UserRole.ADMIN,
        email: admin.email
      };

      const adminProgRes = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(adminProgRes.status).toBe(200);

      const adminStreamRes = await streamGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress/stream`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(adminStreamRes.status).toBe(200);
      await adminStreamRes.body!.cancel();
    });

    it('rejects TA and Student with 403 Forbidden', async () => {
      // TA
      mockSessionUser = {
        id: ta1._id.toString(),
        role: UserRole.TA,
        email: ta1.email
      };

      const taProgRes = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(taProgRes.status).toBe(403);

      const taStreamRes = await streamGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress/stream`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(taStreamRes.status).toBe(403);

      // Student
      mockSessionUser = {
        id: student1._id.toString(),
        role: UserRole.STUDENT,
        email: student1.email
      };

      const studentProgRes = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(studentProgRes.status).toBe(403);

      const studentStreamRes = await streamGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress/stream`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(studentStreamRes.status).toBe(403);
    });

    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      mockSessionUser = null;

      const progRes = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(progRes.status).toBe(401);

      const streamRes = await streamGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress/stream`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(streamRes.status).toBe(401);
    });
  });
});
