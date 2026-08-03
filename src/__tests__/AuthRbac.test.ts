import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

let mockSessionUser: any = null;

// Mock next-auth to allow dynamic control of session users in RBAC testing
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

describe('Authentication & RBAC Tests', () => {
  let coursesGET: any;
  let coursesPOST: any;

  beforeAll(async () => {
    coursesGET = (await import('../app/api/courses/route')).GET;
    coursesPOST = (await import('../app/api/courses/route')).POST;
  });

  describe('Unauthenticated Access (401)', () => {
    it('should return 401 for GET /api/courses when unauthenticated', async () => {
      mockSessionUser = null;
      const res = await coursesGET();
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });

    it('should return 401 for POST /api/courses when unauthenticated', async () => {
      mockSessionUser = null;
      const req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await coursesPOST(req as any);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });
  });

  describe('Role-Based Access Control (RBAC) Permissions (403 vs 200/400)', () => {
    // 1. STUDENT
    describe('Student Role', () => {
      beforeEach(() => {
        mockSessionUser = {
          id: 'student-id',
          email: 'student@university.edu',
          name: 'Student User',
          role: 'STUDENT',
        };
      });

      it('should return 200 OK for GET (has VIEW_COURSES)', async () => {
        const res = await coursesGET();
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.success).toBe(true);
        expect(Array.isArray(data.data)).toBe(true);
      });

      it('should return 403 Forbidden for POST (lacks CREATE_COURSE)', async () => {
        const req = new Request('http://localhost:3000/api/courses', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });
        const res = await coursesPOST(req as any);
        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.message).toBe('Forbidden');
      });
    });

    // 2. TA
    describe('TA Role', () => {
      beforeEach(() => {
        mockSessionUser = {
          id: 'ta-id',
          email: 'ta@university.edu',
          name: 'TA User',
          role: 'TA',
        };
      });

      it('should return 200 OK for GET (has VIEW_COURSES)', async () => {
        const res = await coursesGET();
        expect(res.status).toBe(200);
      });

      it('should return 403 Forbidden for POST (lacks CREATE_COURSE)', async () => {
        const req = new Request('http://localhost:3000/api/courses', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });
        const res = await coursesPOST(req as any);
        expect(res.status).toBe(403);
      });
    });

    // 3. PROFESSOR
    describe('Professor Role', () => {
      beforeEach(() => {
        mockSessionUser = {
          id: 'prof-id',
          email: 'prof@university.edu',
          name: 'Professor User',
          role: 'PROFESSOR',
        };
      });

      it('should return 200 OK for GET (has VIEW_COURSES)', async () => {
        const res = await coursesGET();
        expect(res.status).toBe(200);
      });

      it('should return 400 Bad Request (Validation failed) for POST (has CREATE_COURSE, bypassed auth check)', async () => {
        const req = new Request('http://localhost:3000/api/courses', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });
        const res = await coursesPOST(req as any);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.success).toBe(false);
        expect(data.message).toBe('Validation failed');
      });
    });

    // 4. ADMIN
    describe('Admin Role', () => {
      beforeEach(() => {
        mockSessionUser = {
          id: 'admin-id',
          email: 'admin@university.edu',
          name: 'Admin User',
          role: 'ADMIN',
        };
      });

      it('should return 200 OK for GET (has VIEW_COURSES)', async () => {
        const res = await coursesGET();
        expect(res.status).toBe(200);
      });

      it('should return 400 Bad Request (Validation failed) for POST (has CREATE_COURSE, bypassed auth check)', async () => {
        const req = new Request('http://localhost:3000/api/courses', {
          method: 'POST',
          body: JSON.stringify({}),
          headers: { 'Content-Type': 'application/json' },
        });
        const res = await coursesPOST(req as any);
        expect(res.status).toBe(400);
      });
    });
  });
});
