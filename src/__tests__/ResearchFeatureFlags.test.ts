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

describe('Research Feature Flags (Answer Segmentation + Shared Research Flags)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockSessionUser = null;
    delete process.env.FEATURE_CLASSROOM_ASSESSMENT;
    delete process.env.FEATURE_PERSONALIZED_ASSESSMENT;
    delete process.env.FEATURE_ANSWER_SEGMENTATION;
    delete process.env.NEXT_PUBLIC_FEATURE_CLASSROOM_ASSESSMENT;
    delete process.env.NEXT_PUBLIC_FEATURE_PERSONALIZED_ASSESSMENT;
    delete process.env.NEXT_PUBLIC_FEATURE_ANSWER_SEGMENTATION;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // 1. Flag Defaults & Environment Variable Parsing
  // =========================================================================
  describe('1. Default Flag Evaluation & Parsing', () => {
    it('defaults all research flags to disabled (false) when env vars are unset', () => {
      expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(false);
      expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(false);
      expect(isFeatureEnabled('ANSWER_SEGMENTATION')).toBe(false);

      const flags = getFeatureFlags();
      expect(flags).toEqual({
        CLASSROOM_ASSESSMENT: false,
        PERSONALIZED_ASSESSMENT: false,
        ANSWER_SEGMENTATION: false,
      });
    });

    it('remains disabled for arbitrary/falsy values', () => {
      const falsyValues = ['false', '0', 'no', 'off', 'undefined', 'null', '', 'random'];
      for (const val of falsyValues) {
        process.env.FEATURE_ANSWER_SEGMENTATION = val;
        process.env.FEATURE_CLASSROOM_ASSESSMENT = val;
        process.env.FEATURE_PERSONALIZED_ASSESSMENT = val;
        expect(isFeatureEnabled('ANSWER_SEGMENTATION')).toBe(false);
        expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(false);
        expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(false);
      }
    });

    it('enables Answer Segmentation via FEATURE_ANSWER_SEGMENTATION', () => {
      process.env.FEATURE_ANSWER_SEGMENTATION = 'true';
      expect(isFeatureEnabled('ANSWER_SEGMENTATION')).toBe(true);
      expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(false);
      expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(false);
    });

    it('enables Answer Segmentation via NEXT_PUBLIC_FEATURE_ANSWER_SEGMENTATION', () => {
      process.env.NEXT_PUBLIC_FEATURE_ANSWER_SEGMENTATION = 'true';
      expect(isFeatureEnabled('ANSWER_SEGMENTATION')).toBe(true);
      expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(false);
    });

    it('preserves Classroom and Personalized flag env parsing', () => {
      process.env.FEATURE_CLASSROOM_ASSESSMENT = 'true';
      expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(true);
      expect(isFeatureEnabled('ANSWER_SEGMENTATION')).toBe(false);

      delete process.env.FEATURE_CLASSROOM_ASSESSMENT;
      process.env.FEATURE_PERSONALIZED_ASSESSMENT = 'true';
      expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(true);
      expect(isFeatureEnabled('ANSWER_SEGMENTATION')).toBe(false);
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
  // 2. requireFeature Helper
  // =========================================================================
  describe('2. requireFeature Helper Enforcements', () => {
    it('returns status 404 and disabled error message when ANSWER_SEGMENTATION is disabled', async () => {
      const check = requireFeature('ANSWER_SEGMENTATION');
      expect(check.authorized).toBe(false);
      expect(check.response).not.toBeNull();
      expect(check.response!.status).toBe(404);

      const body = await check.response!.json();
      expect(body).toEqual({
        success: false,
        message: 'Answer segmentation feature is disabled',
        data: null,
      });
    });

    it('returns authorized true with null response when ANSWER_SEGMENTATION is enabled', () => {
      process.env.FEATURE_ANSWER_SEGMENTATION = 'true';

      const check = requireFeature('ANSWER_SEGMENTATION');
      expect(check.authorized).toBe(true);
      expect(check.response).toBeNull();
    });

    it('preserves Classroom and Personalized requireFeature messages', async () => {
      const classroomCheck = requireFeature('CLASSROOM_ASSESSMENT');
      expect(classroomCheck.authorized).toBe(false);
      expect((await classroomCheck.response!.json()).message).toBe(
        'Classroom assessment feature is disabled'
      );

      const personalizedCheck = requireFeature('PERSONALIZED_ASSESSMENT');
      expect(personalizedCheck.authorized).toBe(false);
      expect((await personalizedCheck.response!.json()).message).toBe(
        'Personalized assessment feature is disabled'
      );
    });
  });

  // =========================================================================
  // 3. Segmentation API Route Protection
  // =========================================================================
  describe('3. Segmentation API Route Feature-Flag Enforcement', () => {
    let scriptGET: any;
    let scriptPOST: any;
    let regionsGET: any;
    let regionsPOST: any;
    let regionPUT: any;
    let regionDELETE: any;
    let questionGET: any;
    let questionPATCH: any;
    let questionPUT: any;

    beforeEach(async () => {
      scriptGET = (await import('../app/api/research/segmentation/[scriptId]/route')).GET;
      scriptPOST = (await import('../app/api/research/segmentation/[scriptId]/route')).POST;
      regionsGET = (await import('../app/api/research/segmentation/[scriptId]/regions/route')).GET;
      regionsPOST = (await import('../app/api/research/segmentation/[scriptId]/regions/route')).POST;
      regionPUT = (await import('../app/api/research/segmentation/[scriptId]/regions/[regionId]/route')).PUT;
      regionDELETE = (await import('../app/api/research/segmentation/[scriptId]/regions/[regionId]/route')).DELETE;
      questionGET = (await import('../app/api/research/segmentation/[scriptId]/question/[questionNumber]/route')).GET;
      questionPATCH = (await import('../app/api/research/segmentation/[scriptId]/question/[questionNumber]/route')).PATCH;
      questionPUT = (await import('../app/api/research/segmentation/[scriptId]/question/[questionNumber]/route')).PUT;
    });

    it('returns 404 for all segmentation API routes when flag is disabled (default)', async () => {
      delete process.env.FEATURE_ANSWER_SEGMENTATION;
      delete process.env.NEXT_PUBLIC_FEATURE_ANSWER_SEGMENTATION;

      const dummyReq = new NextRequest('http://localhost:3000/api/research/segmentation/dummy/regions');
      const scriptParams = { params: Promise.resolve({ scriptId: '507f1f77bcf86cd799439011' }) };
      const regionParams = {
        params: Promise.resolve({
          scriptId: '507f1f77bcf86cd799439011',
          regionId: '507f1f77bcf86cd799439012',
        }),
      };
      const questionParams = {
        params: Promise.resolve({
          scriptId: '507f1f77bcf86cd799439011',
          questionNumber: '1',
        }),
      };

      const resList = await Promise.all([
        scriptGET(dummyReq, scriptParams),
        scriptPOST(dummyReq, scriptParams),
        regionsGET(dummyReq, scriptParams),
        regionsPOST(dummyReq, scriptParams),
        regionPUT(dummyReq, regionParams),
        regionDELETE(dummyReq, regionParams),
        questionGET(dummyReq, questionParams),
        questionPATCH(dummyReq, questionParams),
        questionPUT(dummyReq, questionParams),
      ]);

      for (const res of resList) {
        expect(res.status).toBe(404);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.message).toBe('Answer segmentation feature is disabled');
      }
    });

    it('passes past feature check to authentication when flag is enabled', async () => {
      process.env.FEATURE_ANSWER_SEGMENTATION = 'true';
      mockSessionUser = null;

      const dummyReq = new NextRequest('http://localhost:3000/api/research/segmentation/dummy');
      const scriptParams = { params: Promise.resolve({ scriptId: '507f1f77bcf86cd799439011' }) };

      const res = await scriptGET(dummyReq, scriptParams);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });
  });

  // =========================================================================
  // 4. Middleware / Proxy Protection
  // =========================================================================
  describe('4. Middleware Route Protection in proxy.ts', () => {
    it('blocks /api/research/segmentation endpoints with status 404 when disabled', async () => {
      delete process.env.FEATURE_ANSWER_SEGMENTATION;

      const req: any = {
        nextUrl: { pathname: '/api/research/segmentation/abc123/regions' },
        nextauth: { token: { role: 'PROFESSOR' } },
        url: 'http://localhost:3000/api/research/segmentation/abc123/regions',
      };

      const res = proxyMiddleware(req);
      expect(res).toBeDefined();
      expect(res!.status).toBe(404);
      const body = await res!.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('Answer segmentation feature is disabled');
    });

    it('redirects /research/segmentation page to role dashboard when disabled', async () => {
      delete process.env.FEATURE_ANSWER_SEGMENTATION;

      const professorReq: any = {
        nextUrl: { pathname: '/research/segmentation' },
        nextauth: { token: { role: 'PROFESSOR' } },
        url: 'http://localhost:3000/research/segmentation',
      };
      const professorRes = proxyMiddleware(professorReq);
      expect(professorRes).toBeDefined();
      expect(professorRes!.status).toBe(307);
      expect(professorRes!.headers.get('location')).toBe('http://localhost:3000/professor');

      const taReq: any = {
        nextUrl: { pathname: '/research/segmentation' },
        nextauth: { token: { role: 'TA' } },
        url: 'http://localhost:3000/research/segmentation',
      };
      const taRes = proxyMiddleware(taReq);
      expect(taRes).toBeDefined();
      expect(taRes!.status).toBe(307);
      expect(taRes!.headers.get('location')).toBe('http://localhost:3000/ta');
    });

    it('preserves Classroom and Personalized API proxy 404 behavior', async () => {
      delete process.env.FEATURE_CLASSROOM_ASSESSMENT;
      delete process.env.FEATURE_PERSONALIZED_ASSESSMENT;

      const classroomRes = proxyMiddleware({
        nextUrl: { pathname: '/api/classroom/questions' },
        nextauth: { token: { role: 'PROFESSOR' } },
        url: 'http://localhost:3000/api/classroom/questions',
      } as any);
      expect(classroomRes!.status).toBe(404);

      const personalizedRes = proxyMiddleware({
        nextUrl: { pathname: '/api/personalized/today' },
        nextauth: { token: { role: 'STUDENT' } },
        url: 'http://localhost:3000/api/personalized/today',
      } as any);
      expect(personalizedRes!.status).toBe(404);
    });

    it('allows /api/research/segmentation through feature gate when enabled (auth still required)', () => {
      process.env.FEATURE_ANSWER_SEGMENTATION = 'true';

      const req: any = {
        nextUrl: { pathname: '/api/research/segmentation/abc123' },
        nextauth: { token: null },
        url: 'http://localhost:3000/api/research/segmentation/abc123',
      };

      const res = proxyMiddleware(req);
      expect(res).toBeDefined();
      expect(res!.status).toBe(401);
    });
  });

  // =========================================================================
  // 5. Navigation Menu Filtering
  // =========================================================================
  describe('5. Navigation Menu Items Resolution', () => {
    const buildNavForRole = (role: string) => {
      const isAnswerSegmentationEnabled = isFeatureEnabled('ANSWER_SEGMENTATION');

      const professor = [
        { label: 'Dashboard', href: '/professor' },
        { label: 'Courses', href: '/professor/courses' },
        { label: 'Exams', href: '/professor/exams' },
      ];
      if (isAnswerSegmentationEnabled) {
        professor.push({ label: 'Answer Segmentation', href: '/research/segmentation' });
      }
      professor.push(
        { label: 'Flag Review Queue', href: '/professor/flags' },
        { label: 'Create Course', href: '/professor/courses/create' },
        { label: 'Create Exam', href: '/professor/exams/create' }
      );

      const ta = [{ label: 'Dashboard', href: '/ta' }];
      if (isAnswerSegmentationEnabled) {
        ta.push({ label: 'Answer Segmentation', href: '/research/segmentation' });
      }

      const admin = [
        { label: 'Dashboard', href: '/admin' },
        { label: 'Users', href: '/admin/users' },
      ];

      const student = [{ label: 'Dashboard', href: '/student' }];

      const map: Record<string, any[]> = { ADMIN: admin, PROFESSOR: professor, TA: ta, STUDENT: student };
      return map[role] || student;
    };

    it('hides Answer Segmentation from all navigation menus when disabled (default)', () => {
      for (const role of ['ADMIN', 'PROFESSOR', 'TA', 'STUDENT']) {
        const labels = buildNavForRole(role).map((i) => i.label);
        expect(labels).not.toContain('Answer Segmentation');
      }
    });

    it('shows Answer Segmentation for Professor and TA only when enabled', () => {
      process.env.FEATURE_ANSWER_SEGMENTATION = 'true';

      const profLabels = buildNavForRole('PROFESSOR').map((i) => i.label);
      expect(profLabels).toContain('Answer Segmentation');
      expect(buildNavForRole('PROFESSOR').find((i) => i.label === 'Answer Segmentation')?.href).toBe(
        '/research/segmentation'
      );

      const taLabels = buildNavForRole('TA').map((i) => i.label);
      expect(taLabels).toContain('Answer Segmentation');

      const adminLabels = buildNavForRole('ADMIN').map((i) => i.label);
      expect(adminLabels).not.toContain('Answer Segmentation');

      const studentLabels = buildNavForRole('STUDENT').map((i) => i.label);
      expect(studentLabels).not.toContain('Answer Segmentation');
    });
  });
});
