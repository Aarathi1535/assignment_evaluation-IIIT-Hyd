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

describe('AE-113: Reassignment History API & Service', () => {
  let historyGET: any;

  let testCourseId: mongoose.Types.ObjectId;
  let examAId: mongoose.Types.ObjectId;
  let examBId: mongoose.Types.ObjectId;
  let professorId: mongoose.Types.ObjectId;
  let taId1: mongoose.Types.ObjectId;
  let taId2: mongoose.Types.ObjectId;
  let taId3: mongoose.Types.ObjectId;
  let studentId1: mongoose.Types.ObjectId;
  let scriptId1: mongoose.Types.ObjectId;
  let scriptId2: mongoose.Types.ObjectId;

  beforeAll(async () => {
    historyGET = (await import('../app/api/exams/[id]/allocate/reassign/history/route')).GET;

    await Allocation.init();
    await AnswerScript.init();
    await AuditLog.init();
    await Course.init();
    await Exam.init();
    await User.init();
    await Grade.init();

    professorId = new mongoose.Types.ObjectId('000000000000000000000400');
    taId1 = new mongoose.Types.ObjectId('000000000000000000000401');
    taId2 = new mongoose.Types.ObjectId('000000000000000000000402');
    taId3 = new mongoose.Types.ObjectId('000000000000000000000403');
    studentId1 = new mongoose.Types.ObjectId('000000000000000000000404');
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
    await new User({ _id: professorId, name: 'Prof. McGonagall', email: 'prof@iiit.ac.in', role: UserRole.PROFESSOR, password: 'password123', isActive: true }).save();
    await new User({ _id: taId1, name: 'Hermione Granger', email: 'hermione@iiit.ac.in', role: UserRole.TA, password: 'password123', isActive: true }).save();
    await new User({ _id: taId2, name: 'Ron Weasley', email: 'ron@iiit.ac.in', role: UserRole.TA, password: 'password123', isActive: true }).save();
    await new User({ _id: taId3, name: 'Draco Malfoy', email: 'draco@iiit.ac.in', role: UserRole.TA, password: 'password123', isActive: true }).save();
    await new User({ _id: studentId1, name: 'Harry Potter', email: 'harry@iiit.ac.in', role: UserRole.STUDENT, password: 'password123', isActive: true }).save();

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
      teachingAssistants: [taId1, taId2, taId3],
      enrolledStudents: [studentId1],
      isActive: true,
    });
    const savedCourse = await course.save();
    testCourseId = savedCourse._id as mongoose.Types.ObjectId;

    // Exam A
    const examA = new Exam({
      title: 'Exam A - Midterm',
      course: testCourseId,
      createdBy: professorId,
      examDate: new Date('2026-09-15T09:00:00.000Z'),
      totalMarks: 50,
      numberOfQuestions: 4,
      status: 'PUBLISHED',
      ingestionApprovalStatus: 'APPROVED',
      isActive: true,
    });
    const savedExamA = await examA.save();
    examAId = savedExamA._id as mongoose.Types.ObjectId;

    // Exam B
    const examB = new Exam({
      title: 'Exam B - Final',
      course: testCourseId,
      createdBy: professorId,
      examDate: new Date('2026-11-20T09:00:00.000Z'),
      totalMarks: 100,
      numberOfQuestions: 6,
      status: 'PUBLISHED',
      ingestionApprovalStatus: 'APPROVED',
      isActive: true,
    });
    const savedExamB = await examB.save();
    examBId = savedExamB._id as mongoose.Types.ObjectId;

    const script1 = new AnswerScript({
      exam: examAId,
      student: studentId1,
      batchId: 'batch-1',
      fileIndex: 0,
      startPageNumber: 1,
      endPageNumber: 2,
      pageCount: 2,
      isActive: true,
    });
    const savedScript1 = await script1.save();
    scriptId1 = savedScript1._id as mongoose.Types.ObjectId;

    const script2 = new AnswerScript({
      exam: examBId,
      student: studentId1,
      batchId: 'batch-2',
      fileIndex: 0,
      startPageNumber: 1,
      endPageNumber: 2,
      pageCount: 2,
      isActive: true,
    });
    const savedScript2 = await script2.save();
    scriptId2 = savedScript2._id as mongoose.Types.ObjectId;
  });

  function makeRequest(url: string) {
    return new NextRequest(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
  }

  function makeContext(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  describe('1. Successful Retrieval & Data Formatting', () => {
    it('retrieves reassignment history for an exam with resolved TAs, script info, and acting user', async () => {
      const allocId = new mongoose.Types.ObjectId();

      // Create AuditLog entry simulating a reassignment
      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        outcome: 'SUCCESS',
        entityId: allocId,
        entityType: 'Allocation',
        details: {
          examId: examAId.toString(),
          answerScriptId: scriptId1.toString(),
          question: 2,
          previousTaId: taId1.toString(),
          newTaId: taId2.toString(),
        },
        createdAt: new Date('2026-09-02T10:00:00.000Z'),
      });

      const req = makeRequest(`http://localhost:3000/api/exams/${examAId}/allocate/reassign/history`);
      const res = await historyGET(req, makeContext(examAId.toString()));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.examId).toBe(examAId.toString());
      expect(json.data.history).toHaveLength(1);

      const item = json.data.history[0];
      expect(item.action).toBe('ALLOCATION_REASSIGN');
      expect(item.allocationId).toBe(allocId.toString());
      expect(item.question).toBe(2);
      expect(item.timestamp).toBeDefined();

      // Resolved previous TA
      expect(item.previousTa.id).toBe(taId1.toString());
      expect(item.previousTa.name).toBe('Hermione Granger');
      expect(item.previousTa.email).toBe('hermione@iiit.ac.in');

      // Resolved new TA
      expect(item.newTa.id).toBe(taId2.toString());
      expect(item.newTa.name).toBe('Ron Weasley');
      expect(item.newTa.email).toBe('ron@iiit.ac.in');

      // Resolved acting user
      expect(item.actingUser.id).toBe(professorId.toString());
      expect(item.actingUser.name).toBe('Prof. McGonagall');
      expect(item.actingUser.email).toBe('prof@iiit.ac.in');

      // Resolved answer script
      expect(item.answerScript).toBeDefined();
      expect(item.answerScript._id).toBe(scriptId1.toString());
    });
  });

  describe('2. Action and Exam Filtering', () => {
    it('filters out non-reassignment actions and logs from other exams', async () => {
      const alloc1 = new mongoose.Types.ObjectId();
      const alloc2 = new mongoose.Types.ObjectId();

      // Reassignment on Exam A
      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        outcome: 'SUCCESS',
        entityId: alloc1,
        entityType: 'Allocation',
        details: {
          examId: examAId.toString(),
          answerScriptId: scriptId1.toString(),
          question: 1,
          previousTaId: taId1.toString(),
          newTaId: taId2.toString(),
        },
        createdAt: new Date('2026-09-02T09:00:00.000Z'),
      });

      // Unrelated action on Exam A (e.g., ALLOCATE_EQUAL)
      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATE_EQUAL',
        outcome: 'SUCCESS',
        details: {
          examId: examAId.toString(),
        },
        createdAt: new Date('2026-09-02T08:00:00.000Z'),
      });

      // Reassignment on Exam B
      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        outcome: 'SUCCESS',
        entityId: alloc2,
        entityType: 'Allocation',
        details: {
          examId: examBId.toString(),
          answerScriptId: scriptId2.toString(),
          previousTaId: taId2.toString(),
          newTaId: taId3.toString(),
        },
        createdAt: new Date('2026-09-02T11:00:00.000Z'),
      });

      // Query Exam A history
      const reqA = makeRequest(`http://localhost:3000/api/exams/${examAId}/allocate/reassign/history`);
      const resA = await historyGET(reqA, makeContext(examAId.toString()));
      expect(resA.status).toBe(200);
      const jsonA = await resA.json();

      expect(jsonA.data.history).toHaveLength(1);
      expect(jsonA.data.history[0].allocationId).toBe(alloc1.toString());
      expect(jsonA.data.history[0].newTa.id).toBe(taId2.toString());

      // Query Exam B history
      const reqB = makeRequest(`http://localhost:3000/api/exams/${examBId}/allocate/reassign/history`);
      const resB = await historyGET(reqB, makeContext(examBId.toString()));
      expect(resB.status).toBe(200);
      const jsonB = await resB.json();

      expect(jsonB.data.history).toHaveLength(1);
      expect(jsonB.data.history[0].allocationId).toBe(alloc2.toString());
      expect(jsonB.data.history[0].newTa.id).toBe(taId3.toString());
    });
  });

  describe('3. Chronological Ordering (Oldest to Newest)', () => {
    it('returns reassignment entries in chronological order using audit event timestamps', async () => {
      const time1 = new Date('2026-09-02T09:00:00.000Z');
      const time2 = new Date('2026-09-02T11:00:00.000Z');
      const time3 = new Date('2026-09-02T13:00:00.000Z');

      // Insert in random order: time3, time1, time2
      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        entityId: new mongoose.Types.ObjectId(),
        details: { examId: examAId.toString(), previousTaId: taId2.toString(), newTaId: taId3.toString() },
        createdAt: time3,
      });

      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        entityId: new mongoose.Types.ObjectId(),
        details: { examId: examAId.toString(), previousTaId: taId1.toString(), newTaId: taId2.toString() },
        createdAt: time1,
      });

      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        entityId: new mongoose.Types.ObjectId(),
        details: { examId: examAId.toString(), previousTaId: taId2.toString(), newTaId: taId1.toString() },
        createdAt: time2,
      });

      const req = makeRequest(`http://localhost:3000/api/exams/${examAId}/allocate/reassign/history`);
      const res = await historyGET(req, makeContext(examAId.toString()));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.history).toHaveLength(3);

      // Verify oldest first: time1 -> time2 -> time3
      expect(new Date(json.data.history[0].timestamp).getTime()).toBe(time1.getTime());
      expect(new Date(json.data.history[1].timestamp).getTime()).toBe(time2.getTime());
      expect(new Date(json.data.history[2].timestamp).getTime()).toBe(time3.getTime());
      expect(json.data.history[0].newTa.id).toBe(taId2.toString());
      expect(json.data.history[1].newTa.id).toBe(taId1.toString());
      expect(json.data.history[2].newTa.id).toBe(taId3.toString());
    });
  });

  describe('4. Graceful Fallbacks & Edge Cases', () => {
    it('returns empty array when exam has no reassignment events', async () => {
      const req = makeRequest(`http://localhost:3000/api/exams/${examAId}/allocate/reassign/history`);
      const res = await historyGET(req, makeContext(examAId.toString()));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.history).toEqual([]);
    });

    it('gracefully handles missing or deleted TA user without dropping the record', async () => {
      const deletedTaId = new mongoose.Types.ObjectId().toString();

      await AuditLog.create({
        user: professorId,
        action: 'ALLOCATION_REASSIGN',
        entityId: new mongoose.Types.ObjectId(),
        details: {
          examId: examAId.toString(),
          previousTaId: deletedTaId,
          newTaId: taId2.toString(),
        },
        createdAt: new Date(),
      });

      const req = makeRequest(`http://localhost:3000/api/exams/${examAId}/allocate/reassign/history`);
      const res = await historyGET(req, makeContext(examAId.toString()));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.data.history).toHaveLength(1);
      expect(json.data.history[0].previousTa.id).toBe(deletedTaId);
      expect(json.data.history[0].previousTa.name).toBe('Unknown TA');
    });

    it('returns 400 for invalid exam ID format', async () => {
      const req = makeRequest('http://localhost:3000/api/exams/invalid-id/allocate/reassign/history');
      const res = await historyGET(req, makeContext('invalid-id'));
      expect(res.status).toBe(400);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('Invalid Exam ID format');
    });

    it('returns 404 for non-existent exam ID', async () => {
      const nonExistentId = new mongoose.Types.ObjectId().toString();
      const req = makeRequest(`http://localhost:3000/api/exams/${nonExistentId}/allocate/reassign/history`);
      const res = await historyGET(req, makeContext(nonExistentId));
      expect(res.status).toBe(404);

      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('Exam not found');
    });
  });

  describe('5. Authorization & Read-Only Safety', () => {
    it('rejects unauthorized TA requests with 403 Forbidden', async () => {
      mockSessionUser = {
        id: taId1.toString(),
        role: UserRole.TA,
        email: 'hermione@iiit.ac.in',
        name: 'Hermione Granger',
      };

      const req = makeRequest(`http://localhost:3000/api/exams/${examAId}/allocate/reassign/history`);
      const res = await historyGET(req, makeContext(examAId.toString()));
      expect(res.status).toBe(403);
    });

    it('rejects unauthenticated requests with 401 Unauthorized', async () => {
      mockSessionUser = null;

      const req = makeRequest(`http://localhost:3000/api/exams/${examAId}/allocate/reassign/history`);
      const res = await historyGET(req, makeContext(examAId.toString()));
      expect(res.status).toBe(401);
    });

    it('retrieving history is strictly read-only and creates no allocations or audit logs', async () => {
      // Ensure baseline counts
      const allocCountBefore = await Allocation.countDocuments({});
      const auditCountBefore = await AuditLog.countDocuments({});

      const req = makeRequest(`http://localhost:3000/api/exams/${examAId}/allocate/reassign/history`);
      const res = await historyGET(req, makeContext(examAId.toString()));
      expect(res.status).toBe(200);

      // Verify no changes to DB
      expect(await Allocation.countDocuments({})).toBe(allocCountBefore);
      expect(await AuditLog.countDocuments({})).toBe(auditCountBefore);
    });
  });
});
