/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../lib/db';
import {
  UserRole,
  Permission,
  RolePermissions,
  hasPermission,
  SYSTEM_PRINCIPAL_ID,
  SYSTEM_ROLE,
  SYSTEM_AUDIT_CONTEXT,
} from '../constants/permissions';
import {
  requireAuth,
  requirePermission,
  requireAnyPermission,
  requireGradingOrAnnotationAccess,
  GRADING_OR_CANVAS_PERMISSIONS,
  canManageExam,
} from '../lib/apiAuth';
import User from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus, IngestionApprovalStatus } from '../models/Exam';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Rubric from '../models/Rubric';
import Batch, { BatchStatus } from '../models/Batch';

let mockSessionUser: {
  id: string;
  email: string;
  name: string;
  role: UserRole;
} | null = null;

// Mock next-auth getServerSession to dynamically drive session states
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

// Mock audit log writer to inspect AUTHORIZATION_FAILURE logging without throwing
const auditCalls: any[] = [];
vi.mock('../lib/audit', () => ({
  writeAuditLog: vi.fn().mockImplementation(async (entry: any) => {
    auditCalls.push(entry);
    return Promise.resolve({ success: true, id: 'mock-audit-id' });
  }),
}));

describe('AE-226: RBAC Audit and Authorization Enforcement', () => {
  let adminUser: any;
  let prof1User: any;
  let prof2User: any;
  let ta1User: any;
  let ta2User: any;
  let student1User: any;
  let student2User: any;

  let course1: any;
  let course2: any;
  let exam1: any;
  let exam2: any;
  let rubric1: any;
  let script1: any;
  let allocation1: any;
  let batch1: any;

  // Real route handlers
  let healthGET: any;
  let usersGET: any;
  let usersPOST: any;
  let usersImportPOST: any;
  let coursesGET: any;
  let coursesPOST: any;
  let courseIdGET: any;
  let courseIdPUT: any;
  let examsGET: any;
  let examsPOST: any;
  let examIdGET: any;
  let examIdPUT: any;
  let examPublishPOST: any;
  let examUnpublishPOST: any;
  let examRegradeWindowPUT: any;
  let allocationsGET: any;
  let allocationClaimPOST: any;
  let studentResultsGET: any;
  let studentRegradesPOST: any;
  let profRegradesGET: any;
  let profFlagsGET: any;
  let auditLogsGET: any;
  let auditVerifyPOST: any;
  let notificationsGET: any;

  beforeAll(async () => {
    process.env.STUDENT_RESULTS_ENABLED = 'true';
    await connectDB();

    healthGET = (await import('../app/api/health/route')).GET;
    usersGET = (await import('../app/api/users/route')).GET;
    usersPOST = (await import('../app/api/users/route')).POST;
    usersImportPOST = (await import('../app/api/users/import/route')).POST;
    coursesGET = (await import('../app/api/courses/route')).GET;
    coursesPOST = (await import('../app/api/courses/route')).POST;
    courseIdGET = (await import('../app/api/courses/[id]/route')).GET;
    courseIdPUT = (await import('../app/api/courses/[id]/route')).PUT;
    examsGET = (await import('../app/api/exams/route')).GET;
    examsPOST = (await import('../app/api/exams/route')).POST;
    examIdGET = (await import('../app/api/exams/[id]/route')).GET;
    examIdPUT = (await import('../app/api/exams/[id]/route')).PUT;
    examPublishPOST = (await import('../app/api/exams/[id]/publish/route')).POST;
    examUnpublishPOST = (await import('../app/api/exams/[id]/unpublish/route')).POST;
    examRegradeWindowPUT = (await import('../app/api/exams/[id]/regrade-window/route')).PUT;
    allocationsGET = (await import('../app/api/allocations/route')).GET;
    allocationClaimPOST = (await import('../app/api/allocations/[id]/claim/route')).POST;
    studentResultsGET = (await import('../app/api/student/results/route')).GET;
    studentRegradesPOST = (await import('../app/api/student/regrade-requests/route')).POST;
    profRegradesGET = (await import('../app/api/professor/regrade-requests/route')).GET;
    profFlagsGET = (await import('../app/api/professor/flags/route')).GET;
    auditLogsGET = (await import('../app/api/audit-logs/route')).GET;
    auditVerifyPOST = (await import('../app/api/audit-logs/verify/route')).POST;
    notificationsGET = (await import('../app/api/notifications/route')).GET;
  });

  beforeEach(async () => {
    mockSessionUser = null;
    auditCalls.length = 0;

    await Promise.all([
      Allocation.deleteMany({}),
      AnswerScript.deleteMany({}),
      Batch.deleteMany({}),
      Rubric.deleteMany({}),
      Exam.deleteMany({}),
      Course.deleteMany({}),
      User.deleteMany({}),
    ]);

    // Seed test users
    adminUser = await User.create({
      name: 'Admin User',
      email: 'admin.rbac@test.edu',
      password: 'Password123!',
      role: UserRole.ADMIN,
      isActive: true,
    });

    prof1User = await User.create({
      name: 'Prof. Alice Raman',
      email: 'alice.prof@test.edu',
      password: 'Password123!',
      role: UserRole.PROFESSOR,
      isActive: true,
    });

    prof2User = await User.create({
      name: 'Prof. Bob Foreign',
      email: 'bob.prof@test.edu',
      password: 'Password123!',
      role: UserRole.PROFESSOR,
      isActive: true,
    });

    ta1User = await User.create({
      name: 'TA Charlie',
      email: 'charlie.ta@test.edu',
      password: 'Password123!',
      role: UserRole.TA,
      isActive: true,
    });

    ta2User = await User.create({
      name: 'TA David Foreign',
      email: 'david.ta@test.edu',
      password: 'Password123!',
      role: UserRole.TA,
      isActive: true,
    });

    student1User = await User.create({
      name: 'Student Eve',
      email: 'eve.student@test.edu',
      password: 'Password123!',
      role: UserRole.STUDENT,
      isActive: true,
    });

    student2User = await User.create({
      name: 'Student Frank Foreign',
      email: 'frank.student@test.edu',
      password: 'Password123!',
      role: UserRole.STUDENT,
      isActive: true,
    });

    // Seed Course 1 owned by prof1, with ta1 and student1
    course1 = await Course.create({
      courseCode: 'CS101-RBAC',
      courseName: 'Intro to RBAC',
      professor: prof1User._id,
      teachingAssistants: [ta1User._id],
      enrolledStudents: [student1User._id],
      semester: 1,
      academicYear: '2026-2027',
      isActive: true,
    });

    // Seed Course 2 owned by prof2
    course2 = await Course.create({
      courseCode: 'CS202-RBAC',
      courseName: 'Advanced Security',
      professor: prof2User._id,
      teachingAssistants: [ta2User._id],
      enrolledStudents: [student2User._id],
      semester: 1,
      academicYear: '2026-2027',
      isActive: true,
    });

    // Seed Exam 1 in course 1
    exam1 = await Exam.create({
      title: 'CS101 Midterm',
      course: course1._id,
      createdBy: prof1User._id,
      examDate: new Date(),
      numberOfQuestions: 2,
      totalMarks: 20,
      status: ExamStatus.EVALUATING,
      ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
      isActive: true,
    });

    // Seed Exam 2 in course 2
    exam2 = await Exam.create({
      title: 'CS202 Midterm',
      course: course2._id,
      createdBy: prof2User._id,
      examDate: new Date(),
      numberOfQuestions: 2,
      totalMarks: 20,
      status: ExamStatus.EVALUATING,
      ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
      isActive: true,
    });

    rubric1 = await Rubric.create({
      exam: exam1._id,
      createdBy: prof1User._id,
      scoreStep: 1,
      questions: [
        {
          questionNumber: 1,
          maxMarks: 10,
          description: 'Q1',
          criteria: [{ criterionName: 'Correctness', points: 10 }],
        },
      ],
      isActive: true,
    });

    script1 = await AnswerScript.create({
      exam: exam1._id,
      student: student1User._id,
      identificationStatus: IdentificationStatus.IDENTIFIED,
      batchId: 'BATCH-001',
      fileIndex: 0,
      startPageNumber: 1,
      endPageNumber: 2,
      filename: 'script1.pdf',
      pageCount: 2,
      isActive: true,
    });

    allocation1 = await Allocation.create({
      exam: exam1._id,
      answerScript: script1._id,
      ta: ta1User._id,
      allocatedBy: prof1User._id,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.EQUAL,
    });

    batch1 = await Batch.create({
      batchId: 'BATCH-001',
      uploadedBy: prof1User._id,
      exam: exam1._id,
      totalFiles: 1,
      totalSize: 1024,
      totalPageCount: 2,
      status: BatchStatus.DONE,
      isActive: true,
    });
  });

  describe('1. Canonical Role-Permission Matrix Invariants', () => {
    it('verifies ADMIN role possesses all system permissions', () => {
      const allPermissions = Object.values(Permission);
      expect(RolePermissions[UserRole.ADMIN]).toHaveLength(allPermissions.length);
      for (const perm of allPermissions) {
        expect(hasPermission(UserRole.ADMIN, perm)).toBe(true);
      }
    });

    it('verifies PROFESSOR role matches permissions.ts:47-65 exactly', () => {
      const expectedProfPermissions = [
        Permission.CREATE_COURSE,
        Permission.EDIT_COURSE,
        Permission.DELETE_COURSE,
        Permission.ASSIGN_TAS,
        Permission.CREATE_EXAM,
        Permission.EDIT_EXAM,
        Permission.DELETE_EXAM,
        Permission.CREATE_RUBRIC,
        Permission.EDIT_RUBRIC,
        Permission.VIEW_ALL_SUBMISSIONS,
        Permission.ALLOCATE_SCRIPTS,
        Permission.SAVE_MARKS_FEEDBACK,
        Permission.PUBLISH_GRADES,
        Permission.VIEW_COURSES,
        Permission.CREATE_BATCH,
        Permission.VIEW_BATCH,
        Permission.APPROVE_INGESTION,
      ];

      expect(RolePermissions[UserRole.PROFESSOR]).toEqual(expectedProfPermissions);
      expect(RolePermissions[UserRole.PROFESSOR]).toHaveLength(17);

      for (const perm of expectedProfPermissions) {
        expect(hasPermission(UserRole.PROFESSOR, perm)).toBe(true);
      }

      // Least privilege boundaries:
      expect(hasPermission(UserRole.PROFESSOR, Permission.MANAGE_USERS)).toBe(false);
      expect(hasPermission(UserRole.PROFESSOR, Permission.VIEW_OWN_RESULTS)).toBe(false);
      expect(hasPermission(UserRole.PROFESSOR, Permission.REQUEST_REGRADE)).toBe(false);
    });

    it('verifies TA role matches permissions.ts:66-72 exactly', () => {
      const expectedTaPermissions = [
        Permission.VIEW_COURSES,
        Permission.VIEW_ASSIGNED_SCRIPTS,
        Permission.GRADE_SCRIPT,
        Permission.FLAG_FOR_REVIEW,
        Permission.SAVE_MARKS_FEEDBACK,
      ];

      expect(RolePermissions[UserRole.TA]).toEqual(expectedTaPermissions);
      expect(RolePermissions[UserRole.TA]).toHaveLength(5);

      for (const perm of expectedTaPermissions) {
        expect(hasPermission(UserRole.TA, perm)).toBe(true);
      }

      // Prohibited capabilities:
      expect(hasPermission(UserRole.TA, Permission.MANAGE_USERS)).toBe(false);
      expect(hasPermission(UserRole.TA, Permission.CREATE_COURSE)).toBe(false);
      expect(hasPermission(UserRole.TA, Permission.EDIT_COURSE)).toBe(false);
      expect(hasPermission(UserRole.TA, Permission.DELETE_COURSE)).toBe(false);
      expect(hasPermission(UserRole.TA, Permission.ASSIGN_TAS)).toBe(false);
      expect(hasPermission(UserRole.TA, Permission.CREATE_EXAM)).toBe(false);
      expect(hasPermission(UserRole.TA, Permission.DELETE_EXAM)).toBe(false);
      expect(hasPermission(UserRole.TA, Permission.PUBLISH_GRADES)).toBe(false);
      expect(hasPermission(UserRole.TA, Permission.APPROVE_INGESTION)).toBe(false);
      expect(hasPermission(UserRole.TA, Permission.VIEW_ALL_SUBMISSIONS)).toBe(false);
    });

    it('verifies STUDENT role matches permissions.ts:73-77 exactly', () => {
      const expectedStudentPermissions = [
        Permission.VIEW_COURSES,
        Permission.VIEW_OWN_RESULTS,
        Permission.REQUEST_REGRADE,
      ];

      expect(RolePermissions[UserRole.STUDENT]).toEqual(expectedStudentPermissions);
      expect(RolePermissions[UserRole.STUDENT]).toHaveLength(3);

      for (const perm of expectedStudentPermissions) {
        expect(hasPermission(UserRole.STUDENT, perm)).toBe(true);
      }

      // Prohibited capabilities:
      expect(hasPermission(UserRole.STUDENT, Permission.MANAGE_USERS)).toBe(false);
      expect(hasPermission(UserRole.STUDENT, Permission.CREATE_COURSE)).toBe(false);
      expect(hasPermission(UserRole.STUDENT, Permission.CREATE_EXAM)).toBe(false);
      expect(hasPermission(UserRole.STUDENT, Permission.GRADE_SCRIPT)).toBe(false);
      expect(hasPermission(UserRole.STUDENT, Permission.VIEW_ALL_SUBMISSIONS)).toBe(false);
      expect(hasPermission(UserRole.STUDENT, Permission.VIEW_ASSIGNED_SCRIPTS)).toBe(false);
      expect(hasPermission(UserRole.STUDENT, Permission.ALLOCATE_SCRIPTS)).toBe(false);
      expect(hasPermission(UserRole.STUDENT, Permission.PUBLISH_GRADES)).toBe(false);
      expect(hasPermission(UserRole.STUDENT, Permission.APPROVE_INGESTION)).toBe(false);
    });

    it('denies permissions for undefined or unknown roles', () => {
      expect(hasPermission('UNKNOWN_ROLE' as any, Permission.VIEW_COURSES)).toBe(false);
      expect(hasPermission('' as any, Permission.VIEW_COURSES)).toBe(false);
    });

    it('verifies SYSTEM worker principal constants', () => {
      expect(SYSTEM_PRINCIPAL_ID).toBe('SYSTEM_WORKER_PRINCIPAL');
      expect(SYSTEM_ROLE).toBe('SYSTEM');
      expect(SYSTEM_AUDIT_CONTEXT).toEqual({
        actingUserId: 'SYSTEM_WORKER_PRINCIPAL',
        actingUserRole: 'SYSTEM',
      });
    });
  });

  describe('2. API Auth Guard Helpers & canManageExam Tenancy Policy', () => {
    it('requireAuth returns 401 when no session is present', async () => {
      mockSessionUser = null;
      const result = await requireAuth();
      expect(result.authorized).toBe(false);
      expect(result.response?.status).toBe(401);
    });

    it('requireAuth succeeds when authenticated session is present', async () => {
      mockSessionUser = {
        id: prof1User._id.toString(),
        email: prof1User.email,
        name: prof1User.name,
        role: UserRole.PROFESSOR,
      };
      const result = await requireAuth();
      expect(result.authorized).toBe(true);
      expect(result.response).toBeNull();
      expect(result.user?.id).toBe(prof1User._id.toString());
    });

    it('requirePermission returns 403 and writes audit log when missing permission', async () => {
      mockSessionUser = {
        id: student1User._id.toString(),
        email: student1User.email,
        name: student1User.name,
        role: UserRole.STUDENT,
      };
      const result = await requirePermission(Permission.MANAGE_USERS);
      expect(result.authorized).toBe(false);
      expect(result.response?.status).toBe(403);
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0]).toMatchObject({
        user: student1User._id.toString(),
        action: 'AUTHORIZATION_FAILURE',
        details: { attemptedPermission: Permission.MANAGE_USERS, role: UserRole.STUDENT },
      });
    });

    it('requireGradingOrAnnotationAccess allows TA, PROFESSOR, and ADMIN, but denies STUDENT', async () => {
      expect(GRADING_OR_CANVAS_PERMISSIONS).toContain(Permission.GRADE_SCRIPT);
      expect(GRADING_OR_CANVAS_PERMISSIONS).toContain(Permission.SAVE_MARKS_FEEDBACK);
      expect(GRADING_OR_CANVAS_PERMISSIONS).toContain(Permission.EDIT_EXAM);
      expect(GRADING_OR_CANVAS_PERMISSIONS).toContain(Permission.VIEW_ALL_SUBMISSIONS);

      mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
      expect((await requireGradingOrAnnotationAccess()).authorized).toBe(true);

      mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
      expect((await requireGradingOrAnnotationAccess()).authorized).toBe(true);

      mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
      expect((await requireGradingOrAnnotationAccess()).authorized).toBe(true);

      mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
      const studRes = await requireGradingOrAnnotationAccess();
      expect(studRes.authorized).toBe(false);
      expect(studRes.response?.status).toBe(403);
    });

    it('canManageExam: ADMIN and assigned course professor succeed; foreign professor gets 404; TA/Student gets 403', async () => {
      // 1. Unauthenticated -> 401
      const unauth = await canManageExam(null, exam1._id);
      expect(unauth.canManage).toBe(false);
      expect(unauth.errorStatus).toBe(401);

      // 2. Admin -> 200
      const adminRes = await canManageExam({ id: adminUser._id.toString(), role: UserRole.ADMIN }, exam1._id);
      expect(adminRes.canManage).toBe(true);
      expect(adminRes.errorStatus).toBe(200);

      // 3. Course Professor -> 200
      const prof1Res = await canManageExam({ id: prof1User._id.toString(), role: UserRole.PROFESSOR }, exam1._id);
      expect(prof1Res.canManage).toBe(true);
      expect(prof1Res.errorStatus).toBe(200);

      // 4. Foreign Professor -> 404 (tenancy protection: does not reveal exam existence)
      const prof2Res = await canManageExam({ id: prof2User._id.toString(), role: UserRole.PROFESSOR }, exam1._id);
      expect(prof2Res.canManage).toBe(false);
      expect(prof2Res.errorStatus).toBe(404);

      // 5. TA -> 403
      const taRes = await canManageExam({ id: ta1User._id.toString(), role: UserRole.TA }, exam1._id);
      expect(taRes.canManage).toBe(false);
      expect(taRes.errorStatus).toBe(403);

      // 6. Student -> 403
      const studRes = await canManageExam({ id: student1User._id.toString(), role: UserRole.STUDENT }, exam1._id);
      expect(studRes.canManage).toBe(false);
      expect(studRes.errorStatus).toBe(403);
    });
  });

  describe('3. Real Endpoint Execution: Allow & Deny per Role', () => {
    describe('Public Probes: /api/health', () => {
      it('GET /api/health succeeds without authentication', async () => {
        mockSessionUser = null;
        const res = await healthGET();
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.status).toBe('healthy');
        expect(body.data.database).toBe('connected');
      });
    });

    describe('User Administration: /api/users & /api/users/import', () => {
      it('GET /api/users: 401 unauthenticated, 403 student/ta, 200 professor/admin', async () => {
        // Unauthenticated
        mockSessionUser = null;
        expect((await usersGET()).status).toBe(401);

        // Student -> 403
        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        expect((await usersGET()).status).toBe(403);

        // TA -> 403
        mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
        expect((await usersGET()).status).toBe(403);

        // Professor -> 200 (returns students & TAs)
        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        const profRes = await usersGET();
        expect(profRes.status).toBe(200);

        // Admin -> 200 (all users)
        mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
        const adminRes = await usersGET();
        expect(adminRes.status).toBe(200);
      });

      it('POST /api/users: 401 unauth, 403 professor (lacks MANAGE_USERS), 400 validation admin', async () => {
        // Unauthenticated
        mockSessionUser = null;
        const req = new NextRequest('http://localhost:3000/api/users', { method: 'POST', body: JSON.stringify({}) });
        expect((await usersPOST(req)).status).toBe(401);

        // Professor -> 403
        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        const profReq = new NextRequest('http://localhost:3000/api/users', { method: 'POST', body: JSON.stringify({}) });
        expect((await usersPOST(profReq)).status).toBe(403);

        // Admin -> allowed (returns 400 validation for empty body, proving auth passed)
        mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
        const adminReq = new NextRequest('http://localhost:3000/api/users', { method: 'POST', body: JSON.stringify({}) });
        const adminRes = await usersPOST(adminReq);
        expect(adminRes.status).toBe(400); // 400 validation error, not 401/403
      });

      it('POST /api/users/import: 401 unauth, 403 professor', async () => {
        mockSessionUser = null;
        const req = new NextRequest('http://localhost:3000/api/users/import', { method: 'POST' });
        expect((await usersImportPOST(req)).status).toBe(401);

        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        const profReq = new NextRequest('http://localhost:3000/api/users/import', { method: 'POST' });
        expect((await usersImportPOST(profReq)).status).toBe(403);
      });
    });

    describe('Course Management: /api/courses & /api/courses/[id]', () => {
      it('GET /api/courses: 401 unauth, 200 for all authenticated roles', async () => {
        mockSessionUser = null;
        expect((await coursesGET()).status).toBe(401);

        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        expect((await coursesGET()).status).toBe(200);

        mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
        expect((await coursesGET()).status).toBe(200);

        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        expect((await coursesGET()).status).toBe(200);
      });

      it('POST /api/courses: 401 unauth, 403 student/ta, 201 professor/admin', async () => {
        mockSessionUser = null;
        const coursePayload = {
          courseCode: 'CS999-NEW',
          courseName: 'Test Course',
          semester: '1',
          academicYear: '2026-2027',
        };
        const req1 = new NextRequest('http://localhost:3000/api/courses', { method: 'POST', body: JSON.stringify(coursePayload) });
        expect((await coursesPOST(req1)).status).toBe(401);

        // Student -> 403
        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        const req2 = new NextRequest('http://localhost:3000/api/courses', { method: 'POST', body: JSON.stringify(coursePayload) });
        expect((await coursesPOST(req2)).status).toBe(403);

        // TA -> 403
        mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
        const req3 = new NextRequest('http://localhost:3000/api/courses', { method: 'POST', body: JSON.stringify(coursePayload) });
        expect((await coursesPOST(req3)).status).toBe(403);

        // Professor -> 201
        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        const req4 = new NextRequest('http://localhost:3000/api/courses', { method: 'POST', body: JSON.stringify(coursePayload) });
        const resProf = await coursesPOST(req4);
        expect(resProf.status).toBe(201);
      });

      it('PUT /api/courses/[id]: 401 unauth, 403 student/ta, 403 foreign prof, 200 owner prof', async () => {
        const updatePayload = { courseName: 'Updated Course Name' };
        const ctx = { params: Promise.resolve({ id: course1._id.toString() }) };

        // Unauthenticated -> 401
        mockSessionUser = null;
        const req1 = new NextRequest(`http://localhost:3000/api/courses/${course1._id}`, { method: 'PUT', body: JSON.stringify(updatePayload) });
        expect((await courseIdPUT(req1, ctx)).status).toBe(401);

        // Student -> 403
        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        const req2 = new NextRequest(`http://localhost:3000/api/courses/${course1._id}`, { method: 'PUT', body: JSON.stringify(updatePayload) });
        expect((await courseIdPUT(req2, ctx)).status).toBe(403);

        // Foreign Professor (Prof 2 trying to edit Course 1) -> 404 (tenancy isolation)
        mockSessionUser = { id: prof2User._id.toString(), email: prof2User.email, name: prof2User.name, role: UserRole.PROFESSOR };
        const req3 = new NextRequest(`http://localhost:3000/api/courses/${course1._id}`, { method: 'PUT', body: JSON.stringify(updatePayload) });
        expect((await courseIdPUT(req3, ctx)).status).toBe(404);

        // Course Owner Professor -> 200
        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        const req4 = new NextRequest(`http://localhost:3000/api/courses/${course1._id}`, { method: 'PUT', body: JSON.stringify(updatePayload) });
        expect((await courseIdPUT(req4, ctx)).status).toBe(200);
      });
    });

    describe('Exam Lifecycle & Scoping: /api/exams & /api/exams/[id]', () => {
      it('POST /api/exams: 401 unauth, 403 student/ta, 403 non-course prof, 201 course prof', async () => {
        const examPayload = {
          title: 'New Exam 2026',
          course: course1._id.toString(),
          examDate: new Date(),
          numberOfQuestions: 1,
          totalMarks: 10,
        };

        // Unauthenticated
        mockSessionUser = null;
        const req1 = new NextRequest('http://localhost:3000/api/exams', { method: 'POST', body: JSON.stringify(examPayload) });
        expect((await examsPOST(req1)).status).toBe(401);

        // Student -> 403
        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        const req2 = new NextRequest('http://localhost:3000/api/exams', { method: 'POST', body: JSON.stringify(examPayload) });
        expect((await examsPOST(req2)).status).toBe(403);

        // Foreign professor (Prof 2 creating exam in Prof 1's course) -> 404 (course not found for foreign prof)
        mockSessionUser = { id: prof2User._id.toString(), email: prof2User.email, name: prof2User.name, role: UserRole.PROFESSOR };
        const req3 = new NextRequest('http://localhost:3000/api/exams', { method: 'POST', body: JSON.stringify(examPayload) });
        expect((await examsPOST(req3)).status).toBe(404);

        // Course Professor -> 201
        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        const req4 = new NextRequest('http://localhost:3000/api/exams', { method: 'POST', body: JSON.stringify(examPayload) });
        expect((await examsPOST(req4)).status).toBe(201);
      });

      it('PUT /api/exams/[id]: 401 unauth, 403 student/ta, 404 foreign prof (canManageExam isolation), 200 owner prof', async () => {
        const updatePayload = { title: 'Updated Exam Title' };
        const ctx = { params: Promise.resolve({ id: exam1._id.toString() }) };

        // Unauthenticated -> 401
        mockSessionUser = null;
        const req1 = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}`, { method: 'PUT', body: JSON.stringify(updatePayload) });
        expect((await examIdPUT(req1, ctx)).status).toBe(401);

        // Student -> 403
        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        const req2 = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}`, { method: 'PUT', body: JSON.stringify(updatePayload) });
        expect((await examIdPUT(req2, ctx)).status).toBe(403);

        // Foreign Professor (Prof 2 trying to update Exam 1) -> 404
        mockSessionUser = { id: prof2User._id.toString(), email: prof2User.email, name: prof2User.name, role: UserRole.PROFESSOR };
        const req3 = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}`, { method: 'PUT', body: JSON.stringify(updatePayload) });
        expect((await examIdPUT(req3, ctx)).status).toBe(404);

        // Course Professor -> 200
        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        const req4 = new NextRequest(`http://localhost:3000/api/exams/${exam1._id}`, { method: 'PUT', body: JSON.stringify(updatePayload) });
        expect((await examIdPUT(req4, ctx)).status).toBe(200);
      });
    });

    describe('Grading Allocations: /api/allocations & /api/allocations/[id]/claim', () => {
      it('GET /api/allocations: 401 unauth, 403 student/professor (lacks VIEW_ASSIGNED_SCRIPTS), 200 TA/admin', async () => {
        const req = new NextRequest('http://localhost:3000/api/allocations');

        mockSessionUser = null;
        expect((await allocationsGET(req)).status).toBe(401);

        // Student -> 403 (lacks VIEW_ASSIGNED_SCRIPTS)
        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        expect((await allocationsGET(req)).status).toBe(403);

        // Professor -> 403 (permissions.ts:47-65 gives VIEW_ALL_SUBMISSIONS, not VIEW_ASSIGNED_SCRIPTS)
        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        expect((await allocationsGET(req)).status).toBe(403);

        // TA -> 200 (sees assigned scripts)
        mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
        const taRes = await allocationsGET(req);
        expect(taRes.status).toBe(200);

        // Admin -> 200
        mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
        expect((await allocationsGET(req)).status).toBe(200);
      });

      it('POST /api/allocations/[id]/claim: 401 unauth, 403 student, 403 unassigned TA, 200 assigned TA', async () => {
        const ctx = { params: Promise.resolve({ id: allocation1._id.toString() }) };
        const req = new NextRequest(`http://localhost:3000/api/allocations/${allocation1._id}/claim`, { method: 'POST' });

        mockSessionUser = null;
        expect((await allocationClaimPOST(req, ctx)).status).toBe(401);

        // Student -> 403
        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        expect((await allocationClaimPOST(req, ctx)).status).toBe(403);

        // Unassigned TA (TA 2 claiming TA 1's allocation) -> 403
        mockSessionUser = { id: ta2User._id.toString(), email: ta2User.email, name: ta2User.name, role: UserRole.TA };
        expect((await allocationClaimPOST(req, ctx)).status).toBe(403);

        // Assigned TA (TA 1) -> 200
        mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
        const claimRes = await allocationClaimPOST(req, ctx);
        expect(claimRes.status).toBe(200);
      });
    });

    describe('Student Results & Regrading: /api/student/results & regrade-requests', () => {
      it('GET /api/student/results: 401 unauth, 403 TA/Professor, 200 Student', async () => {
        mockSessionUser = null;
        expect((await studentResultsGET()).status).toBe(401);

        // TA -> 403 (studentResults strictly enforces STUDENT role)
        mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
        expect((await studentResultsGET()).status).toBe(403);

        // Professor -> 403
        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        expect((await studentResultsGET()).status).toBe(403);

        // Student -> 200
        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        expect((await studentResultsGET()).status).toBe(200);
      });

      it('POST /api/student/regrade-requests: 401 unauth, 403 TA/Professor', async () => {
        const req = new NextRequest('http://localhost:3000/api/student/regrade-requests', { method: 'POST', body: JSON.stringify({}) });

        mockSessionUser = null;
        expect((await studentRegradesPOST(req)).status).toBe(401);

        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        expect((await studentRegradesPOST(req)).status).toBe(403);
      });
    });

    describe('Professor Queue: /api/professor/regrade-requests & /api/professor/flags', () => {
      it('GET /api/professor/regrade-requests: 401 unauth, 403 student, 200 professor/admin', async () => {
        const req = new NextRequest('http://localhost:3000/api/professor/regrade-requests');

        mockSessionUser = null;
        expect((await profRegradesGET(req)).status).toBe(401);

        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        expect((await profRegradesGET(req)).status).toBe(403);

        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        expect((await profRegradesGET(req)).status).toBe(200);
      });

      it('GET /api/professor/flags: 401 unauth, 403 student, 200 professor/admin', async () => {
        const req = new NextRequest('http://localhost:3000/api/professor/flags');

        mockSessionUser = null;
        expect((await profFlagsGET(req)).status).toBe(401);

        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        expect((await profFlagsGET(req)).status).toBe(403);

        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        expect((await profFlagsGET(req)).status).toBe(200);
      });
    });

    describe('Audit Logs & Verification: /api/audit-logs & /api/audit-logs/verify', () => {
      it('GET /api/audit-logs: 401 unauth, 403 student/ta, 200 professor/admin (with examId)', async () => {
        const reqNoParam = new NextRequest('http://localhost:3000/api/audit-logs');
        const reqWithExam = new NextRequest(`http://localhost:3000/api/audit-logs?examId=${exam1._id}`);

        mockSessionUser = null;
        expect((await auditLogsGET(reqWithExam)).status).toBe(401);

        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        expect((await auditLogsGET(reqWithExam)).status).toBe(403);

        mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
        expect((await auditLogsGET(reqWithExam)).status).toBe(403);

        // Professor without examId -> 400
        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        expect((await auditLogsGET(reqNoParam)).status).toBe(400);

        // Professor with owned examId -> 200
        expect((await auditLogsGET(reqWithExam)).status).toBe(200);
      });

      it('POST /api/audit-logs/verify: 401 unauth, 403 student/ta/prof, 200 admin only', async () => {
        mockSessionUser = null;
        expect((await auditVerifyPOST()).status).toBe(401);

        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        expect((await auditVerifyPOST()).status).toBe(403);

        mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
        expect((await auditVerifyPOST()).status).toBe(403);

        // Professor has VIEW_ALL_SUBMISSIONS but is NOT ADMIN -> 403
        mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
        expect((await auditVerifyPOST()).status).toBe(403);

        // Admin -> 200
        mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
        expect((await auditVerifyPOST()).status).toBe(200);
      });
    });

    describe('Notifications: /api/notifications', () => {
      it('GET /api/notifications: 401 unauth, 200 for any authenticated role', async () => {
        const req = new NextRequest('http://localhost:3000/api/notifications');

        mockSessionUser = null;
        expect((await notificationsGET(req)).status).toBe(401);

        mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
        expect((await notificationsGET(req)).status).toBe(200);
      });

    describe('Exhaustive 90-Route Handler Role Audit (Code-Derived)', () => {
      const dummyId = new mongoose.Types.ObjectId().toString();

      describe('Route [1/90]: /api/allocations', () => {
        it('GET /api/allocations: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/allocations/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/allocations'.replace(/\[id\]/g, allocation1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [2/90]: /api/allocations/[id]', () => {
        it('DELETE /api/allocations/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/allocations/[id]/route');
          const handler: any = mod['DELETE'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/allocations/[id]'.replace(/\[id\]/g, allocation1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': allocation1._id.toString()}) };
          const reqOpts = { method: 'DELETE' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [3/90]: /api/allocations/[id]/claim', () => {
        it('POST /api/allocations/[id]/claim: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/allocations/[id]/claim/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/allocations/[id]/claim'.replace(/\[id\]/g, allocation1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': allocation1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_ADMIN.status);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [4/90]: /api/allocations/[id]/complete', () => {
        it('POST /api/allocations/[id]/complete: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/allocations/[id]/complete/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/allocations/[id]/complete'.replace(/\[id\]/g, allocation1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': allocation1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [5/90]: /api/allocations/[id]/release', () => {
        it('POST /api/allocations/[id]/release: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/allocations/[id]/release/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/allocations/[id]/release'.replace(/\[id\]/g, allocation1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': allocation1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [6/90]: /api/allocations/[id]/reopen', () => {
        it('POST /api/allocations/[id]/reopen: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/allocations/[id]/reopen/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/allocations/[id]/reopen'.replace(/\[id\]/g, allocation1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': allocation1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [7/90]: /api/allocations/next', () => {
        it('GET /api/allocations/next: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/allocations/next/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/allocations/next'.replace(/\[id\]/g, allocation1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [8/90]: /api/analytics/exams/[id]', () => {
        it('GET /api/analytics/exams/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/analytics/exams/[id]/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/analytics/exams/[id]'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [9/90]: /api/analytics/exams/[id]/export', () => {
        it('GET /api/analytics/exams/[id]/export: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/analytics/exams/[id]/export/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/analytics/exams/[id]/export'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [10/90]: /api/analytics/exams/[id]/export/lms', () => {
        it('GET /api/analytics/exams/[id]/export/lms: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/analytics/exams/[id]/export/lms/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/analytics/exams/[id]/export/lms'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('POST /api/analytics/exams/[id]/export/lms: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/analytics/exams/[id]/export/lms/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/analytics/exams/[id]/export/lms'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [11/90]: /api/analytics/exams/[id]/graders', () => {
        it('GET /api/analytics/exams/[id]/graders: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/analytics/exams/[id]/graders/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/analytics/exams/[id]/graders'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [12/90]: /api/analytics/exams/[id]/lti/passback', () => {
        it('GET /api/analytics/exams/[id]/lti/passback: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/analytics/exams/[id]/lti/passback/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/analytics/exams/[id]/lti/passback'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('POST /api/analytics/exams/[id]/lti/passback: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/analytics/exams/[id]/lti/passback/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/analytics/exams/[id]/lti/passback'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [13/90]: /api/analytics/remark-tags', () => {
        it('GET /api/analytics/remark-tags: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/analytics/remark-tags/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/analytics/remark-tags'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_ADMIN.status);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [14/90]: /api/answerscripts/[id]/identify', () => {
        it('POST /api/answerscripts/[id]/identify: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/answerscripts/[id]/identify/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/answerscripts/[id]/identify'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [15/90]: /api/audit-logs', () => {
        it('GET /api/audit-logs: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/audit-logs/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/audit-logs'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [16/90]: /api/audit-logs/export', () => {
        it('GET /api/audit-logs/export: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/audit-logs/export/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/audit-logs/export'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [17/90]: /api/audit-logs/verify', () => {
        it('POST /api/audit-logs/verify: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/audit-logs/verify/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/audit-logs/verify'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [18/90]: /api/auth/[...nextauth]', () => {
        it('GET /api/auth/[...nextauth]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/auth/[...nextauth]/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
        });
        it('POST /api/auth/[...nextauth]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/auth/[...nextauth]/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
        });
      });
      describe('Route [19/90]: /api/auth/register', () => {
        it('POST /api/auth/register: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/auth/register/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/auth/register'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resPublic = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resPublic.status).not.toBe(401);
          expect(resPublic.status).not.toBe(500);
        });
      });
      describe('Route [20/90]: /api/auth/reset', () => {
        it('POST /api/auth/reset: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/auth/reset/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/auth/reset'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resPublic = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resPublic.status).not.toBe(401);
          expect(resPublic.status).not.toBe(500);
        });
      });
      describe('Route [21/90]: /api/auth/reset-password', () => {
        it('POST /api/auth/reset-password: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/auth/reset-password/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/auth/reset-password'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resPublic = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resPublic.status).not.toBe(401);
          expect(resPublic.status).not.toBe(500);
        });
      });
      describe('Route [22/90]: /api/courses', () => {
        it('GET /api/courses: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/courses/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/courses'.replace(/\[id\]/g, course1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
        it('POST /api/courses: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/courses/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/courses'.replace(/\[id\]/g, course1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [23/90]: /api/courses/[id]', () => {
        it('GET /api/courses/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/courses/[id]/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/courses/[id]'.replace(/\[id\]/g, course1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': course1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
        it('PUT /api/courses/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/courses/[id]/route');
          const handler: any = mod['PUT'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/courses/[id]'.replace(/\[id\]/g, course1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': course1._id.toString()}) };
          const reqOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('DELETE /api/courses/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/courses/[id]/route');
          const handler: any = mod['DELETE'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/courses/[id]'.replace(/\[id\]/g, course1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': course1._id.toString()}) };
          const reqOpts = { method: 'DELETE' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [24/90]: /api/courses/[id]/enroll', () => {
        it('POST /api/courses/[id]/enroll: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/courses/[id]/enroll/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/courses/[id]/enroll'.replace(/\[id\]/g, course1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': course1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('DELETE /api/courses/[id]/enroll: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/courses/[id]/enroll/route');
          const handler: any = mod['DELETE'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/courses/[id]/enroll'.replace(/\[id\]/g, course1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': course1._id.toString()}) };
          const reqOpts = { method: 'DELETE' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [25/90]: /api/exams', () => {
        it('GET /api/exams: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
        it('POST /api/exams: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [26/90]: /api/exams/[id]', () => {
        it('GET /api/exams/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
        it('PUT /api/exams/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/route');
          const handler: any = mod['PUT'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('DELETE /api/exams/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/route');
          const handler: any = mod['DELETE'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'DELETE' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('PATCH /api/exams/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/route');
          const handler: any = mod['PATCH'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [27/90]: /api/exams/[id]/allocate', () => {
        it('GET /api/exams/[id]/allocate: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/allocate/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/allocate'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('POST /api/exams/[id]/allocate: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/allocate/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/allocate'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [28/90]: /api/exams/[id]/allocate/preview', () => {
        it('POST /api/exams/[id]/allocate/preview: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/allocate/preview/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/allocate/preview'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [29/90]: /api/exams/[id]/allocate/reassign', () => {
        it('PUT /api/exams/[id]/allocate/reassign: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/allocate/reassign/route');
          const handler: any = mod['PUT'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/allocate/reassign'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [30/90]: /api/exams/[id]/allocate/reassign/history', () => {
        it('GET /api/exams/[id]/allocate/reassign/history: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/allocate/reassign/history/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/allocate/reassign/history'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [31/90]: /api/exams/[id]/approve-ingestion', () => {
        it('POST /api/exams/[id]/approve-ingestion: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/approve-ingestion/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/approve-ingestion'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [32/90]: /api/exams/[id]/blind-grading', () => {
        it('POST /api/exams/[id]/blind-grading: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/blind-grading/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/blind-grading'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [33/90]: /api/exams/[id]/cover-sheets', () => {
        it('POST /api/exams/[id]/cover-sheets: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/cover-sheets/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/cover-sheets'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [34/90]: /api/exams/[id]/enroll', () => {
        it('POST /api/exams/[id]/enroll: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/enroll/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/enroll'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('PUT /api/exams/[id]/enroll: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/enroll/route');
          const handler: any = mod['PUT'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/enroll'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [35/90]: /api/exams/[id]/export', () => {
        it('GET /api/exams/[id]/export: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/export/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/export'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [36/90]: /api/exams/[id]/ingestion-summary', () => {
        it('GET /api/exams/[id]/ingestion-summary: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/ingestion-summary/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/ingestion-summary'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [37/90]: /api/exams/[id]/progress', () => {
        it('GET /api/exams/[id]/progress: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/progress/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/progress'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [38/90]: /api/exams/[id]/progress/stream', () => {
        it('GET /api/exams/[id]/progress/stream: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/progress/stream/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/progress/stream'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [39/90]: /api/exams/[id]/publish', () => {
        it('GET /api/exams/[id]/publish: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/publish/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/publish'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('POST /api/exams/[id]/publish: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/publish/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/publish'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [40/90]: /api/exams/[id]/regrade-window', () => {
        it('GET /api/exams/[id]/regrade-window: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/regrade-window/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/regrade-window'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
        it('PUT /api/exams/[id]/regrade-window: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/regrade-window/route');
          const handler: any = mod['PUT'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/regrade-window'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [41/90]: /api/exams/[id]/revoke-ingestion', () => {
        it('POST /api/exams/[id]/revoke-ingestion: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/revoke-ingestion/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/revoke-ingestion'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [42/90]: /api/exams/[id]/students', () => {
        it('GET /api/exams/[id]/students: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/students/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/students'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [43/90]: /api/exams/[id]/submissions/bulk', () => {
        it('POST /api/exams/[id]/submissions/bulk: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/submissions/bulk/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/submissions/bulk'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [44/90]: /api/exams/[id]/ta/[taId]', () => {
        it('GET /api/exams/[id]/ta/[taId]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/ta/[taId]/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/ta/[taId]'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString(), 'taId': ta1User._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [45/90]: /api/exams/[id]/tags', () => {
        it('GET /api/exams/[id]/tags: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/tags/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/tags'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('POST /api/exams/[id]/tags: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/tags/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/tags'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [46/90]: /api/exams/[id]/unpublish', () => {
        it('POST /api/exams/[id]/unpublish: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/unpublish/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/unpublish'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [47/90]: /api/exams/[id]/verify-assembly', () => {
        it('POST /api/exams/[id]/verify-assembly: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/verify-assembly/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/verify-assembly'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [48/90]: /api/exams/[id]/verify-integrity', () => {
        it('POST /api/exams/[id]/verify-integrity: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/exams/[id]/verify-integrity/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/exams/[id]/verify-integrity'.replace(/\[id\]/g, exam1._id.toString()).replace(/\[taId\]/g, ta1User._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': exam1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [49/90]: /api/health', () => {
        it('GET /api/health: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/health/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/health'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resPublic = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resPublic.status).not.toBe(401);
          expect(resPublic.status).not.toBe(500);
        });
      });
      describe('Route [50/90]: /api/ingest', () => {
        it('GET /api/ingest: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/ingest/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/ingest'.replace(/\[id\]/g, batch1.batchId).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('POST /api/ingest: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/ingest/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/ingest'.replace(/\[id\]/g, batch1.batchId).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [51/90]: /api/ingest/[id]', () => {
        it('GET /api/ingest/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/ingest/[id]/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/ingest/[id]'.replace(/\[id\]/g, batch1.batchId).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': batch1.batchId}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [52/90]: /api/ingest/[id]/pages/[pageId]/enhance', () => {
        it('PUT /api/ingest/[id]/pages/[pageId]/enhance: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/ingest/[id]/pages/[pageId]/enhance/route');
          const handler: any = mod['PUT'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/ingest/[id]/pages/[pageId]/enhance'.replace(/\[id\]/g, batch1.batchId).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': batch1.batchId, 'pageId': dummyId}) };
          const reqOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [53/90]: /api/ingest/[id]/pages/[pageId]/image', () => {
        it('GET /api/ingest/[id]/pages/[pageId]/image: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/ingest/[id]/pages/[pageId]/image/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/ingest/[id]/pages/[pageId]/image'.replace(/\[id\]/g, batch1.batchId).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': batch1.batchId, 'pageId': dummyId}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [54/90]: /api/ingest/[id]/pages/[pageId]/thumbnail', () => {
        it('GET /api/ingest/[id]/pages/[pageId]/thumbnail: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/ingest/[id]/pages/[pageId]/thumbnail/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/ingest/[id]/pages/[pageId]/thumbnail'.replace(/\[id\]/g, batch1.batchId).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': batch1.batchId, 'pageId': dummyId}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [55/90]: /api/ingest/[id]/scripts', () => {
        it('GET /api/ingest/[id]/scripts: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/ingest/[id]/scripts/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/ingest/[id]/scripts'.replace(/\[id\]/g, batch1.batchId).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': batch1.batchId}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [56/90]: /api/ingest/[id]/scripts/merge', () => {
        it('POST /api/ingest/[id]/scripts/merge: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/ingest/[id]/scripts/merge/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/ingest/[id]/scripts/merge'.replace(/\[id\]/g, batch1.batchId).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': batch1.batchId}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [57/90]: /api/ingest/[id]/scripts/remap', () => {
        it('POST /api/ingest/[id]/scripts/remap: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/ingest/[id]/scripts/remap/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/ingest/[id]/scripts/remap'.replace(/\[id\]/g, batch1.batchId).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': batch1.batchId}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [58/90]: /api/ingest/[id]/scripts/reorder', () => {
        it('POST /api/ingest/[id]/scripts/reorder: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/ingest/[id]/scripts/reorder/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/ingest/[id]/scripts/reorder'.replace(/\[id\]/g, batch1.batchId).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': batch1.batchId}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [59/90]: /api/ingest/[id]/scripts/split', () => {
        it('POST /api/ingest/[id]/scripts/split: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/ingest/[id]/scripts/split/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/ingest/[id]/scripts/split'.replace(/\[id\]/g, batch1.batchId).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': batch1.batchId}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [60/90]: /api/notifications', () => {
        it('GET /api/notifications: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/notifications/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/notifications'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
      });
      describe('Route [61/90]: /api/notifications/[id]/read', () => {
        it('PATCH /api/notifications/[id]/read: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/notifications/[id]/read/route');
          const handler: any = mod['PATCH'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/notifications/[id]/read'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
      });
      describe('Route [62/90]: /api/notifications/read-all', () => {
        it('PATCH /api/notifications/read-all: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/notifications/read-all/route');
          const handler: any = mod['PATCH'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/notifications/read-all'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
      });
      describe('Route [63/90]: /api/professor/activity', () => {
        it('GET /api/professor/activity: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/professor/activity/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/professor/activity'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [64/90]: /api/professor/flags', () => {
        it('GET /api/professor/flags: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/professor/flags/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/professor/flags'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [65/90]: /api/professor/flags/[id]/resolve', () => {
        it('POST /api/professor/flags/[id]/resolve: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/professor/flags/[id]/resolve/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/professor/flags/[id]/resolve'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [66/90]: /api/professor/flags/analytics', () => {
        it('GET /api/professor/flags/analytics: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/professor/flags/analytics/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/professor/flags/analytics'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [67/90]: /api/professor/regrade-requests', () => {
        it('GET /api/professor/regrade-requests: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/professor/regrade-requests/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/professor/regrade-requests'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [68/90]: /api/professor/regrade-requests/[id]', () => {
        it('PATCH /api/professor/regrade-requests/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/professor/regrade-requests/[id]/route');
          const handler: any = mod['PATCH'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/professor/regrade-requests/[id]'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [69/90]: /api/professor/regrade-requests/[id]/assignment', () => {
        it('PATCH /api/professor/regrade-requests/[id]/assignment: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/professor/regrade-requests/[id]/assignment/route');
          const handler: any = mod['PATCH'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/professor/regrade-requests/[id]/assignment'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [70/90]: /api/rubrics', () => {
        it('GET /api/rubrics: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/rubrics/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/rubrics'.replace(/\[id\]/g, rubric1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
        it('POST /api/rubrics: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/rubrics/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/rubrics'.replace(/\[id\]/g, rubric1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [71/90]: /api/rubrics/[id]', () => {
        it('GET /api/rubrics/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/rubrics/[id]/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/rubrics/[id]'.replace(/\[id\]/g, rubric1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': rubric1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
        it('PUT /api/rubrics/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/rubrics/[id]/route');
          const handler: any = mod['PUT'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/rubrics/[id]'.replace(/\[id\]/g, rubric1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': rubric1._id.toString()}) };
          const reqOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [72/90]: /api/scripts/[id]', () => {
        it('GET /api/scripts/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/scripts/[id]/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/scripts/[id]'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [73/90]: /api/scripts/[id]/flags', () => {
        it('GET /api/scripts/[id]/flags: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/scripts/[id]/flags/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/scripts/[id]/flags'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('POST /api/scripts/[id]/flags: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/scripts/[id]/flags/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/scripts/[id]/flags'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_ADMIN.status);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [74/90]: /api/scripts/[id]/grades', () => {
        it('GET /api/scripts/[id]/grades: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/scripts/[id]/grades/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/scripts/[id]/grades'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('POST /api/scripts/[id]/grades: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/scripts/[id]/grades/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/scripts/[id]/grades'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('PUT /api/scripts/[id]/grades: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/scripts/[id]/grades/route');
          const handler: any = mod['PUT'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/scripts/[id]/grades'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString()}) };
          const reqOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [75/90]: /api/scripts/[id]/pages', () => {
        it('GET /api/scripts/[id]/pages: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/scripts/[id]/pages/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/scripts/[id]/pages'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [76/90]: /api/scripts/[id]/pages/[p]/annotations', () => {
        it('GET /api/scripts/[id]/pages/[p]/annotations: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/scripts/[id]/pages/[p]/annotations/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/scripts/[id]/pages/[p]/annotations'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString(), 'p': '1'}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('PUT /api/scripts/[id]/pages/[p]/annotations: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/scripts/[id]/pages/[p]/annotations/route');
          const handler: any = mod['PUT'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/scripts/[id]/pages/[p]/annotations'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString(), 'p': '1'}) };
          const reqOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [77/90]: /api/scripts/[id]/questions/[questionNumber]/grade', () => {
        it('POST /api/scripts/[id]/questions/[questionNumber]/grade: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/scripts/[id]/questions/[questionNumber]/grade/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/scripts/[id]/questions/[questionNumber]/grade'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString(), 'questionNumber': '1'}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('PUT /api/scripts/[id]/questions/[questionNumber]/grade: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/scripts/[id]/questions/[questionNumber]/grade/route');
          const handler: any = mod['PUT'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/scripts/[id]/questions/[questionNumber]/grade'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString(), 'questionNumber': '1'}) };
          const reqOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [78/90]: /api/scripts/[id]/submit', () => {
        it('POST /api/scripts/[id]/submit: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/scripts/[id]/submit/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/scripts/[id]/submit'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': script1._id.toString()}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [79/90]: /api/student/regrade-requests', () => {
        it('GET /api/student/regrade-requests: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/student/regrade-requests/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/student/regrade-requests'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_ADMIN.status);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
        it('POST /api/student/regrade-requests: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/student/regrade-requests/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/student/regrade-requests'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_ADMIN.status);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
      });
      describe('Route [80/90]: /api/student/results', () => {
        it('GET /api/student/results: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/student/results/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/student/results'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_ADMIN.status);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
      });
      describe('Route [81/90]: /api/student/results/[scriptId]', () => {
        it('GET /api/student/results/[scriptId]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/student/results/[scriptId]/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/student/results/[scriptId]'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'scriptId': script1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_ADMIN.status);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
      });
      describe('Route [82/90]: /api/student/results/[scriptId]/export', () => {
        it('GET /api/student/results/[scriptId]/export: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/student/results/[scriptId]/export/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/student/results/[scriptId]/export'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'scriptId': script1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_ADMIN.status);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
      });
      describe('Route [83/90]: /api/student/results/[scriptId]/pages', () => {
        it('GET /api/student/results/[scriptId]/pages: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/student/results/[scriptId]/pages/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/student/results/[scriptId]/pages'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'scriptId': script1._id.toString()}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_ADMIN.status);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
      });
      describe('Route [84/90]: /api/student/results/[scriptId]/pages/[pageId]/annotations', () => {
        it('GET /api/student/results/[scriptId]/pages/[pageId]/annotations: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/student/results/[scriptId]/pages/[pageId]/annotations/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/student/results/[scriptId]/pages/[pageId]/annotations'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'scriptId': script1._id.toString(), 'pageId': dummyId}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_ADMIN.status);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
      });
      describe('Route [85/90]: /api/student/results/[scriptId]/pages/[pageId]/image', () => {
        it('GET /api/student/results/[scriptId]/pages/[pageId]/image: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/student/results/[scriptId]/pages/[pageId]/image/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/student/results/[scriptId]/pages/[pageId]/image'.replace(/\[id\]/g, script1._id.toString()).replace(/\[scriptId\]/g, script1._id.toString()).replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'scriptId': script1._id.toString(), 'pageId': dummyId}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_ADMIN.status);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_STUDENT.status).not.toBe(401);
          expect(res_STUDENT.status).not.toBe(403);
          expect(res_STUDENT.status).not.toBe(500);
        });
      });
      describe('Route [86/90]: /api/tags', () => {
        it('GET /api/tags: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/tags/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/tags'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('POST /api/tags: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/tags/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/tags'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [87/90]: /api/tags/[id]', () => {
        it('GET /api/tags/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/tags/[id]/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/tags/[id]'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('PUT /api/tags/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/tags/[id]/route');
          const handler: any = mod['PUT'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/tags/[id]'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('DELETE /api/tags/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/tags/[id]/route');
          const handler: any = mod['DELETE'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/tags/[id]'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'DELETE' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('PATCH /api/tags/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/tags/[id]/route');
          const handler: any = mod['PATCH'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/tags/[id]'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_TA.status).not.toBe(401);
          expect(res_TA.status).not.toBe(403);
          expect(res_TA.status).not.toBe(500);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [88/90]: /api/users', () => {
        it('GET /api/users: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/users/route');
          const handler: any = mod['GET'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/users'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'GET' };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_PROFESSOR.status).not.toBe(401);
          expect(res_PROFESSOR.status).not.toBe(403);
          expect(res_PROFESSOR.status).not.toBe(500);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('POST /api/users: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/users/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/users'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [89/90]: /api/users/[id]', () => {
        it('PUT /api/users/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/users/[id]/route');
          const handler: any = mod['PUT'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/users/[id]'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
        it('PATCH /api/users/[id]: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/users/[id]/route');
          const handler: any = mod['PATCH'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/users/[id]'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({'id': dummyId}) };
          const reqOpts = { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
      describe('Route [90/90]: /api/users/import', () => {
        it('POST /api/users/import: strictly verifies allow/deny across all four roles', async () => {
          const mod: any = await import('../app/api/users/import/route');
          const handler: any = mod['POST'];
          expect(typeof handler).toBe('function');
          const url = 'http://localhost:3000/api/users/import'.replace(/\[.*?\]/g, dummyId);
          const ctx = { params: Promise.resolve({}) };
          const reqOpts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brightness: 1, question: 1, reason: 'OTHER', note: 'test', action: 'reopen' }) };
          mockSessionUser = null;
          const resUnauth = await handler(new NextRequest(url, reqOpts), ctx);
          expect(resUnauth.status).toBe(401);
          mockSessionUser = { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: UserRole.ADMIN };
          const res_ADMIN = await handler(new NextRequest(url, reqOpts), ctx);
          expect(res_ADMIN.status).not.toBe(401);
          expect(res_ADMIN.status).not.toBe(403);
          expect(res_ADMIN.status).not.toBe(500);
          mockSessionUser = { id: prof1User._id.toString(), email: prof1User.email, name: prof1User.name, role: UserRole.PROFESSOR };
          const res_PROFESSOR = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_PROFESSOR.status);
          mockSessionUser = { id: ta1User._id.toString(), email: ta1User.email, name: ta1User.name, role: UserRole.TA };
          const res_TA = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_TA.status);
          mockSessionUser = { id: student1User._id.toString(), email: student1User.email, name: student1User.name, role: UserRole.STUDENT };
          const res_STUDENT = await handler(new NextRequest(url, reqOpts), ctx);
          expect([403, 404]).toContain(res_STUDENT.status);
        });
      });
    });
  });
});

});
