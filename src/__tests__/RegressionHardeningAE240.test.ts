import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  isRegradeWindowOpen,
  resolveDraftConflict,
  validatePayloadSize,
  sanitizeMark,
} from '../lib/regressionHardening';

describe('AE-240: Final Bug Fixes, Regression Hardening, and Resilience Guards', () => {
  const docsPath = path.join(process.cwd(), 'docs', 'REGRESSION_HARDENING.md');

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

    it('should accommodate clock skew at exact closing boundary (within 5000ms grace period)', () => {
      // 2 seconds past the closing deadline: within 5000ms tolerance
      const skewClosingTime = baseEnd + 2000;
      const status = isRegradeWindowOpen(baseStart, baseEnd, skewClosingTime, 5000);

      expect(status.isOpen).toBe(true);
      expect(status.status).toBe('OPEN');
    });

    it('should strictly reject submissions after the window and grace tolerance expire', () => {
      // 10 seconds past deadline (beyond 5000ms grace)
      const expiredTime = baseEnd + 10000;
      const status = isRegradeWindowOpen(baseStart, baseEnd, expiredTime, 5000);

      expect(status.isOpen).toBe(false);
      expect(status.status).toBe('EXPIRED');
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

  describe('Regression Hardening Documentation (docs/REGRESSION_HARDENING.md)', () => {
    it('should document audit matrix across all 5 operational phases', () => {
      expect(fs.existsSync(docsPath)).toBe(true);
      const content = fs.readFileSync(docsPath, 'utf8');

      expect(content).toContain('Ingestion');
      expect(content).toContain('Concurrency');
      expect(content).toContain('Offline Sync');
      expect(content).toContain('Regrades');
      expect(content).toContain('Storage');
      expect(content).toContain('isRegradeWindowOpen');
      expect(content).toContain('resolveDraftConflict');
      expect(content).toContain('detectFileTypeByMagicBytes');
      expect(content).toContain('sanitizeMark');
    });
  });
});
