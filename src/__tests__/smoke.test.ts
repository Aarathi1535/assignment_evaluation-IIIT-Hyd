/* eslint-disable @typescript-eslint/no-explicit-any */
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
  let resetPasswordPOST: any;
  let AuthService: any;
  let User: any;

  beforeAll(async () => {
    healthGET = (await import('../app/api/health/route')).GET;
    registerPOST = (await import('../app/api/auth/register/route')).POST;
    coursesGET = (await import('../app/api/courses/route')).GET;
    coursesPOST = (await import('../app/api/courses/route')).POST;
    resetPOST = (await import('../app/api/auth/reset/route')).POST;
    resetPasswordPOST = (await import('../app/api/auth/reset-password/route')).POST;
    AuthService = (await import('../services/AuthService')).default;
    User = (await import('../models/User')).default;
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
      const user = await User.findOne({ email: 'reset-test@university.edu' });
      expect(user).not.toBeNull();
      expect(user?.resetPasswordToken).toBeDefined();
      expect(user?.resetPasswordToken).not.toBeNull();
      expect(user?.resetPasswordExpires).toBeDefined();
      expect(user?.resetPasswordExpires!.getTime()).toBeGreaterThan(Date.now());
    });

    it('should reset password successfully with a valid token (happy path)', async () => {
      // Register user
      const email = 'happy-reset@university.edu';
      const registerPayload = {
        name: 'Happy Reset User',
        email,
        password: 'old-secure-password',
        role: 'STUDENT',
      };
      const reqReg = new Request('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(registerPayload),
        headers: { 'Content-Type': 'application/json' },
      });
      await registerPOST(reqReg as any);

      // Spy on token generation
      const generateResetTokenSpy = vi.spyOn(AuthService, 'generateResetToken');

      // Request reset
      const reqReset = new Request('http://localhost:3000/api/auth/reset', {
        method: 'POST',
        body: JSON.stringify({ email }),
        headers: { 'Content-Type': 'application/json' },
      });
      await resetPOST(reqReset as any);

      // Retrieve the raw token from spy
      const rawToken = await generateResetTokenSpy.mock.results[0].value;
      expect(rawToken).not.toBeNull();

      // Call reset-password API with the raw token
      const reqResetPassword = new Request('http://localhost:3000/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: rawToken, newPassword: 'new-secure-password' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const resResetPassword = await resetPasswordPOST(reqResetPassword as any);
      expect(resResetPassword.status).toBe(200);
      const data = await resResetPassword.json();
      expect(data.success).toBe(true);
      expect(data.message).toContain('reset successfully');

      // Verify user record in database: token and expiry cleared, password changed
      const user = await User.findOne({ email });
      expect(user?.resetPasswordToken).toBeNull();
      expect(user?.resetPasswordExpires).toBeNull();

      // Verify we can authenticate with new password using bcrypt
      const bcrypt = await import('bcryptjs');
      const match = await bcrypt.compare('new-secure-password', user!.password);
      expect(match).toBe(true);

      generateResetTokenSpy.mockRestore();
    });

    it('should reject password reset for an invalid token', async () => {
      const reqResetPassword = new Request('http://localhost:3000/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: 'completely-invalid-token', newPassword: 'new-secure-password' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const resResetPassword = await resetPasswordPOST(reqResetPassword as any);
      expect(resResetPassword.status).toBe(400);
      const data = await resResetPassword.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Invalid or expired token');
    });

    it('should reject password reset for an expired token', async () => {
      // Register user
      const email = 'expired-reset@university.edu';
      const registerPayload = {
        name: 'Expired Reset User',
        email,
        password: 'old-secure-password',
        role: 'STUDENT',
      };
      const reqReg = new Request('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(registerPayload),
        headers: { 'Content-Type': 'application/json' },
      });
      await registerPOST(reqReg as any);

      const generateResetTokenSpy = vi.spyOn(AuthService, 'generateResetToken');

      // Request reset
      const reqReset = new Request('http://localhost:3000/api/auth/reset', {
        method: 'POST',
        body: JSON.stringify({ email }),
        headers: { 'Content-Type': 'application/json' },
      });
      await resetPOST(reqReset as any);

      const rawToken = await generateResetTokenSpy.mock.results[0].value;

      // Manually expire token in database
      await User.findOneAndUpdate(
        { email },
        { resetPasswordExpires: new Date(Date.now() - 1000) } // 1 second ago
      );

      // Attempt to reset password
      const reqResetPassword = new Request('http://localhost:3000/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: rawToken, newPassword: 'new-secure-password' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const resResetPassword = await resetPasswordPOST(reqResetPassword as any);
      expect(resResetPassword.status).toBe(400);
      const data = await resResetPassword.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Invalid or expired token');

      generateResetTokenSpy.mockRestore();
    });

    it('should reject password reset when reusing a token (single-use)', async () => {
      // Register user
      const email = 'reused-reset@university.edu';
      const registerPayload = {
        name: 'Reused Reset User',
        email,
        password: 'old-secure-password',
        role: 'STUDENT',
      };
      const reqReg = new Request('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(registerPayload),
        headers: { 'Content-Type': 'application/json' },
      });
      await registerPOST(reqReg as any);

      const generateResetTokenSpy = vi.spyOn(AuthService, 'generateResetToken');

      // Request reset
      const reqReset = new Request('http://localhost:3000/api/auth/reset', {
        method: 'POST',
        body: JSON.stringify({ email }),
        headers: { 'Content-Type': 'application/json' },
      });
      await resetPOST(reqReset as any);

      const rawToken = await generateResetTokenSpy.mock.results[0].value;

      // Reset password first time
      const reqReset1 = new Request('http://localhost:3000/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: rawToken, newPassword: 'new-secure-password-1' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const resReset1 = await resetPasswordPOST(reqReset1 as any);
      expect(resReset1.status).toBe(200);

      // Try to reset password second time with the same token
      const reqReset2 = new Request('http://localhost:3000/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token: rawToken, newPassword: 'new-secure-password-2' }),
        headers: { 'Content-Type': 'application/json' },
      });
      const resReset2 = await resetPasswordPOST(reqReset2 as any);
      expect(resReset2.status).toBe(400);
      const data2 = await resReset2.json();
      expect(data2.success).toBe(false);
      expect(data2.message).toBe('Invalid or expired token');

      generateResetTokenSpy.mockRestore();
    });
  });
});
