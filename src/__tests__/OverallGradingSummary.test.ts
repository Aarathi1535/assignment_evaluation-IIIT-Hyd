/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AllocationService from '../services/AllocationService';
import { 
  formatOverallGradingSummary, 
  formatEtaDisplay 
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

describe('AE-107: Professor Dashboard Overall Exam Grading Summary Tests', () => {
  let progressGET: any;

  let prof: any;
  let admin: any;
  let ta1: any;
  let ta2: any;
  let student1: any;
  let student2: any;
  let student3: any;
  let student4: any;

  let course: any;
  let exam: any;
  let script1: any;
  let script2: any;
  let script3: any;
  let script4: any;

  beforeAll(async () => {
    progressGET = (await import('../app/api/exams/[id]/progress/route')).GET;

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
      name: 'Professor Flitwick',
      email: 'flitwick@hogwarts.edu',
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

    student4 = await User.create({
      name: 'Dean Thomas',
      email: 'dean@hogwarts.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    course = await Course.create({
      courseCode: 'CHM101',
      courseName: 'Charms',
      semester: 1,
      academicYear: '2026-2027',
      professor: prof._id,
      teachingAssistants: [ta1._id, ta2._id],
      enrolledStudents: [student1._id, student2._id, student3._id, student4._id],
      isActive: true
    });

    exam = await Exam.create({
      title: 'Charms Practical Exam',
      course: course._id,
      status: ExamStatus.PUBLISHED,
      createdBy: prof._id,
      examDate: new Date(),
      totalMarks: 100,
      numberOfQuestions: 4
    });

    script1 = await AnswerScript.create({
      exam: exam._id,
      student: student1._id,
      filePath: '/scans/charms/script1.pdf',
      filename: 'script1.pdf',
      startPageNumber: 1,
      endPageNumber: 2,
      pageCount: 2,
      isActive: true
    });

    script2 = await AnswerScript.create({
      exam: exam._id,
      student: student2._id,
      filePath: '/scans/charms/script2.pdf',
      filename: 'script2.pdf',
      startPageNumber: 3,
      endPageNumber: 4,
      pageCount: 2,
      isActive: true
    });

    script3 = await AnswerScript.create({
      exam: exam._id,
      student: student3._id,
      filePath: '/scans/charms/script3.pdf',
      filename: 'script3.pdf',
      startPageNumber: 5,
      endPageNumber: 6,
      pageCount: 2,
      isActive: true
    });

    script4 = await AnswerScript.create({
      exam: exam._id,
      student: student4._id,
      filePath: '/scans/charms/script4.pdf',
      filename: 'script4.pdf',
      startPageNumber: 7,
      endPageNumber: 8,
      pageCount: 2,
      isActive: true
    });

    mockSessionUser = {
      id: prof._id.toString(),
      email: prof.email,
      name: prof.name,
      role: UserRole.PROFESSOR
    };
  });

  describe('1. Overall Summary Calculation Helpers', () => {
    it('calculates overall graded count, remaining, and percentage from total and graded', () => {
      const summary = formatOverallGradingSummary(15, 20);
      expect(summary.graded).toBe(15);
      expect(summary.total).toBe(20);
      expect(summary.remaining).toBe(5);
      expect(summary.percentage).toBe(75);
    });

    it('handles zero allocations safely without division by zero', () => {
      const summary = formatOverallGradingSummary(0, 0);
      expect(summary.graded).toBe(0);
      expect(summary.total).toBe(0);
      expect(summary.remaining).toBe(0);
      expect(summary.percentage).toBe(0);
    });

    it('formats ETA display strings for completed, in-progress, and insufficient data states', () => {
      // Completed
      expect(formatEtaDisplay(new Date(), true, 'COMPLETED', 0)).toBe('Grading Complete (100%)');

      // In-progress with estimated seconds
      const futureDate = new Date(Date.now() + 1200000); // +20 mins
      const etaStr = formatEtaDisplay(futureDate, true, undefined, 1200);
      expect(etaStr).toContain('~20m remaining');

      // No allocations
      expect(formatEtaDisplay(null, false, 'NO_ALLOCATIONS')).toBe('ETA unavailable (no allocations)');

      // Insufficient timing data
      expect(formatEtaDisplay(null, false, 'INSUFFICIENT_DATA')).toBe('ETA pending more completed grading data');
    });
  });

  describe('2. Total Graded Count, Overall Percentage & Aggregate Progress via Backend API', () => {
    it('aggregates total graded count and percentage from per-TA allocations', async () => {
      // TA1: 2 completed
      await Allocation.create({
        exam: exam._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL,
        completedAt: new Date(Date.now() - 3600000)
      });
      await Allocation.create({
        exam: exam._id,
        ta: ta1._id,
        answerScript: script2._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL,
        completedAt: new Date(Date.now() - 1800000)
      });

      // TA2: 1 in-progress, 1 pending
      await Allocation.create({
        exam: exam._id,
        ta: ta2._id,
        answerScript: script3._id,
        allocatedBy: prof._id,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL
      });
      await Allocation.create({
        exam: exam._id,
        ta: ta2._id,
        answerScript: script4._id,
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
      expect(json.data.total).toBe(4);
      expect(json.data.graded).toBe(2);
      expect(json.data.progress.length).toBe(2);

      const overall = formatOverallGradingSummary(json.data.graded, json.data.total);
      expect(overall.graded).toBe(2);
      expect(overall.total).toBe(4);
      expect(overall.remaining).toBe(2);
      expect(overall.percentage).toBe(50);
    });
  });

  describe('3. Naive ETA Calculation using completedAt Timestamps', () => {
    it('calculates naive ETA when at least 2 completedAt timestamps exist', async () => {
      const t0 = new Date('2026-09-01T10:00:00.000Z');
      const t1 = new Date('2026-09-01T10:10:00.000Z'); // 10 minutes between completions (600s)

      // 2 completed out of 4 total allocations
      await Allocation.create({
        exam: exam._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL,
        completedAt: t0
      });
      await Allocation.create({
        exam: exam._id,
        ta: ta1._id,
        answerScript: script2._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL,
        completedAt: t1
      });

      // 2 remaining allocations (1 in progress, 1 pending)
      await Allocation.create({
        exam: exam._id,
        ta: ta2._id,
        answerScript: script3._id,
        allocatedBy: prof._id,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL
      });
      await Allocation.create({
        exam: exam._id,
        ta: ta2._id,
        answerScript: script4._id,
        allocatedBy: prof._id,
        status: AllocationStatus.PENDING,
        rule: AllocationRule.EQUAL
      });

      const progress = await AllocationService.getProgress(exam._id.toString());

      expect(progress.total).toBe(4);
      expect(progress.graded).toBe(2);
      expect(progress.etaAvailable).toBe(true);
      expect(progress.eta).not.toBeNull();
      // 2 remaining * 600s avg = 1200s
      expect(progress.estimatedRemainingSeconds).toBe(1200);
    });

    it('returns etaAvailable = false with INSUFFICIENT_DATA when fewer than 2 completedAt timestamps exist', async () => {
      // Only 1 completed allocation
      await Allocation.create({
        exam: exam._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL,
        completedAt: new Date()
      });

      // 1 pending allocation
      await Allocation.create({
        exam: exam._id,
        ta: ta2._id,
        answerScript: script2._id,
        allocatedBy: prof._id,
        status: AllocationStatus.PENDING,
        rule: AllocationRule.EQUAL
      });

      const progress = await AllocationService.getProgress(exam._id.toString());

      expect(progress.total).toBe(2);
      expect(progress.graded).toBe(1);
      expect(progress.etaAvailable).toBe(false);
      expect(progress.eta).toBeNull();
      expect(progress.etaReason).toBe('INSUFFICIENT_DATA');
    });

    it('handles 100% completed state (remaining = 0) with COMPLETED reason', async () => {
      const t0 = new Date('2026-09-01T10:00:00.000Z');
      const t1 = new Date('2026-09-01T10:05:00.000Z');

      await Allocation.create({
        exam: exam._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL,
        completedAt: t0
      });
      await Allocation.create({
        exam: exam._id,
        ta: ta2._id,
        answerScript: script2._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL,
        completedAt: t1
      });

      const progress = await AllocationService.getProgress(exam._id.toString());

      expect(progress.total).toBe(2);
      expect(progress.graded).toBe(2);
      expect(progress.etaAvailable).toBe(true);
      expect(progress.etaReason).toBe('COMPLETED');
      expect(progress.estimatedRemainingSeconds).toBe(0);
    });

    it('does not use updatedAt or createdAt as completion timestamp proxies', async () => {
      // Create completed allocations without completedAt (e.g. legacy/corrupted record)
      // but with distinct updatedAt and createdAt
      await Allocation.collection.insertOne({
        exam: exam._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL,
        createdAt: new Date('2026-09-01T08:00:00.000Z'),
        updatedAt: new Date('2026-09-01T09:00:00.000Z')
        // Notice completedAt is intentionally omitted
      });
      await Allocation.collection.insertOne({
        exam: exam._id,
        ta: ta1._id,
        answerScript: script2._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL,
        createdAt: new Date('2026-09-01T08:00:00.000Z'),
        updatedAt: new Date('2026-09-01T10:00:00.000Z')
        // Notice completedAt is intentionally omitted
      });
      await Allocation.collection.insertOne({
        exam: exam._id,
        ta: ta2._id,
        answerScript: script3._id,
        allocatedBy: prof._id,
        status: AllocationStatus.PENDING,
        rule: AllocationRule.EQUAL,
        createdAt: new Date('2026-09-01T08:00:00.000Z'),
        updatedAt: new Date('2026-09-01T08:00:00.000Z')
      });

      const progress = await AllocationService.getProgress(exam._id.toString());

      // Because neither completed allocation has a completedAt timestamp,
      // it must not fall back to updatedAt or createdAt.
      expect(progress.etaAvailable).toBe(false);
      expect(progress.eta).toBeNull();
      expect(progress.etaReason).toBe('INSUFFICIENT_DATA');
    });
  });

  describe('4. Authorization Preservation', () => {
    it('allows Professor and Admin to access progress with overall summary & ETA', async () => {
      mockSessionUser = {
        id: prof._id.toString(),
        role: UserRole.PROFESSOR,
        email: prof.email
      };

      const profRes = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(profRes.status).toBe(200);
      const profBody = await profRes.json();
      expect(profBody.success).toBe(true);
      expect(profBody.data.etaAvailable).toBeDefined();

      mockSessionUser = {
        id: admin._id.toString(),
        role: UserRole.ADMIN,
        email: admin.email
      };

      const adminRes = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(adminRes.status).toBe(200);
    });

    it('rejects unauthorized TA and Student roles with 403 Forbidden', async () => {
      mockSessionUser = {
        id: ta1._id.toString(),
        role: UserRole.TA,
        email: ta1.email
      };

      const taRes = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(taRes.status).toBe(403);

      mockSessionUser = {
        id: student1._id.toString(),
        role: UserRole.STUDENT,
        email: student1.email
      };

      const studentRes = await progressGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam._id}/progress`),
        { params: Promise.resolve({ id: exam._id.toString() }) }
      );
      expect(studentRes.status).toBe(403);
    });
  });
});
