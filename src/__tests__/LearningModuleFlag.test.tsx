// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import {
  isFeatureEnabled,
  getFeatureFlags,
  parseBooleanFlag,
  isLearningModuleEnabled,
} from '../config/features';
import { requireFeature } from '../lib/apiAuth';
import DashboardLayout from '../app/(dashboard)/layout';

let currentMockUser: { name: string; email: string; role: string } | null = {
  name: 'Professor Test',
  email: 'prof@iiit.ac.in',
  role: 'PROFESSOR',
};

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: currentMockUser ? { user: currentMockUser } : null,
    status: currentMockUser ? 'authenticated' : 'unauthenticated',
  }),
  signOut: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/professor',
}));

describe('LRN-02: LEARNING_MODULE Feature Flag & Navigation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    cleanup();
    process.env = { ...originalEnv };
    delete process.env.FEATURE_LEARNING_MODULE;
    delete process.env.NEXT_PUBLIC_FEATURE_LEARNING_MODULE;
    delete process.env.LEARNING_MODULE;
    delete process.env.NEXT_PUBLIC_LEARNING_MODULE;
    currentMockUser = {
      name: 'Professor Test',
      email: 'prof@iiit.ac.in',
      role: 'PROFESSOR',
    };
  });

  afterEach(() => {
    cleanup();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe('1. Flag Resolution & Environment Variable Parsing', () => {
    it('defaults to disabled (false) when env vars are unset', () => {
      expect(isFeatureEnabled('LEARNING_MODULE')).toBe(false);
      expect(isLearningModuleEnabled()).toBe(false);

      const flags = getFeatureFlags();
      expect(flags).toEqual({
        LEARNING_MODULE: false,
      });
    });

    it('remains disabled for explicit false and falsy values', () => {
      const falsyValues = ['false', '0', 'no', 'off', 'undefined', 'null', '', 'random', 'FALSE'];
      for (const val of falsyValues) {
        process.env.FEATURE_LEARNING_MODULE = val;
        expect(isFeatureEnabled('LEARNING_MODULE')).toBe(false);
        expect(isLearningModuleEnabled()).toBe(false);
      }
    });

    it('enables flag via FEATURE_LEARNING_MODULE with truthy strings', () => {
      const truthyValues = ['true', '1', 'yes', 'on', 'TRUE', 'True', 'ON'];
      for (const val of truthyValues) {
        process.env.FEATURE_LEARNING_MODULE = val;
        expect(isFeatureEnabled('LEARNING_MODULE')).toBe(true);
        expect(isLearningModuleEnabled()).toBe(true);
      }
    });

    it('enables flag via NEXT_PUBLIC_FEATURE_LEARNING_MODULE for browser consistency', () => {
      process.env.NEXT_PUBLIC_FEATURE_LEARNING_MODULE = 'true';
      expect(isFeatureEnabled('LEARNING_MODULE')).toBe(true);
      expect(isLearningModuleEnabled()).toBe(true);
    });

    it('enables flag via LEARNING_MODULE alias', () => {
      process.env.LEARNING_MODULE = 'true';
      expect(isFeatureEnabled('LEARNING_MODULE')).toBe(true);
    });

    it('enables flag via NEXT_PUBLIC_LEARNING_MODULE alias', () => {
      process.env.NEXT_PUBLIC_LEARNING_MODULE = 'true';
      expect(isFeatureEnabled('LEARNING_MODULE')).toBe(true);
    });

    it('correctly normalizes values in parseBooleanFlag', () => {
      expect(parseBooleanFlag('true')).toBe(true);
      expect(parseBooleanFlag('1')).toBe(true);
      expect(parseBooleanFlag('yes')).toBe(true);
      expect(parseBooleanFlag('on')).toBe(true);
      expect(parseBooleanFlag('  true  ')).toBe(true);

      expect(parseBooleanFlag('false')).toBe(false);
      expect(parseBooleanFlag('0')).toBe(false);
      expect(parseBooleanFlag('no')).toBe(false);
      expect(parseBooleanFlag('off')).toBe(false);
      expect(parseBooleanFlag('')).toBe(false);
      expect(parseBooleanFlag(null)).toBe(false);
      expect(parseBooleanFlag(undefined)).toBe(false);
    });
  });

  describe('2. Route Guard requireFeature()', () => {
    it('returns status 404 with descriptive message when flag is disabled (unset)', async () => {
      delete process.env.FEATURE_LEARNING_MODULE;

      const guard = requireFeature('LEARNING_MODULE');
      expect(guard.authorized).toBe(false);
      expect(guard.response).not.toBeNull();
      expect(guard.response!.status).toBe(404);

      const body = await guard.response!.json();
      expect(body.success).toBe(false);
      expect(body.message).toContain('disabled');
      expect(body.data).toBeNull();
    });

    it('returns status 404 when flag is explicitly set to false', async () => {
      process.env.FEATURE_LEARNING_MODULE = 'false';

      const guard = requireFeature('LEARNING_MODULE');
      expect(guard.authorized).toBe(false);
      expect(guard.response!.status).toBe(404);
    });

    it('allows route to proceed when flag is enabled', () => {
      process.env.FEATURE_LEARNING_MODULE = 'true';

      const guard = requireFeature('LEARNING_MODULE');
      expect(guard.authorized).toBe(true);
      expect(guard.response).toBeNull();
    });

    it('allows route to proceed when NEXT_PUBLIC_FEATURE_LEARNING_MODULE is enabled', () => {
      process.env.NEXT_PUBLIC_FEATURE_LEARNING_MODULE = 'true';

      const guard = requireFeature('LEARNING_MODULE');
      expect(guard.authorized).toBe(true);
      expect(guard.response).toBeNull();
    });
  });

  describe('3. Conditional Dashboard Navigation', () => {
    it('hides Learning Module navigation for Professor when disabled', () => {
      delete process.env.FEATURE_LEARNING_MODULE;
      currentMockUser = { name: 'Professor Oak', email: 'prof@iiit.ac.in', role: 'PROFESSOR' };

      render(
        <DashboardLayout>
          <div>Main Content</div>
        </DashboardLayout>
      );

      // Existing links must remain intact
      expect(screen.getByText('Dashboard')).toBeDefined();
      expect(screen.getByText('Courses')).toBeDefined();
      expect(screen.getByText('Exams')).toBeDefined();
      expect(screen.getByText('Flag Review Queue')).toBeDefined();
      expect(screen.getByText('Create Course')).toBeDefined();
      expect(screen.getByText('Create Exam')).toBeDefined();

      // Learning Module must be hidden
      expect(screen.queryByText('Learning Module')).toBeNull();
    });

    it('shows Learning Module navigation for Professor when enabled', () => {
      process.env.NEXT_PUBLIC_FEATURE_LEARNING_MODULE = 'true';
      currentMockUser = { name: 'Professor Oak', email: 'prof@iiit.ac.in', role: 'PROFESSOR' };

      render(
        <DashboardLayout>
          <div>Main Content</div>
        </DashboardLayout>
      );

      const learningLinks = screen.getAllByText('Learning Module');
      expect(learningLinks.length).toBeGreaterThan(0);
      const linkAnchor = learningLinks[0].closest('a');
      expect(linkAnchor?.getAttribute('href')).toBe('/professor/learning');

      // Existing links must still be present
      expect(screen.getByText('Dashboard')).toBeDefined();
      expect(screen.getByText('Courses')).toBeDefined();
      expect(screen.getByText('Exams')).toBeDefined();
    });

    it('hides Learning Module navigation for Student when disabled', () => {
      delete process.env.FEATURE_LEARNING_MODULE;
      currentMockUser = { name: 'Student Ash', email: 'student@iiit.ac.in', role: 'STUDENT' };

      render(
        <DashboardLayout>
          <div>Student Workspace</div>
        </DashboardLayout>
      );

      expect(screen.getByText('Dashboard')).toBeDefined();
      expect(screen.queryByText('Learning Module')).toBeNull();
    });

    it('shows Learning Module navigation for Student when enabled', () => {
      process.env.NEXT_PUBLIC_FEATURE_LEARNING_MODULE = 'true';
      currentMockUser = { name: 'Student Ash', email: 'student@iiit.ac.in', role: 'STUDENT' };

      render(
        <DashboardLayout>
          <div>Student Workspace</div>
        </DashboardLayout>
      );

      const learningLinks = screen.getAllByText('Learning Module');
      expect(learningLinks.length).toBeGreaterThan(0);
      const linkAnchor = learningLinks[0].closest('a');
      expect(linkAnchor?.getAttribute('href')).toBe('/student/learning');

      expect(screen.getByText('Dashboard')).toBeDefined();
    });

    it('leaves Admin and TA navigation unchanged regardless of flag state', () => {
      // Test TA with flag disabled
      delete process.env.FEATURE_LEARNING_MODULE;
      currentMockUser = { name: 'TA Brock', email: 'ta@iiit.ac.in', role: 'TA' };

      const { unmount } = render(
        <DashboardLayout>
          <div>TA Workspace</div>
        </DashboardLayout>
      );

      expect(screen.getByText('Dashboard')).toBeDefined();
      expect(screen.queryByText('Learning Module')).toBeNull();
      unmount();

      // Test TA with flag enabled
      process.env.NEXT_PUBLIC_FEATURE_LEARNING_MODULE = 'true';
      render(
        <DashboardLayout>
          <div>TA Workspace</div>
        </DashboardLayout>
      );

      expect(screen.getByText('Dashboard')).toBeDefined();
      expect(screen.queryByText('Learning Module')).toBeNull();
    });
  });
});
