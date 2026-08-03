import { describe, it, expect, beforeAll, vi } from 'vitest';

let mockSessionUser: any = {
  id: '60d5ec49315e2c56a84976fa',
  email: 'admin@university.edu',
  name: 'Default Admin',
  role: 'ADMIN',
};

// Mock next-auth to allow dynamic control of user sessions in tests
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

describe('Smoke Tests', () => {
  let healthGET: any;
  let registerPOST: any;
  let coursesGET: any;
  let coursesPOST: any;
  let resetPOST: any;

  beforeAll(async () => {
    healthGET = (await import('../app/api/health/route')).GET;
    registerPOST = (await import('../app/api/auth/register/route')).POST;
    coursesGET = (await import('../app/api/courses/route')).GET;
    coursesPOST = (await import('../app/api/courses/route')).POST;
    resetPOST = (await import('../app/api/auth/reset/route')).POST;
  });

  describe('Health API', () => {
    it('should return healthy status', async () => {
      const res = await healthGET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.status).toBe('healthy');
    });
  });

  describe('Authentication API', () => {
    it('should handle registration validation failure', async () => {
      const req = new Request('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await registerPOST(req as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Validation failed');
    });

    it('should prevent duplicate registration', async () => {
      const payload = {
        name: 'Default Admin',
        email: 'admin@university.edu',
        password: 'admin-secure-password',
        role: 'ADMIN',
      };

      // Register the first time (should succeed)
      const req1 = new Request('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const res1 = await registerPOST(req1 as any);
      expect(res1.status).toBe(201);

      // Register the second time (should return 409 duplicate error)
      const req2 = new Request('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });
      const res2 = await registerPOST(req2 as any);
      expect(res2.status).toBe(409);
      const data = await res2.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Email already registered');
    });
  });

  describe('Course API - Authorization & Functionality', () => {
    it('should return 401 Unauthorized for unauthenticated GET requests', async () => {
      mockSessionUser = null;
      const res = await coursesGET();
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });

    it('should return 401 Unauthorized for unauthenticated POST requests', async () => {
      mockSessionUser = null;
      const req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await coursesPOST(req as any);
      expect(res.status).toBe(401);
    });

    it('should return 200 OK for STUDENT GET requests', async () => {
      mockSessionUser = {
        id: 'student-id',
        email: 'student@university.edu',
        name: 'Student User',
        role: 'STUDENT',
      };
      const res = await coursesGET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('should return 403 Forbidden for STUDENT POST requests', async () => {
      mockSessionUser = {
        id: 'student-id',
        email: 'student@university.edu',
        name: 'Student User',
        role: 'STUDENT',
      };
      const req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await coursesPOST(req as any);
      expect(res.status).toBe(403);
    });

    it('should return 200 OK for TA GET requests', async () => {
      mockSessionUser = {
        id: 'ta-id',
        email: 'ta@university.edu',
        name: 'TA User',
        role: 'TA',
      };
      const res = await coursesGET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('should return 403 Forbidden for TA POST requests', async () => {
      mockSessionUser = {
        id: 'ta-id',
        email: 'ta@university.edu',
        name: 'TA User',
        role: 'TA',
      };
      const req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await coursesPOST(req as any);
      expect(res.status).toBe(403);
    });

    it('should return 200 for PROFESSOR GET requests', async () => {
      mockSessionUser = {
        id: 'prof-id',
        email: 'prof@university.edu',
        name: 'Prof User',
        role: 'PROFESSOR',
      };
      const res = await coursesGET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('should return 400 validation error (instead of 403) for PROFESSOR POST requests with empty body', async () => {
      mockSessionUser = {
        id: 'prof-id',
        email: 'prof@university.edu',
        name: 'Prof User',
        role: 'PROFESSOR',
      };
      const req = new Request('http://localhost:3000/api/courses', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await coursesPOST(req as any);
      expect(res.status).toBe(400); // Authorized to access, but failed validation
    });

    it('should return 200 for ADMIN GET requests', async () => {
      mockSessionUser = {
        id: 'admin-id',
        email: 'admin@university.edu',
        name: 'Admin User',
        role: 'ADMIN',
      };
      const res = await coursesGET();
      expect(res.status).toBe(200);
    });
  });

  describe('Password Reset API', () => {
    it('should return 400 for validation failure (invalid email)', async () => {
      const req = new Request('http://localhost:3000/api/auth/reset', {
        method: 'POST',
        body: JSON.stringify({ email: 'invalid-email' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await resetPOST(req as any);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Validation failed');
    });

    it('should return generic success (200) for a non-existent email', async () => {
      const req = new Request('http://localhost:3000/api/auth/reset', {
        method: 'POST',
        body: JSON.stringify({ email: 'nonexistent@university.edu' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await resetPOST(req as any);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('If that email address exists in our database');
    });

    it('should return generic success (200) and generate a token for an existing email', async () => {
      // First, register a user
      const registerPayload = {
        name: 'Reset Test User',
        email: 'reset-test@university.edu',
        password: 'reset-secure-password',
        role: 'STUDENT',
      };
      const reqReg = new Request('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(registerPayload),
        headers: { 'Content-Type': 'application/json' },
      });
      await registerPOST(reqReg as any);

      // Now, call the reset API
      const reqReset = new Request('http://localhost:3000/api/auth/reset', {
        method: 'POST',
        body: JSON.stringify({ email: 'reset-test@university.edu' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const resReset = await resetPOST(reqReset as any);
      expect(resReset.status).toBe(200);
      const data = await resReset.json();
      expect(data.success).toBe(true);

      // Verify in the database that the token and expiry are set
      const User = (await import('../models/User')).default;
      const user = await User.findOne({ email: 'reset-test@university.edu' });
      expect(user).not.toBeNull();
      expect(user?.resetPasswordToken).toBeDefined();
      expect(user?.resetPasswordToken).not.toBeNull();
      expect(user?.resetPasswordExpires).toBeDefined();
      expect(user?.resetPasswordExpires!.getTime()).toBeGreaterThan(Date.now());
    });
  });
});
