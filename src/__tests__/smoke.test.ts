import { describe, it, expect, beforeAll } from 'vitest';

describe('Smoke Tests', () => {
  let healthGET: any;
  let registerPOST: any;
  let coursesGET: any;

  beforeAll(async () => {
    healthGET = (await import('../app/api/health/route')).GET;
    registerPOST = (await import('../app/api/auth/register/route')).POST;
    coursesGET = (await import('../app/api/courses/route')).GET;
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

  describe('Course API', () => {
    it('should return courses list successfully', async () => {
      const res = await coursesGET();
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data)).toBe(true);
    });
  });
});
