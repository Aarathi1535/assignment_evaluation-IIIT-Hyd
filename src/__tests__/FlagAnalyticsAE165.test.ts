/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import ScriptFlag, { FlagReason, FlagStatus } from '../models/ScriptFlag';
import AnswerScript from '../models/AnswerScript';
import Exam, { ExamStatus } from '../models/Exam';
import Course from '../models/Course';
import User, { UserRole } from '../models/User';
import Allocation from '../models/Allocation';
import AuditLog from '../models/AuditLog';
import Notification from '../models/Notification';
import Grade from '../models/Grade';
import ScriptFlagService from '../services/ScriptFlagService';
import { GET as analyticsGET } from '../app/api/professor/flags/analytics/route';

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

describe('AE-165: Flag Analytics / Counts Tests', () => {
  let profAId: mongoose.Types.ObjectId;
  let profBId: mongoose.Types.ObjectId;
  let adminId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let student2Id: mongoose.Types.ObjectId;

  let courseAId: mongoose.Types.ObjectId;
  let courseBId: mongoose.Types.ObjectId;
  let examA1Id: mongoose.Types.ObjectId;
  let examA2Id: mongoose.Types.ObjectId;
  let examBId: mongoose.Types.ObjectId;

  let scriptA1Id: mongoose.Types.ObjectId;
  let scriptA2Id: mongoose.Types.ObjectId;
  let scriptB1Id: mongoose.Types.ObjectId;

  beforeAll(async () => {
    await ScriptFlag.init();
    await AnswerScript.init();
    await Exam.init();
    await Course.init();
    await User.init();
    await Allocation.init();
    await AuditLog.init();
    await Notification.init();
    await Grade.init();

    profAId = new mongoose.Types.ObjectId('000000000000000000000701');
    profBId = new mongoose.Types.ObjectId('000000000000000000000702');
    adminId = new mongoose.Types.ObjectId('000000000000000000000703');
    taId = new mongoose.Types.ObjectId('000000000000000000000704');
    studentId = new mongoose.Types.ObjectId('000000000000000000000705');
    student2Id = new mongoose.Types.ObjectId('000000000000000000000706');
  });

  beforeEach(async () => {
    await ScriptFlag.deleteMany({});
    await AnswerScript.deleteMany({});
    await Exam.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});
    await Allocation.deleteMany({});
    await AuditLog.deleteMany({});
    await Notification.deleteMany({});
    await Grade.deleteMany({});

    // 1. Create Users
    await new User({
      _id: profAId,
      name: 'Professor Albus Dumbledore',
      email: 'dumbledore@hogwarts.edu',
      role: UserRole.PROFESSOR,
      password: 'password123',
      isActive: true,
    }).save();

    await new User({
      _id: profBId,
      name: 'Professor Minerva McGonagall',
      email: 'mcgonagall@hogwarts.edu',
      role: UserRole.PROFESSOR,
      password: 'password123',
      isActive: true,
    }).save();

    await new User({
      _id: adminId,
      name: 'Admin User',
      email: 'admin@hogwarts.edu',
      role: UserRole.ADMIN,
      password: 'password123',
      isActive: true,
    }).save();

    await new User({
      _id: taId,
      name: 'Hermione Granger (TA)',
      email: 'hermione@hogwarts.edu',
      role: UserRole.TA,
      password: 'password123',
      isActive: true,
    }).save();

    await new User({
      _id: studentId,
      name: 'Harry Potter',
      email: 'harry@hogwarts.edu',
      role: UserRole.STUDENT,
      password: 'password123',
      isActive: true,
    }).save();

    await new User({
      _id: student2Id,
      name: 'Ron Weasley',
      email: 'ron@hogwarts.edu',
      role: UserRole.STUDENT,
      password: 'password123',
      isActive: true,
    }).save();

    // 2. Create Courses
    courseAId = new mongoose.Types.ObjectId();
    await new Course({
      _id: courseAId,
      courseCode: 'CS101',
      courseName: 'Transfiguration 101',
      professor: profAId,
      semester: 1,
      academicYear: '2026-2027',
      instructors: [profAId],
      teachingAssistants: [taId],
      enrolledStudents: [studentId, student2Id],
      isActive: true,
    }).save();

    courseBId = new mongoose.Types.ObjectId();
    await new Course({
      _id: courseBId,
      courseCode: 'CS102',
      courseName: 'Potions 102',
      professor: profBId,
      semester: 1,
      academicYear: '2026-2027',
      instructors: [profBId],
      teachingAssistants: [taId],
      enrolledStudents: [studentId],
      isActive: true,
    }).save();

    // 3. Create Exams
    examA1Id = new mongoose.Types.ObjectId();
    await new Exam({
      _id: examA1Id,
      title: 'Transfiguration Midterm (Prof A)',
      course: courseAId,
      examDate: new Date('2026-10-01'),
      totalMarks: 100,
      numberOfQuestions: 5,
      createdBy: profAId,
      status: ExamStatus.EVALUATING,
      isActive: true,
    }).save();

    examA2Id = new mongoose.Types.ObjectId();
    await new Exam({
      _id: examA2Id,
      title: 'Transfiguration Final (Prof A)',
      course: courseAId,
      examDate: new Date('2026-11-01'),
      totalMarks: 100,
      numberOfQuestions: 5,
      createdBy: profAId,
      status: ExamStatus.EVALUATING,
      isActive: true,
    }).save();

    examBId = new mongoose.Types.ObjectId();
    await new Exam({
      _id: examBId,
      title: 'Potions Midterm (Prof B)',
      course: courseBId,
      examDate: new Date('2026-10-01'),
      totalMarks: 100,
      numberOfQuestions: 5,
      createdBy: profBId,
      status: ExamStatus.EVALUATING,
      isActive: true,
    }).save();

    // 4. Create AnswerScripts
    scriptA1Id = new mongoose.Types.ObjectId();
    await new AnswerScript({
      _id: scriptA1Id,
      exam: examA1Id,
      student: studentId,
      scriptReference: 'SCRIPT-A1',
      pages: [],
      isActive: true,
    }).save();

    scriptA2Id = new mongoose.Types.ObjectId();
    await new AnswerScript({
      _id: scriptA2Id,
      exam: examA2Id,
      student: student2Id,
      scriptReference: 'SCRIPT-A2',
      pages: [],
      isActive: true,
    }).save();

    scriptB1Id = new mongoose.Types.ObjectId();
    await new AnswerScript({
      _id: scriptB1Id,
      exam: examBId,
      student: studentId,
      scriptReference: 'SCRIPT-B1',
      pages: [],
      isActive: true,
    }).save();
  });

  describe('1. Server-Side Aggregation & Response Structure', () => {
    it('returns zero-count combinations when no flags exist', async () => {
      const result = await ScriptFlagService.getFlagAnalytics({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(result.total).toBe(0);
      expect(result.byStatus).toEqual({
        OPEN: 0,
        RESOLVED: 0,
        ESCALATED: 0,
      });
      expect(result.byReason).toEqual({
        CHEATING_SUSPECTED: 0,
        ILLEGIBLE: 0,
        OTHER: 0,
      });
      expect(result.byReasonAndStatus).toEqual({
        CHEATING_SUSPECTED: { OPEN: 0, RESOLVED: 0, ESCALATED: 0 },
        ILLEGIBLE: { OPEN: 0, RESOLVED: 0, ESCALATED: 0 },
        OTHER: { OPEN: 0, RESOLVED: 0, ESCALATED: 0 },
      });
    });

    it('accurately groups flag counts by reason × status and computes total', async () => {
      // Create diverse flags for Prof A
      await ScriptFlag.create([
        {
          answerScript: scriptA1Id,
          exam: examA1Id,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.CHEATING_SUSPECTED,
          status: FlagStatus.OPEN,
        },
        {
          answerScript: scriptA1Id,
          exam: examA1Id,
          question: 2,
          raisedBy: taId,
          reason: FlagReason.CHEATING_SUSPECTED,
          status: FlagStatus.RESOLVED,
          resolution: { action: 'CLEAR', by: profAId, at: new Date(), notes: 'ok' },
        },
        {
          answerScript: scriptA1Id,
          exam: examA1Id,
          question: 3,
          raisedBy: taId,
          reason: FlagReason.ILLEGIBLE,
          status: FlagStatus.OPEN,
        },
        {
          answerScript: scriptA2Id,
          exam: examA2Id,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.ILLEGIBLE,
          status: FlagStatus.ESCALATED,
          resolution: { action: 'ESCALATE', by: profAId, at: new Date(), notes: 'escalated' },
        },
        {
          answerScript: scriptA2Id,
          exam: examA2Id,
          question: 2,
          raisedBy: taId,
          reason: FlagReason.OTHER,
          status: FlagStatus.OPEN,
        },
      ]);

      const result = await ScriptFlagService.getFlagAnalytics({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(result.total).toBe(5);
      expect(result.byStatus.OPEN).toBe(3);
      expect(result.byStatus.RESOLVED).toBe(1);
      expect(result.byStatus.ESCALATED).toBe(1);

      expect(result.byReason.CHEATING_SUSPECTED).toBe(2);
      expect(result.byReason.ILLEGIBLE).toBe(2);
      expect(result.byReason.OTHER).toBe(1);

      expect(result.byReasonAndStatus.CHEATING_SUSPECTED).toEqual({
        OPEN: 1,
        RESOLVED: 1,
        ESCALATED: 0,
      });
      expect(result.byReasonAndStatus.ILLEGIBLE).toEqual({
        OPEN: 1,
        RESOLVED: 0,
        ESCALATED: 1,
      });
      expect(result.byReasonAndStatus.OTHER).toEqual({
        OPEN: 1,
        RESOLVED: 0,
        ESCALATED: 0,
      });
    });
  });

  describe('2. Professor Ownership Scoping & Two-Professor Isolation', () => {
    it('isolates analytics between professors: Professor A cannot see Professor B flags', async () => {
      // Flags for Prof A (2 flags)
      await ScriptFlag.create([
        {
          answerScript: scriptA1Id,
          exam: examA1Id,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.CHEATING_SUSPECTED,
          status: FlagStatus.OPEN,
        },
        {
          answerScript: scriptA2Id,
          exam: examA2Id,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.ILLEGIBLE,
          status: FlagStatus.OPEN,
        },
      ]);

      // Flags for Prof B (3 flags)
      await ScriptFlag.create([
        {
          answerScript: scriptB1Id,
          exam: examBId,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.OTHER,
          status: FlagStatus.OPEN,
        },
        {
          answerScript: scriptB1Id,
          exam: examBId,
          question: 2,
          raisedBy: taId,
          reason: FlagReason.OTHER,
          status: FlagStatus.OPEN,
        },
        {
          answerScript: scriptB1Id,
          exam: examBId,
          question: 3,
          raisedBy: taId,
          reason: FlagReason.OTHER,
          status: FlagStatus.OPEN,
        },
      ]);

      // Prof A analytics
      const resultA = await ScriptFlagService.getFlagAnalytics({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });
      expect(resultA.total).toBe(2);
      expect(resultA.byReason.CHEATING_SUSPECTED).toBe(1);
      expect(resultA.byReason.ILLEGIBLE).toBe(1);
      expect(resultA.byReason.OTHER).toBe(0);

      // Prof B analytics
      const resultB = await ScriptFlagService.getFlagAnalytics({
        userId: profBId,
        userRole: UserRole.PROFESSOR,
      });
      expect(resultB.total).toBe(3);
      expect(resultB.byReason.OTHER).toBe(3);
      expect(resultB.byReason.CHEATING_SUSPECTED).toBe(0);
      expect(resultB.byReason.ILLEGIBLE).toBe(0);
    });

    it('rejects attempt by Professor A to pass Professor B examId with 403 Forbidden', async () => {
      await expect(
        ScriptFlagService.getFlagAnalytics({
          userId: profAId,
          userRole: UserRole.PROFESSOR,
          examId: examBId, // Prof B's exam
        })
      ).rejects.toThrow(/Forbidden.*own/i);
    });

    it('rejects nonexistent examId with 404 Not Found', async () => {
      const nonExistentExamId = new mongoose.Types.ObjectId();
      await expect(
        ScriptFlagService.getFlagAnalytics({
          userId: profAId,
          userRole: UserRole.PROFESSOR,
          examId: nonExistentExamId,
        })
      ).rejects.toThrow(/Exam not found/i);
    });

    it('filters analytics by specific owned examId when requested by professor', async () => {
      // Create flags in Exam A1 and Exam A2
      await ScriptFlag.create([
        {
          answerScript: scriptA1Id,
          exam: examA1Id,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.CHEATING_SUSPECTED,
          status: FlagStatus.OPEN,
        },
        {
          answerScript: scriptA2Id,
          exam: examA2Id,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.ILLEGIBLE,
          status: FlagStatus.OPEN,
        },
      ]);

      // Filter specifically for Exam A1
      const resultA1 = await ScriptFlagService.getFlagAnalytics({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
        examId: examA1Id,
      });

      expect(resultA1.total).toBe(1);
      expect(resultA1.byReason.CHEATING_SUSPECTED).toBe(1);
      expect(resultA1.byReason.ILLEGIBLE).toBe(0);
    });
  });

  describe('3. ADMIN & Role-Based Access Control', () => {
    it('allows ADMIN to retrieve analytics across all exams globally', async () => {
      await ScriptFlag.create([
        {
          answerScript: scriptA1Id,
          exam: examA1Id,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.CHEATING_SUSPECTED,
          status: FlagStatus.OPEN,
        },
        {
          answerScript: scriptB1Id,
          exam: examBId,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.OTHER,
          status: FlagStatus.OPEN,
        },
      ]);

      const result = await ScriptFlagService.getFlagAnalytics({
        userId: adminId,
        userRole: UserRole.ADMIN,
      });

      expect(result.total).toBe(2);
      expect(result.byReason.CHEATING_SUSPECTED).toBe(1);
      expect(result.byReason.OTHER).toBe(1);
    });

    it('allows ADMIN to filter analytics by any specific examId', async () => {
      await ScriptFlag.create([
        {
          answerScript: scriptA1Id,
          exam: examA1Id,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.CHEATING_SUSPECTED,
          status: FlagStatus.OPEN,
        },
        {
          answerScript: scriptB1Id,
          exam: examBId,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.OTHER,
          status: FlagStatus.OPEN,
        },
      ]);

      const result = await ScriptFlagService.getFlagAnalytics({
        userId: adminId,
        userRole: UserRole.ADMIN,
        examId: examBId,
      });

      expect(result.total).toBe(1);
      expect(result.byReason.OTHER).toBe(1);
      expect(result.byReason.CHEATING_SUSPECTED).toBe(0);
    });

    it('rejects TA with 403 Forbidden', async () => {
      await expect(
        ScriptFlagService.getFlagAnalytics({
          userId: taId,
          userRole: UserRole.TA,
        })
      ).rejects.toThrow(/Forbidden/i);
    });

    it('rejects Student with 403 Forbidden', async () => {
      await expect(
        ScriptFlagService.getFlagAnalytics({
          userId: studentId,
          userRole: UserRole.STUDENT,
        })
      ).rejects.toThrow(/Forbidden/i);
    });
  });

  describe('4. API Route Integration (GET /api/professor/flags/analytics)', () => {
    it('returns 200 with analytics for authorized professor', async () => {
      await ScriptFlag.create({
        answerScript: scriptA1Id,
        exam: examA1Id,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.ILLEGIBLE,
        status: FlagStatus.OPEN,
      });

      mockSessionUser = { id: profAId.toString(), role: UserRole.PROFESSOR };

      const req = new NextRequest('http://localhost/api/professor/flags/analytics');
      const res = await analyticsGET(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(1);
      expect(json.data.byReason.ILLEGIBLE).toBe(1);
      expect(json.data.byReasonAndStatus.ILLEGIBLE.OPEN).toBe(1);
    });

    it('supports optional examId query parameter via API route', async () => {
      await ScriptFlag.create([
        {
          answerScript: scriptA1Id,
          exam: examA1Id,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.CHEATING_SUSPECTED,
          status: FlagStatus.OPEN,
        },
        {
          answerScript: scriptA2Id,
          exam: examA2Id,
          question: 1,
          raisedBy: taId,
          reason: FlagReason.ILLEGIBLE,
          status: FlagStatus.OPEN,
        },
      ]);

      mockSessionUser = { id: profAId.toString(), role: UserRole.PROFESSOR };

      const req = new NextRequest(`http://localhost/api/professor/flags/analytics?examId=${examA1Id}`);
      const res = await analyticsGET(req);

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(1);
      expect(json.data.byReason.CHEATING_SUSPECTED).toBe(1);
      expect(json.data.byReason.ILLEGIBLE).toBe(0);
    });

    it('returns 403 Forbidden when professor queries another professor examId via API route', async () => {
      mockSessionUser = { id: profAId.toString(), role: UserRole.PROFESSOR };

      const req = new NextRequest(`http://localhost/api/professor/flags/analytics?examId=${examBId}`);
      const res = await analyticsGET(req);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toMatch(/Forbidden/i);
    });

    it('returns 403 Forbidden for TA user via API route', async () => {
      mockSessionUser = { id: taId.toString(), role: UserRole.TA };

      const req = new NextRequest('http://localhost/api/professor/flags/analytics');
      const res = await analyticsGET(req);

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
    });
  });
});
