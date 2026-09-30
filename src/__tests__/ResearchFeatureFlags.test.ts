/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { isFeatureEnabled, getFeatureFlags, parseBooleanFlag } from '../config/features';
import { requireFeature } from '../lib/apiAuth';

vi.mock('next-auth/middleware', () => ({
  withAuth: (middlewareFn: any) => middlewareFn,
}));

import proxy from '../proxy';

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

describe('Research Feature Flags (Handwriting Consistency + Shared Research Flags)', () => {
  const originalEnv = { ...process.env };

  let consentGET: any;
  let consentPOST: any;
  let evaluationGET: any;
  let evaluationPOST: any;

  beforeAll(async () => {
    const consentModule = await import('../app/api/research/handwriting/consent/route');
    consentGET = consentModule.GET;
    consentPOST = consentModule.POST;

    const evaluationModule = await import('../app/api/research/handwriting/evaluation/route');
    evaluationGET = evaluationModule.GET;
    evaluationPOST = evaluationModule.POST;
  });

  beforeEach(() => {
    mockSessionUser = null;
    delete process.env.FEATURE_CLASSROOM_ASSESSMENT;
    delete process.env.FEATURE_PERSONALIZED_ASSESSMENT;
    delete process.env.FEATURE_ANSWER_SEGMENTATION;
    delete process.env.FEATURE_HANDWRITING_CONSISTENCY;
    delete process.env.NEXT_PUBLIC_FEATURE_CLASSROOM_ASSESSMENT;
    delete process.env.NEXT_PUBLIC_FEATURE_PERSONALIZED_ASSESSMENT;
    delete process.env.NEXT_PUBLIC_FEATURE_ANSWER_SEGMENTATION;
    delete process.env.NEXT_PUBLIC_FEATURE_HANDWRITING_CONSISTENCY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // 1. Flag Defaults & Environment Variable Parsing
  // =========================================================================
  describe('1. Default Flag Evaluation & Parsing', () => {
    it('defaults all research flags including HANDWRITING_CONSISTENCY to disabled (false) when env vars are unset', () => {
      expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(false);
      expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(false);
      expect(isFeatureEnabled('ANSWER_SEGMENTATION')).toBe(false);
      expect(isFeatureEnabled('HANDWRITING_CONSISTENCY')).toBe(false);

      const flags = getFeatureFlags();
      expect(flags).toEqual({
        CLASSROOM_ASSESSMENT: false,
        PERSONALIZED_ASSESSMENT: false,
        ANSWER_SEGMENTATION: false,
        HANDWRITING_CONSISTENCY: false,
      });
    });

    it('remains disabled for arbitrary/falsy values', () => {
      const falsyValues = ['false', '0', 'no', 'off', 'undefined', 'null', '', 'random'];
      for (const val of falsyValues) {
        process.env.FEATURE_HANDWRITING_CONSISTENCY = val;
        process.env.FEATURE_CLASSROOM_ASSESSMENT = val;
        process.env.FEATURE_PERSONALIZED_ASSESSMENT = val;
        process.env.FEATURE_ANSWER_SEGMENTATION = val;

        expect(isFeatureEnabled('HANDWRITING_CONSISTENCY')).toBe(false);
        expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(false);
        expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(false);
        expect(isFeatureEnabled('ANSWER_SEGMENTATION')).toBe(false);
      }
    });

    it('enables Handwriting Consistency via FEATURE_HANDWRITING_CONSISTENCY', () => {
      process.env.FEATURE_HANDWRITING_CONSISTENCY = 'true';
      expect(isFeatureEnabled('HANDWRITING_CONSISTENCY')).toBe(true);
      expect(isFeatureEnabled('CLASSROOM_ASSESSMENT')).toBe(false);
      expect(isFeatureEnabled('PERSONALIZED_ASSESSMENT')).toBe(false);
      expect(isFeatureEnabled('ANSWER_SEGMENTATION')).toBe(false);
    });

    it('enables Handwriting Consistency via NEXT_PUBLIC_FEATURE_HANDWRITING_CONSISTENCY', () => {
      process.env.NEXT_PUBLIC_FEATURE_HANDWRITING_CONSISTENCY = 'true';
      expect(isFeatureEnabled('HANDWRITING_CONSISTENCY')).toBe(true);
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
      expect(parseBooleanFlag('')).toBe(false);
    });
  });

  // =========================================================================
  // 2. requireFeature Guard Helper
  // =========================================================================
  describe('2. requireFeature Helper Function', () => {
    it('returns status 404 with exact json structure when flag is disabled', async () => {
      delete process.env.FEATURE_HANDWRITING_CONSISTENCY;

      const guard = requireFeature('HANDWRITING_CONSISTENCY');
      expect(guard.authorized).toBe(false);
      expect(guard.response).toBeDefined();
      expect(guard.response!.status).toBe(404);

      const body = await guard.response!.json();
      expect(body).toEqual({
        success: false,
        message: 'Handwriting consistency feature is disabled',
        data: null,
      });
    });

    it('returns authorized true with null response when flag is enabled', () => {
      process.env.FEATURE_HANDWRITING_CONSISTENCY = 'true';

      const guard = requireFeature('HANDWRITING_CONSISTENCY');
      expect(guard.authorized).toBe(true);
      expect(guard.response).toBeNull();
    });
  });

  // =========================================================================
  // 3. API Route Protection (consent and evaluation)
  // =========================================================================
  describe('3. In-Route API Handlers Protection', () => {
    it('returns 404 for consent API GET and POST when flag is disabled (default)', async () => {
      delete process.env.FEATURE_HANDWRITING_CONSISTENCY;
      delete process.env.NEXT_PUBLIC_FEATURE_HANDWRITING_CONSISTENCY;

      const dummyGetReq = new NextRequest('http://localhost:3000/api/research/handwriting/consent');
      const dummyPostReq = new NextRequest('http://localhost:3000/api/research/handwriting/consent', {
        method: 'POST',
        body: JSON.stringify({ hasConsented: true }),
      });

      const getRes = await consentGET(dummyGetReq);
      expect(getRes.status).toBe(404);
      const getData = await getRes.json();
      expect(getData.success).toBe(false);
      expect(getData.message).toBe('Handwriting consistency feature is disabled');

      const postRes = await consentPOST(dummyPostReq);
      expect(postRes.status).toBe(404);
      const postData = await postRes.json();
      expect(postData.success).toBe(false);
      expect(postData.message).toBe('Handwriting consistency feature is disabled');
    });

    it('returns 404 for evaluation API GET and POST when flag is disabled (default)', async () => {
      delete process.env.FEATURE_HANDWRITING_CONSISTENCY;
      delete process.env.NEXT_PUBLIC_FEATURE_HANDWRITING_CONSISTENCY;

      const dummyGetReq = new NextRequest('http://localhost:3000/api/research/handwriting/evaluation');
      const dummyPostReq = new NextRequest('http://localhost:3000/api/research/handwriting/evaluation', {
        method: 'POST',
        body: JSON.stringify({ studentIds: [] }),
      });

      const getRes = await evaluationGET(dummyGetReq);
      expect(getRes.status).toBe(404);
      const getData = await getRes.json();
      expect(getData.success).toBe(false);
      expect(getData.message).toBe('Handwriting consistency feature is disabled');

      const postRes = await evaluationPOST(dummyPostReq);
      expect(postRes.status).toBe(404);
      const postData = await postRes.json();
      expect(postData.success).toBe(false);
      expect(postData.message).toBe('Handwriting consistency feature is disabled');
    });

    it('passes past feature check to authentication when flag is enabled', async () => {
      process.env.FEATURE_HANDWRITING_CONSISTENCY = 'true';
      mockSessionUser = null;

      const dummyReq = new NextRequest('http://localhost:3000/api/research/handwriting/consent');
      const res = await consentGET(dummyReq);
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
    it('blocks /api/research/handwriting endpoints with status 404 when disabled', async () => {
      delete process.env.FEATURE_HANDWRITING_CONSISTENCY;

      const req: any = {
        nextUrl: { pathname: '/api/research/handwriting/consent' },
        nextauth: { token: { role: 'ADMIN' } },
        url: 'http://localhost:3000/api/research/handwriting/consent',
      };

      const res: any = (proxy as any)(req);
      expect(res).toBeDefined();
      expect(res!.status).toBe(404);
      const body = await res!.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('Handwriting consistency feature is disabled');
    });

    it('redirects /admin/research/handwriting page to /admin when disabled', async () => {
      delete process.env.FEATURE_HANDWRITING_CONSISTENCY;

      const adminReq: any = {
        nextUrl: { pathname: '/admin/research/handwriting' },
        nextauth: { token: { role: 'ADMIN' } },
        url: 'http://localhost:3000/admin/research/handwriting',
      };
      const adminRes: any = (proxy as any)(adminReq);
      expect(adminRes).toBeDefined();
      expect(adminRes!.status).toBe(307);
      expect(adminRes!.headers.get('location')).toBe('http://localhost:3000/admin');
    });

    it('allows /api/research/handwriting through feature gate when enabled (auth still checked by middleware)', () => {
      process.env.FEATURE_HANDWRITING_CONSISTENCY = 'true';

      const unauthenticatedReq: any = {
        nextUrl: { pathname: '/api/research/handwriting/evaluation' },
        nextauth: { token: null },
        url: 'http://localhost:3000/api/research/handwriting/evaluation',
      };

      const res: any = (proxy as any)(unauthenticatedReq);
      expect(res).toBeDefined();
      expect(res!.status).toBe(401);
    });
  });

  // =========================================================================
  // 5. Navigation Menu Filtering
  // =========================================================================
  describe('5. Navigation Menu Items Resolution', () => {
    const buildNavForRole = (role: string) => {
      const isHandwritingConsistencyEnabled = isFeatureEnabled('HANDWRITING_CONSISTENCY');

      const adminNavItems = [
        { label: 'Dashboard', href: '/admin' },
        { label: 'Users', href: '/admin/users' },
      ];
      if (isHandwritingConsistencyEnabled) {
        adminNavItems.push({
          label: 'Handwriting Consistency',
          href: '/admin/research/handwriting',
        });
      }

      const professorNavItems = [
        { label: 'Dashboard', href: '/professor' },
        { label: 'Courses', href: '/professor/courses' },
        { label: 'Exams', href: '/professor/exams' },
        { label: 'Flag Review Queue', href: '/professor/flags' },
        { label: 'Create Course', href: '/professor/courses/create' },
        { label: 'Create Exam', href: '/professor/exams/create' },
      ];

      const taNavItems = [{ label: 'Dashboard', href: '/ta' }];
      const studentNavItems = [{ label: 'Dashboard', href: '/student' }];

      const map: Record<string, any[]> = {
        ADMIN: adminNavItems,
        PROFESSOR: professorNavItems,
        TA: taNavItems,
        STUDENT: studentNavItems,
      };
      return map[role] || studentNavItems;
    };

    it('hides Handwriting Consistency from all navigation menus when disabled (default)', () => {
      for (const role of ['ADMIN', 'PROFESSOR', 'TA', 'STUDENT']) {
        const labels = buildNavForRole(role).map((i) => i.label);
        expect(labels).not.toContain('Handwriting Consistency');
      }
    });

    it('shows Handwriting Consistency for Admin only when enabled', () => {
      process.env.FEATURE_HANDWRITING_CONSISTENCY = 'true';

      const adminItems = buildNavForRole('ADMIN');
      const adminLabels = adminItems.map((i) => i.label);
      expect(adminLabels).toContain('Handwriting Consistency');
      expect(adminItems.find((i) => i.label === 'Handwriting Consistency')?.href).toBe(
        '/admin/research/handwriting'
      );

      const profLabels = buildNavForRole('PROFESSOR').map((i) => i.label);
      expect(profLabels).not.toContain('Handwriting Consistency');

      const taLabels = buildNavForRole('TA').map((i) => i.label);
      expect(taLabels).not.toContain('Handwriting Consistency');

      const studentLabels = buildNavForRole('STUDENT').map((i) => i.label);
      expect(studentLabels).not.toContain('Handwriting Consistency');
    });
  });
});
