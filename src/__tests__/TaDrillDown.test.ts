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

describe('AE-108: Professor Dashboard TA Drill-Down Tests', () => {
  let taWorkloadGET: any;

  let prof: any;
  let admin: any;
  let ta1: any;
  let ta2: any;
  let student1: any;
  let student2: any;
  let student3: any;

  let course: any;
  let exam1: any;
  let exam2: any;
  let script1: any;
  let script2: any;
  let script3: any;
  let script4: any;

  beforeAll(async () => {
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
      name: 'Professor Sprout',
      email: 'sprout@hogwarts.edu',
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

    course = await Course.create({
      courseCode: 'HRB101',
      courseName: 'Herbology',
      semester: 1,
      academicYear: '2026-2027',
      professor: prof._id,
      teachingAssistants: [ta1._id, ta2._id],
      enrolledStudents: [student1._id, student2._id, student3._id],
      isActive: true
    });

    exam1 = await Exam.create({
      title: 'Herbology Practical',
      course: course._id,
      status: ExamStatus.PUBLISHED,
      createdBy: prof._id,
      examDate: new Date(),
      totalMarks: 100,
      numberOfQuestions: 2
    });

    exam2 = await Exam.create({
      title: 'Herbology Theory',
      course: course._id,
      status: ExamStatus.PUBLISHED,
      createdBy: prof._id,
      examDate: new Date(),
      totalMarks: 100,
      numberOfQuestions: 1
    });

    script1 = await AnswerScript.create({
      exam: exam1._id,
      student: student1._id,
      filePath: '/scans/herbology/script1.pdf',
      filename: 'script1.pdf',
      startPageNumber: 1,
      endPageNumber: 2,
      pageCount: 2,
      isActive: true
    });

    script2 = await AnswerScript.create({
      exam: exam1._id,
      student: student2._id,
      filePath: '/scans/herbology/script2.pdf',
      filename: 'script2.pdf',
      startPageNumber: 3,
      endPageNumber: 4,
      pageCount: 2,
      isActive: true
    });

    script3 = await AnswerScript.create({
      exam: exam1._id,
      student: student3._id,
      filePath: '/scans/herbology/script3.pdf',
      filename: 'script3.pdf',
      startPageNumber: 5,
      endPageNumber: 6,
      pageCount: 2,
      isActive: true
    });

    script4 = await AnswerScript.create({
      exam: exam2._id,
      student: student1._id,
      filePath: '/scans/herbology/script4.pdf',
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

  describe('1. Time Per Script & Duration Helper Functions', () => {
    it('calculates duration in seconds strictly as (completedAt - claimedAt)', () => {
      const claimedAt = new Date('2026-09-01T10:00:00.000Z');
      const completedAt = new Date('2026-09-01T10:04:30.000Z'); // 4m 30s = 270s

      const duration = calculateTimePerScript(claimedAt, completedAt, 'COMPLETED');
      expect(duration).toBe(270);
    });

    it('returns null if either claimedAt or completedAt is missing', () => {
      expect(calculateTimePerScript(null, new Date(), 'COMPLETED')).toBeNull();
      expect(calculateTimePerScript(new Date(), null, 'COMPLETED')).toBeNull();
      expect(calculateTimePerScript(undefined, undefined, 'COMPLETED')).toBeNull();
    });

    it('returns null if status is not COMPLETED (e.g. IN_PROGRESS or PENDING)', () => {
      const claimedAt = new Date('2026-09-01T10:00:00.000Z');
      const completedAt = new Date('2026-09-01T10:05:00.000Z');

      expect(calculateTimePerScript(claimedAt, completedAt, 'IN_PROGRESS')).toBeNull();
      expect(calculateTimePerScript(claimedAt, completedAt, 'PENDING')).toBeNull();
    });

    it('formats duration nicely into friendly text units', () => {
      expect(formatDuration(45)).toBe('45s');
      expect(formatDuration(270)).toBe('4m 30s');
      expect(formatDuration(3600)).toBe('1h');
      expect(formatDuration(3720)).toBe('1h 2m');
      expect(formatDuration(null)).toBe('—');
      expect(formatDuration(undefined)).toBe('—');
    });
  });

  describe('2. Service & API Scoping and Detail Data Retrieval', () => {
    it('retrieves detailed workload strictly scoped to the requested exam and TA', async () => {
      const claimedT0 = new Date('2026-09-01T10:00:00.000Z');
      const completedT0 = new Date('2026-09-01T10:06:00.000Z'); // 360s = 6m

      // TA1 on Exam1: 1 COMPLETED, 1 IN_PROGRESS
      await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.QUESTION,
        question: 1,
        claimedAt: claimedT0,
        completedAt: completedT0
      });

      await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script2._id,
        allocatedBy: prof._id,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.QUESTION,
        question: 2,
        claimedAt: new Date('2026-09-01T10:10:00.000Z')
      });

      // TA2 on Exam1: 1 PENDING (must NOT be in TA1 result)
      await Allocation.create({
        exam: exam1._id,
        ta: ta2._id,
        answerScript: script3._id,
        allocatedBy: prof._id,
        status: AllocationStatus.PENDING,
        rule: AllocationRule.EQUAL
      });

      // TA1 on Exam2: 1 COMPLETED (must NOT be in Exam1 result)
      await Allocation.create({
        exam: exam2._id,
        ta: ta1._id,
        answerScript: script4._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL,
        claimedAt: new Date(),
        completedAt: new Date()
      });

      const res = await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/ta/${ta1._id}`),
        { params: Promise.resolve({ id: exam1._id.toString(), taId: ta1._id.toString() }) }
      );
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      const data = json.data;

      expect(data.examId).toBe(exam1._id.toString());
      expect(data.ta.id).toBe(ta1._id.toString());
      expect(data.ta.name).toBe('Hermione Granger');
      expect(data.total).toBe(2);
      expect(data.graded).toBe(1);
      expect(data.inProgress).toBe(1);
      expect(data.pending).toBe(0);

      expect(data.scripts.length).toBe(2);

      const completedScript = data.scripts.find((s: any) => s.status === AllocationStatus.COMPLETED);
      expect(completedScript).toBeDefined();
      expect(completedScript.scriptId).toBe('script1.pdf');
      expect(completedScript.question).toBe(1);
      expect(completedScript.durationSeconds).toBe(360);

      const inProgressScript = data.scripts.find((s: any) => s.status === AllocationStatus.IN_PROGRESS);
      expect(inProgressScript).toBeDefined();
      expect(inProgressScript.scriptId).toBe('script2.pdf');
      expect(inProgressScript.question).toBe(2);
      expect(inProgressScript.durationSeconds).toBeNull();
    });

    it('does not calculate duration or use updatedAt when completedAt or claimedAt is missing', async () => {
      // Completed record without claimedAt
      await Allocation.create({
        exam: exam1._id,
        ta: ta1._id,
        answerScript: script1._id,
        allocatedBy: prof._id,
        status: AllocationStatus.COMPLETED,
        rule: AllocationRule.EQUAL,
        completedAt: new Date('2026-09-01T12:00:00.000Z')
        // claimedAt is undefined
      });

      const workload = await AllocationService.getTaAllocationsForExam(exam1._id.toString(), ta1._id.toString());
      expect(workload.scripts[0].durationSeconds).toBeNull();
    });

    it('returns 400 for invalid ID format and 404 for non-existent exam or TA', async () => {
      const badIdRes = await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/invalid/ta/${ta1._id}`),
        { params: Promise.resolve({ id: 'invalid', taId: ta1._id.toString() }) }
      );
      expect(badIdRes.status).toBe(400);

      const badTaRes = await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/ta/invalid`),
        { params: Promise.resolve({ id: exam1._id.toString(), taId: 'invalid' }) }
      );
      expect(badTaRes.status).toBe(400);

      const nonExistentId = '000000000000000000000999';
      const notFoundRes = await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${nonExistentId}/ta/${ta1._id}`),
        { params: Promise.resolve({ id: nonExistentId, taId: ta1._id.toString() }) }
      );
      expect(notFoundRes.status).toBe(404);
    });
  });

  describe('3. Authorization Preservation', () => {
    it('allows Professor and Admin to access TA workload detail', async () => {
      mockSessionUser = {
        id: prof._id.toString(),
        role: UserRole.PROFESSOR,
        email: prof.email
      };

      const profRes = await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/ta/${ta1._id}`),
        { params: Promise.resolve({ id: exam1._id.toString(), taId: ta1._id.toString() }) }
      );
      expect(profRes.status).toBe(200);

      mockSessionUser = {
        id: admin._id.toString(),
        role: UserRole.ADMIN,
        email: admin.email
      };

      const adminRes = await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/ta/${ta1._id}`),
        { params: Promise.resolve({ id: exam1._id.toString(), taId: ta1._id.toString() }) }
      );
      expect(adminRes.status).toBe(200);
    });

    it('rejects TA, Student, and unauthenticated requests with 403 / 401', async () => {
      mockSessionUser = {
        id: ta1._id.toString(),
        role: UserRole.TA,
        email: ta1.email
      };

      const taRes = await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/ta/${ta1._id}`),
        { params: Promise.resolve({ id: exam1._id.toString(), taId: ta1._id.toString() }) }
      );
      expect(taRes.status).toBe(403);

      mockSessionUser = {
        id: student1._id.toString(),
        role: UserRole.STUDENT,
        email: student1.email
      };

      const studentRes = await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/ta/${ta1._id}`),
        { params: Promise.resolve({ id: exam1._id.toString(), taId: ta1._id.toString() }) }
      );
      expect(studentRes.status).toBe(403);

      mockSessionUser = null;
      const unauthRes = await taWorkloadGET(
        new NextRequest(`http://localhost:3000/api/exams/${exam1._id}/ta/${ta1._id}`),
        { params: Promise.resolve({ id: exam1._id.toString(), taId: ta1._id.toString() }) }
      );
      expect(unauthRes.status).toBe(401);
    });
  });
});
