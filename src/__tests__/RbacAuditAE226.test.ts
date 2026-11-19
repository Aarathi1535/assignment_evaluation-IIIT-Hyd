/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
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
} from '../lib/apiAuth';

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

// Mock audit log writer to verify AUTHORIZATION_FAILURE audit logging
const auditCalls: any[] = [];
vi.mock('../lib/audit', () => ({
  writeAuditLog: vi.fn().mockImplementation(async (entry: any) => {
    auditCalls.push(entry);
    return Promise.resolve({ success: true, id: 'mock-audit-id' });
  }),
}));

describe('AE-226: RBAC Audit and Authorization Enforcement', () => {
  beforeEach(() => {
    mockSessionUser = null;
    auditCalls.length = 0;
  });

  describe('1. Canonical Role-Permission Matrix Invariants', () => {
    it('verifies ADMIN role possesses all system permissions', () => {
      const allPermissions = Object.values(Permission);
      expect(RolePermissions[UserRole.ADMIN]).toHaveLength(allPermissions.length);
      for (const perm of allPermissions) {
        expect(hasPermission(UserRole.ADMIN, perm)).toBe(true);
      }
    });

    it('verifies PROFESSOR role has exam/course lifecycle permissions but lacks MANAGE_USERS', () => {
      expect(hasPermission(UserRole.PROFESSOR, Permission.CREATE_COURSE)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.EDIT_COURSE)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.DELETE_COURSE)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.ASSIGN_TAS)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.CREATE_EXAM)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.EDIT_EXAM)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.DELETE_EXAM)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.CREATE_RUBRIC)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.EDIT_RUBRIC)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.VIEW_ALL_SUBMISSIONS)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.ALLOCATE_SCRIPTS)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.PUBLISH_GRADES)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.CREATE_BATCH)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.VIEW_BATCH)).toBe(true);
      expect(hasPermission(UserRole.PROFESSOR, Permission.APPROVE_INGESTION)).toBe(true);

      // Least privilege boundaries:
      expect(hasPermission(UserRole.PROFESSOR, Permission.MANAGE_USERS)).toBe(false);
      expect(hasPermission(UserRole.PROFESSOR, Permission.VIEW_OWN_RESULTS)).toBe(false);
      expect(hasPermission(UserRole.PROFESSOR, Permission.REQUEST_REGRADE)).toBe(false);
    });

    it('verifies TA role has grading and feedback capabilities but lacks course/exam management', () => {
      expect(hasPermission(UserRole.TA, Permission.VIEW_COURSES)).toBe(true);
      expect(hasPermission(UserRole.TA, Permission.VIEW_ASSIGNED_SCRIPTS)).toBe(true);
      expect(hasPermission(UserRole.TA, Permission.GRADE_SCRIPT)).toBe(true);
      expect(hasPermission(UserRole.TA, Permission.FLAG_FOR_REVIEW)).toBe(true);
      expect(hasPermission(UserRole.TA, Permission.SAVE_MARKS_FEEDBACK)).toBe(true);

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

    it('verifies STUDENT role is strictly limited to viewing courses, own results, and regrade requests', () => {
      expect(hasPermission(UserRole.STUDENT, Permission.VIEW_COURSES)).toBe(true);
      expect(hasPermission(UserRole.STUDENT, Permission.VIEW_OWN_RESULTS)).toBe(true);
      expect(hasPermission(UserRole.STUDENT, Permission.REQUEST_REGRADE)).toBe(true);

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

  describe('2. API Auth Guard Helpers (requireAuth, requirePermission, requireAnyPermission)', () => {
    it('requireAuth returns 401 when no session is present', async () => {
      mockSessionUser = null;
      const result = await requireAuth();
      expect(result.authorized).toBe(false);
      expect(result.user).toBeNull();
      expect(result.response?.status).toBe(401);
      const data = await result.response?.json();
      expect(data).toEqual({
        success: false,
        message: 'Unauthorized',
        data: null,
      });
    });

    it('requireAuth succeeds when authenticated session is present', async () => {
      mockSessionUser = {
        id: 'usr-prof-1',
        email: 'prof@iiit.ac.in',
        name: 'Prof. Raman',
        role: UserRole.PROFESSOR,
      };
      const result = await requireAuth();
      expect(result.authorized).toBe(true);
      expect(result.response).toBeNull();
      expect(result.user).toEqual(mockSessionUser);
    });

    it('requirePermission returns 401 when unauthenticated', async () => {
      mockSessionUser = null;
      const result = await requirePermission(Permission.CREATE_COURSE);
      expect(result.authorized).toBe(false);
      expect(result.response?.status).toBe(401);
    });

    it('requirePermission returns 403 and writes audit log when authenticated but lacks permission', async () => {
      mockSessionUser = {
        id: 'usr-stud-1',
        email: 'student@iiit.ac.in',
        name: 'Student Candidate',
        role: UserRole.STUDENT,
      };
      const result = await requirePermission(Permission.MANAGE_USERS);
      expect(result.authorized).toBe(false);
      expect(result.response?.status).toBe(403);
      const data = await result.response?.json();
      expect(data).toEqual({
        success: false,
        message: 'Forbidden',
        data: null,
      });

      // Audit trail verification:
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0]).toMatchObject({
        user: 'usr-stud-1',
        action: 'AUTHORIZATION_FAILURE',
        outcome: 'FAILURE',
        details: {
          attemptedPermission: Permission.MANAGE_USERS,
          role: UserRole.STUDENT,
        },
      });
    });

    it('requirePermission succeeds when user role possesses required permission', async () => {
      mockSessionUser = {
        id: 'usr-admin-1',
        email: 'admin@iiit.ac.in',
        name: 'System Admin',
        role: UserRole.ADMIN,
      };
      const result = await requirePermission(Permission.MANAGE_USERS);
      expect(result.authorized).toBe(true);
      expect(result.response).toBeNull();
      expect(result.user?.id).toBe('usr-admin-1');
      expect(auditCalls).toHaveLength(0);
    });

    it('requireAnyPermission succeeds when user has at least one matching permission', async () => {
      mockSessionUser = {
        id: 'usr-ta-1',
        email: 'ta@iiit.ac.in',
        name: 'Teaching Assistant',
        role: UserRole.TA,
      };
      const result = await requireAnyPermission([
        Permission.MANAGE_USERS,
        Permission.GRADE_SCRIPT,
      ]);
      expect(result.authorized).toBe(true);
      expect(result.response).toBeNull();
    });

    it('requireAnyPermission returns 403 when user possesses none of the permissions', async () => {
      mockSessionUser = {
        id: 'usr-stud-1',
        email: 'student@iiit.ac.in',
        name: 'Student Candidate',
        role: UserRole.STUDENT,
      };
      const result = await requireAnyPermission([
        Permission.CREATE_COURSE,
        Permission.MANAGE_USERS,
      ]);
      expect(result.authorized).toBe(false);
      expect(result.response?.status).toBe(403);
      expect(auditCalls).toHaveLength(1);
      expect(auditCalls[0].action).toBe('AUTHORIZATION_FAILURE');
    });

    it('requireGradingOrAnnotationAccess allows TA, PROFESSOR, and ADMIN, but denies STUDENT', async () => {
      expect(GRADING_OR_CANVAS_PERMISSIONS).toContain(Permission.GRADE_SCRIPT);
      expect(GRADING_OR_CANVAS_PERMISSIONS).toContain(Permission.SAVE_MARKS_FEEDBACK);
      expect(GRADING_OR_CANVAS_PERMISSIONS).toContain(Permission.EDIT_EXAM);
      expect(GRADING_OR_CANVAS_PERMISSIONS).toContain(Permission.VIEW_ALL_SUBMISSIONS);

      // TA check:
      mockSessionUser = {
        id: 'ta-1',
        email: 'ta@iiit.ac.in',
        name: 'TA',
        role: UserRole.TA,
      };
      let res = await requireGradingOrAnnotationAccess();
      expect(res.authorized).toBe(true);

      // Professor check:
      mockSessionUser = {
        id: 'prof-1',
        email: 'prof@iiit.ac.in',
        name: 'Prof',
        role: UserRole.PROFESSOR,
      };
      res = await requireGradingOrAnnotationAccess();
      expect(res.authorized).toBe(true);

      // Admin check:
      mockSessionUser = {
        id: 'admin-1',
        email: 'admin@iiit.ac.in',
        name: 'Admin',
        role: UserRole.ADMIN,
      };
      res = await requireGradingOrAnnotationAccess();
      expect(res.authorized).toBe(true);

      // Student check:
      mockSessionUser = {
        id: 'stud-1',
        email: 'stud@iiit.ac.in',
        name: 'Student',
        role: UserRole.STUDENT,
      };
      res = await requireGradingOrAnnotationAccess();
      expect(res.authorized).toBe(false);
      expect(res.response?.status).toBe(403);
    });
  });

  describe('3. Route-Level Endpoint Authorization Testing', () => {
    let usersGET: any;
    let usersPOST: any;
    let auditVerifyPOST: any;
    let profRegradesGET: any;

    beforeAll(async () => {
      usersGET = (await import('../app/api/users/route')).GET;
      usersPOST = (await import('../app/api/users/route')).POST;
      auditVerifyPOST = (await import('../app/api/audit-logs/verify/route')).POST;
      profRegradesGET = (await import('../app/api/professor/regrade-requests/route')).GET;
    });

    describe('/api/users endpoint authorization', () => {
      it('returns 401 for unauthenticated GET /api/users', async () => {
        mockSessionUser = null;
        const res = await usersGET();
        expect(res.status).toBe(401);
      });

      it('returns 403 for STUDENT and TA on GET /api/users', async () => {
        mockSessionUser = {
          id: 'u-stud',
          email: 's@test.com',
          name: 'Student',
          role: UserRole.STUDENT,
        };
        const resStudent = await usersGET();
        expect(resStudent.status).toBe(403);

        mockSessionUser = {
          id: 'u-ta',
          email: 'ta@test.com',
          name: 'TA',
          role: UserRole.TA,
        };
        const resTA = await usersGET();
        expect(resTA.status).toBe(403);
      });

      it('returns 401 for unauthenticated POST /api/users', async () => {
        mockSessionUser = null;
        const req = new NextRequest('http://localhost:3000/api/users', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const res = await usersPOST(req);
        expect(res.status).toBe(401);
      });

      it('returns 403 for PROFESSOR on POST /api/users (MANAGE_USERS required)', async () => {
        mockSessionUser = {
          id: 'u-prof',
          email: 'prof@test.com',
          name: 'Professor',
          role: UserRole.PROFESSOR,
        };
        const req = new NextRequest('http://localhost:3000/api/users', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        const res = await usersPOST(req);
        expect(res.status).toBe(403);
      });
    });

    describe('/api/audit-logs/verify endpoint authorization (ADMIN only)', () => {
      it('returns 401 when unauthenticated', async () => {
        mockSessionUser = null;
        const res = await auditVerifyPOST();
        expect(res.status).toBe(401);
      });

      it('returns 403 for STUDENT and TA (lacks VIEW_ALL_SUBMISSIONS)', async () => {
        mockSessionUser = {
          id: 'u-ta',
          email: 'ta@test.com',
          name: 'TA',
          role: UserRole.TA,
        };
        const res = await auditVerifyPOST();
        expect(res.status).toBe(403);
      });

      it('returns 403 for PROFESSOR (has VIEW_ALL_SUBMISSIONS but is not ADMIN)', async () => {
        mockSessionUser = {
          id: 'u-prof',
          email: 'prof@test.com',
          name: 'Professor',
          role: UserRole.PROFESSOR,
        };
        const res = await auditVerifyPOST();
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.message).toBe('Forbidden');
      });
    });

    describe('/api/professor/regrade-requests endpoint authorization', () => {
      it('returns 401 when unauthenticated', async () => {
        mockSessionUser = null;
        const req = new NextRequest('http://localhost:3000/api/professor/regrade-requests');
        const res = await profRegradesGET(req);
        expect(res.status).toBe(401);
      });

      it('returns 403 for STUDENT calling professor regrades queue', async () => {
        mockSessionUser = {
          id: 'u-stud',
          email: 's@test.com',
          name: 'Student',
          role: UserRole.STUDENT,
        };
        const req = new NextRequest('http://localhost:3000/api/professor/regrade-requests');
        const res = await profRegradesGET(req);
        expect(res.status).toBe(403);
      });
    });
  });
});
