/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import ScriptFlag, { FlagReason, FlagStatus } from '../models/ScriptFlag';
import AnswerScript from '../models/AnswerScript';
import Exam, { ExamStatus } from '../models/Exam';
import Course from '../models/Course';
import User, { UserRole } from '../models/User';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AuditLog from '../models/AuditLog';
import Notification from '../models/Notification';
import Grade from '../models/Grade';
import ScriptFlagService from '../services/ScriptFlagService';
import { GET as professorFlagsGET } from '../app/api/professor/flags/route';

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

describe('AE-163: Professor Flag Review Queue Tests', () => {
  let profAId: mongoose.Types.ObjectId;
  let profBId: mongoose.Types.ObjectId;
  let adminId: mongoose.Types.ObjectId;
  let taId: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let student2Id: mongoose.Types.ObjectId;

  let courseAId: mongoose.Types.ObjectId;
  let courseBId: mongoose.Types.ObjectId;
  let examAId: mongoose.Types.ObjectId;
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

    profAId = new mongoose.Types.ObjectId('000000000000000000000901');
    profBId = new mongoose.Types.ObjectId('000000000000000000000902');
    adminId = new mongoose.Types.ObjectId('000000000000000000000903');
    taId = new mongoose.Types.ObjectId('000000000000000000000904');
    studentId = new mongoose.Types.ObjectId('000000000000000000000905');
    student2Id = new mongoose.Types.ObjectId('000000000000000000000906');
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
      courseName: 'Transfiguration I',
      professor: profAId,
      semester: 1,
      academicYear: '2026-2027',
      teachingAssistants: [taId],
      enrolledStudents: [studentId, student2Id],
      isActive: true,
    }).save();

    courseBId = new mongoose.Types.ObjectId();
    await new Course({
      _id: courseBId,
      courseCode: 'CS102',
      courseName: 'Potions I',
      professor: profBId,
      semester: 1,
      academicYear: '2026-2027',
      teachingAssistants: [taId],
      enrolledStudents: [studentId],
      isActive: true,
    }).save();

    // 3. Create Exams (Prof A owns Exam A, Prof B owns Exam B)
    examAId = new mongoose.Types.ObjectId();
    await new Exam({
      _id: examAId,
      title: 'Transfiguration Midterm',
      course: courseAId,
      createdBy: profAId,
      examDate: new Date(),
      totalMarks: 100,
      status: ExamStatus.EVALUATING,
      numberOfQuestions: 5,
      isActive: true,
    }).save();

    examBId = new mongoose.Types.ObjectId();
    await new Exam({
      _id: examBId,
      title: 'Potions Midterm',
      course: courseBId,
      createdBy: profBId,
      examDate: new Date(),
      totalMarks: 100,
      status: ExamStatus.EVALUATING,
      numberOfQuestions: 5,
      isActive: true,
    }).save();

    // 4. Create Answer Scripts
    scriptA1Id = new mongoose.Types.ObjectId();
    await new AnswerScript({
      _id: scriptA1Id,
      exam: examAId,
      student: studentId,
      scriptReference: 'SCRIPT-A-001',
      candidateStudentId: 'ROLL-001',
      pageCount: 4,
      isActive: true,
    }).save();

    scriptA2Id = new mongoose.Types.ObjectId();
    await new AnswerScript({
      _id: scriptA2Id,
      exam: examAId,
      student: student2Id,
      scriptReference: 'SCRIPT-A-002',
      candidateStudentId: 'ROLL-002',
      pageCount: 3,
      isActive: true,
    }).save();

    scriptB1Id = new mongoose.Types.ObjectId();
    await new AnswerScript({
      _id: scriptB1Id,
      exam: examBId,
      student: studentId,
      scriptReference: 'SCRIPT-B-001',
      candidateStudentId: 'ROLL-003',
      pageCount: 5,
      isActive: true,
    }).save();

    // 5. Seed TA allocations
    await new Allocation({
      exam: examAId,
      answerScript: scriptA1Id,
      ta: taId,
      status: AllocationStatus.PENDING,
      allocatedBy: profAId,
      rule: AllocationRule.EQUAL,
      isActive: true,
    }).save();

    await new Allocation({
      exam: examBId,
      answerScript: scriptB1Id,
      ta: taId,
      status: AllocationStatus.PENDING,
      allocatedBy: profBId,
      rule: AllocationRule.EQUAL,
      isActive: true,
    }).save();
  });

  describe('Requirement 1 & 4: Access Control and Server-Side Ownership Scoping', () => {
    it('allows a professor to access flags belonging to their own exams', async () => {
      // Create flag on Prof A's exam
      await new ScriptFlag({
        answerScript: scriptA1Id,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        note: 'Suspicious identical handwriting with neighbor',
        status: FlagStatus.OPEN,
      }).save();

      const result = await ScriptFlagService.getProfessorFlagQueue({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(result.flags).toHaveLength(1);
      expect(result.flags[0].exam._id).toBe(examAId.toString());
      expect(result.flags[0].reason).toBe(FlagReason.CHEATING_SUSPECTED);
      expect(result.counts.open).toBe(1);
    });

    it('scopes professor flags using Exam.find({ createdBy: viewer.id }) without hiding flags for inactive exams', async () => {
      // Create an exam owned by Prof A with isActive: false (or archived)
      const inactiveExamId = new mongoose.Types.ObjectId();
      await new Exam({
        _id: inactiveExamId,
        title: 'Archived Exam',
        course: courseAId,
        createdBy: profAId,
        examDate: new Date(),
        totalMarks: 100,
        status: ExamStatus.ARCHIVED,
        numberOfQuestions: 5,
        isActive: false,
      }).save();

      const scriptInactiveId = new mongoose.Types.ObjectId();
      await new AnswerScript({
        _id: scriptInactiveId,
        exam: inactiveExamId,
        student: studentId,
        scriptReference: 'SCRIPT-INACTIVE-001',
        candidateStudentId: 'ROLL-INACTIVE',
        pageCount: 2,
        isActive: true,
      }).save();

      await new ScriptFlag({
        answerScript: scriptInactiveId,
        exam: inactiveExamId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.OTHER,
        note: 'Flag on archived exam',
        status: FlagStatus.OPEN,
      }).save();

      const result = await ScriptFlagService.getProfessorFlagQueue({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(result.flags).toHaveLength(1);
      expect(result.flags[0].exam._id).toBe(inactiveExamId.toString());
      expect(result.flags[0].reason).toBe(FlagReason.OTHER);
    });

    it('enforces two-professor isolation: Professor A cannot see Professor B flags', async () => {
      // Create flag on Prof A's exam
      await new ScriptFlag({
        answerScript: scriptA1Id,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.ILLEGIBLE,
        status: FlagStatus.OPEN,
      }).save();

      // Create flag on Prof B's exam
      await new ScriptFlag({
        answerScript: scriptB1Id,
        exam: examBId,
        question: 2,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        note: 'Flag on Professor B exam',
        status: FlagStatus.OPEN,
      }).save();

      // Prof A requests queue
      const profAResult = await ScriptFlagService.getProfessorFlagQueue({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(profAResult.flags).toHaveLength(1);
      expect(profAResult.flags[0].exam._id).toBe(examAId.toString());

      // Prof B requests queue
      const profBResult = await ScriptFlagService.getProfessorFlagQueue({
        userId: profBId,
        userRole: UserRole.PROFESSOR,
      });

      expect(profBResult.flags).toHaveLength(1);
      expect(profBResult.flags[0].exam._id).toBe(examBId.toString());
      expect(profBResult.flags[0].reason).toBe(FlagReason.CHEATING_SUSPECTED);
    });

    it('prevents bypassing ownership when passing another professor examId', async () => {
      // Create flag on Prof B's exam
      await new ScriptFlag({
        answerScript: scriptB1Id,
        exam: examBId,
        question: 3,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        status: FlagStatus.OPEN,
      }).save();

      // Prof A maliciously passes Prof B's examId
      const profAResult = await ScriptFlagService.getProfessorFlagQueue({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
        examId: examBId.toString(),
      });

      // Must be empty - server never trusts client-supplied examId
      expect(profAResult.flags).toHaveLength(0);
      expect(profAResult.counts.open).toBe(0);
    });

    it('rejects TA access to the professor review queue with 403 Forbidden', async () => {
      await expect(
        ScriptFlagService.getProfessorFlagQueue({
          userId: taId,
          userRole: UserRole.TA,
        })
      ).rejects.toThrow('Forbidden');

      // Also verify via API Route
      mockSessionUser = {
        id: taId.toString(),
        name: 'Hermione Granger',
        email: 'hermione@hogwarts.edu',
        role: UserRole.TA,
      };

      const req = new NextRequest('http://localhost:3000/api/professor/flags');
      const res = await professorFlagsGET(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('rejects student access to the professor review queue with 403 Forbidden', async () => {
      await expect(
        ScriptFlagService.getProfessorFlagQueue({
          userId: studentId,
          userRole: UserRole.STUDENT,
        })
      ).rejects.toThrow('Forbidden');

      // Also verify via API Route
      mockSessionUser = {
        id: studentId.toString(),
        name: 'Harry Potter',
        email: 'harry@hogwarts.edu',
        role: UserRole.STUDENT,
      };

      const req = new NextRequest('http://localhost:3000/api/professor/flags');
      const res = await professorFlagsGET(req);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.success).toBe(false);
    });

    it('allows ADMIN to access review queue across all exams', async () => {
      await new ScriptFlag({
        answerScript: scriptA1Id,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.ILLEGIBLE,
        status: FlagStatus.OPEN,
      }).save();

      await new ScriptFlag({
        answerScript: scriptB1Id,
        exam: examBId,
        question: 2,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        status: FlagStatus.OPEN,
      }).save();

      const adminResult = await ScriptFlagService.getProfessorFlagQueue({
        userId: adminId,
        userRole: UserRole.ADMIN,
      });

      expect(adminResult.flags).toHaveLength(2);
      expect(adminResult.counts.open).toBe(2);
    });
  });

  describe('Requirement 2: Queue Ordering and Status Filtering', () => {
    it('sorts OPEN flags newest first by default', async () => {
      const olderTime = new Date('2026-09-01T10:00:00Z');
      const newerTime = new Date('2026-09-02T10:00:00Z');

      const flagOlder = new ScriptFlag({
        answerScript: scriptA1Id,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.ILLEGIBLE,
        status: FlagStatus.OPEN,
        createdAt: olderTime,
        updatedAt: olderTime,
      });
      await flagOlder.save();

      const flagNewer = new ScriptFlag({
        answerScript: scriptA2Id,
        exam: examAId,
        question: 2,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        status: FlagStatus.OPEN,
        createdAt: newerTime,
        updatedAt: newerTime,
      });
      await flagNewer.save();

      const result = await ScriptFlagService.getProfessorFlagQueue({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(result.flags).toHaveLength(2);
      // Newest first
      expect(result.flags[0]._id).toBe(flagNewer._id.toString());
      expect(result.flags[1]._id).toBe(flagOlder._id.toString());
    });

    it('filters flags by status (OPEN, RESOLVED, ESCALATED)', async () => {
      await new ScriptFlag({
        answerScript: scriptA1Id,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        status: FlagStatus.OPEN,
      }).save();

      await new ScriptFlag({
        answerScript: scriptA1Id,
        exam: examAId,
        question: 2,
        raisedBy: taId,
        reason: FlagReason.ILLEGIBLE,
        status: FlagStatus.RESOLVED,
      }).save();

      await new ScriptFlag({
        answerScript: scriptA2Id,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.OTHER,
        status: FlagStatus.ESCALATED,
      }).save();

      // 1. Default / OPEN query
      const openResult = await ScriptFlagService.getProfessorFlagQueue({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });
      expect(openResult.flags).toHaveLength(1);
      expect(openResult.flags[0].status).toBe(FlagStatus.OPEN);
      expect(openResult.counts.open).toBe(1);
      expect(openResult.counts.resolved).toBe(1);
      expect(openResult.counts.escalated).toBe(1);

      // 2. RESOLVED filter
      const resolvedResult = await ScriptFlagService.getProfessorFlagQueue({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
        status: FlagStatus.RESOLVED,
      });
      expect(resolvedResult.flags).toHaveLength(1);
      expect(resolvedResult.flags[0].status).toBe(FlagStatus.RESOLVED);
      expect(resolvedResult.flags[0].reason).toBe(FlagReason.ILLEGIBLE);

      // 3. ESCALATED filter
      const escalatedResult = await ScriptFlagService.getProfessorFlagQueue({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
        status: FlagStatus.ESCALATED,
      });
      expect(escalatedResult.flags).toHaveLength(1);
      expect(escalatedResult.flags[0].status).toBe(FlagStatus.ESCALATED);
      expect(escalatedResult.flags[0].reason).toBe(FlagReason.OTHER);
    });

    it('rejects invalid status parameter with 400 Bad Request', async () => {
      await expect(
        ScriptFlagService.getProfessorFlagQueue({
          userId: profAId,
          userRole: UserRole.PROFESSOR,
          status: 'INVALID_STATUS' as any,
        })
      ).rejects.toThrow('Invalid flag status filter');
    });
  });

  describe('Requirement 3, 5 & 6: Data Population, TA Marks, Empty State, and Read-Only Review', () => {
    it('returns empty queue with exact empty state contract when no flags exist', async () => {
      const result = await ScriptFlagService.getProfessorFlagQueue({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(result.flags).toHaveLength(0);
      expect(result.counts.open).toBe(0);
      expect(result.counts.resolved).toBe(0);
      expect(result.counts.escalated).toBe(0);
      expect(result.counts.total).toBe(0);
    });

    it('populates student identity and current TA marks without modifying them', async () => {
      // Create a grade saved by TA
      const rubricId = new mongoose.Types.ObjectId();
      await new Grade({
        answerScript: scriptA1Id,
        rubric: rubricId,
        gradedBy: taId,
        question: 1,
        marksAwarded: [
          { criterionName: 'Correctness', score: 4.5, feedback: 'Almost correct' },
        ],
        totalScore: 4.5,
        feedback: 'Good attempt',
        isFinal: false,
      }).save();

      // Create a flag on that question
      await new ScriptFlag({
        answerScript: scriptA1Id,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        note: 'Identical phrasing to student 42',
        status: FlagStatus.OPEN,
      }).save();

      const result = await ScriptFlagService.getProfessorFlagQueue({
        userId: profAId,
        userRole: UserRole.PROFESSOR,
      });

      expect(result.flags).toHaveLength(1);
      const flagItem = result.flags[0];

      // Verify populated context
      expect(flagItem.answerScript.student).toBeDefined();
      expect(flagItem.answerScript.student?.name).toBe('Harry Potter');
      expect(flagItem.exam.title).toBe('Transfiguration Midterm');
      expect(flagItem.raisedBy.name).toBe('Hermione Granger (TA)');

      // Verify TA marks are populated accurately
      expect(flagItem.currentMarks).toBeDefined();
      expect(flagItem.currentMarks?.totalScore).toBe(4.5);
      expect(flagItem.currentMarks?.marksAwarded?.[0]?.criterionName).toBe('Correctness');
      expect(flagItem.currentMarks?.marksAwarded?.[0]?.score).toBe(4.5);

      // Verify grade record is unchanged (read-only guarantee)
      const existingGrade = await Grade.findOne({ answerScript: scriptA1Id });
      expect(existingGrade?.totalScore).toBe(4.5);
      expect(existingGrade?.isFinal).toBe(false);
    });

    it('supports API route GET /api/professor/flags with query params', async () => {
      await new ScriptFlag({
        answerScript: scriptA1Id,
        exam: examAId,
        question: 1,
        raisedBy: taId,
        reason: FlagReason.CHEATING_SUSPECTED,
        status: FlagStatus.OPEN,
      }).save();

      mockSessionUser = {
        id: profAId.toString(),
        name: 'Professor Albus Dumbledore',
        email: 'dumbledore@hogwarts.edu',
        role: UserRole.PROFESSOR,
      };

      const req = new NextRequest('http://localhost:3000/api/professor/flags?status=OPEN');
      const res = await professorFlagsGET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.flags).toHaveLength(1);
      expect(json.data.counts.open).toBe(1);
    });
  });
});
