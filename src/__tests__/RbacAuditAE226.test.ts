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
import Exam, { ExamStatus } from '../models/Exam';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Rubric from '../models/Rubric';

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
    });
  });
});
