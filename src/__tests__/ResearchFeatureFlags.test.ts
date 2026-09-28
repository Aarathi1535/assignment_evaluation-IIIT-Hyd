/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { isFeatureEnabled, getFeatureFlags, parseBooleanFlag } from '../config/features';
import { requireFeature } from '../lib/apiAuth';
import { proxyMiddleware } from '../proxy';

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

describe('Research Feature Flags (Classroom Assessment & Personalized Assessment)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockSessionUser = null;
    // Reset env vars to baseline
    delete process.env.FEATURE_CLASSROOM_ASSESSMENT;
    delete process.env.FEATURE_PERSONALIZED_ASSESSMENT;
    delete process.env.NEXT_PUBLIC_FEATURE_CLASSROOM_ASSESSMENT;
    delete process.env.NEXT_PUBLIC_FEATURE_PERSONALIZED_ASSESSMENT;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // 1. Flag Defaults & Environment Variable Parsing
  // =========================================================================
  describe('1. Default Flag Evaluation & Parsing', () => {
    it('defaults both flags to disabled (false) when env vars are unset', () => {
      expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(false);
      expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(false);

      const flags = getFeatureFlags();
      expect(flags).toEqual({
        CLASSROOM_ASSESSMENT: false,
        PERSONALIZED_ASSESSMENT: false,
      });
    });

    it('remains disabled for arbitrary/falsy values', () => {
      const falsyValues = ['false', '0', 'no', 'off', 'undefined', 'null', '', 'random'];
      for (const val of falsyValues) {
        process.env.FEATURE_CLASSROOM_ASSESSMENT = val;
        process.env.FEATURE_PERSONALIZED_ASSESSMENT = val;
        expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(false);
        expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(false);
      }
    });

    it('enables Classroom Assessment via FEATURE_CLASSROOM_ASSESSMENT', () => {
      process.env.FEATURE_CLASSROOM_ASSESSMENT = 'true';
      expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(true);
      expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(false);
    });

    it('enables Classroom Assessment via NEXT_PUBLIC_FEATURE_CLASSROOM_ASSESSMENT', () => {
      process.env.NEXT_PUBLIC_FEATURE_CLASSROOM_ASSESSMENT = 'true';
      expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(true);
      expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(false);
    });

    it('enables Personalized Assessment via FEATURE_PERSONALIZED_ASSESSMENT', () => {
      process.env.FEATURE_PERSONALIZED_ASSESSMENT = 'true';
      expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(true);
      expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(false);
    });

    it('enables Personalized Assessment via NEXT_PUBLIC_FEATURE_PERSONALIZED_ASSESSMENT', () => {
      process.env.NEXT_PUBLIC_FEATURE_PERSONALIZED_ASSESSMENT = 'true';
      expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(true);
      expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(false);
    });

    it('correctly parses case-insensitive truthy boolean strings', () => {
      expect(parseBooleanFlag('TRUE')).toBe(true);
      expect(parseBooleanFlag('True')).toBe(true);
      expect(parseBooleanFlag('1')).toBe(true);
      expect(parseBooleanFlag('yes')).toBe(true);
      expect(parseBooleanFlag('on')).toBe(true);

      expect(parseBooleanFlag('FALSE')).toBe(false);
      expect(parseBooleanFlag('0')).toBe(false);
      expect(parseBooleanFlag(undefined)).toBe(false);
      expect(parseBooleanFlag(null)).toBe(false);
    });
  });

  // =========================================================================
  // 2. requireFeature API Helper
  // =========================================================================
  describe('2. requireFeature Helper Enforcements', () => {
    it('returns status 404 and disabled error message when flag is disabled', async () => {
      const classroomCheck = requireFeature('CLASSROOM_ASSESSMENT');
      expect(classroomCheck.authorized).toBe(false);
      expect(classroomCheck.response).not.toBeNull();
      expect(classroomCheck.response!.status).toBe(404);

      const classroomBody = await classroomCheck.response!.json();
      expect(classroomBody).toEqual({
        success: false,
        message: 'Classroom assessment feature is disabled',
        data: null,
      });

      const personalizedCheck = requireFeature('PERSONALIZED_ASSESSMENT');
      expect(personalizedCheck.authorized).toBe(false);
      expect(personalizedCheck.response).not.toBeNull();
      expect(personalizedCheck.response!.status).toBe(404);

      const personalizedBody = await personalizedCheck.response!.json();
      expect(personalizedBody).toEqual({
        success: false,
        message: 'Personalized assessment feature is disabled',
        data: null,
      });
    });

    it('returns authorized true with null response when flag is enabled', () => {
      process.env.FEATURE_CLASSROOM_ASSESSMENT = 'true';
      process.env.FEATURE_PERSONALIZED_ASSESSMENT = 'true';

      const classroomCheck = requireFeature('CLASSROOM_ASSESSMENT');
      expect(classroomCheck.authorized).toBe(true);
      expect(classroomCheck.response).toBeNull();

      const personalizedCheck = requireFeature('PERSONALIZED_ASSESSMENT');
      expect(personalizedCheck.authorized).toBe(true);
      expect(personalizedCheck.response).toBeNull();
    });
  });

  // =========================================================================
  // 3. Server API Routes Feature-Flag Enforcement
  // =========================================================================
  describe('3. Server API Routes Route Protection', () => {
    let questionsGET: any;
    let questionsPOST: any;
    let activeQuestionGET: any;
    let questionDetailGET: any;
    let questionDetailPATCH: any;
    let submissionsGET: any;
    let submissionDetailGET: any;
    let questionSubmissionsGET: any;
    let submitPOST: any;
    let imageGET: any;

    beforeEach(async () => {
      questionsGET = (await import('../app/api/classroom/questions/route')).GET;
      questionsPOST = (await import('../app/api/classroom/questions/route')).POST;
      activeQuestionGET = (await import('../app/api/classroom/questions/active/route')).GET;
      questionDetailGET = (await import('../app/api/classroom/questions/[id]/route')).GET;
      questionDetailPATCH = (await import('../app/api/classroom/questions/[id]/route')).PATCH;
      submissionsGET = (await import('../app/api/classroom/submissions/route')).GET;
      submissionDetailGET = (await import('../app/api/classroom/submissions/[id]/route')).GET;
      questionSubmissionsGET = (await import('../app/api/classroom/questions/[id]/submissions/route')).GET;
      submitPOST = (await import('../app/api/classroom/submit/route')).POST;
      imageGET = (await import('../app/api/classroom/image/route')).GET;
    });

    it('returns 404 for all classroom API routes when flag is disabled (default)', async () => {
      delete process.env.FEATURE_CLASSROOM_ASSESSMENT;
      delete process.env.NEXT_PUBLIC_FEATURE_CLASSROOM_ASSESSMENT;

      const dummyReq = new NextRequest('http://localhost:3000/api/classroom/questions');
      const dummyParams = { params: Promise.resolve({ id: 'dummy-id' }) };

      const resList = await Promise.all([
        questionsGET(),
        questionsPOST(dummyReq),
        activeQuestionGET(),
        questionDetailGET(dummyReq, dummyParams),
        questionDetailPATCH(dummyReq, dummyParams),
        submissionsGET(dummyReq),
        submissionDetailGET(dummyReq, dummyParams),
        questionSubmissionsGET(dummyReq, dummyParams),
        submitPOST(dummyReq),
        imageGET(dummyReq),
      ]);

      for (const res of resList) {
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.message).toBe('Classroom assessment feature is disabled');
      }
    });

    it('passes past feature check to authentication/business logic when flag is enabled', async () => {
      process.env.FEATURE_CLASSROOM_ASSESSMENT = 'true';
      mockSessionUser = null; // Unauthenticated

      // Calling unauthenticated should now return 401 Unauthorized instead of 404 Feature Disabled
      const res = await questionsGET();
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });
  });

  // =========================================================================
  // 4. Middleware Route & API Protection (proxy.ts)
  // =========================================================================
  describe('4. Middleware Route Protection in proxy.ts', () => {
    it('blocks /api/classroom endpoints with status 404 when disabled', async () => {
      delete process.env.FEATURE_CLASSROOM_ASSESSMENT;

      const req: any = {
        nextUrl: { pathname: '/api/classroom/questions' },
        nextauth: { token: { role: 'PROFESSOR' } },
        url: 'http://localhost:3000/api/classroom/questions',
      };

      const res = proxyMiddleware(req);
      expect(res).toBeDefined();
      expect(res!.status).toBe(404);
      const body = await res!.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('Classroom assessment feature is disabled');
    });

    it('blocks /api/personalized endpoints with status 404 when disabled', async () => {
      delete process.env.FEATURE_PERSONALIZED_ASSESSMENT;

      const req: any = {
        nextUrl: { pathname: '/api/personalized/today' },
        nextauth: { token: { role: 'STUDENT' } },
        url: 'http://localhost:3000/api/personalized/today',
      };

      const res = proxyMiddleware(req);
      expect(res).toBeDefined();
      expect(res!.status).toBe(404);
      const body = await res!.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('Personalized assessment feature is disabled');
    });

    it('redirects dashboard page /professor/classroom to dashboard when flag is disabled', async () => {
      delete process.env.FEATURE_CLASSROOM_ASSESSMENT;

      const req: any = {
        nextUrl: { pathname: '/professor/classroom' },
        nextauth: { token: { role: 'PROFESSOR' } },
        url: 'http://localhost:3000/professor/classroom',
      };

      const res = proxyMiddleware(req);
      expect(res).toBeDefined();
      // Next.js redirect returns status 307
      expect(res!.status).toBe(307);
      expect(res!.headers.get('location')).toBe('http://localhost:3000/professor');
    });

    it('redirects student page /student/classroom to dashboard when flag is disabled', async () => {
      delete process.env.FEATURE_CLASSROOM_ASSESSMENT;

      const req: any = {
        nextUrl: { pathname: '/student/classroom' },
        nextauth: { token: { role: 'STUDENT' } },
        url: 'http://localhost:3000/student/classroom',
      };

      const res = proxyMiddleware(req);
      expect(res).toBeDefined();
      expect(res!.status).toBe(307);
      expect(res!.headers.get('location')).toBe('http://localhost:3000/student');
    });

    it('redirects /professor/personalized to dashboard when flag is disabled', async () => {
      delete process.env.FEATURE_PERSONALIZED_ASSESSMENT;

      const req: any = {
        nextUrl: { pathname: '/professor/personalized' },
        nextauth: { token: { role: 'PROFESSOR' } },
        url: 'http://localhost:3000/professor/personalized',
      };

      const res = proxyMiddleware(req);
      expect(res).toBeDefined();
      expect(res!.status).toBe(307);
      expect(res!.headers.get('location')).toBe('http://localhost:3000/professor');
    });

    it('redirects /student/personalized to dashboard when flag is disabled', async () => {
      delete process.env.FEATURE_PERSONALIZED_ASSESSMENT;

      const req: any = {
        nextUrl: { pathname: '/student/personalized' },
        nextauth: { token: { role: 'STUDENT' } },
        url: 'http://localhost:3000/student/personalized',
      };

      const res = proxyMiddleware(req);
      expect(res).toBeDefined();
      expect(res!.status).toBe(307);
      expect(res!.headers.get('location')).toBe('http://localhost:3000/student');
    });
  });

  // =========================================================================
  // 5. Navigation Menu Filtering Behavior
  // =========================================================================
  describe('5. Navigation Menu Items Resolution', () => {
    // Helper to simulate the exact navigation builder in layout.tsx
    const buildNavForRole = (role: string) => {
      const isClassroom = isFeatureEnabled('CLASSROOM_ASSESSMENT');
      const isPersonalized = isFeatureEnabled('PERSONALIZED_ASSESSMENT');

      const admin = [
        { label: 'Dashboard', href: '/admin' },
        { label: 'Users', href: '/admin/users' },
      ];
      if (isClassroom) admin.push({ label: 'Classroom Assessment', href: '/professor/classroom' });

      const professor = [
        { label: 'Dashboard', href: '/professor' },
        { label: 'Courses', href: '/professor/courses' },
        { label: 'Exams', href: '/professor/exams' },
      ];
      if (isClassroom) professor.push({ label: 'Classroom Assessment', href: '/professor/classroom' });
      if (isPersonalized) professor.push({ label: 'Personalized Assessment', href: '/professor/personalized' });
      professor.push(
        { label: 'Flag Review Queue', href: '/professor/flags' },
        { label: 'Create Course', href: '/professor/courses/create' },
        { label: 'Create Exam', href: '/professor/exams/create' }
      );

      const ta = [{ label: 'Dashboard', href: '/ta' }];

      const student = [{ label: 'Dashboard', href: '/student' }];
      if (isClassroom) student.push({ label: 'Classroom Assessment', href: '/student/classroom' });
      if (isPersonalized) student.push({ label: 'Daily Assessment', href: '/student/personalized' });

      const map: Record<string, any[]> = { ADMIN: admin, PROFESSOR: professor, TA: ta, STUDENT: student };
      return map[role] || student;
    };

    it('hides Classroom and Personalized Assessment from all navigation menus when disabled (default)', () => {
      for (const role of ['ADMIN', 'PROFESSOR', 'TA', 'STUDENT']) {
        const items = buildNavForRole(role);
        const labels = items.map((i) => i.label);
        expect(labels).not.toContain('Classroom Assessment');
        expect(labels).not.toContain('Personalized Assessment');
        expect(labels).not.toContain('Daily Assessment');
      }
    });

    it('shows Classroom Assessment only when enabled', () => {
      process.env.FEATURE_CLASSROOM_ASSESSMENT = 'true';

      const adminItems = buildNavForRole('ADMIN').map((i) => i.label);
      expect(adminItems).toContain('Classroom Assessment');

      const profItems = buildNavForRole('PROFESSOR').map((i) => i.label);
      expect(profItems).toContain('Classroom Assessment');
      expect(profItems).not.toContain('Personalized Assessment');

      const studentItems = buildNavForRole('STUDENT').map((i) => i.label);
      expect(studentItems).toContain('Classroom Assessment');
      expect(studentItems).not.toContain('Daily Assessment');
    });

    it('shows Personalized Assessment only when enabled', () => {
      process.env.FEATURE_PERSONALIZED_ASSESSMENT = 'true';

      const profItems = buildNavForRole('PROFESSOR').map((i) => i.label);
      expect(profItems).toContain('Personalized Assessment');
      expect(profItems).not.toContain('Classroom Assessment');

      const studentItems = buildNavForRole('STUDENT').map((i) => i.label);
      expect(studentItems).toContain('Daily Assessment');
      expect(studentItems).not.toContain('Classroom Assessment');

      const adminItems = buildNavForRole('ADMIN').map((i) => i.label);
      expect(adminItems).not.toContain('Classroom Assessment');
    });

    it('shows both features when both are explicitly enabled', () => {
      process.env.FEATURE_CLASSROOM_ASSESSMENT = 'true';
      process.env.FEATURE_PERSONALIZED_ASSESSMENT = 'true';

      const profItems = buildNavForRole('PROFESSOR').map((i) => i.label);
      expect(profItems).toContain('Classroom Assessment');
      expect(profItems).toContain('Personalized Assessment');

      const studentItems = buildNavForRole('STUDENT').map((i) => i.label);
      expect(studentItems).toContain('Classroom Assessment');
      expect(studentItems).toContain('Daily Assessment');
    });
  });
});
