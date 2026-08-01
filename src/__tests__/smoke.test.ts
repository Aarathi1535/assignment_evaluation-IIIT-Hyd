import { loadEnvConfig } from '@next/env';
// Load environment variables (.env.local) first
loadEnvConfig(process.cwd());

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';

describe('Smoke Tests', () => {
  let healthGET: any;
  let registerPOST: any;
  let coursesGET: any;

  beforeAll(async () => {
    const { connectDB } = await import('../lib/db');
    await connectDB();

    healthGET = (await import('../app/api/health/route')).GET;
    registerPOST = (await import('../app/api/auth/register/route')).POST;
    coursesGET = (await import('../app/api/courses/route')).GET;
  });

  afterAll(async () => {
    await mongoose.connection.close();
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
      const req = new Request('http://localhost:3000/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: 'Default Admin',
          email: 'admin@university.edu',
          password: 'admin-secure-password',
          role: 'ADMIN',
        }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await registerPOST(req as any);
      expect(res.status).toBe(409);
      const data = await res.json();
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
