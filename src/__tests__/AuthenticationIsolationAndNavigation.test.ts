// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { connectClassroomDB } from '../lib/classroomDb';
import { connectPersonalizedDB } from '../lib/personalizedDb';
import ClassroomUser from '../models/ClassroomUser';
import PersonalizedUser from '../models/PersonalizedUser';
import {
  signClassroomToken,
  verifyClassroomToken,
  getClassroomUser,
  requireClassroomAuth,
} from '../lib/classroomAuth';
import {
  signPersonalizedToken,
  verifyPersonalizedToken,
  getPersonalizedUser,
  requirePersonalizedAuth,
} from '../lib/personalizedAuth';
import { POST as classroomRegister } from '../app/api/classroom/auth/register/route';
import { POST as classroomLogin } from '../app/api/classroom/auth/login/route';
import { POST as personalizedRegister } from '../app/api/personalized/auth/register/route';
import { POST as personalizedLogin } from '../app/api/personalized/auth/login/route';

import { render, screen } from '@testing-library/react';
import React from 'react';
import { UnifiedPlatformNav } from '../components/navigation/UnifiedPlatformNav';

vi.mock('next-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-auth')>();
  return {
    ...actual,
    getServerSession: vi.fn(),
  };
});

let mockPathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

describe('Architecture Note v2: Authentication Isolation & Module Navigation', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.ADMIN_INVITE_CODE = 'SECRET-ADMIN-CODE-2026';
    process.env.CLASSROOM_AUTH_SECRET = 'classroom-isolated-secret-salt-32chars';
    process.env.PERSONALIZED_AUTH_SECRET = 'personalized-isolated-secret-salt-32chars';
    delete process.env.CLASSROOM_ENABLE_SHARED_AUTH;
    delete process.env.PERSONALIZED_ENABLE_SHARED_AUTH;

    await connectClassroomDB();
    await connectPersonalizedDB();
    await ClassroomUser.deleteMany({});
    await PersonalizedUser.deleteMany({});
  });

  describe('1. Authentication Secret Isolation', () => {
    it('rejects tokens signed with different product secrets', () => {
      const classroomToken = signClassroomToken({
        id: 'usr-1',
        email: 'test@iiit.ac.in',
        name: 'Test',
        role: 'PROFESSOR',
      });

      // Classroom token cannot be verified as a personalized token
      const persDecoded = verifyPersonalizedToken(classroomToken);
      expect(persDecoded).toBeNull();

      const personalizedToken = signPersonalizedToken({
        id: 'usr-2',
        email: 'test2@iiit.ac.in',
        name: 'Test 2',
        role: 'STUDENT',
      });

      // Personalized token cannot be verified as a classroom token
      const classDecoded = verifyClassroomToken(personalizedToken);
      expect(classDecoded).toBeNull();
    });
  });

  describe('2. Zero Session Bleed (No Automatic NextAuth Fallback in Phase 1)', () => {
    it('does not authenticate classroom request via NextAuth when shared auth is disabled', async () => {
      // Mock NextAuth getServerSession to simulate an active Assignment Evaluation session
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: 'eval-user-id',
          name: 'Eval Professor',
          email: 'evalprof@iiit.ac.in',
          role: 'PROFESSOR',
        },
        expires: '2099-01-01',
      });

      // No classroom token provided in request
      const req = new NextRequest('http://localhost/api/classroom/sessions');

      // Shared auth is not enabled -> must return null and fail auth
      const user = await getClassroomUser(req);
      expect(user).toBeNull();

      const auth = await requireClassroomAuth(req);
      expect(auth.authorized).toBe(false);
      expect(auth.response?.status).toBe(401);
    });

    it('does not authenticate personalized request via NextAuth when shared auth is disabled', async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: {
          id: 'eval-user-id',
          name: 'Eval Student',
          email: 'evalstudent@iiit.ac.in',
          role: 'STUDENT',
        },
        expires: '2099-01-01',
      });

      const req = new NextRequest('http://localhost/api/personalized/today');

      const user = await getPersonalizedUser(req);
      expect(user).toBeNull();

      const auth = await requirePersonalizedAuth(req);
      expect(auth.authorized).toBe(false);
      expect(auth.response?.status).toBe(401);
    });
  });

  describe('3. Registration Role Hardening & Privilege Elevation Protection', () => {
    it('strictly assigns STUDENT role for public classroom registration even if PROFESSOR is requested', async () => {
      const req = new NextRequest('http://localhost/api/classroom/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Public Registrant',
          email: 'registrant@iiit.ac.in',
          password: 'Password123!',
          role: 'PROFESSOR', // Unauthorized elevation attempt
        }),
      });

      const res = await classroomRegister(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.user.role).toBe('STUDENT');

      const saved = await ClassroomUser.findOne({ email: 'registrant@iiit.ac.in' });
      expect(saved?.role).toBe('STUDENT');
    });

    it('allows PROFESSOR role assignment only when valid adminInviteCode is supplied', async () => {
      const req = new NextRequest('http://localhost/api/classroom/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Authorized Faculty',
          email: 'faculty@iiit.ac.in',
          password: 'Password123!',
          role: 'PROFESSOR',
          adminInviteCode: 'SECRET-ADMIN-CODE-2026',
        }),
      });

      const res = await classroomRegister(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.user.role).toBe('PROFESSOR');

      const saved = await ClassroomUser.findOne({ email: 'faculty@iiit.ac.in' });
      expect(saved?.role).toBe('PROFESSOR');
    });

    it('strictly assigns STUDENT role for public personalized registration', async () => {
      const req = new NextRequest('http://localhost/api/personalized/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Learner User',
          email: 'learner@iiit.ac.in',
          password: 'Password123!',
          role: 'PROFESSOR', // Unauthorized elevation attempt
        }),
      });

      const res = await personalizedRegister(req);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.user.role).toBe('STUDENT');

      const saved = await PersonalizedUser.findOne({ email: 'learner@iiit.ac.in' });
      expect(saved?.role).toBe('STUDENT');
    });
  });

  describe('4. Deactivated Account Enforcement (isActive: false)', () => {
    it('rejects login for deactivated classroom account with 401 ACCOUNT_DISABLED', async () => {
      const bcrypt = (await import('bcryptjs')).default;
      const hashedPassword = await bcrypt.hash('validPassword123', 10);

      await ClassroomUser.create({
        name: 'Disabled User',
        email: 'disabled@iiit.ac.in',
        password: hashedPassword,
        role: 'STUDENT',
        isActive: false,
      });

      const req = new NextRequest('http://localhost/api/classroom/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'disabled@iiit.ac.in',
          password: 'validPassword123',
        }),
      });

      const res = await classroomLogin(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('deactivated');
      expect(json.code).toBe('ACCOUNT_DISABLED');
    });

    it('rejects login for deactivated personalized learning account with 401 ACCOUNT_DISABLED', async () => {
      const bcrypt = (await import('bcryptjs')).default;
      const hashedPassword = await bcrypt.hash('validPassword123', 10);

      await PersonalizedUser.create({
        name: 'Deactivated Learner',
        email: 'deactivated@iiit.ac.in',
        password: hashedPassword,
        role: 'STUDENT',
        isActive: false,
      });

      const req = new NextRequest('http://localhost/api/personalized/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'deactivated@iiit.ac.in',
          password: 'validPassword123',
        }),
      });

      const res = await personalizedLogin(req);
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(json.message).toContain('deactivated');
      expect(json.code).toBe('ACCOUNT_DISABLED');
    });
  });

  describe('5. Unified Platform Navigation & Cross-Module Routing', () => {
    it('renders navigation tabs for all three independent products', () => {
      mockPathname = '/';
      render(React.createElement(UnifiedPlatformNav, { currentUser: null }));

      const evalTab = screen.getByTestId('nav-tab-evaluation');
      const classroomTab = screen.getByTestId('nav-tab-classroom');
      const practiceTab = screen.getByTestId('nav-tab-practice');

      expect(evalTab).toBeDefined();
      expect(evalTab.getAttribute('href')).toBe('/login');
      expect(classroomTab.getAttribute('href')).toBe('/classroom');
      expect(practiceTab.getAttribute('href')).toBe('/personalized');

      // Unauthenticated state renders sign-in button
      const signinBtn = screen.getByTestId('nav-signin-btn');
      expect(signinBtn).toBeDefined();
      expect(signinBtn.getAttribute('href')).toBe('/login');
    });

    it('dynamically routes Evaluation tab to /student for STUDENT role', () => {
      mockPathname = '/classroom';
      render(React.createElement(UnifiedPlatformNav, {
        currentUser: {
          name: 'Student Aarav',
          email: 'aarav@iiit.ac.in',
          role: 'STUDENT',
        },
      }));

      const evalTab = screen.getByTestId('nav-tab-evaluation');
      expect(evalTab.getAttribute('href')).toBe('/student');
    });

    it('dynamically routes Evaluation tab to /professor for PROFESSOR role', () => {
      mockPathname = '/personalized';
      render(React.createElement(UnifiedPlatformNav, {
        currentUser: {
          name: 'Prof. Jawahar',
          email: 'jawahar@iiit.ac.in',
          role: 'PROFESSOR',
        },
      }));

      const evalTab = screen.getByTestId('nav-tab-evaluation');
      expect(evalTab.getAttribute('href')).toBe('/professor');
    });

    it('dynamically routes Evaluation tab to /ta for TA role', () => {
      mockPathname = '/';
      render(React.createElement(UnifiedPlatformNav, {
        currentUser: {
          name: 'TA Suresh',
          email: 'suresh@iiit.ac.in',
          role: 'TA',
        },
      }));

      const evalTab = screen.getByTestId('nav-tab-evaluation');
      expect(evalTab.getAttribute('href')).toBe('/ta');
    });

    it('dynamically routes Evaluation tab to /admin for ADMIN role', () => {
      mockPathname = '/';
      render(React.createElement(UnifiedPlatformNav, {
        currentUser: {
          name: 'Admin User',
          email: 'admin@iiit.ac.in',
          role: 'ADMIN',
        },
      }));

      const evalTab = screen.getByTestId('nav-tab-evaluation');
      expect(evalTab.getAttribute('href')).toBe('/admin');
    });
  });
});
