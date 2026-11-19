import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('AE-238: Role-Based User Manuals and Documentation Suite', () => {
  const rootDir = process.cwd();
  const profGuidePath = path.join(rootDir, 'docs', 'USER_GUIDE_PROFESSOR.md');
  const taGuidePath = path.join(rootDir, 'docs', 'USER_GUIDE_TA.md');
  const studentGuidePath = path.join(rootDir, 'docs', 'USER_GUIDE_STUDENT.md');
  const adminGuidePath = path.join(rootDir, 'docs', 'USER_GUIDE_ADMIN.md');

  describe('Professor User Guide (USER_GUIDE_PROFESSOR.md)', () => {
    it('should exist and document complete instructor workflows', () => {
      expect(fs.existsSync(profGuidePath)).toBe(true);
      const content = fs.readFileSync(profGuidePath, 'utf8');

      // Course & Roster CSV
      expect(content).toContain('Import Roster (CSV)');
      expect(content).toContain('studentId,email,name');
      // Rubric & Score steps
      expect(content).toContain('Configure Rubrics');
      expect(content).toContain('Score Step Granularity');
      // Allocation & Velocity
      expect(content).toContain('Grading Allocations');
      expect(content).toContain('Allocation Monitor');
      // Publication & Unpublishing
      expect(content).toContain('Publication Preview Modal');
      expect(content).toContain('Unpublish Results');
      expect(content).toContain('Audit Justification Reason');
      // Regrade arbitration
      expect(content).toContain('Regrade Requests');
      expect(content).toContain('Approve Regrade');
      expect(content).toContain('Reject Regrade');
    });
  });

  describe('Teaching Assistant User Guide (USER_GUIDE_TA.md)', () => {
    it('should exist and document grading tools, shortcuts, and offline mode', () => {
      expect(fs.existsSync(taGuidePath)).toBe(true);
      const content = fs.readFileSync(taGuidePath, 'utf8');

      // Anonymity
      expect(content).toContain('anonymized');
      // Annotation tools
      expect(content).toContain('Pen Tool');
      expect(content).toContain('Eraser Tool');
      expect(content).toContain('Checkmark Stamp');
      expect(content).toContain('Cross Stamp');
      expect(content).toContain('Comment Tag');
      // Shortcuts
      expect(content).toContain('[Tab]');
      expect(content).toContain('[P]');
      expect(content).toContain('[E]');
      expect(content).toContain('[S]');
      expect(content).toContain('[N]');
      expect(content).toContain('[B]');
      // Offline sync
      expect(content).toContain('Offline Drafts');
      expect(content).toContain('IndexedDB');
      // Flagging
      expect(content).toContain('Flag Script');
      expect(content).toContain('Illegible Handwriting');
      expect(content).toContain('Suspected Malpractice');
    });
  });

  describe('Student User Guide (USER_GUIDE_STUDENT.md)', () => {
    it('should exist and document script viewing, watermarks, and regrade appeals', () => {
      expect(fs.existsSync(studentGuidePath)).toBe(true);
      const content = fs.readFileSync(studentGuidePath, 'utf8');

      // Login & Portal
      expect(content).toContain('@students.iiit.ac.in');
      expect(content).toContain('Evaluated Script Viewer');
      expect(content).toContain('digital watermark');
      // Regrade submission
      expect(content).toContain('Regrade Window');
      expect(content).toContain('Request Regrade');
      // Lifecycle
      expect(content).toContain('Pending Review');
      expect(content).toContain('Under Evaluation');
      expect(content).toContain('Resolved (Approved)');
      expect(content).toContain('Resolved (Rejected)');
    });
  });

  describe('Administrator User Guide (USER_GUIDE_ADMIN.md)', () => {
    it('should exist and document terms, RBAC, HMAC verification, and operations', () => {
      expect(fs.existsSync(adminGuidePath)).toBe(true);
      const content = fs.readFileSync(adminGuidePath, 'utf8');

      // Academic config
      expect(content).toContain('Academic Settings');
      expect(content).toContain('Create Course');
      // RBAC
      expect(content).toContain('ADMIN');
      expect(content).toContain('PROFESSOR');
      expect(content).toContain('TEACHING_ASSISTANT');
      expect(content).toContain('STUDENT');
      // Audit & HMAC
      expect(content).toContain('Audit Viewer');
      expect(content).toContain('verifyIntegrity.ts');
      expect(content).toContain('HMAC');
      // Ops
      expect(content).toContain('/api/health');
      expect(content).toContain('backupDatabase.ts');
      expect(content).toContain('restoreDatabase.ts');
    });
  });
});
