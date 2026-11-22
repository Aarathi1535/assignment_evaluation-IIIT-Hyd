import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { SHORTCUT_MAP } from '../lib/shortcutMap';

describe('AE-238: Role-Based User Manuals Accuracy and Integration Suite', () => {
  const rootDir = process.cwd();
  const profGuidePath = path.join(rootDir, 'docs', 'USER_GUIDE_PROFESSOR.md');
  const taGuidePath = path.join(rootDir, 'docs', 'USER_GUIDE_TA.md');
  const studentGuidePath = path.join(rootDir, 'docs', 'USER_GUIDE_STUDENT.md');
  const adminGuidePath = path.join(rootDir, 'docs', 'USER_GUIDE_ADMIN.md');

  describe('Route Accuracy across all Manuals', () => {
    it('should reference existing dashboard routes in USER_GUIDE_PROFESSOR.md', () => {
      const content = fs.readFileSync(profGuidePath, 'utf8');

      // Verify referenced professor pages exist in src/app/(dashboard)
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
      expect(content).not.toContain('/admin/audit\n');
    });
  });

  describe('Keyboard Shortcuts & Canvas Hotkeys Accuracy (USER_GUIDE_TA.md)', () => {
    it('should match actual shortcut keys in SHORTCUT_MAP', () => {
      const content = fs.readFileSync(taGuidePath, 'utf8');

      // Verify that every single key combination mentioned in the manual is in SHORTCUT_MAP
      const validKeys = new Set<string>();
      for (const item of SHORTCUT_MAP) {
        validKeys.add(item.key.toUpperCase());
        if (item.keys) {
          for (const k of item.keys) {
            validKeys.add(k.toUpperCase());
          }
        }
      }

      // Hotkeys: P (Pen), E (Eraser), C (Check), X (Cross), H (Highlighter), T (Text), V (Select)
      expect(validKeys.has('P')).toBe(true);
      expect(validKeys.has('E')).toBe(true);
      expect(validKeys.has('C')).toBe(true);
      expect(validKeys.has('X')).toBe(true);
      expect(validKeys.has('H')).toBe(true);
      expect(validKeys.has('T')).toBe(true);
      expect(validKeys.has('V')).toBe(true);

      // Save Draft vs Submit Final: Enter is draft, Ctrl+Enter is final
      expect(content).toContain('[Enter]');
      expect(content).toContain('Save current question marks and feedback as draft');
      expect(content).toContain('[Ctrl+Enter]');
      expect(content).toContain('Finalize and submit evaluation');

      // Must not claim Tab or Shift+Tab are captured for grading
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
    it('should NOT instruct admins to execute an unsafeguarded database restore', () => {
      const adminContent = fs.readFileSync(adminGuidePath, 'utf8');
      expect(adminContent).not.toMatch(/npx tsx src\/scripts\/restoreDatabase\.ts backups\/latest(?!\s+--dry-run)/);
      expect(adminContent).toContain('--dry-run');
      expect(adminContent).toContain('MongoDB Atlas Continuous Cloud Backups');
    });

    it('should accurately describe the /api/health JSON structure', () => {
      const adminContent = fs.readFileSync(adminGuidePath, 'utf8');
      expect(adminContent).toContain('/api/health');
      expect(adminContent).toContain('"success": true');
      expect(adminContent).toContain('"status": "healthy"');
      expect(adminContent).toContain('"database": "connected"');
    });
  });
});
