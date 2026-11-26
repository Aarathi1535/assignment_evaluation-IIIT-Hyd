import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SHORTCUT_MAP } from '../lib/shortcutMap';
import { UserRole } from '../constants/permissions';
import { RegradeStatus, RegradeDecisionOutcome } from '../models/RegradeRequest';
import { FlagReason } from '../models/ScriptFlag';

describe('AE-238: Role-Based User Manuals Accuracy and Integration Suite', () => {
  const rootDir = process.cwd();
  const profGuidePath = path.join(rootDir, 'docs', 'USER_GUIDE_PROFESSOR.md');
  const taGuidePath = path.join(rootDir, 'docs', 'USER_GUIDE_TA.md');
  const studentGuidePath = path.join(rootDir, 'docs', 'USER_GUIDE_STUDENT.md');
  const adminGuidePath = path.join(rootDir, 'docs', 'USER_GUIDE_ADMIN.md');

  describe('Route Accuracy across all Manuals', () => {
    it('should reference existing dashboard routes in USER_GUIDE_PROFESSOR.md', () => {
      const content = fs.readFileSync(profGuidePath, 'utf8');

      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'professor', 'page.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'professor', 'courses', 'page.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'professor', 'exams', 'page.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'professor', 'exams', 'create', 'page.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'professor', 'flags', 'page.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'professor', 'regrade-requests', 'page.tsx'))).toBe(true);

      expect(content).toContain('/professor/exams');
      expect(content).toContain('/professor/exams/create');
      expect(content).toContain('/professor/regrade-requests');
      expect(content).toContain('/professor/flags');
    });

    it('should reference existing dashboard routes in USER_GUIDE_TA.md', () => {
      const content = fs.readFileSync(taGuidePath, 'utf8');

      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'ta', 'page.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'grading', '[scriptId]', 'page.tsx'))).toBe(true);

      expect(content).toContain('/ta');
      expect(content).toContain('/grading/[scriptId]');
    });

    it('should reference existing dashboard routes in USER_GUIDE_STUDENT.md', () => {
      const content = fs.readFileSync(studentGuidePath, 'utf8');

      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'student', 'page.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'student', 'results', 'page.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'student', 'results', '[scriptId]', 'page.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'student', 'regrade-requests', 'page.tsx'))).toBe(true);

      expect(content).toContain('/student');
      expect(content).toContain('/student/results');
      expect(content).toContain('/student/results/[scriptId]');
      expect(content).toContain('/student/regrade-requests');
    });

    it('should reference existing dashboard routes in USER_GUIDE_ADMIN.md', () => {
      const content = fs.readFileSync(adminGuidePath, 'utf8');

      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'admin', 'page.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'admin', 'users', 'page.tsx'))).toBe(true);
      expect(fs.existsSync(path.join(rootDir, 'src', 'app', '(dashboard)', 'admin', 'audit-logs', 'page.tsx'))).toBe(true);

      expect(content).toContain('/admin');
      expect(content).toContain('/admin/users');
      expect(content).toContain('/admin/audit-logs');
      expect(content).not.toContain('Academic Settings');
      expect(content).not.toContain('/professor/courses');
    });
  });

  describe('Model & Value Alignment across all Manuals', () => {
    it('aligns with UserRole enum values (ADMIN, PROFESSOR, TA, STUDENT)', () => {
      const adminContent = fs.readFileSync(adminGuidePath, 'utf8');
      expect(adminContent).toContain('`ADMIN`');
      expect(adminContent).toContain('`PROFESSOR`');
      expect(adminContent).toContain('`TA`');
      expect(adminContent).toContain('`STUDENT`');
      expect(adminContent).not.toContain('`TEACHING_ASSISTANT`');
      expect(UserRole.TA).toBe('TA');
    });

    it('aligns with RegradeStatus and Decision enum values (OPEN, REVIEWING, RESOLVED)', () => {
      const profContent = fs.readFileSync(profGuidePath, 'utf8');
      const studentContent = fs.readFileSync(studentGuidePath, 'utf8');

      expect(profContent).toContain('`OPEN`');
      expect(profContent).toContain('`REVIEWING`');
      expect(profContent).toContain('`RESOLVED`');

      expect(studentContent).toContain('**OPEN**');
      expect(studentContent).toContain('**REVIEWING**');
      expect(studentContent).toContain('**RESOLVED**');

      expect(RegradeStatus.OPEN).toBe('OPEN');
      expect(RegradeStatus.REVIEWING).toBe('REVIEWING');
      expect(RegradeStatus.RESOLVED).toBe('RESOLVED');
      expect(RegradeDecisionOutcome.APPROVED).toBe('APPROVED');
      expect(RegradeDecisionOutcome.REJECTED).toBe('REJECTED');
    });

    it('aligns with FlagReason definitions without inventing fictional buttons in TA guide', () => {
      const taContent = fs.readFileSync(taGuidePath, 'utf8');
      expect(taContent).not.toContain('Flag Script');
      expect(FlagReason.CHEATING_SUSPECTED).toBe('CHEATING_SUSPECTED');
      expect(FlagReason.ILLEGIBLE).toBe('ILLEGIBLE');
      expect(FlagReason.OTHER).toBe('OTHER');
    });
  });

  describe('Keyboard Shortcuts & Canvas Hotkeys Accuracy (USER_GUIDE_TA.md)', () => {
    it('should match actual shortcut keys in SHORTCUT_MAP', () => {
      const content = fs.readFileSync(taGuidePath, 'utf8');

      const validKeys = new Set<string>();
      for (const item of SHORTCUT_MAP) {
        validKeys.add(item.key.toUpperCase());
        if (item.keys) {
          for (const k of item.keys) {
            validKeys.add(k.toUpperCase());
          }
        }
      }

      expect(validKeys.has('P')).toBe(true);
      expect(validKeys.has('E')).toBe(true);
      expect(validKeys.has('C')).toBe(true);
      expect(validKeys.has('X')).toBe(true);
      expect(validKeys.has('H')).toBe(true);
      expect(validKeys.has('T')).toBe(true);
      expect(validKeys.has('V')).toBe(true);

      expect(content).toContain('[Enter]');
      expect(content).toContain('Save current question marks and feedback as draft');
      expect(content).toContain('[Ctrl+Enter]');
      expect(content).toContain('Finalize and submit evaluation');

      expect(content).not.toContain('[Tab] / [Shift+Tab]');
    });
  });

  describe('Offline Storage Integrity', () => {
    it('should document localStorage with in-memory fallback, not IndexedDB', () => {
      const taContent = fs.readFileSync(taGuidePath, 'utf8');
      expect(taContent).toContain('localStorage');
      expect(taContent).not.toContain('IndexedDB');
    });
  });

  describe('Authentication Mechanism Accuracy', () => {
    it('should reference standard credential login and avoid fictional IIIT SSO claims', () => {
      const studentContent = fs.readFileSync(studentGuidePath, 'utf8');
      expect(studentContent).toContain('/login');
      expect(studentContent).not.toContain('IIIT SSO');
      expect(studentContent).not.toContain('Sign in with IIIT Account');
    });
  });

  describe('Publish Confirmation Accuracy (USER_GUIDE_PROFESSOR.md)', () => {
    it('should accurately describe Publish Results Modal without fake confirmation phrase', () => {
      const profContent = fs.readFileSync(profGuidePath, 'utf8');
      expect(profContent).toContain('Publish Results Modal');
      expect(profContent).toContain('Publish Results');
      expect(profContent).not.toContain('faculty confirmation phrase');
    });
  });

  describe('Disaster Recovery Safeguards (USER_GUIDE_ADMIN.md)', () => {
    it('points to Atlas backups only and removes nonexistent backupDatabase/restoreDatabase scripts', () => {
      const adminContent = fs.readFileSync(adminGuidePath, 'utf8');
      expect(adminContent).not.toContain('backupDatabase.ts');
      expect(adminContent).not.toContain('restoreDatabase.ts');
      expect(adminContent).toContain('MongoDB Atlas Continuous Cloud Backups');
    });

    it('accurately describes the /api/health JSON structure without fabricated uptime field', () => {
      const adminContent = fs.readFileSync(adminGuidePath, 'utf8');
      expect(adminContent).toContain('/api/health');
      expect(adminContent).toContain('"success": true');
      expect(adminContent).toContain('"status": "healthy"');
      expect(adminContent).toContain('"database": "connected"');
      expect(adminContent).not.toContain('"uptime"');
    });
  });
});
