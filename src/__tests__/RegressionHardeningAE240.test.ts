import { describe, it, expect } from 'vitest';
import { isRegradeWindowOpen as checkExamRegradeWindow } from '../utils/regradeWindow';
import {
  isRegradeWindowOpen,
  resolveDraftConflict,
  validatePayloadSize,
  sanitizeMark,
} from '../lib/regressionHardening';

describe('AE-240: Final Bug Fixes, Regression Hardening, and Resilience Guards', () => {
  describe('Integration with Exam Regrade Utility (src/utils/regradeWindow.ts)', () => {
    const opensAt = new Date('2026-11-01T00:00:00Z');
    const closesAt = new Date('2026-11-08T00:00:00Z');

    it('should confirm regrade window is open when within range', () => {
      const exam = { regradeWindowOpensAt: opensAt, regradeWindowClosesAt: closesAt };
      const mid = new Date('2026-11-04T12:00:00Z');
      expect(checkExamRegradeWindow(exam, mid)).toBe(true);
    });

    it('should reject regrade window when current time is after closesAt', () => {
      const exam = { regradeWindowOpensAt: opensAt, regradeWindowClosesAt: closesAt };
      const after = new Date(closesAt.getTime() + 1);
      expect(checkExamRegradeWindow(exam, after)).toBe(false);
    });

    it('should accept regrade window at the exact closesAt timestamp', () => {
      const exam = { regradeWindowOpensAt: opensAt, regradeWindowClosesAt: closesAt };
      expect(checkExamRegradeWindow(exam, closesAt)).toBe(true);
    });

    it('should reject regrade window when current time is before opensAt', () => {
      const exam = { regradeWindowOpensAt: opensAt, regradeWindowClosesAt: closesAt };
      const before = new Date(opensAt.getTime() - 1);
      expect(checkExamRegradeWindow(exam, before)).toBe(false);
    });

    it('should reject if dates are null or missing', () => {
      expect(checkExamRegradeWindow({}, new Date())).toBe(false);
      expect(checkExamRegradeWindow({ regradeWindowOpensAt: opensAt, regradeWindowClosesAt: null }, new Date())).toBe(false);
      expect(checkExamRegradeWindow({ regradeWindowOpensAt: null, regradeWindowClosesAt: closesAt }, new Date())).toBe(false);
    });
  });

  describe('Regrade Window Boundary Evaluation (isRegradeWindowOpen)', () => {
    const baseStart = new Date('2026-11-01T00:00:00Z').getTime();
    const baseEnd = new Date('2026-11-08T00:00:00Z').getTime(); // 7-day window

    it('should confirm active window when current time is within bounds', () => {
      const midTime = new Date('2026-11-04T12:00:00Z').getTime();
      const status = isRegradeWindowOpen(baseStart, baseEnd, midTime);

      expect(status.isOpen).toBe(true);
      expect(status.status).toBe('OPEN');
      expect(status.remainingMs).toBeGreaterThan(0);
    });

    it('should report NOT_OPEN_YET if current time is prior to window opening', () => {
      const beforeTime = new Date('2026-10-31T23:00:00Z').getTime();
      const status = isRegradeWindowOpen(baseStart, baseEnd, beforeTime);

      expect(status.isOpen).toBe(false);
      expect(status.status).toBe('NOT_OPEN_YET');
    });

    it('should strictly reject submissions after the window closing boundary with zero grace tolerance', () => {
      // 1 ms past the closing deadline: strictly rejected
      const lateTime = baseEnd + 1;
      const status = isRegradeWindowOpen(baseStart, baseEnd, lateTime);

      expect(status.isOpen).toBe(false);
      expect(status.status).toBe('EXPIRED');
      expect(status.remainingMs).toBe(0);
    });

    it('should allow submissions at the exact closing boundary timestamp', () => {
      const exactEndTime = baseEnd;
      const status = isRegradeWindowOpen(baseStart, baseEnd, exactEndTime);

      expect(status.isOpen).toBe(true);
      expect(status.status).toBe('OPEN');
      expect(status.remainingMs).toBe(0);
    });

    it('should throw an error on malformed date inputs', () => {
      expect(() => isRegradeWindowOpen('invalid-date', baseEnd)).toThrow('Invalid date parameter');
    });
  });

  describe('Multi-Tab Draft Conflict Resolution (resolveDraftConflict)', () => {
    it('should select incoming draft when incoming version is higher', () => {
      const local = { version: 2, updatedAt: 1000, marks: 5 };
      const incoming = { version: 3, updatedAt: 1200, marks: 7 };

      const res = resolveDraftConflict(local, incoming);
      expect(res.winner).toBe('incoming');
      expect(res.resolved.marks).toBe(7);
      expect(res.conflictDetected).toBe(true);
    });

    it('should preserve local draft when local version is higher', () => {
      const local = { version: 5, updatedAt: 2000, marks: 8 };
      const incoming = { version: 4, updatedAt: 1800, marks: 6 };

      const res = resolveDraftConflict(local, incoming);
      expect(res.winner).toBe('local');
      expect(res.resolved.marks).toBe(8);
      expect(res.conflictDetected).toBe(true);
    });

    it('should tie-break equal versions based on latest timestamp', () => {
      const local = { version: 2, updatedAt: 1000, marks: 5 };
      const incoming = { version: 2, updatedAt: 1050, marks: 6 }; // Newer by 50ms

      const res = resolveDraftConflict(local, incoming);
      expect(res.winner).toBe('incoming');
      expect(res.resolved.marks).toBe(6);
    });
  });

  describe('Bounded Payload Stream Guard (validatePayloadSize)', () => {
    it('should approve payloads within safe memory limits (<= 15MB)', () => {
      const fiveMb = 5 * 1024 * 1024;
      expect(validatePayloadSize(fiveMb).valid).toBe(true);
    });

    it('should reject payloads exceeding maximum buffer ceiling (> 15MB)', () => {
      const twentyMb = 20 * 1024 * 1024;
      const res = validatePayloadSize(twentyMb);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('exceeds maximum allowed threshold');
    });

    it('should reject negative byte lengths', () => {
      expect(validatePayloadSize(-1).valid).toBe(false);
    });
  });

  describe('Safe Numerical Score Sanitization (sanitizeMark)', () => {
    it('should validate valid integer and fractional scores', () => {
      expect(sanitizeMark(8, 10, 0.5)).toEqual({ valid: true, sanitized: 8 });
      expect(sanitizeMark(7.5, 10, 0.5)).toEqual({ valid: true, sanitized: 7.5 });
    });

    it('should snap floating-point scores that deviate from score step', () => {
      const res = sanitizeMark(7.4, 10, 0.5);
      expect(res.valid).toBe(false);
      expect(res.sanitized).toBe(7.5);
      expect(res.error).toContain('snapped to 7.5');
    });

    it('should reject negative numbers and numbers exceeding maximum question points', () => {
      expect(sanitizeMark(-1, 10, 0.5).valid).toBe(false);

      const exceedRes = sanitizeMark(12, 10, 0.5);
      expect(exceedRes.valid).toBe(false);
      expect(exceedRes.sanitized).toBe(10);
      expect(exceedRes.error).toContain('exceeds maximum');
    });

    it('should reject empty or non-numeric inputs', () => {
      expect(sanitizeMark('', 10).valid).toBe(false);
      expect(sanitizeMark('not-a-number', 10).valid).toBe(false);
      expect(sanitizeMark(null, 10).valid).toBe(false);
    });
  });


});
