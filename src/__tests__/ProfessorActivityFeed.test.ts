/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import Allocation from '../models/Allocation';
import AnswerScript from '../models/AnswerScript';
import Exam from '../models/Exam';
import Course from '../models/Course';
import User, { UserRole } from '../models/User';
import AuditLog from '../models/AuditLog';
import Grade from '../models/Grade';
import AllocationService from '../services/AllocationService';
import { formatActivityTime, getActionBadge } from '../components/ProfessorActivityFeed';

// Mock NextAuth session
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

describe('AE-116: Activity Feed on Professor Dashboard', () => {
  let activityGET: any;

  let testCourseId: mongoose.Types.ObjectId;
  let testExamId: mongoose.Types.ObjectId;
  let professorId: mongoose.Types.ObjectId;
  let taId1: mongoose.Types.ObjectId;
  let taId2: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let scriptId: mongoose.Types.ObjectId;

  beforeAll(async () => {
    activityGET = (await import('../app/api/professor/activity/route')).GET;

    await Allocation.init();
    await AnswerScript.init();
    await AuditLog.init();
    await Course.init();
    await Exam.init();
    await User.init();
    await Grade.init();

    professorId = new mongoose.Types.ObjectId('000000000000000000000500');
    taId1 = new mongoose.Types.ObjectId('000000000000000000000501');
    taId2 = new mongoose.Types.ObjectId('000000000000000000000502');
    studentId = new mongoose.Types.ObjectId('000000000000000000000503');
  });

  beforeEach(async () => {
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await Allocation.deleteMany({});
    await AnswerScript.deleteMany({});
    await User.deleteMany({});
    await AuditLog.deleteMany({});
    await Grade.deleteMany({});

    // Create Users
    await new User({
      _id: professorId,
      name: 'Prof. McGonagall',
      email: 'prof@iiit.ac.in',
      role: UserRole.PROFESSOR,
      password: 'password123',
      isActive: true
    }).save();

    await new User({
      _id: taId1,
      name: 'Hermione Granger',
      email: 'hermione@iiit.ac.in',
      role: UserRole.TA,
      password: 'password123',
      isActive: true
    }).save();

    await new User({
      _id: taId2,
      name: 'Ron Weasley',
      email: 'ron@iiit.ac.in',
      role: UserRole.TA,
      password: 'password123',
      isActive: true
    }).save();

    await new User({
      _id: studentId,
      name: 'Harry Potter',
      email: 'harry@iiit.ac.in',
      role: UserRole.STUDENT,
      password: 'password123',
      isActive: true
    }).save();

    mockSessionUser = {
      id: professorId.toString(),
      role: UserRole.PROFESSOR,
      email: 'prof@iiit.ac.in',
      name: 'Prof. McGonagall',
    };

    const course = new Course({
      courseCode: 'CS201',
      courseName: 'Data Structures',
      semester: 1,
      academicYear: '2026-2027',
      professor: professorId,
      teachingAssistants: [taId1, taId2],
      enrolledStudents: [studentId],
      isActive: true,
    });
    const savedCourse = await course.save();
    testCourseId = savedCourse._id as mongoose.Types.ObjectId;

    const exam = new Exam({
      title: 'Data Structures Midterm',
      course: testCourseId,
      createdBy: professorId,
      examDate: new Date('2026-09-15T09:00:00.000Z'),
      totalMarks: 50,
      numberOfQuestions: 4,
      status: 'PUBLISHED',
      ingestionApprovalStatus: 'APPROVED',
      isActive: true,
    });
    const savedExam = await exam.save();
    testExamId = savedExam._id as mongoose.Types.ObjectId;

    const script = new AnswerScript({
      exam: testExamId,
      student: studentId,
      batchId: 'batch-1',
      fileIndex: 0,
      startPageNumber: 1,
      endPageNumber: 2,
      pageCount: 2,
      isActive: true,
    });
    const savedScript = await script.save();
    scriptId = savedScript._id as mongoose.Types.ObjectId;
  });

  function makeRequest(url: string) {
    return new NextRequest(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  describe('1. Reuse Existing AuditLog & Successful ALLOCATION_REASSIGN in Feed', () => {
    it('returns successful ALLOCATION_REASSIGN events recorded in AuditLog with resolved context', async () => {
      const allocId = new mongoose.Types.ObjectId();

      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        outcome: 'SUCCESS',
        entityId: allocId,
        entityType: 'Allocation',
        details: {
          examId: testExamId.toString(),
          answerScriptId: scriptId.toString(),
          question: 2,
          previousTaId: taId1.toString(),
          newTaId: taId2.toString(),
        },
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
      });

      const req = makeRequest('http://localhost:3000/api/professor/activity');
      const res = await activityGET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(1);
      expect(json.data.activities).toHaveLength(1);

      const item = json.data.activities[0];
      expect(item.action).toBe('ALLOCATION_REASSIGN');
      expect(item.allocationId).toBe(allocId.toString());
      expect(item.question).toBe(2);
      expect(item.description).toBe('Reassigned Question 2 to Ron Weasley');
      expect(item.actingUser.id).toBe(professorId.toString());
      expect(item.actingUser.name).toBe('Prof. McGonagall');
      expect(item.details.previousTa.name).toBe('Hermione Granger');
      expect(item.details.newTa.name).toBe('Ron Weasley');
      expect(item.exam.title).toBe('Data Structures Midterm');
      expect(item.exam.courseCode).toBe('CS201');
      expect(item.answerScript.id).toBe(scriptId.toString());
    });
  });

  describe('2. Deterministic Newest-First Ordering', () => {
    it('returns activities ordered by newest first (descending timestamp)', async () => {
      const time1 = new Date('2026-09-02T08:00:00.000Z');
      const time2 = new Date('2026-09-02T10:00:00.000Z');
      const time3 = new Date('2026-09-02T12:00:00.000Z');

      // Insert out of chronological order
      await AuditLog.create({
        user: taId1,
        action: 'ALLOCATION_CLAIM',
        outcome: 'SUCCESS',
        entityId: new mongoose.Types.ObjectId(),
        entityType: 'Allocation',
        details: { examId: testExamId.toString(), question: 1, taId: taId1.toString() },
        createdAt: time1,
      });

      await AuditLog.create({
        user: taId1,
        action: 'ALLOCATION_COMPLETE',
        outcome: 'SUCCESS',
        entityId: new mongoose.Types.ObjectId(),
        entityType: 'Allocation',
        details: { examId: testExamId.toString(), question: 1, taId: taId1.toString() },
        createdAt: time3,
      });

      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        outcome: 'SUCCESS',
        entityId: new mongoose.Types.ObjectId(),
        entityType: 'Allocation',
        details: { examId: testExamId.toString(), question: 2, previousTaId: taId1.toString(), newTaId: taId2.toString() },
        createdAt: time2,
      });

      const req = makeRequest('http://localhost:3000/api/professor/activity');
      const res = await activityGET(req);
      const json = await res.json();

      expect(json.data.activities).toHaveLength(3);
      // Newest first: time3 -> time2 -> time1
      expect(new Date(json.data.activities[0].createdAt).getTime()).toBe(time3.getTime());
      expect(json.data.activities[0].action).toBe('ALLOCATION_COMPLETE');

      expect(new Date(json.data.activities[1].createdAt).getTime()).toBe(time2.getTime());
      expect(json.data.activities[1].action).toBe('ALLOCATION_REASSIGN');

      expect(new Date(json.data.activities[2].createdAt).getTime()).toBe(time1.getTime());
      expect(json.data.activities[2].action).toBe('ALLOCATION_CLAIM');
    });
  });

  describe('3. Database-Level Limiting', () => {
    it('returns only the requested N activities based on limit parameter', async () => {
      // Create 5 activities
      for (let i = 1; i <= 5; i++) {
        await AuditLog.create({
          user: taId1,
          action: 'ALLOCATION_CLAIM',
          outcome: 'SUCCESS',
          details: { examId: testExamId.toString(), question: i, taId: taId1.toString() },
          createdAt: new Date(`2026-09-02T10:0${i}:00.000Z`),
        });
      }

      const req = makeRequest('http://localhost:3000/api/professor/activity?limit=2');
      const res = await activityGET(req);
      const json = await res.json();

      expect(json.data.activities).toHaveLength(2);
      expect(json.data.total).toBe(5);
      // Check that the two returned are the newest (question 5 and 4)
      expect(json.data.activities[0].question).toBe(5);
      expect(json.data.activities[1].question).toBe(4);
    });

    it('rejects invalid limit parameter with 400 Bad Request', async () => {
      const req = makeRequest('http://localhost:3000/api/professor/activity?limit=invalid');
      const res = await activityGET(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('Invalid limit parameter');
    });
  });

  describe('4. Authorization Controls', () => {
    it('allows Admin users to retrieve the activity feed', async () => {
      mockSessionUser = {
        id: new mongoose.Types.ObjectId().toString(),
        role: UserRole.ADMIN,
        email: 'admin@iiit.ac.in',
        name: 'Admin User',
      };

      const req = makeRequest('http://localhost:3000/api/professor/activity');
      const res = await activityGET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
    });

    it('rejects unauthorized TA user with 403 Forbidden', async () => {
      mockSessionUser = {
        id: taId1.toString(),
        role: UserRole.TA,
        email: 'hermione@iiit.ac.in',
        name: 'Hermione Granger',
      };

      const req = makeRequest('http://localhost:3000/api/professor/activity');
      const res = await activityGET(req);
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe('Forbidden');
    });

    it('rejects unauthorized Student user with 403 Forbidden', async () => {
      mockSessionUser = {
        id: studentId.toString(),
        role: UserRole.STUDENT,
        email: 'harry@iiit.ac.in',
        name: 'Harry Potter',
      };

      const req = makeRequest('http://localhost:3000/api/professor/activity');
      const res = await activityGET(req);
      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated request with 401 Unauthorized', async () => {
      mockSessionUser = null;

      const req = makeRequest('http://localhost:3000/api/professor/activity');
      const res = await activityGET(req);
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toBe('Unauthorized');
    });
  });

  describe('5. Empty State & Data Sanitization', () => {
    it('returns empty activities array with total: 0 when no activities exist', async () => {
      const req = makeRequest('http://localhost:3000/api/professor/activity');
      const res = await activityGET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.activities).toEqual([]);
      expect(json.data.total).toBe(0);
    });

    it('does not expose non-grading actions or sensitive user password/token data', async () => {
      // Create non-grading action
      await AuditLog.create({
        user: professorId,
        action: 'USER_REGISTERED',
        outcome: 'SUCCESS',
        details: { token: 'secret-12345', password: 'hash' },
        createdAt: new Date(),
      });

      // Create failed action
      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        outcome: 'FAILURE',
        details: { error: 'Reassignment conflict' },
        createdAt: new Date(),
      });

      const req = makeRequest('http://localhost:3000/api/professor/activity');
      const res = await activityGET(req);
      const json = await res.json();

      expect(json.data.activities).toHaveLength(0);
    });
  });

  describe('6. Optional Exam Filtering', () => {
    it('filters activities by examId when specified', async () => {
      const otherExamId = new mongoose.Types.ObjectId();

      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        outcome: 'SUCCESS',
        details: { examId: testExamId.toString(), question: 1, newTaId: taId1.toString() },
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
      });

      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        outcome: 'SUCCESS',
        details: { examId: otherExamId.toString(), question: 2, newTaId: taId2.toString() },
        createdAt: new Date('2026-09-02T11:00:00.000Z'),
      });

      const req = makeRequest(`http://localhost:3000/api/professor/activity?examId=${testExamId.toString()}`);
      const res = await activityGET(req);
      const json = await res.json();

      expect(json.data.activities).toHaveLength(1);
      expect(json.data.activities[0].question).toBe(1);
    });

    it('returns 400 for invalid examId format', async () => {
      const req = makeRequest('http://localhost:3000/api/professor/activity?examId=invalid-id');
      const res = await activityGET(req);
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('Invalid Exam ID format');
    });
  });

  describe('7. UI Helper Unit Tests', () => {
    it('formats relative activity time accurately', () => {
      const now = new Date();
      expect(formatActivityTime(now)).toBe('Just now');

      const fiveMinsAgo = new Date(now.getTime() - 5 * 60 * 1000);
      expect(formatActivityTime(fiveMinsAgo)).toBe('5m ago');

      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      expect(formatActivityTime(twoHoursAgo)).toBe('2h ago');

      const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      expect(formatActivityTime(threeDaysAgo)).toBe('3d ago');

      expect(formatActivityTime('invalid-date')).toBe('');
    });

    it('returns correct action badges for different actions', () => {
      expect(getActionBadge('ALLOCATION_REASSIGN').label).toBe('Reassigned');
      expect(getActionBadge('ALLOCATION_CLAIM').label).toBe('Claimed');
      expect(getActionBadge('ALLOCATION_COMPLETE').label).toBe('Completed');
      expect(getActionBadge('ANSWERSCRIPT_IDENTIFIED').label).toBe('Identified');
      expect(getActionBadge('INGESTION_APPROVED').label).toBe('Approved');
      expect(getActionBadge('EXAM_BLIND_GRADING_TOGGLED').label).toBe('Blind Grading');
      expect(getActionBadge('UNKNOWN_ACTION').label).toBe('UNKNOWN ACTION');
    });
  });

  describe('8. Service Direct Invocation & Error Resilience', () => {
    it('gracefully handles missing user or deleted TA accounts without crashing', async () => {
      const ghostTaId = new mongoose.Types.ObjectId();

      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        outcome: 'SUCCESS',
        details: {
          examId: testExamId.toString(),
          question: 3,
          previousTaId: ghostTaId.toString(),
          newTaId: taId2.toString(),
        },
        createdAt: new Date(),
      });

      const result = await AllocationService.getActivityFeed();
      expect(result.activities).toHaveLength(1);
      expect(result.activities[0].details?.previousTa?.name).toBe('Unknown TA');
      expect(result.activities[0].details?.newTa?.name).toBe('Ron Weasley');
    });
  });

  describe('9. Mentor P2 Fix: Professor Scoping, Cross-Professor Isolation, & SCRIPT_REMAP/MERGE Audit Context', () => {
    let profBId: mongoose.Types.ObjectId;
    let courseBId: mongoose.Types.ObjectId;
    let examBId: mongoose.Types.ObjectId;
    let scriptBId: mongoose.Types.ObjectId;

    beforeEach(async () => {
      profBId = new mongoose.Types.ObjectId('000000000000000000000599');
      await new User({
        _id: profBId,
        name: 'Prof. Severus Snape',
        email: 'snape@iiit.ac.in',
        role: UserRole.PROFESSOR,
        password: 'password123',
        isActive: true,
      }).save();

      const courseB = await new Course({
        courseCode: 'CS301',
        courseName: 'Algorithms',
        semester: 2,
        academicYear: '2026-2027',
        professor: profBId,
        teachingAssistants: [taId1],
        enrolledStudents: [studentId],
        isActive: true,
      }).save();
      courseBId = courseB._id as mongoose.Types.ObjectId;

      const examB = await new Exam({
        title: 'Algorithms Final Exam',
        course: courseBId,
        createdBy: profBId,
        examDate: new Date('2026-09-20T09:00:00.000Z'),
        totalMarks: 100,
        numberOfQuestions: 5,
        status: 'PUBLISHED',
        ingestionApprovalStatus: 'APPROVED',
        isActive: true,
      }).save();
      examBId = examB._id as mongoose.Types.ObjectId;

      const scriptB = await new AnswerScript({
        exam: examBId,
        student: studentId,
        batchId: 'batch-b-1',
        fileIndex: 0,
        startPageNumber: 1,
        endPageNumber: 3,
        pageCount: 3,
        isActive: true,
      }).save();
      scriptBId = scriptB._id as mongoose.Types.ObjectId;
    });

    it('A. restricts Professor A activity feed strictly to Professor A exams and excludes Professor B exams (Cross-Professor Isolation)', async () => {
      // Event for Prof A exam
      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        outcome: 'SUCCESS',
        details: {
          examId: testExamId.toString(),
          answerScriptId: scriptId.toString(),
          question: 1,
          newTaId: taId1.toString(),
        },
        createdAt: new Date('2026-09-10T10:00:00.000Z'),
      });

      // Event for Prof B exam
      await AuditLog.create({
        user: profBId,
        action: 'ALLOCATION_CLAIM',
        outcome: 'SUCCESS',
        details: {
          examId: examBId.toString(),
          answerScriptId: scriptBId.toString(),
          question: 1,
          taId: taId1.toString(),
        },
        createdAt: new Date('2026-09-10T11:00:00.000Z'),
      });

      // 1. Professor A requests activity feed
      mockSessionUser = {
        id: professorId.toString(),
        role: UserRole.PROFESSOR,
        email: 'prof@iiit.ac.in',
        name: 'Prof. McGonagall',
      };

      const reqA = makeRequest('http://localhost:3000/api/professor/activity');
      const resA = await activityGET(reqA);
      expect(resA.status).toBe(200);
      const jsonA = await resA.json();
      expect(jsonA.data.total).toBe(1);
      expect(jsonA.data.activities).toHaveLength(1);
      expect(jsonA.data.activities[0].exam.id).toBe(testExamId.toString());
      expect(jsonA.data.activities[0].action).toBe('ALLOCATION_REASSIGN');

      // 2. Professor B requests activity feed
      mockSessionUser = {
        id: profBId.toString(),
        role: UserRole.PROFESSOR,
        email: 'snape@iiit.ac.in',
        name: 'Prof. Severus Snape',
      };

      const reqB = makeRequest('http://localhost:3000/api/professor/activity');
      const resB = await activityGET(reqB);
      expect(resB.status).toBe(200);
      const jsonB = await resB.json();
      expect(jsonB.data.total).toBe(1);
      expect(jsonB.data.activities).toHaveLength(1);
      expect(jsonB.data.activities[0].exam.id).toBe(examBId.toString());
      expect(jsonB.data.activities[0].action).toBe('ALLOCATION_CLAIM');
    });

    it('B. returns requested exam for owner, but returns empty result (no leak) when Professor A requests Professor B examId', async () => {
      await AuditLog.create({
        user: profBId,
        action: 'ALLOCATION_COMPLETE',
        outcome: 'SUCCESS',
        details: {
          examId: examBId.toString(),
          answerScriptId: scriptBId.toString(),
          question: 2,
        },
        createdAt: new Date('2026-09-10T12:00:00.000Z'),
      });

      // Professor A requests Professor B's examId
      mockSessionUser = {
        id: professorId.toString(),
        role: UserRole.PROFESSOR,
        email: 'prof@iiit.ac.in',
        name: 'Prof. McGonagall',
      };

      const req = makeRequest(`http://localhost:3000/api/professor/activity?examId=${examBId.toString()}`);
      const res = await activityGET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.total).toBe(0);
      expect(json.data.activities).toHaveLength(0);
    });

    it('C. returns SCRIPT_REMAP and SCRIPT_MERGE audit logs containing details.examId in the scoped feed', async () => {
      // SCRIPT_REMAP log
      const remapPageId = new mongoose.Types.ObjectId();
      await AuditLog.create({
        user: professorId,
        action: 'SCRIPT_REMAP',
        outcome: 'SUCCESS',
        entityId: remapPageId,
        entityType: 'IngestionPage',
        details: {
          batchId: 'batch-1',
          examId: testExamId.toString(),
          pageId: remapPageId.toString(),
          pageNumber: 2,
          previousScriptId: scriptId.toString(),
          newScriptId: scriptId.toString(),
        },
        createdAt: new Date('2026-09-10T14:00:00.000Z'),
      });

      // SCRIPT_MERGE log
      await AuditLog.create({
        user: professorId,
        action: 'SCRIPT_MERGE',
        outcome: 'SUCCESS',
        entityId: scriptId,
        entityType: 'AnswerScript',
        details: {
          batchId: 'batch-1',
          examId: testExamId.toString(),
          sourceScriptId: scriptId.toString(),
          targetScriptId: scriptId.toString(),
        },
        createdAt: new Date('2026-09-10T15:00:00.000Z'),
      });

      mockSessionUser = {
        id: professorId.toString(),
        role: UserRole.PROFESSOR,
        email: 'prof@iiit.ac.in',
        name: 'Prof. McGonagall',
      };

      const req = makeRequest('http://localhost:3000/api/professor/activity');
      const res = await activityGET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.total).toBe(2);
      expect(json.data.activities).toHaveLength(2);

      const actions = json.data.activities.map((a: any) => a.action);
      expect(actions).toContain('SCRIPT_MERGE');
      expect(actions).toContain('SCRIPT_REMAP');
      expect(json.data.activities[0].exam.id).toBe(testExamId.toString());
      expect(json.data.activities[1].exam.id).toBe(testExamId.toString());
    });

    it('D. returns empty activity feed for a professor who has created zero exams', async () => {
      const newProfId = new mongoose.Types.ObjectId();
      await new User({
        _id: newProfId,
        name: 'Prof. Filius Flitwick',
        email: 'flitwick@iiit.ac.in',
        role: UserRole.PROFESSOR,
        password: 'password123',
        isActive: true,
      }).save();

      mockSessionUser = {
        id: newProfId.toString(),
        role: UserRole.PROFESSOR,
        email: 'flitwick@iiit.ac.in',
        name: 'Prof. Filius Flitwick',
      };

      const req = makeRequest('http://localhost:3000/api/professor/activity');
      const res = await activityGET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.total).toBe(0);
      expect(json.data.activities).toHaveLength(0);
    });

    it('E. allows Admin to view activities across multiple professors and exams', async () => {
      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        outcome: 'SUCCESS',
        details: { examId: testExamId.toString(), question: 1 },
        createdAt: new Date('2026-09-10T10:00:00.000Z'),
      });

      await AuditLog.create({
        user: profBId,
        action: 'ALLOCATION_CLAIM',
        outcome: 'SUCCESS',
        details: { examId: examBId.toString(), question: 2 },
        createdAt: new Date('2026-09-10T11:00:00.000Z'),
      });

      const adminId = new mongoose.Types.ObjectId();
      mockSessionUser = {
        id: adminId.toString(),
        role: UserRole.ADMIN,
        email: 'admin@iiit.ac.in',
        name: 'Admin Dumbledore',
      };

      const req = makeRequest('http://localhost:3000/api/professor/activity');
      const res = await activityGET(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.total).toBe(2);
      expect(json.data.activities).toHaveLength(2);
    });
  });
});
