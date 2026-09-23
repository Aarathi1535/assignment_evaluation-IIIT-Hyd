/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import ScriptFlag, { FlagReason, FlagStatus } from '../models/ScriptFlag';
import AnswerScript from '../models/AnswerScript';
import Exam from '../models/Exam';
import Course from '../models/Course';
import User, { UserRole } from '../models/User';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AuditLog from '../models/AuditLog';
import Notification, { NotificationType } from '../models/Notification';
import Grade from '../models/Grade';
import ScriptFlagService from '../services/ScriptFlagService';
import { POST as flagPOST, GET as flagGET } from '../app/api/scripts/[id]/flags/route';

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

describe('AE-162: ScriptFlag Model, Service, and API Tests', () => {
  let professorId: mongoose.Types.ObjectId;
  let taId1: mongoose.Types.ObjectId;
  let taId2: mongoose.Types.ObjectId;
  let unallocatedTaId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let studentId2: mongoose.Types.ObjectId;
  let testCourseId: mongoose.Types.ObjectId;
  let testExamId: mongoose.Types.ObjectId;
  let scriptId1: mongoose.Types.ObjectId;
  let scriptId2: mongoose.Types.ObjectId;

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

    professorId = new mongoose.Types.ObjectId('000000000000000000000800');
    taId1 = new mongoose.Types.ObjectId('000000000000000000000801');
    taId2 = new mongoose.Types.ObjectId('000000000000000000000802');
    unallocatedTaId = new mongoose.Types.ObjectId('000000000000000000000803');
    studentId = new mongoose.Types.ObjectId('000000000000000000000804');
    studentId2 = new mongoose.Types.ObjectId('000000000000000000000805');
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
      _id: professorId,
      name: 'Professor Severus Snape',
      email: 'snape@hogwarts.edu',
      role: UserRole.PROFESSOR,
      password: 'password123',
      isActive: true,
    }).save();

    await new User({
      _id: taId1,
      name: 'Hermione Granger (TA 1)',
      email: 'hermione@hogwarts.edu',
      role: UserRole.TA,
      password: 'password123',
      isActive: true,
    }).save();

    await new User({
      _id: taId2,
      name: 'Ron Weasley (TA 2)',
      email: 'ron@hogwarts.edu',
      role: UserRole.TA,
      password: 'password123',
      isActive: true,
    }).save();

    await new User({
      _id: unallocatedTaId,
      name: 'Draco Malfoy (Unallocated TA)',
      email: 'draco@hogwarts.edu',
      role: UserRole.TA,
      password: 'password123',
      isActive: true,
    }).save();

    await new User({
      _id: studentId,
      name: 'Harry Potter (Student)',
      email: 'harry@hogwarts.edu',
      role: UserRole.STUDENT,
      password: 'password123',
      isActive: true,
    }).save();

    await new User({
      _id: studentId2,
      name: 'Neville Longbottom (Student 2)',
      email: 'neville@hogwarts.edu',
      role: UserRole.STUDENT,
      password: 'password123',
      isActive: true,
    }).save();

    // 2. Create Course & Exam
    const course = new Course({
      courseCode: 'POT101',
      courseName: 'Potions Masterclass',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [taId1, taId2, unallocatedTaId],
      enrolledStudents: [studentId, studentId2],
      isActive: true,
    });
    const savedCourse = await course.save();
    testCourseId = savedCourse._id as mongoose.Types.ObjectId;

    const exam = new Exam({
      title: 'Advanced Potion Making Midterm',
      course: testCourseId,
      createdBy: professorId,
      examDate: new Date('2026-09-15T09:00:00.000Z'),
      totalMarks: 50,
      numberOfQuestions: 3,
      status: 'PUBLISHED',
      ingestionApprovalStatus: 'APPROVED',
      isActive: true,
    });
    const savedExam = await exam.save();
    testExamId = savedExam._id as mongoose.Types.ObjectId;

    // 3. Create Answer Scripts
    const script1 = new AnswerScript({
      exam: testExamId,
      student: studentId,
      batchId: 'batch-101',
      fileIndex: 0,
      startPageNumber: 1,
      endPageNumber: 3,
      pageCount: 3,
      anonymousId: 'ANON-SCR-001',
      scriptReference: 'REF-001',
      isActive: true,
    });
    const savedScript1 = await script1.save();
    scriptId1 = savedScript1._id as mongoose.Types.ObjectId;

    const script2 = new AnswerScript({
      exam: testExamId,
      student: studentId2,
      batchId: 'batch-101',
      fileIndex: 1,
      startPageNumber: 4,
      endPageNumber: 6,
      pageCount: 3,
      anonymousId: 'ANON-SCR-002',
      scriptReference: 'REF-002',
      isActive: true,
    });
    const savedScript2 = await script2.save();
    scriptId2 = savedScript2._id as mongoose.Types.ObjectId;
  });

  function makeRequest(url: string, method = 'GET', body?: any) {
    return new NextRequest(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  function makeContext(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  describe('1. Model Validation & Partial Unique Indexing', () => {
    it('creates a valid ScriptFlag document with default status OPEN and denormalized exam', async () => {
      const flag = new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        question: 1,
        raisedBy: taId1,
        reason: FlagReason.CHEATING_SUSPECTED,
        note: 'Matches external source verbatim',
      });
      const saved = await flag.save();

      expect(saved._id).toBeDefined();
      expect(saved.status).toBe(FlagStatus.OPEN);
      expect(saved.exam.toString()).toBe(testExamId.toString());
      expect(saved.answerScript.toString()).toBe(scriptId1.toString());
      expect(saved.question).toBe(1);
      expect(saved.reason).toBe(FlagReason.CHEATING_SUSPECTED);
      expect(saved.note).toBe('Matches external source verbatim');
      expect(saved.resolution).toBeNull();
      expect(saved.createdAt).toBeInstanceOf(Date);
      expect(saved.updatedAt).toBeInstanceOf(Date);
    });

    it('supports all defined FlagReason enum values', async () => {
      const reasons = [
        FlagReason.CHEATING_SUSPECTED,
        FlagReason.ILLEGIBLE,
        FlagReason.OTHER,
      ];

      for (let i = 0; i < reasons.length; i++) {
        const flag = new ScriptFlag({
          answerScript: scriptId1,
          exam: testExamId,
          question: i + 1,
          raisedBy: taId1,
          reason: reasons[i],
        });
        const saved = await flag.save();
        expect(saved.reason).toBe(reasons[i]);
      }
    });

    it('enforces partial unique index: rejects duplicate OPEN flag by same TA on same question', async () => {
      await new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        question: 1,
        raisedBy: taId1,
        reason: FlagReason.ILLEGIBLE,
        status: FlagStatus.OPEN,
      }).save();

      const duplicate = new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        question: 1,
        raisedBy: taId1,
        reason: FlagReason.OTHER,
        status: FlagStatus.OPEN,
      });

      await expect(duplicate.save()).rejects.toThrow();
    });

    it('allows multiple TAs to flag the same script/question independently', async () => {
      const flagTa1 = await new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        question: 1,
        raisedBy: taId1,
        reason: FlagReason.CHEATING_SUSPECTED,
        status: FlagStatus.OPEN,
      }).save();

      const flagTa2 = await new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        question: 1,
        raisedBy: taId2,
        reason: FlagReason.ILLEGIBLE,
        status: FlagStatus.OPEN,
      }).save();

      expect(flagTa1._id).toBeDefined();
      expect(flagTa2._id).toBeDefined();
      expect(flagTa1.raisedBy.toString()).not.toBe(flagTa2.raisedBy.toString());
    });

    it('allows a new OPEN flag after previous flag by same TA is RESOLVED', async () => {
      const resolvedFlag = await new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        question: 1,
        raisedBy: taId1,
        reason: FlagReason.ILLEGIBLE,
        status: FlagStatus.RESOLVED,
        resolution: {
          action: 'CLEAR',
          by: professorId,
          at: new Date(),
          notes: 'Script re-scanned clearly',
        },
      }).save();

      expect(resolvedFlag.status).toBe(FlagStatus.RESOLVED);

      const newOpenFlag = await new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        question: 1,
        raisedBy: taId1,
        reason: FlagReason.OTHER,
        status: FlagStatus.OPEN,
      }).save();

      expect(newOpenFlag._id).toBeDefined();
      expect(newOpenFlag.status).toBe(FlagStatus.OPEN);
    });
  });

  describe('2. ScriptFlagService Authorization & Allocation Enforcement', () => {
    it('creates flag successfully before any Grade exists for the script', async () => {
      // Allocate TA 1 to whole script 1
      await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL,
      });

      // Verify no grade exists
      const gradesCount = await Grade.countDocuments({ answerScript: scriptId1 });
      expect(gradesCount).toBe(0);

      const flag = await ScriptFlagService.createFlag({
        scriptId: scriptId1.toString(),
        reason: FlagReason.CHEATING_SUSPECTED,
        note: 'Suspicious mathematical notation',
        userId: taId1.toString(),
        userRole: UserRole.TA,
      });

      expect(flag).toBeDefined();
      expect(flag.reason).toBe(FlagReason.CHEATING_SUSPECTED);
      expect(flag.status).toBe(FlagStatus.OPEN);
    });

    it('allows question-wise allocated TA to flag their allocated question', async () => {
      // Allocate TA 1 to question 2
      await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        question: 2,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.QUESTION,
      });

      const flag = await ScriptFlagService.createFlag({
        scriptId: scriptId1.toString(),
        question: 2,
        reason: FlagReason.ILLEGIBLE,
        note: 'Ink smudge on formula step 3',
        userId: taId1.toString(),
        userRole: UserRole.TA,
      });

      expect(flag.question).toBe(2);
      expect(flag.reason).toBe(FlagReason.ILLEGIBLE);
    });

    it('rejects flag creation when TA is not allocated to the script', async () => {
      // TA 1 is allocated, but unallocated TA attempts to flag
      await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL,
      });

      await expect(
        ScriptFlagService.createFlag({
          scriptId: scriptId1.toString(),
          reason: FlagReason.OTHER,
          userId: unallocatedTaId.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow(/not allocated/i);
    });

    it('rejects question flag when TA is allocated to a different question on the same script', async () => {
      // TA 1 is allocated to Question 1 only
      await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        question: 1,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.QUESTION,
      });

      // TA 1 tries to flag Question 2
      await expect(
        ScriptFlagService.createFlag({
          scriptId: scriptId1.toString(),
          question: 2,
          reason: FlagReason.CHEATING_SUSPECTED,
          userId: taId1.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow(/not allocated/i);
    });

    it('rejects flag creation when user role lacks FLAG_FOR_REVIEW permission', async () => {
      await expect(
        ScriptFlagService.createFlag({
          scriptId: scriptId1.toString(),
          reason: FlagReason.OTHER,
          userId: studentId.toString(),
          userRole: UserRole.STUDENT,
        })
      ).rejects.toThrow(/permission/i);
    });

    it('rejects invalid reason enum with 400 Bad Request', async () => {
      await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL,
      });

      await expect(
        ScriptFlagService.createFlag({
          scriptId: scriptId1.toString(),
          reason: 'INVALID_REASON_CODE',
          userId: taId1.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow(/Invalid flag reason/i);
    });

    it('trims note whitespace and rejects note exceeding 2000 characters', async () => {
      await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL,
      });

      const longNote = 'A'.repeat(2001);
      await expect(
        ScriptFlagService.createFlag({
          scriptId: scriptId1.toString(),
          reason: FlagReason.OTHER,
          note: longNote,
          userId: taId1.toString(),
          userRole: UserRole.TA,
        })
      ).rejects.toThrow(/cannot exceed 2000 characters/i);

      // Whitespace trimmed
      const flag = await ScriptFlagService.createFlag({
        scriptId: scriptId1.toString(),
        reason: FlagReason.OTHER,
        note: '   Trimmed note content   ',
        userId: taId1.toString(),
        userRole: UserRole.TA,
      });

      expect(flag.note).toBe('Trimmed note content');
    });
  });

  describe('3. AuditLog Recording & Professor Notification', () => {
    it('records an AuditLog entry when a flag is created', async () => {
      await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        question: 1,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.QUESTION,
      });

      const flag = await ScriptFlagService.createFlag({
        scriptId: scriptId1.toString(),
        question: 1,
        reason: FlagReason.CHEATING_SUSPECTED,
        note: 'Potential plagiarism from peer',
        userId: taId1.toString(),
        userRole: UserRole.TA,
        ipAddress: '192.168.1.100',
      });

      const logs = await AuditLog.find({ entityId: flag._id });
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('SCRIPT_FLAG_CREATED');
      expect(logs[0].outcome).toBe('SUCCESS');
      expect(logs[0].user.toString()).toBe(taId1.toString());
      expect(logs[0].details?.reason).toBe(FlagReason.CHEATING_SUSPECTED);
      expect(logs[0].ipAddress).toBe('192.168.1.100');
    });

    it('creates an in-app Notification for the exam professor when a flag is raised', async () => {
      await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        question: 3,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.QUESTION,
      });

      await Notification.deleteMany({});

      await ScriptFlagService.createFlag({
        scriptId: scriptId1.toString(),
        question: 3,
        reason: FlagReason.ILLEGIBLE,
        userId: taId1.toString(),
        userRole: UserRole.TA,
      });

      const notifications = await Notification.find({ recipient: professorId });
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe(NotificationType.FLAG);
      expect(notifications[0].title).toBe('Script Flagged for Review');
      expect(notifications[0].message).toContain('Question 3');
      expect(notifications[0].message).toContain(FlagReason.ILLEGIBLE);
      expect(notifications[0].read).toBe(false);
      expect(notifications[0].exam?.toString()).toBe(testExamId.toString());
      expect(notifications[0].answerScript?.toString()).toBe(scriptId1.toString());
    });
  });

  describe('4. Privacy & Visibility Restrictions', () => {
    it('completely denies Student access to flag retrieval with 403 Forbidden', async () => {
      await expect(
        ScriptFlagService.getFlagsForScript({
          scriptId: scriptId1.toString(),
          userId: studentId.toString(),
          userRole: UserRole.STUDENT,
        })
      ).rejects.toThrow(/Student accounts cannot access flag information/i);
    });

    it('restricts TA to seeing only flags they raised themselves', async () => {
      await new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        question: 1,
        raisedBy: taId1,
        reason: FlagReason.CHEATING_SUSPECTED,
        note: 'Secret TA1 observation',
      }).save();

      await new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        question: 2,
        raisedBy: taId2,
        reason: FlagReason.ILLEGIBLE,
        note: 'Secret TA2 observation',
      }).save();

      const ta1Flags = await ScriptFlagService.getFlagsForScript({
        scriptId: scriptId1.toString(),
        userId: taId1.toString(),
        userRole: UserRole.TA,
      });

      expect(ta1Flags).toHaveLength(1);
      expect(ta1Flags[0].raisedBy.toString()).toBe(taId1.toString());
      expect(ta1Flags[0].note).toBe('Secret TA1 observation');

      const ta2Flags = await ScriptFlagService.getFlagsForScript({
        scriptId: scriptId1.toString(),
        userId: taId2.toString(),
        userRole: UserRole.TA,
      });

      expect(ta2Flags).toHaveLength(1);
      expect(ta2Flags[0].raisedBy.toString()).toBe(taId2.toString());
      expect(ta2Flags[0].note).toBe('Secret TA2 observation');
    });

    it('allows the exam Professor to view all flags on the script', async () => {
      await new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        question: 1,
        raisedBy: taId1,
        reason: FlagReason.CHEATING_SUSPECTED,
      }).save();

      await new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        question: 2,
        raisedBy: taId2,
        reason: FlagReason.ILLEGIBLE,
      }).save();

      const profFlags = await ScriptFlagService.getFlagsForScript({
        scriptId: scriptId1.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
      });

      expect(profFlags).toHaveLength(2);
    });

    it('isolates flags between distinct answer scripts', async () => {
      await new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        question: 1,
        raisedBy: taId1,
        reason: FlagReason.CHEATING_SUSPECTED,
      }).save();

      const script2Flags = await ScriptFlagService.getFlagsForScript({
        scriptId: scriptId2.toString(),
        userId: professorId.toString(),
        userRole: UserRole.PROFESSOR,
      });

      expect(script2Flags).toHaveLength(0);
    });
  });

  describe('5. HTTP API Endpoints (POST & GET /api/scripts/[id]/flags)', () => {
    it('POST /api/scripts/[id]/flags returns 201 Created on successful flag', async () => {
      await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL,
      });

      mockSessionUser = {
        id: taId1.toString(),
        email: 'hermione@hogwarts.edu',
        name: 'Hermione Granger',
        role: UserRole.TA,
      };

      const req = makeRequest(`http://localhost:3000/api/scripts/${scriptId1}/flags`, 'POST', {
        reason: FlagReason.CHEATING_SUSPECTED,
        note: 'External solution match',
      });

      const res = await flagPOST(req, makeContext(scriptId1.toString()));
      expect(res.status).toBe(201);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe(FlagStatus.OPEN);
      expect(json.data.reason).toBe(FlagReason.CHEATING_SUSPECTED);
    });

    it('POST returns 409 Conflict when attempting duplicate open flag on same question', async () => {
      await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        question: 1,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.QUESTION,
      });

      mockSessionUser = {
        id: taId1.toString(),
        email: 'hermione@hogwarts.edu',
        name: 'Hermione Granger',
        role: UserRole.TA,
      };

      const req1 = makeRequest(`http://localhost:3000/api/scripts/${scriptId1}/flags`, 'POST', {
        question: 1,
        reason: FlagReason.ILLEGIBLE,
      });
      const res1 = await flagPOST(req1, makeContext(scriptId1.toString()));
      expect(res1.status).toBe(201);

      const req2 = makeRequest(`http://localhost:3000/api/scripts/${scriptId1}/flags`, 'POST', {
        question: 1,
        reason: FlagReason.OTHER,
      });
      const res2 = await flagPOST(req2, makeContext(scriptId1.toString()));
      expect(res2.status).toBe(409);

      const json2 = await res2.json();
      expect(json2.success).toBe(false);
      expect(json2.message).toContain('already exists');
    });

    it('GET /api/scripts/[id]/flags returns 403 Forbidden for Student', async () => {
      mockSessionUser = {
        id: studentId.toString(),
        email: 'harry@hogwarts.edu',
        name: 'Harry Potter',
        role: UserRole.STUDENT,
      };

      const req = makeRequest(`http://localhost:3000/api/scripts/${scriptId1}/flags`, 'GET');
      const res = await flagGET(req, makeContext(scriptId1.toString()));

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('GET /api/scripts/[id]/flags returns 200 with scoped flags for TA', async () => {
      await new ScriptFlag({
        answerScript: scriptId1,
        exam: testExamId,
        raisedBy: taId1,
        reason: FlagReason.OTHER,
        note: 'Checked by TA1',
      }).save();

      mockSessionUser = {
        id: taId1.toString(),
        email: 'hermione@hogwarts.edu',
        name: 'Hermione Granger',
        role: UserRole.TA,
      };

      const req = makeRequest(`http://localhost:3000/api/scripts/${scriptId1}/flags`, 'GET');
      const res = await flagGET(req, makeContext(scriptId1.toString()));

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toHaveLength(1);
      expect(json.data[0].note).toBe('Checked by TA1');
    });
  });
});
