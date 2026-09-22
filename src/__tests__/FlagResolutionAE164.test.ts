/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import ScriptFlag, { FlagReason, FlagStatus, FlagResolutionAction } from '../models/ScriptFlag';
import AnswerScript from '../models/AnswerScript';
import Exam, { ExamStatus } from '../models/Exam';
import Course from '../models/Course';
import User, { UserRole } from '../models/User';
import Allocation from '../models/Allocation';
import AuditLog from '../models/AuditLog';
import Notification from '../models/Notification';
import Grade from '../models/Grade';
import Rubric from '../models/Rubric';
import ScriptFlagService from '../services/ScriptFlagService';
import examService from '../services/ExamService';
import { GradingService } from '../services/GradingService';
import { POST as resolveRoutePOST } from '../app/api/professor/flags/[id]/resolve/route';
import { POST as genericResolveRoutePOST } from '../app/api/flags/[id]/resolve/route';

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

describe('AE-164: Flag Resolution / Audited Grade Override Tests', () => {
  let profAId: mongoose.Types.ObjectId;
  let profBId: mongoose.Types.ObjectId;
  let adminId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let student2Id: mongoose.Types.ObjectId;

  let courseAId: mongoose.Types.ObjectId;
  let examAId: mongoose.Types.ObjectId;
  let examBId: mongoose.Types.ObjectId;

  let scriptAId: mongoose.Types.ObjectId;
  let rubricAId: mongoose.Types.ObjectId;

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
    await Rubric.init();

    profAId = new mongoose.Types.ObjectId('000000000000000000000801');
    profBId = new mongoose.Types.ObjectId('000000000000000000000802');
    adminId = new mongoose.Types.ObjectId('000000000000000000000803');
    taId = new mongoose.Types.ObjectId('000000000000000000000804');
    studentId = new mongoose.Types.ObjectId('000000000000000000000805');
    student2Id = new mongoose.Types.ObjectId('000000000000000000000806');
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
    await Rubric.deleteMany({});

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

    // 3. Create Exams
    examAId = new mongoose.Types.ObjectId();
    await new Exam({
      _id: examAId,
      title: 'Midterm Exam - Prof A',
      course: courseAId,
      examDate: new Date('2026-10-01'),
      totalMarks: 100,
      numberOfQuestions: 5,
      createdBy: profAId,
      status: ExamStatus.REVIEW_PENDING,
      isActive: true,
    }).save();

    examBId = new mongoose.Types.ObjectId();
    await new Exam({
      _id: examBId,
      title: 'Midterm Exam - Prof B',
      course: courseAId,
      examDate: new Date('2026-10-01'),
      totalMarks: 100,
      numberOfQuestions: 5,
      createdBy: profBId,
      status: ExamStatus.REVIEW_PENDING,
      isActive: true,
    }).save();

    // 4. Create AnswerScript
    scriptAId = new mongoose.Types.ObjectId();
    await new AnswerScript({
      _id: scriptAId,
      exam: examAId,
      student: studentId,
      scriptReference: 'SCRIPT-A1',
      pages: [],
      isActive: true,
    }).save();

    // 5. Create Active Rubric for Exam A
    rubricAId = new mongoose.Types.ObjectId();
    await new Rubric({
      _id: rubricAId,
      exam: examAId,
      scoreStep: 0.5,
      createdBy: profAId,
      isActive: true,
      questions: [
        {
          questionNumber: 1,
          maxMarks: 10,
          criteria: [
            { criterionName: 'Correctness', points: 6, description: 'Accuracy of formula' },
            { criterionName: 'Clarity', points: 4, description: 'Explanation steps' },
          ],
        },
      ],
    }).save();
  });

  describe('Authorization & Exam Ownership', () => {
    it('should allow the exam-owner professor to resolve a flag', async () => {
      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        note: 'Suspicious similarity',
        status: FlagStatus.OPEN,
      }).save();

      const result = await ScriptFlagService.resolveFlag({
        flagId: flag._id,
        action: FlagResolutionAction.CLEAR,
        notes: 'Reviewed handwriting and student draft; flag cleared.',
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(result.status).toBe(FlagStatus.RESOLVED);
      expect(result.resolution?.action).toBe(FlagResolutionAction.CLEAR);
      expect(result.resolution?.by?.toString()).toBe(profAId.toString());
    });

    it('should forbid another professor from resolving a flag belonging to a different exam (two-professor isolation)', async () => {
      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId, // owned by Prof A
        question: 1,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        note: 'Suspicious similarity',
        status: FlagStatus.OPEN,
      }).save();

      // Prof B tries to resolve Prof A's flag
      await expect(
        ScriptFlagService.resolveFlag({
          flagId: flag._id,
          action: FlagResolutionAction.CLEAR,
          notes: 'Prof B trying to resolve',
          userId: profBId,
          userRole: UserRole.PROFESSOR,
        })
      ).rejects.toThrow(/Forbidden.*own/i);
    });

    it('should allow an admin to resolve a flag for any exam', async () => {
      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        note: 'Escalated issue',
        status: FlagStatus.OPEN,
      }).save();

      const result = await ScriptFlagService.resolveFlag({
        flagId: flag._id,
        action: FlagResolutionAction.CLEAR,
        notes: 'Admin review completed.',
        userId: adminId,
        userRole: UserRole.ADMIN,
      });

      expect(result.status).toBe(FlagStatus.RESOLVED);
      expect(result.resolution?.by?.toString()).toBe(adminId.toString());
    });

    it('should forbid a TA from resolving a flag', async () => {
      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.ILLEGIBLE,
        note: 'Cannot read text',
        status: FlagStatus.OPEN,
      }).save();

      await expect(
        ScriptFlagService.resolveFlag({
          flagId: flag._id,
          action: FlagResolutionAction.CLEAR,
          notes: 'TA trying to resolve',
          userId: taId,
          userRole: UserRole.TA,
        })
      ).rejects.toThrow(/Forbidden/i);
    });
  });

  describe('OVERRIDE Action & Score Immutability', () => {
    it('should store previousScore and newScore without mutating original TA Grade marksAwarded', async () => {
      // Create TA's original Grade record
      const originalGrade = await new Grade({
        answerScript: scriptAId,
        rubric: rubricAId,
        question: 1,
        gradedBy: taId,
        totalScore: 5.0,
        marksAwarded: [
          { criterionName: 'Correctness', score: 3.0, feedback: 'Initial partial credit' },
          { criterionName: 'Clarity', score: 2.0, feedback: 'Average clarity' },
        ],
        isFinal: true,
      }).save();

      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.OTHER,
        note: 'TA requests professor check criterion 1',
        status: FlagStatus.OPEN,
      }).save();

      // Professor overrides with criterion overrides
      const resolvedFlag = await ScriptFlagService.resolveFlag({
        flagId: flag._id,
        action: FlagResolutionAction.OVERRIDE,
        notes: 'Student solution is completely correct according to alternative method.',
        criterionOverrides: [
          { criterionName: 'Correctness', score: 6.0, feedback: 'Full points for alternative derivation' },
          { criterionName: 'Clarity', score: 2.5, feedback: 'Clear steps' },
        ],
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(resolvedFlag.status).toBe(FlagStatus.RESOLVED);
      expect(resolvedFlag.resolution?.action).toBe(FlagResolutionAction.OVERRIDE);
      expect(resolvedFlag.resolution?.previousScore).toBe(5.0);
      expect(resolvedFlag.resolution?.newScore).toBe(8.5);

      // Verify original TA Grade was NOT mutated
      const freshOriginalGrade = await Grade.findById(originalGrade._id);
      expect(freshOriginalGrade?.totalScore).toBe(5.0);
      expect(freshOriginalGrade?.marksAwarded[0].score).toBe(3.0);
      expect(freshOriginalGrade?.marksAwarded[1].score).toBe(2.0);

      // Verify effective grade uses override
      const effective = await ScriptFlagService.getEffectiveGrade(scriptAId, 1);
      expect(effective.isOverridden).toBe(true);
      expect(effective.totalScore).toBe(8.5);
      expect(effective.originalScore).toBe(5.0);
      expect(effective.marksAwarded?.[0].score).toBe(6.0);
    });

    it('should validate new score against rubric bounds and reject out-of-range scores', async () => {
      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1, // maxMarks = 10
        raisedBy: taId,
        reason: FlagReason.OTHER,
        status: FlagStatus.OPEN,
      }).save();

      // Exceeds question maxMarks (15 > 10)
      await expect(
        ScriptFlagService.resolveFlag({
          flagId: flag._id,
          action: FlagResolutionAction.OVERRIDE,
          newScore: 15,
          notes: 'Score too high',
          userId: profAId,
          userRole: UserRole.PROFESSOR,
        })
      ).rejects.toThrow(/exceeds maximum allowed marks/i);

      // Negative score (-2 < 0)
      await expect(
        ScriptFlagService.resolveFlag({
          flagId: flag._id,
          action: FlagResolutionAction.OVERRIDE,
          newScore: -2,
          notes: 'Negative score',
          userId: profAId,
          userRole: UserRole.PROFESSOR,
        })
      ).rejects.toThrow(/negative/i);
    });

    it('should validate new score against scoreStep granularity', async () => {
      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.OTHER,
        status: FlagStatus.OPEN,
      }).save();

      // Rubric scoreStep is 0.5; score 7.33 is invalid step
      await expect(
        ScriptFlagService.resolveFlag({
          flagId: flag._id,
          action: FlagResolutionAction.OVERRIDE,
          newScore: 7.33,
          notes: 'Invalid step size',
          userId: profAId,
          userRole: UserRole.PROFESSOR,
        })
      ).rejects.toThrow(/multiple of the score step/i);

      // Score 7.5 is valid step
      const result = await ScriptFlagService.resolveFlag({
        flagId: flag._id,
        action: FlagResolutionAction.OVERRIDE,
        newScore: 7.5,
        notes: 'Valid score step 7.5',
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(result.status).toBe(FlagStatus.RESOLVED);
      expect(result.resolution?.newScore).toBe(7.5);
    });
  });

  describe('CLEAR & ESCALATE Actions', () => {
    it('CLEAR should mark flag RESOLVED and preserve the original score', async () => {
      await new Grade({
        answerScript: scriptAId,
        rubric: rubricAId,
        question: 1,
        gradedBy: taId,
        totalScore: 7.0,
        marksAwarded: [{ criterionName: 'Correctness', score: 5.0 }, { criterionName: 'Clarity', score: 2.0 }],
        isFinal: true,
      }).save();

      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.ILLEGIBLE,
        note: 'Hard to read',
        status: FlagStatus.OPEN,
      }).save();

      const resolved = await ScriptFlagService.resolveFlag({
        flagId: flag._id,
        action: FlagResolutionAction.CLEAR,
        notes: 'Clear scan confirmed, TA grade is accurate.',
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(resolved.status).toBe(FlagStatus.RESOLVED);
      expect(resolved.resolution?.action).toBe(FlagResolutionAction.CLEAR);

      const effective = await ScriptFlagService.getEffectiveGrade(scriptAId, 1);
      expect(effective.isOverridden).toBe(false);
      expect(effective.totalScore).toBe(7.0);
    });

    it('ESCALATE should change status to ESCALATED without modifying score', async () => {
      await new Grade({
        answerScript: scriptAId,
        rubric: rubricAId,
        question: 1,
        gradedBy: taId,
        totalScore: 6.0,
        marksAwarded: [{ criterionName: 'Correctness', score: 4.0 }, { criterionName: 'Clarity', score: 2.0 }],
        isFinal: true,
      }).save();

      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        note: 'Disciplinary review needed',
        status: FlagStatus.OPEN,
      }).save();

      const escalated = await ScriptFlagService.resolveFlag({
        flagId: flag._id,
        action: FlagResolutionAction.ESCALATE,
        notes: 'Escalating to exam board admin.',
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(escalated.status).toBe(FlagStatus.ESCALATED);
      expect(escalated.resolution?.action).toBe(FlagResolutionAction.ESCALATE);

      const effective = await ScriptFlagService.getEffectiveGrade(scriptAId, 1);
      expect(effective.isOverridden).toBe(false);
      expect(effective.totalScore).toBe(6.0);
    });
  });

  describe('Finalized Grades & Audit Logging', () => {
    it('should confirm finalized grades return 409 for direct edits in GradingService', async () => {
      await new Grade({
        answerScript: scriptAId,
        rubric: rubricAId,
        question: 1,
        gradedBy: taId,
        totalScore: 6.0,
        marksAwarded: [{ criterionName: 'Correctness', score: 4.0 }, { criterionName: 'Clarity', score: 2.0 }],
        isFinal: true,
      }).save();

      const gradingService = new GradingService();
      await expect(
        gradingService.saveGrade({
          scriptId: scriptAId,
          question: 1,
          marksAwarded: [{ criterionName: 'Correctness', score: 6.0 }, { criterionName: 'Clarity', score: 4.0 }],
          userId: profAId.toString(),
          userRole: UserRole.PROFESSOR,
          isFinal: true,
        })
      ).rejects.toThrow(/finalized and cannot be modified/i);
    });

    it('should record an AuditLog entry with all required fields for every resolution action', async () => {
      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        status: FlagStatus.OPEN,
      }).save();

      await ScriptFlagService.resolveFlag({
        flagId: flag._id,
        action: FlagResolutionAction.OVERRIDE,
        newScore: 9.0,
        notes: 'Audited grade override completed.',
        userId: profAId,
        userRole: UserRole.PROFESSOR,
        ipAddress: '127.0.0.1',
      });

      const auditLogs = await AuditLog.find({ entityId: flag._id });
      expect(auditLogs.length).toBeGreaterThanOrEqual(1);

      const log = auditLogs.find((l) => l.action === 'SCRIPT_FLAG_OVERRIDE');
      expect(log).toBeDefined();
      expect(log?.user?.toString()).toBe(profAId.toString());
      expect(log?.details?.action).toBe(FlagResolutionAction.OVERRIDE);
      expect(log?.details?.newScore).toBe(9.0);
      expect(log?.details?.notes).toBe('Audited grade override completed.');
      expect(log?.details?.scriptId).toBe(scriptAId.toString());
      expect(log?.details?.examId).toBe(examAId.toString());
    });
  });

  describe('Publication Flow Validation (Requirement 9)', () => {
    it('should block exam publication when an OPEN flag exists', async () => {
      // Add an OPEN flag to exam A
      await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        status: FlagStatus.OPEN,
      }).save();

      // Attempt to publish exam A
      await expect(
        examService.updateExam(
          examAId.toString(),
          { status: ExamStatus.PUBLISHED },
          profAId.toString(),
          UserRole.PROFESSOR
        )
      ).rejects.toThrow(/Cannot publish exam.*open flag/i);
    });

    it('should allow exam publication when flags are RESOLVED or ESCALATED', async () => {
      // Create a RESOLVED flag and an ESCALATED flag
      await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.OTHER,
        status: FlagStatus.RESOLVED,
        resolution: {
          action: FlagResolutionAction.CLEAR,
          by: profAId,
          at: new Date(),
          notes: 'Cleared',
        },
      }).save();

      const scriptA2 = await new AnswerScript({
        exam: examAId,
        student: student2Id,
        scriptReference: 'SCRIPT-A2',
        pages: [],
        isActive: true,
      }).save();

      await new ScriptFlag({
        answerScript: scriptA2._id,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        status: FlagStatus.ESCALATED,
        resolution: {
          action: FlagResolutionAction.ESCALATE,
          by: profAId,
          at: new Date(),
          notes: 'Escalated to board',
        },
      }).save();

      // Attempt to publish exam A
      const updated = await examService.updateExam(
        examAId.toString(),
        { status: ExamStatus.PUBLISHED },
        profAId.toString(),
        UserRole.PROFESSOR
      );

      expect(updated?.status).toBe(ExamStatus.PUBLISHED);
    });
  });

  describe('API Route Integration (POST /api/professor/flags/[id]/resolve & /api/flags/[id]/resolve)', () => {
    it('should resolve flag via POST /api/professor/flags/[id]/resolve', async () => {
      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.OTHER,
        status: FlagStatus.OPEN,
      }).save();

      mockSessionUser = { id: profAId.toString(), role: UserRole.PROFESSOR };

      const req = new NextRequest(
        `http://localhost/api/professor/flags/${flag._id}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: FlagResolutionAction.CLEAR,
            notes: 'Verified via API route',
          }),
        }
      );

      const res = await resolveRoutePOST(req, {
        params: Promise.resolve({ id: flag._id.toString() }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe(FlagStatus.RESOLVED);
    });

    it('should resolve flag via generic POST /api/flags/[id]/resolve', async () => {
      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.OTHER,
        status: FlagStatus.OPEN,
      }).save();

      mockSessionUser = { id: adminId.toString(), role: UserRole.ADMIN };

      const req = new NextRequest(
        `http://localhost/api/flags/${flag._id}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: FlagResolutionAction.OVERRIDE,
            newScore: 8.0,
            notes: 'Admin score override',
          }),
        }
      );

      const res = await genericResolveRoutePOST(req, {
        params: Promise.resolve({ id: flag._id.toString() }),
      });
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.status).toBe(FlagStatus.RESOLVED);
      expect(json.data.resolution.newScore).toBe(8.0);
    });

    it('should return 400 when notes are missing or score is invalid in API request', async () => {
      const flag = await new ScriptFlag({
        answerScript: scriptAId,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.OTHER,
        status: FlagStatus.OPEN,
      }).save();

      mockSessionUser = { id: profAId.toString(), role: UserRole.PROFESSOR };

      const req = new NextRequest(
        `http://localhost/api/professor/flags/${flag._id}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify({
            action: FlagResolutionAction.CLEAR,
            // missing notes
          }),
        }
      );

      const res = await resolveRoutePOST(req, {
        params: Promise.resolve({ id: flag._id.toString() }),
      });
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toMatch(/notes are required/i);
    });
  });
});
