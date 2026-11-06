import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { connectClassroomDB } from '../lib/classroomDb';
import { connectPersonalizedDB } from '../lib/personalizedDb';
import ClassroomUser from '../models/ClassroomUser';
import PersonalizedUser from '../models/PersonalizedUser';
import { signClassroomToken, verifyClassroomToken, requireClassroomAuth } from '../lib/classroomAuth';
import { signPersonalizedToken, verifyPersonalizedToken, requirePersonalizedAuth } from '../lib/personalizedAuth';
import { POST as classroomRegister } from '../app/api/classroom/auth/register/route';
import { POST as classroomLogin } from '../app/api/classroom/auth/login/route';
import { POST as personalizedRegister } from '../app/api/personalized/auth/register/route';
import { POST as personalizedLogin } from '../app/api/personalized/auth/login/route';

describe('Independent Product Architecture', () => {
  beforeAll(async () => {
    process.env.CLASSROOM_AUTH_SECRET = 'test-classroom-secret-key-salt-32chars';
    process.env.PERSONALIZED_AUTH_SECRET = 'test-personalized-secret-key-salt-32chars';
  });

  beforeEach(async () => {
    await ClassroomUser.deleteMany({});
    await PersonalizedUser.deleteMany({});
  });

  describe('Database Connection Separation', () => {
    it('connectClassroomDB connects successfully to the classroom database', async () => {
      const conn = await connectClassroomDB();
      expect(conn).toBeDefined();
      expect(conn.connection.readyState).toBe(1);
    });

    it('connectPersonalizedDB connects successfully to the personalized database', async () => {
      const conn = await connectPersonalizedDB();
      expect(conn).toBeDefined();
      expect(conn.connection.readyState).toBe(1);
    });
  });

  describe('Product 2: Classroom Activity Independent Auth', () => {
    it('signs and verifies independent classroom tokens', () => {
      const token = signClassroomToken({
        id: 'class-prof-1',
        email: 'prof@iiit.ac.in',
        name: 'Prof. Rao',
        role: 'PROFESSOR',
      });

      const decoded = verifyClassroomToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.email).toBe('prof@iiit.ac.in');
      expect(decoded?.role).toBe('PROFESSOR');
    });

    it('registers and authenticates independent classroom users', async () => {
      // 1. Register
      const regReq = new NextRequest('http://localhost/api/classroom/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Prof. Ananya',
          email: 'ananya@iiit.ac.in',
          password: 'securePassword123',
          role: 'PROFESSOR',
          department: 'CSE',
        }),
      });

      const regRes = await classroomRegister(regReq);
      expect(regRes.status).toBe(201);
      const regJson = await regRes.json();
      expect(regJson.success).toBe(true);
      expect(regJson.data.user.email).toBe('ananya@iiit.ac.in');

      // 2. Login
      const loginReq = new NextRequest('http://localhost/api/classroom/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'ananya@iiit.ac.in',
          password: 'securePassword123',
        }),
      });

      const loginRes = await classroomLogin(loginReq);
      expect(loginRes.status).toBe(200);
      const loginJson = await loginRes.json();
      expect(loginJson.success).toBe(true);
      expect(loginJson.data.token).toBeDefined();

      // 3. Authenticate with header
      const authReq = new NextRequest('http://localhost/api/classroom/sessions', {
        headers: {
          'x-classroom-token': loginJson.data.token,
        },
      });

      const authResult = await requireClassroomAuth(authReq);
      expect(authResult.authorized).toBe(true);
      expect(authResult.user?.email).toBe('ananya@iiit.ac.in');
    });

    it('rejects invalid password for classroom login', async () => {
      await ClassroomUser.create({
        name: 'Test Prof',
        email: 'test@iiit.ac.in',
        password: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890', // dummy hash
        role: 'PROFESSOR',
      });

      const loginReq = new NextRequest('http://localhost/api/classroom/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@iiit.ac.in',
          password: 'wrongPassword',
        }),
      });

      const loginRes = await classroomLogin(loginReq);
      expect(loginRes.status).toBe(401);
    });
  });

  describe('Product 3: Personalised Learning Independent Auth', () => {
    it('signs and verifies independent personalized tokens', () => {
      const token = signPersonalizedToken({
        id: 'pers-student-1',
        email: 'student@iiit.ac.in',
        name: 'Student Rohan',
        role: 'STUDENT',
      });

      const decoded = verifyPersonalizedToken(token);
      expect(decoded).not.toBeNull();
      expect(decoded?.email).toBe('student@iiit.ac.in');
      expect(decoded?.role).toBe('STUDENT');
    });

    it('registers and authenticates independent personalized learners', async () => {
      // 1. Register
      const regReq = new NextRequest('http://localhost/api/personalized/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Rohan Sharma',
          email: 'rohan@iiit.ac.in',
          password: 'learnerPassword456',
          role: 'STUDENT',
          skillLevel: 'INTERMEDIATE',
        }),
      });

      const regRes = await personalizedRegister(regReq);
      expect(regRes.status).toBe(201);
      const regJson = await regRes.json();
      expect(regJson.success).toBe(true);
      expect(regJson.data.user.email).toBe('rohan@iiit.ac.in');

      // 2. Login
      const loginReq = new NextRequest('http://localhost/api/personalized/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'rohan@iiit.ac.in',
          password: 'learnerPassword456',
        }),
      });

      const loginRes = await personalizedLogin(loginReq);
      expect(loginRes.status).toBe(200);
      const loginJson = await loginRes.json();
      expect(loginJson.success).toBe(true);
      expect(loginJson.data.token).toBeDefined();

      // 3. Authenticate with header
      const authReq = new NextRequest('http://localhost/api/personalized/today', {
        headers: {
          'x-personalized-token': loginJson.data.token,
        },
      });

      const authResult = await requirePersonalizedAuth(authReq);
      expect(authResult.authorized).toBe(true);
      expect(authResult.user?.email).toBe('rohan@iiit.ac.in');
    });
  });

  describe('Product Cross-Isolation', () => {
    it('prevents classroom token from authenticating personalized learning', async () => {
      const classroomToken = signClassroomToken({
        id: 'class-user-1',
        email: 'user@iiit.ac.in',
        name: 'User',
        role: 'PROFESSOR',
      });

      // Attempt to access personalized endpoint using classroom token
      const req = new NextRequest('http://localhost/api/personalized/today', {
        headers: {
          'x-personalized-token': classroomToken,
        },
      });

      const auth = await requirePersonalizedAuth(req);
      // Signature mismatch because secrets are isolated
      expect(auth.authorized).toBe(false);
    });

    it('prevents personalized user from logging in via classroom auth', async () => {
      // Create user ONLY in PersonalizedUser collection
      await PersonalizedUser.create({
        name: 'Only Personalized',
        email: 'isolated@iiit.ac.in',
        password: '$2a$10$abcdefghijklmnopqrstuvwxyz1234567890',
        role: 'STUDENT',
      });

      // Try logging in via Classroom API
      const loginReq = new NextRequest('http://localhost/api/classroom/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'isolated@iiit.ac.in',
          password: 'somepassword',
        }),
      });

      const loginRes = await classroomLogin(loginReq);
      expect(loginRes.status).toBe(401);
    });
  });
});
