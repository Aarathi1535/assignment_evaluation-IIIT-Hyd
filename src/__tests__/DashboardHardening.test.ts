/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation from '../models/Allocation';
import { 
  formatTaProgressLabel,
  calculateProgressPercentage,
  formatOverallGradingSummary,
  formatEtaDisplay,
  calculateTimePerScript,
  formatDuration
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

describe('AE-109: Professor Dashboard Production Hardening Tests', () => {
  let progressGET: any;
  let sseGET: any;
  let taWorkloadGET: any;

  let prof: any;
  let admin: any;
  let ta: any;
  let student: any;
  let course: any;
  let exam: any;
  let emptyExam: any;

  beforeAll(async () => {
    progressGET = (await import('../app/api/exams/[id]/progress/route')).GET;
    sseGET = (await import('../app/api/exams/[id]/progress/stream/route')).GET;
    taWorkloadGET = (await import('../app/api/exams/[id]/ta/[taId]/route')).GET;

    await User.init();
    await Course.init();
    await Exam.init();
    await AnswerScript.init();
    await Allocation.init();
  });

  beforeEach(async () => {
    mockSessionUser = null;

    await Allocation.deleteMany({});
    await AnswerScript.deleteMany({});
    await Exam.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    prof = await User.create({
      name: 'Professor McGonagall',
      email: 'mcgonagall@hogwarts.edu',
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true
    });

    admin = await User.create({
      name: 'Admin Dumbledore',
      email: 'dumbledore@hogwarts.edu',
      password: 'password123',
      role: UserRole.ADMIN,
      isActive: true
    });

    ta = await User.create({
      name: 'Percy Weasley',
      email: 'percy@hogwarts.edu',
      password: 'password123',
      role: UserRole.TA,
      isActive: true
    });

    student = await User.create({
      name: 'Seamus Finnigan',
      email: 'seamus@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    course = await Course.create({
      courseCode: 'TRANS101',
      courseName: 'Transfiguration',
      semester: 1,
      academicYear: '2026-2027',
      professor: prof._id,
      teachingAssistants: [ta._id],
      enrolledStudents: [student._id],
      isActive: true
    });

    exam = await Exam.create({
      title: 'Transfiguration Midterm',
      course: course._id,
      status: ExamStatus.PUBLISHED,
      createdBy: prof._id,
      examDate: new Date(),
      totalMarks: 100,
      numberOfQuestions: 1
    });

    emptyExam = await Exam.create({
      title: 'Empty Exam Without Allocations',
      course: course._id,
      status: ExamStatus.PUBLISHED,
      createdBy: prof._id,
      examDate: new Date(),
      totalMarks: 100,
      numberOfQuestions: 1
    });

    mockSessionUser = {
      id: prof._id.toString(),
      email: prof.email,
      name: prof.name,
      role: UserRole.PROFESSOR
    };
  });

  describe('1. Safe Formatting & Edge Case Resilience in Pure Helpers', () => {
    it('handles undefined, null, NaN, and negative inputs in formatTaProgressLabel safely', () => {
      expect(formatTaProgressLabel(null, null, null)).toBe('Teaching Assistant — 0/0');
      expect(formatTaProgressLabel(undefined, undefined, undefined)).toBe('Teaching Assistant — 0/0');
      expect(formatTaProgressLabel('', NaN, -5)).toBe('Teaching Assistant — 0/0');
      expect(formatTaProgressLabel('  TA Beta  ', 10, 20)).toBe('TA Beta — 10/20');
    });

    it('handles abnormal and out-of-bound percentages in calculateProgressPercentage safely', () => {
      expect(calculateProgressPercentage(0, 0)).toBe(0);
      expect(calculateProgressPercentage(-5, -10)).toBe(0);
      expect(calculateProgressPercentage(150, 100)).toBe(100);
      expect(calculateProgressPercentage(NaN, NaN)).toBe(0);
      expect(calculateProgressPercentage(null, null)).toBe(0);
      expect(calculateProgressPercentage(0, 50, 0.756)).toBe(76);
      expect(calculateProgressPercentage(0, 50, -0.5)).toBe(0);
      expect(calculateProgressPercentage(0, 50, 1.5)).toBe(100);
    });

    it('handles formatOverallGradingSummary edge cases defensively', () => {
      const emptySummary = formatOverallGradingSummary(null, null);
      expect(emptySummary).toEqual({ graded: 0, total: 0, remaining: 0, percentage: 0 });

      const negativeSummary = formatOverallGradingSummary(-5, -10);
      expect(negativeSummary).toEqual({ graded: 0, total: 0, remaining: 0, percentage: 0 });

      const normalSummary = formatOverallGradingSummary(45, 60);
      expect(normalSummary).toEqual({ graded: 45, total: 60, remaining: 15, percentage: 75 });
    });

    it('handles formatEtaDisplay edge cases defensively', () => {
      expect(formatEtaDisplay(null, false, 'NO_ALLOCATIONS')).toBe('ETA unavailable (no allocations)');
      expect(formatEtaDisplay(null, false, 'INSUFFICIENT_DATA')).toBe('ETA pending more completed grading data');
      expect(formatEtaDisplay(null, false, 'COMPLETED')).toBe('Grading Complete (100%)');
      expect(formatEtaDisplay('invalid-date-string', true, undefined)).toBe('ETA pending more completed grading data');
    });

    it('handles calculateTimePerScript and formatDuration edge cases defensively', () => {
      expect(calculateTimePerScript(null, null, 'COMPLETED')).toBeNull();
      expect(calculateTimePerScript('invalid', 'invalid', 'COMPLETED')).toBeNull();
      expect(calculateTimePerScript('2026-09-01T10:05:00Z', '2026-09-01T10:00:00Z', 'COMPLETED')).toBeNull(); // Negative duration
      expect(calculateTimePerScript('2026-09-01T10:00:00Z', '2026-09-01T10:05:00Z', 'IN_PROGRESS')).toBeNull();

      expect(formatDuration(-10)).toBe('—');
      expect(formatDuration(NaN)).toBe('—');
      expect(formatDuration(null)).toBe('—');
      expect(formatDuration(undefined)).toBe('—');
    });
  });

  describe('2. Empty State vs Error State Distinguishability', () => {
    it('returns a successful 200 response with empty allocations array for an unallocated exam', async () => {
      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${emptyExam._id}/progress`),
        { params: Promise.resolve({ id: emptyExam._id.toString() }) }
      );
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(0);
      expect(json.data.graded).toBe(0);
      expect(json.data.progress).toEqual([]);
      expect(json.data.etaReason).toBe('NO_ALLOCATIONS');
      expect(json.data.etaAvailable).toBe(false);
    });

    it('returns a 404 HttpError response for non-existent exam clearly distinguished from empty data', async () => {
      const nonExistentId = '000000000000000000000888';
      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${nonExistentId}/progress`),
        { params: Promise.resolve({ id: nonExistentId }) }
      );
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('not found');
      expect(json.data).toBeNull();
    });

    it('returns 400 for malformed exam ID format', async () => {
      const res = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/invalid-id/progress`),
        { params: Promise.resolve({ id: 'invalid-id' }) }
      );
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('Invalid');
    });
  });

  describe('3. Production Authorization Preservation', () => {
    it('allows Professor and Admin to access progress and drilldown APIs', async () => {
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

      const profWorkloadRes = await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/ta/${ta._id}`),
        { params: Promise.resolve({ id: exam._id.toString(), taId: ta._id.toString() }) }
      );
      expect(profWorkloadRes.status).toBe(200);

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

      const adminWorkloadRes = await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/ta/${ta._id}`),
        { params: Promise.resolve({ id: exam._id.toString(), taId: ta._id.toString() }) }
      );
      expect(adminWorkloadRes.status).toBe(200);
    });

    it('strictly denies TA, Student, and unauthenticated access to all professor progress routes', async () => {
      // 1. TA
      mockSessionUser = {
        id: ta._id.toString(),
        role: UserRole.TA,
        email: ta.email
      };

      expect((await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      )).status).toBe(403);

      expect((await sseGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress/stream`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      )).status).toBe(403);

      expect((await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/ta/${ta._id}`),
        { params: Promise.resolve({ id: exam._id.toString(), taId: ta._id.toString() }) }
      )).status).toBe(403);

      // 2. Student
      mockSessionUser = {
        id: student._id.toString(),
        role: UserRole.STUDENT,
        email: student.email
      };

      expect((await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      )).status).toBe(403);

      expect((await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/ta/${ta._id}`),
        { params: Promise.resolve({ id: exam._id.toString(), taId: ta._id.toString() }) }
      )).status).toBe(403);

      // 3. Unauthenticated
      mockSessionUser = null;

      expect((await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      )).status).toBe(401);

      expect((await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/ta/${ta._id}`),
        { params: Promise.resolve({ id: exam._id.toString(), taId: ta._id.toString() }) }
      )).status).toBe(401);
    });
  });
});
