/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { proxyMiddleware, isLearningRoute, proxyAuthOptions } from '../proxy';

function createMockRequest(pathname: string, token: any = null) {
  const url = `http://localhost:3000${pathname}`;
  return {
    url,
    nextUrl: new URL(url),
    nextauth: { token },
  } as any;
}

describe('LRN-02: Proxy Security Guard & Route Protection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.FEATURE_LEARNING_MODULE;
    delete process.env.NEXT_PUBLIC_FEATURE_LEARNING_MODULE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('1. Route Pattern Matching with isLearningRoute()', () => {
    it('matches exact learning route endpoints and subpaths across all three route families', () => {
      // 1. /api/learning/*
      expect(isLearningRoute('/api/learning')).toBe(true);
      expect(isLearningRoute('/api/learning/')).toBe(true);
      expect(isLearningRoute('/api/learning/questions')).toBe(true);
      expect(isLearningRoute('/api/learning/assessment/submit')).toBe(true);

      // 2. /professor/learning*
      expect(isLearningRoute('/professor/learning')).toBe(true);
      expect(isLearningRoute('/professor/learning/')).toBe(true);
      expect(isLearningRoute('/professor/learning/dashboard')).toBe(true);
      expect(isLearningRoute('/professor/learning/taxonomy/edit')).toBe(true);

      // 3. /student/learning*
      expect(isLearningRoute('/student/learning')).toBe(true);
      expect(isLearningRoute('/student/learning/')).toBe(true);
      expect(isLearningRoute('/student/learning/practice')).toBe(true);
      expect(isLearningRoute('/student/learning/results/123')).toBe(true);
    });

    it('does not match unrelated routes or paths with partial prefix overlap', () => {
      // Partial prefix overlaps that must NOT be intercepted
      expect(isLearningRoute('/api/learning-center')).toBe(false);
      expect(isLearningRoute('/api/learning_path')).toBe(false);
      expect(isLearningRoute('/professor/learning-analytics')).toBe(false);
      expect(isLearningRoute('/student/learning-portal')).toBe(false);

      // Unrelated core application routes
      expect(isLearningRoute('/api/courses')).toBe(false);
      expect(isLearningRoute('/api/exams')).toBe(false);
      expect(isLearningRoute('/api/allocations')).toBe(false);
      expect(isLearningRoute('/api/auth/session')).toBe(false);
      expect(isLearningRoute('/professor')).toBe(false);
      expect(isLearningRoute('/professor/courses')).toBe(false);
      expect(isLearningRoute('/professor/exams')).toBe(false);
      expect(isLearningRoute('/student')).toBe(false);
      expect(isLearningRoute('/student/results')).toBe(false);
      expect(isLearningRoute('/admin')).toBe(false);
      expect(isLearningRoute('/admin/users')).toBe(false);
      expect(isLearningRoute('/ta')).toBe(false);
      expect(isLearningRoute('/login')).toBe(false);
    });
  });

  describe('2. Disabled State: Generic 404 Security Guard', () => {
    it('returns generic 404 for unauthenticated requests when server flag is unset', async () => {
      delete process.env.FEATURE_LEARNING_MODULE;

      const routes = [
        '/api/learning',
        '/api/learning/questions',
        '/professor/learning',
        '/professor/learning/plan',
        '/student/learning',
        '/student/learning/quiz',
      ];

      for (const route of routes) {
        const req = createMockRequest(route, null);
        const res = proxyMiddleware(req);

        expect(res).toBeDefined();
        expect(res!.status).toBe(404);

        const body = await res!.json();
        expect(body).toEqual({
          success: false,
          message: 'Not Found',
          data: null,
        });
      }
    });

    it('returns generic 404 for authenticated requests when server flag is explicitly false', async () => {
      process.env.FEATURE_LEARNING_MODULE = 'false';

      const profToken = { id: 'prof-1', email: 'prof@iiit.ac.in', role: 'PROFESSOR' };
      const studentToken = { id: 'stud-1', email: 'student@iiit.ac.in', role: 'STUDENT' };

      // Professor attempting professor learning route
      const profReq = createMockRequest('/professor/learning', profToken);
      const profRes = proxyMiddleware(profReq);
      expect(profRes?.status).toBe(404);

      // Student attempting student learning route
      const studentReq = createMockRequest('/student/learning', studentToken);
      const studentRes = proxyMiddleware(studentReq);
      expect(studentRes?.status).toBe(404);

      // API route with valid token
      const apiReq = createMockRequest('/api/learning/assessment', profToken);
      const apiRes = proxyMiddleware(apiReq);
      expect(apiRes?.status).toBe(404);
    });

    it('returns 404 when public flag is true but server flag is unset or false', async () => {
      delete process.env.FEATURE_LEARNING_MODULE;
      process.env.NEXT_PUBLIC_FEATURE_LEARNING_MODULE = 'true';

      const profToken = { id: 'prof-1', email: 'prof@iiit.ac.in', role: 'PROFESSOR' };

      const apiRes = proxyMiddleware(createMockRequest('/api/learning/questions', profToken));
      expect(apiRes?.status).toBe(404);

      const profRes = proxyMiddleware(createMockRequest('/professor/learning', profToken));
      expect(profRes?.status).toBe(404);

      const studentRes = proxyMiddleware(createMockRequest('/student/learning', profToken));
      expect(studentRes?.status).toBe(404);
    });

    it('allows proxyAuthOptions.callbacks.authorized to route unauthenticated disabled requests to proxyMiddleware for 404', () => {
      delete process.env.FEATURE_LEARNING_MODULE;

      // In disabled state, unauthenticated learning requests must be authorized to reach proxyMiddleware
      // so proxyMiddleware returns 404 instead of NextAuth redirecting to /login (which reveals existence)
      const isAuth1 = proxyAuthOptions.callbacks.authorized({
        token: null,
        req: createMockRequest('/professor/learning'),
      });
      expect(isAuth1).toBe(true);

      const isAuth2 = proxyAuthOptions.callbacks.authorized({
        token: null,
        req: createMockRequest('/student/learning'),
      });
      expect(isAuth2).toBe(true);

      const isAuth3 = proxyAuthOptions.callbacks.authorized({
        token: null,
        req: createMockRequest('/api/learning/questions'),
      });
      expect(isAuth3).toBe(true);
    });
  });

  describe('3. Enabled State: Authentication & Authorization Flow Preserved', () => {
    beforeEach(() => {
      process.env.FEATURE_LEARNING_MODULE = 'true';
    });

    it('enforces 401 Unauthorized on /api/learning/* when unauthenticated', async () => {
      const req = createMockRequest('/api/learning/questions', null);
      const res = proxyMiddleware(req);

      expect(res).toBeDefined();
      expect(res!.status).toBe(401);

      const body = await res!.json();
      expect(body.success).toBe(false);
      expect(body.message).toBe('Unauthorized');
    });

    it('allows authenticated users to pass through /api/learning/*', () => {
      const token = { id: 'user-1', email: 'user@iiit.ac.in', role: 'PROFESSOR' };
      const req = createMockRequest('/api/learning/questions', token);
      const res = proxyMiddleware(req);

      // Undefined return in Next.js middleware passes request to route handler
      expect(res).toBeUndefined();
    });

    it('requires authentication for /professor/learning* in proxyAuthOptions.callbacks.authorized', () => {
      const unauthReq = createMockRequest('/professor/learning', null);
      const isAuth = proxyAuthOptions.callbacks.authorized({
        token: null,
        req: unauthReq,
      });
      // When enabled, unauthenticated users are NOT authorized, triggering redirect to login
      expect(isAuth).toBe(false);

      const authReq = createMockRequest('/professor/learning', { id: 'prof-1', role: 'PROFESSOR' });
      const isAuthLoggedIn = proxyAuthOptions.callbacks.authorized({
        token: { id: 'prof-1', role: 'PROFESSOR' } as any,
        req: authReq,
      });
      expect(isAuthLoggedIn).toBe(true);
    });

    it('redirects unauthorized roles from /professor/learning* to their own dashboard', () => {
      const studentToken = { id: 's-1', email: 's@iiit.ac.in', role: 'STUDENT' };
      const req = createMockRequest('/professor/learning', studentToken);
      const res = proxyMiddleware(req);

      expect(res).toBeDefined();
      expect(res!.status).toBe(307); // NextResponse.redirect
      expect(res!.headers.get('location')).toBe('http://localhost:3000/student');
    });

    it('permits authorized Professor with CREATE_EXAM permission to access /professor/learning*', () => {
      const profToken = { id: 'p-1', email: 'prof@iiit.ac.in', role: 'PROFESSOR' };
      const req = createMockRequest('/professor/learning', profToken);
      const res = proxyMiddleware(req);

      expect(res).toBeUndefined();
    });

    it('requires authentication for /student/learning* in proxyAuthOptions.callbacks.authorized', () => {
      const unauthReq = createMockRequest('/student/learning', null);
      const isAuth = proxyAuthOptions.callbacks.authorized({
        token: null,
        req: unauthReq,
      });
      expect(isAuth).toBe(false);

      const authReq = createMockRequest('/student/learning', { id: 'stud-1', role: 'STUDENT' });
      const isAuthLoggedIn = proxyAuthOptions.callbacks.authorized({
        token: { id: 'stud-1', role: 'STUDENT' } as any,
        req: authReq,
      });
      expect(isAuthLoggedIn).toBe(true);
    });

    it('redirects non-student roles from /student/learning* to their own dashboard', () => {
      const profToken = { id: 'p-1', email: 'prof@iiit.ac.in', role: 'PROFESSOR' };
      const req = createMockRequest('/student/learning', profToken);
      const res = proxyMiddleware(req);

      expect(res).toBeDefined();
      expect(res!.status).toBe(307);
      expect(res!.headers.get('location')).toBe('http://localhost:3000/professor');
    });

    it('permits authorized Student with VIEW_OWN_RESULTS permission to access /student/learning*', () => {
      const studentToken = { id: 's-1', email: 's@iiit.ac.in', role: 'STUDENT' };
      const req = createMockRequest('/student/learning', studentToken);
      const res = proxyMiddleware(req);

      expect(res).toBeUndefined();
    });
  });

  describe('4. Unrelated Routes Unaffected', () => {
    it('leaves unrelated routes unaffected when flag is disabled', () => {
      delete process.env.FEATURE_LEARNING_MODULE;

      const profToken = { id: 'p-1', email: 'prof@iiit.ac.in', role: 'PROFESSOR' };
      const studentToken = { id: 's-1', email: 's@iiit.ac.in', role: 'STUDENT' };

      // Normal API route with auth: passes through
      const apiReq = createMockRequest('/api/courses', profToken);
      expect(proxyMiddleware(apiReq)).toBeUndefined();

      // Normal API route without auth: 401
      const unauthApiReq = createMockRequest('/api/courses', null);
      expect(proxyMiddleware(unauthApiReq)?.status).toBe(401);

      // Normal professor route with prof auth: passes through
      const profReq = createMockRequest('/professor/courses', profToken);
      expect(proxyMiddleware(profReq)).toBeUndefined();

      // Student trying to access professor route: redirected to /student
      const crossReq = createMockRequest('/professor/courses', studentToken);
      expect(proxyMiddleware(crossReq)?.status).toBe(307);
      expect(proxyMiddleware(crossReq)?.headers.get('location')).toBe('http://localhost:3000/student');

      // Unrelated route with "learning" substring: unaffected
      const overlapReq = createMockRequest('/api/learning-center', profToken);
      expect(proxyMiddleware(overlapReq)).toBeUndefined();
    });

    it('leaves unrelated routes unaffected when flag is enabled', () => {
      process.env.FEATURE_LEARNING_MODULE = 'true';

      const profToken = { id: 'p-1', email: 'prof@iiit.ac.in', role: 'PROFESSOR' };

      expect(proxyMiddleware(createMockRequest('/api/exams', profToken))).toBeUndefined();
      expect(proxyMiddleware(createMockRequest('/professor/exams', profToken))).toBeUndefined();
      expect(proxyMiddleware(createMockRequest('/api/auth/session', null))).toBeUndefined();
    });
  });
});
