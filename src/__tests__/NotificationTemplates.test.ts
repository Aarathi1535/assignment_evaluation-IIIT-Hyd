/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AnswerScript from '../models/AnswerScript';
import Exam from '../models/Exam';
import Course from '../models/Course';
import User, { UserRole } from '../models/User';
import AuditLog from '../models/AuditLog';
import Grade from '../models/Grade';
import Notification, { NotificationType } from '../models/Notification';
import AllocationService from '../services/AllocationService';
import {
  renderAssignmentTemplate,
  renderReassignmentTemplate,
  renderPublishTemplate,
  renderNotificationTemplate
} from '../templates/notificationTemplates';

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

describe('AE-117: Notification Templates', () => {
  let reassignPUT: any;

  let testCourseId: mongoose.Types.ObjectId;
  let testExamId: mongoose.Types.ObjectId;
  let professorId: mongoose.Types.ObjectId;
  let taId1: mongoose.Types.ObjectId;
  let taId2: mongoose.Types.ObjectId;
  let studentId: mongoose.Types.ObjectId;
  let studentId2: mongoose.Types.ObjectId;
  let scriptId1: mongoose.Types.ObjectId;

  beforeAll(async () => {
    reassignPUT = (await import('../app/api/exams/[id]/allocate/reassign/route')).PUT;

    await Allocation.init();
    await AnswerScript.init();
    await AuditLog.init();
    await Course.init();
    await Exam.init();
    await User.init();
    await Grade.init();
    await Notification.init();

    professorId = new mongoose.Types.ObjectId('000000000000000000000600');
    taId1 = new mongoose.Types.ObjectId('000000000000000000000601');
    taId2 = new mongoose.Types.ObjectId('000000000000000000000602');
    studentId = new mongoose.Types.ObjectId('000000000000000000000603');
    studentId2 = new mongoose.Types.ObjectId('000000000000000000000604');
  });

  beforeEach(async () => {
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await Allocation.deleteMany({});
    await AnswerScript.deleteMany({});
    await User.deleteMany({});
    await AuditLog.deleteMany({});
    await Grade.deleteMany({});
    await Notification.deleteMany({});

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

    await new User({
      _id: studentId2,
      name: 'Neville Longbottom',
      email: 'neville@iiit.ac.in',
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
      enrolledStudents: [studentId, studentId2],
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

    const script1 = new AnswerScript({
      exam: testExamId,
      student: studentId,
      batchId: 'batch-1',
      fileIndex: 0,
      startPageNumber: 1,
      endPageNumber: 2,
      pageCount: 2,
      isActive: true,
    });
    const saved1 = await script1.save();
    scriptId1 = saved1._id as mongoose.Types.ObjectId;

    const script2 = new AnswerScript({
      exam: testExamId,
      student: studentId2,
      batchId: 'batch-1',
      fileIndex: 1,
      startPageNumber: 3,
      endPageNumber: 4,
      pageCount: 2,
      isActive: true,
    });
    await script2.save();
  });

  function makeRequest(url: string, method: string = 'GET', body?: any) {
    return new NextRequest(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  function makeContext(id: string) {
    return { params: Promise.resolve({ id }) };
  }

  describe('1. Assignment Template Unit Tests', () => {
    it('renders whole-script assignment template without question number', () => {
      const result = renderAssignmentTemplate({
        exam: testExamId,
        allocation: new mongoose.Types.ObjectId(),
        answerScript: scriptId1,
        question: null,
        recipient: taId1
      });

      expect(result.type).toBe(NotificationType.ASSIGNMENT);
      expect(result.title).toBe('New Script Assigned');
      expect(result.message).toBe('You have been assigned a new answer script for grading.');
      expect(result.message).not.toContain('undefined');
      expect(result.message).not.toContain('null');
    });

    it('renders question-specific assignment template with valid question number', () => {
      const result = renderAssignmentTemplate({
        exam: testExamId,
        allocation: new mongoose.Types.ObjectId(),
        answerScript: scriptId1,
        question: 2,
        recipient: taId1
      });

      expect(result.type).toBe(NotificationType.ASSIGNMENT);
      expect(result.title).toBe('New Script Assigned');
      expect(result.message).toBe('You have been assigned question 2 of an answer script for grading.');
      expect(result.message).not.toContain('undefined');
      expect(result.message).not.toContain('null');
    });
  });

  describe('2. Reassignment Template Unit Tests', () => {
    it('renders whole-script reassignment template without question number', () => {
      const result = renderReassignmentTemplate({
        exam: testExamId,
        allocation: new mongoose.Types.ObjectId(),
        answerScript: scriptId1,
        question: null,
        previousTaId: taId1,
        newTaId: taId2,
        recipient: taId2
      });

      expect(result.type).toBe(NotificationType.ASSIGNMENT);
      expect(result.title).toBe('Script Reassigned to You');
      expect(result.message).toBe('An answer script has been reassigned to you for grading.');
      expect(result.message).not.toContain('undefined');
      expect(result.message).not.toContain('null');
    });

    it('renders question-specific reassignment template with valid question number', () => {
      const result = renderReassignmentTemplate({
        exam: testExamId,
        allocation: new mongoose.Types.ObjectId(),
        answerScript: scriptId1,
        question: 3,
        previousTaId: taId1,
        newTaId: taId2,
        recipient: taId2
      });

      expect(result.type).toBe(NotificationType.ASSIGNMENT);
      expect(result.title).toBe('Script Reassigned to You');
      expect(result.message).toBe('Question 3 of an answer script has been reassigned to you for grading.');
      expect(result.message).not.toContain('undefined');
      expect(result.message).not.toContain('null');
    });
  });

  describe('3. Publish Template Unit Tests', () => {
    it('renders publish template with exam title', () => {
      const result = renderPublishTemplate({
        exam: testExamId,
        examTitle: 'Data Structures Midterm',
        recipient: studentId
      });

      expect(result.type).toBe(NotificationType.PUBLISH);
      expect(result.title).toBe('Grades Published');
      expect(result.message).toBe('Grades have been published for Data Structures Midterm.');
      expect(result.message).not.toContain('undefined');
      expect(result.message).not.toContain('null');
    });

    it('renders publish template fallback when exam title is missing or empty', () => {
      const result1 = renderPublishTemplate(null);
      expect(result1.type).toBe(NotificationType.PUBLISH);
      expect(result1.title).toBe('Grades Published');
      expect(result1.message).toBe('Grades have been published for your exam.');

      const result2 = renderPublishTemplate({ examTitle: '   ' });
      expect(result2.message).toBe('Grades have been published for your exam.');
      expect(result2.message).not.toContain('undefined');
      expect(result2.message).not.toContain('null');
    });
  });

  describe('4. Missing, Invalid, or Incomplete Data Handling', () => {
    it('safely handles null/undefined payloads across all templates without throwing', () => {
      expect(() => renderAssignmentTemplate(null)).not.toThrow();
      expect(() => renderReassignmentTemplate(null)).not.toThrow();
      expect(() => renderPublishTemplate(null)).not.toThrow();

      const assign = renderAssignmentTemplate(undefined);
      expect(assign.title).toBe('New Script Assigned');
      expect(assign.message).toBe('You have been assigned a new answer script for grading.');

      const reassign = renderReassignmentTemplate(undefined);
      expect(reassign.title).toBe('Script Reassigned to You');
      expect(reassign.message).toBe('An answer script has been reassigned to you for grading.');
    });

    it('safely ignores invalid question values (NaN, negative, zero) and falls back cleanly', () => {
      const invalidQuestions = [0, -1, NaN, 'abc' as any, -99];

      for (const q of invalidQuestions) {
        const resAssign = renderAssignmentTemplate({ question: q });
        expect(resAssign.message).toBe('You have been assigned a new answer script for grading.');

        const resReassign = renderReassignmentTemplate({ question: q });
        expect(resReassign.message).toBe('An answer script has been reassigned to you for grading.');
      }
    });

    it('unified renderNotificationTemplate dispatches correctly', () => {
      const res1 = renderNotificationTemplate(NotificationType.ASSIGNMENT, { question: 1 });
      expect(res1.title).toBe('New Script Assigned');
      expect(res1.message).toContain('question 1');

      const res2 = renderNotificationTemplate(NotificationType.REASSIGNMENT, { question: 4 });
      expect(res2.title).toBe('Script Reassigned to You');
      expect(res2.message).toContain('Question 4');

      const res3 = renderNotificationTemplate(NotificationType.PUBLISH, { examTitle: 'Final Exam' });
      expect(res3.title).toBe('Grades Published');
      expect(res3.message).toBe('Grades have been published for Final Exam.');

      const resUnknown = renderNotificationTemplate('UNKNOWN_TYPE' as any, null);
      expect(resUnknown.title).toBe('Notification');
      expect(resUnknown.message).toBe('You have received a new notification.');
    });
  });

  describe('5. Integration with AllocationService Assignment & Reassignment', () => {
    it('uses template in allocateEqual and persists matching notification in DB', async () => {
      await AllocationService.allocateEqual(
        testExamId.toString(),
        [taId1.toString(), taId2.toString()],
        professorId.toString()
      );

      const notifs = await Notification.find({ exam: testExamId });
      expect(notifs).toHaveLength(2);

      for (const n of notifs) {
        expect(n.type).toBe(NotificationType.ASSIGNMENT);
        expect(n.title).toBe('New Script Assigned');
        expect(n.message).toBe('You have been assigned a new answer script for grading.');
        expect(n.read).toBe(false);
      }
    });

    it('uses template in allocateByQuestion and persists question-specific messages', async () => {
      await AllocationService.allocateByQuestion(
        testExamId.toString(),
        [taId1.toString(), taId2.toString()],
        professorId.toString()
      );

      const notifs = await Notification.find({ exam: testExamId });
      expect(notifs.length).toBeGreaterThan(0);

      for (const n of notifs) {
        expect(n.type).toBe(NotificationType.ASSIGNMENT);
        expect(n.title).toBe('New Script Assigned');
        expect(n.message).toBe(`You have been assigned question ${n.question} of an answer script for grading.`);
      }
    });

    it('uses template in reassignAllocation and notifies receiving TA only', async () => {
      const alloc = await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        question: 2,
        allocatedBy: professorId,
        status: AllocationStatus.PENDING,
        rule: AllocationRule.EQUAL,
      });

      await Notification.deleteMany({});

      const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, 'PUT', {
        allocationId: alloc._id.toString(),
        targetTaId: taId2.toString(),
      });

      const res = await reassignPUT(req, makeContext(testExamId.toString()));
      expect(res.status).toBe(200);

      const notifs = await Notification.find({});
      expect(notifs).toHaveLength(1);

      const targetNotif = notifs[0];
      expect(targetNotif.recipient.toString()).toBe(taId2.toString());
      expect(targetNotif.title).toBe('Script Reassigned to You');
      expect(targetNotif.message).toBe('Question 2 of an answer script has been reassigned to you for grading.');
      expect(targetNotif.read).toBe(false);

      // Previous TA-1 received NO notification
      const ta1Notif = await Notification.findOne({ recipient: taId1 });
      expect(ta1Notif).toBeNull();
    });
  });
});
