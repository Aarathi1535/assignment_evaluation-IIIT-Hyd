/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import Allocation, { AllocationRule, AllocationStatus } from '../models/Allocation';
import AnswerScript from '../models/AnswerScript';
import Exam from '../models/Exam';
import Course from '../models/Course';
import User, { UserRole } from '../models/User';
import AuditLog from '../models/AuditLog';
import Grade from '../models/Grade';
import Notification, { NotificationType } from '../models/Notification';
import { AllocationService } from '../services/AllocationService';
import NotificationService from '../services/NotificationService';

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

describe('AE-111: TA Assignment Notifications', () => {
  let allocationsGET: any;
  let notificationsGET: any;
  let markReadPATCH: any;
  let markAllReadPATCH: any;
  let reassignPUT: any;

  let testCourseId: mongoose.Types.ObjectId;
  let testExamId: mongoose.Types.ObjectId;
  let professorId: mongoose.Types.ObjectId;
  let taId1: mongoose.Types.ObjectId;
  let taId2: mongoose.Types.ObjectId;
  let taId3: mongoose.Types.ObjectId;
  let studentId1: mongoose.Types.ObjectId;
  let studentId2: mongoose.Types.ObjectId;
  let scriptId1: mongoose.Types.ObjectId;
  let scriptId2: mongoose.Types.ObjectId;

  beforeAll(async () => {
    allocationsGET = (await import('../app/api/allocations/route')).GET;
    notificationsGET = (await import('../app/api/notifications/route')).GET;
    markReadPATCH = (await import('../app/api/notifications/[id]/read/route')).PATCH;
    markAllReadPATCH = (await import('../app/api/notifications/read-all/route')).PATCH;
    reassignPUT = (await import('../app/api/exams/[id]/allocate/reassign/route')).PUT;

    await Allocation.init();
    await AnswerScript.init();
    await AuditLog.init();
    await Course.init();
    await Exam.init();
    await User.init();
    await Grade.init();
    await Notification.init();

    professorId = new mongoose.Types.ObjectId('000000000000000000000300');
    taId1 = new mongoose.Types.ObjectId('000000000000000000000301');
    taId2 = new mongoose.Types.ObjectId('000000000000000000000302');
    taId3 = new mongoose.Types.ObjectId('000000000000000000000303');
    studentId1 = new mongoose.Types.ObjectId('000000000000000000000304');
    studentId2 = new mongoose.Types.ObjectId('000000000000000000000305');
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
    await new User({ _id: professorId, name: 'Prof. McGonagall', email: 'prof@iiit.ac.in', role: UserRole.PROFESSOR, password: 'password123', isActive: true }).save();
    await new User({ _id: taId1, name: 'Hermione Granger', email: 'hermione@iiit.ac.in', role: UserRole.TA, password: 'password123', isActive: true }).save();
    await new User({ _id: taId2, name: 'Ron Weasley', email: 'ron@iiit.ac.in', role: UserRole.TA, password: 'password123', isActive: true }).save();
    await new User({ _id: taId3, name: 'Draco Malfoy', email: 'draco@iiit.ac.in', role: UserRole.TA, password: 'password123', isActive: true }).save();
    await new User({ _id: studentId1, name: 'Harry Potter', email: 'harry@iiit.ac.in', role: UserRole.STUDENT, password: 'password123', isActive: true }).save();
    await new User({ _id: studentId2, name: 'Neville Longbottom', email: 'neville@iiit.ac.in', role: UserRole.STUDENT, password: 'password123', isActive: true }).save();

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
      enrolledStudents: [studentId1, studentId2],
      isActive: true,
    });
    const savedCourse = await course.save();
    testCourseId = savedCourse._id as mongoose.Types.ObjectId;

    const exam = new Exam({
      title: 'Midterm 2026',
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
      exam: testExamId,
      student: studentId2,
      batchId: 'batch-1',
      fileIndex: 1,
      startPageNumber: 3,
      endPageNumber: 4,
      pageCount: 2,
      isActive: true,
    });
    const savedScript2 = await script2.save();
    scriptId2 = savedScript2._id as mongoose.Types.ObjectId;
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

  describe('1. New Assignment Notification Creation & Transaction Behavior', () => {
    it('creates persistent in-app notifications for each assigned TA during allocateEqual', async () => {
      const allocations = await AllocationService.allocateEqual(
        testExamId.toString(),
        [taId1.toString(), taId2.toString()],
        professorId.toString()
      );

      expect(allocations).toHaveLength(2);

      // Verify notifications created in database
      const notifications = await Notification.find({ exam: testExamId }).sort({ createdAt: 1 });
      expect(notifications).toHaveLength(2);

      const ta1Notification = notifications.find((n) => n.recipient.toString() === taId1.toString());
      expect(ta1Notification).toBeDefined();
      expect(ta1Notification!.type).toBe(NotificationType.ASSIGNMENT);
      expect(ta1Notification!.title).toBe('New Script Assigned');
      expect(ta1Notification!.read).toBe(false);
      expect(ta1Notification!.allocation).toBeDefined();
      expect(ta1Notification!.exam!.toString()).toBe(testExamId.toString());

      const ta2Notification = notifications.find((n) => n.recipient.toString() === taId2.toString());
      expect(ta2Notification).toBeDefined();
      expect(ta2Notification!.read).toBe(false);

      // TA3 was not allocated anything
      const ta3Notification = notifications.find((n) => n.recipient.toString() === taId3.toString());
      expect(ta3Notification).toBeUndefined();
    });

    it('creates question-specific notification message during allocateByQuestion', async () => {
      const allocations = await AllocationService.allocateByQuestion(
        testExamId.toString(),
        [taId1.toString(), taId2.toString()],
        professorId.toString()
      );

      expect(allocations.length).toBeGreaterThan(0);

      const notifications = await Notification.find({ exam: testExamId });
      expect(notifications.length).toBe(allocations.length);

      for (const notif of notifications) {
        expect(notif.question).toBeDefined();
        expect(notif.message).toContain(`question ${notif.question}`);
      }
    });

    it('creates persistent in-app notifications during allocateRandom', async () => {
      const allocations = await AllocationService.allocateRandom(
        testExamId.toString(),
        [taId1.toString(), taId2.toString()],
        professorId.toString(),
        12345
      );

      expect(allocations).toHaveLength(2);
      const notifCount = await Notification.countDocuments({ exam: testExamId });
      expect(notifCount).toBe(2);
    });

    it('rolls back and creates NO notifications if allocation transaction fails', async () => {
      // Intentionally pass an invalid TA not on the course to trigger transaction failure
      const nonCourseTaId = new mongoose.Types.ObjectId().toString();

      await expect(
        AllocationService.allocateEqual(
          testExamId.toString(),
          [nonCourseTaId],
          professorId.toString()
        )
      ).rejects.toThrow('is not a teaching assistant for this course');

      // Assert 0 allocations and 0 notifications
      const allocCount = await Allocation.countDocuments({ exam: testExamId });
      const notifCount = await Notification.countDocuments({ exam: testExamId });
      expect(allocCount).toBe(0);
      expect(notifCount).toBe(0);
    });
  });

  describe('2. Reassignment Notification Behavior', () => {
    it('creates notification ONLY for the new TA (TA-B) and NOT for the previous TA (TA-A)', async () => {
      // Step 1: Create an allocation for TA-1
      const alloc = await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        allocatedBy: professorId,
        status: AllocationStatus.PENDING,
        rule: AllocationRule.EQUAL,
      });

      // Clear any setup notifications
      await Notification.deleteMany({});

      // Step 2: Reassign from TA-1 (TA-A) to TA-2 (TA-B) via endpoint
      const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, 'PUT', {
        allocationId: alloc._id.toString(),
        targetTaId: taId2.toString(),
      });

      const res = await reassignPUT(req, makeContext(testExamId.toString()));
      expect(res.status).toBe(200);

      // Step 3: Assert notifications
      const allNotifications = await Notification.find({});
      expect(allNotifications).toHaveLength(1);

      const targetNotif = allNotifications[0];
      expect(targetNotif.recipient.toString()).toBe(taId2.toString());
      expect(targetNotif.title).toBe('Script Reassigned to You');
      expect(targetNotif.allocation!.toString()).toBe(alloc._id.toString());
      expect(targetNotif.read).toBe(false);

      // Verify TA-1 received NO notification
      const ta1Notif = await Notification.findOne({ recipient: taId1 });
      expect(ta1Notif).toBeNull();

      // Verify professor received NO notification
      const profNotif = await Notification.findOne({ recipient: professorId });
      expect(profNotif).toBeNull();
    });

    it('creates NO notification if reassignment fails validation', async () => {
      // Create an IN_PROGRESS allocation
      const alloc = await Allocation.create({
        exam: testExamId,
        ta: taId1,
        answerScript: scriptId1,
        allocatedBy: professorId,
        status: AllocationStatus.IN_PROGRESS,
        rule: AllocationRule.EQUAL,
        claimedAt: new Date(),
      });

      await Notification.deleteMany({});

      const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, 'PUT', {
        allocationId: alloc._id.toString(),
        targetTaId: taId2.toString(),
      });

      const res = await reassignPUT(req, makeContext(testExamId.toString()));
      expect(res.status).toBe(400);

      // 0 notifications exist
      const notifCount = await Notification.countDocuments({});
      expect(notifCount).toBe(0);
    });
  });

  describe('3. TA-Scoped Queue Endpoint (GET /api/allocations)', () => {
    it('exposes unreadNotificationCount scoped to authenticated TA', async () => {
      // Create 2 unread notifications for TA-1 and 1 for TA-2
      await Notification.create([
        { recipient: taId1, title: 'Notif 1', message: 'Msg 1', type: NotificationType.ASSIGNMENT, read: false },
        { recipient: taId1, title: 'Notif 2', message: 'Msg 2', type: NotificationType.ASSIGNMENT, read: false },
        { recipient: taId2, title: 'Notif 3', message: 'Msg 3', type: NotificationType.ASSIGNMENT, read: false },
      ]);

      mockSessionUser = {
        id: taId1.toString(),
        role: UserRole.TA,
        email: 'hermione@iiit.ac.in',
        name: 'Hermione Granger',
      };

      const req = makeRequest('http://localhost:3000/api/allocations');
      const res = await allocationsGET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.unreadNotificationCount).toBe(2);
    });
  });

  describe('4. Notification API Endpoints & Mark As Read Flow', () => {
    let notif1Id: string;

    beforeEach(async () => {
      const n1 = await Notification.create({
        recipient: taId1,
        title: 'Script Assigned 1',
        message: 'Grading assigned',
        type: NotificationType.ASSIGNMENT,
        exam: testExamId,
        answerScript: scriptId1,
        read: false,
      });
      notif1Id = n1._id.toString();

      await Notification.create({
        recipient: taId1,
        title: 'Script Assigned 2',
        message: 'Grading assigned',
        type: NotificationType.ASSIGNMENT,
        exam: testExamId,
        answerScript: scriptId2,
        read: false,
      });

      // Create a notification for TA-2
      await Notification.create({
        recipient: taId2,
        title: 'TA2 Notif',
        message: 'Grading assigned',
        type: NotificationType.ASSIGNMENT,
        read: false,
      });
    });

    it('GET /api/notifications returns list and unread count scoped to authenticated user', async () => {
      mockSessionUser = {
        id: taId1.toString(),
        role: UserRole.TA,
        email: 'hermione@iiit.ac.in',
        name: 'Hermione Granger',
      };

      const req = makeRequest('http://localhost:3000/api/notifications');
      const res = await notificationsGET(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.notifications).toHaveLength(2);
      expect(json.data.unreadCount).toBe(2);
      expect(json.data.total).toBe(2);
    });

    it('PATCH /api/notifications/[id]/read marks single notification as read and decreases unread count', async () => {
      mockSessionUser = {
        id: taId1.toString(),
        role: UserRole.TA,
        email: 'hermione@iiit.ac.in',
        name: 'Hermione Granger',
      };

      const req = makeRequest(`http://localhost:3000/api/notifications/${notif1Id}/read`, 'PATCH');
      const res = await markReadPATCH(req, makeContext(notif1Id));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.read).toBe(true);
      expect(json.data.readAt).toBeDefined();

      // Verify unread count decreases to 1
      const unreadCount = await NotificationService.getUnreadCount(taId1.toString());
      expect(unreadCount).toBe(1);

      // Verify notification remains persisted in DB
      const dbNotif = await Notification.findById(notif1Id);
      expect(dbNotif).not.toBeNull();
      expect(dbNotif!.read).toBe(true);
    });

    it('repeated PATCH /api/notifications/[id]/read is safe and idempotent', async () => {
      mockSessionUser = {
        id: taId1.toString(),
        role: UserRole.TA,
        email: 'hermione@iiit.ac.in',
        name: 'Hermione Granger',
      };

      // Call mark as read once
      const req1 = makeRequest(`http://localhost:3000/api/notifications/${notif1Id}/read`, 'PATCH');
      const res1 = await markReadPATCH(req1, makeContext(notif1Id));
      expect(res1.status).toBe(200);

      // Call mark as read a second time
      const req2 = makeRequest(`http://localhost:3000/api/notifications/${notif1Id}/read`, 'PATCH');
      const res2 = await markReadPATCH(req2, makeContext(notif1Id));
      expect(res2.status).toBe(200);

      const unreadCount = await NotificationService.getUnreadCount(taId1.toString());
      expect(unreadCount).toBe(1);
    });

    it('PATCH /api/notifications/[id]/read rejects with 403 when trying to mark another user\'s notification', async () => {
      mockSessionUser = {
        id: taId2.toString(),
        role: UserRole.TA,
        email: 'ron@iiit.ac.in',
        name: 'Ron Weasley',
      };

      // TA-2 attempts to mark TA-1's notification as read
      const req = makeRequest(`http://localhost:3000/api/notifications/${notif1Id}/read`, 'PATCH');
      const res = await markReadPATCH(req, makeContext(notif1Id));
      expect(res.status).toBe(403);

      const json = await res.json();
      expect(json.message).toContain('Cannot mark another user\'s notification as read');
    });

    it('PATCH /api/notifications/read-all marks all notifications for authenticated user as read', async () => {
      mockSessionUser = {
        id: taId1.toString(),
        role: UserRole.TA,
        email: 'hermione@iiit.ac.in',
        name: 'Hermione Granger',
      };

      const req = makeRequest('http://localhost:3000/api/notifications/read-all', 'PATCH');
      const res = await markAllReadPATCH(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.modifiedCount).toBe(2);

      const unreadCount = await NotificationService.getUnreadCount(taId1.toString());
      expect(unreadCount).toBe(0);

      // TA-2's notification is unaffected
      const ta2Unread = await NotificationService.getUnreadCount(taId2.toString());
      expect(ta2Unread).toBe(1);
    });
  });
});
