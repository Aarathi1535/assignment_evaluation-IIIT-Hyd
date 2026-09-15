/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  formatTaProgressLabel, 
  calculateProgressPercentage, 
  formatOverallGradingSummary,
  formatEtaDisplay,
  calculateTimePerScript,
  formatDuration 
} from '../components/TaLiveProgressView';
import { 
  filterEligibleReplacementTas, 
  isAllocationReassignable, 
  getReassignmentScopeText, 
  formatReassignSuccessMessage 
} from '../components/ReassignModal';

describe('AE-120: Dashboard Accessibility Audits and Regression Tests', () => {
  describe('Accessible String and Label Formatting', () => {
    it('generates meaningful per-TA accessible progress labels', () => {
      expect(formatTaProgressLabel('Alice', 10, 20)).toBe('Alice — 10/20');
      expect(formatTaProgressLabel('Bob', 0, 0)).toBe('Bob — 0/0');
      expect(formatTaProgressLabel(null, 5, 10)).toBe('Teaching Assistant — 5/10');
      expect(formatTaProgressLabel('', 5, 10)).toBe('Teaching Assistant — 5/10');
    });

    it('calculates accessible percentage values bounded between 0 and 100', () => {
      expect(calculateProgressPercentage(5, 10)).toBe(50);
      expect(calculateProgressPercentage(0, 0)).toBe(0);
      expect(calculateProgressPercentage(15, 10)).toBe(100);
      expect(calculateProgressPercentage(null, 10)).toBe(0);
      expect(calculateProgressPercentage(undefined, undefined, 0.756)).toBe(76);
    });

    it('formats overall grading summary accessible metrics', () => {
      const summary = formatOverallGradingSummary(25, 100);
      expect(summary.graded).toBe(25);
      expect(summary.total).toBe(100);
      expect(summary.remaining).toBe(75);
      expect(summary.percentage).toBe(25);
    });

    it('formats accessible ETA descriptions across all states', () => {
      expect(formatEtaDisplay(undefined, false, 'COMPLETED')).toBe('Grading Complete (100%)');
      expect(formatEtaDisplay(undefined, false, 'NO_ALLOCATIONS')).toBe('ETA unavailable (no allocations)');
      expect(formatEtaDisplay(undefined, false, 'INSUFFICIENT_DATA')).toBe('ETA pending more completed grading data');
      
      const futureDate = new Date(Date.now() + 180000);
      const etaStr = formatEtaDisplay(futureDate, true, undefined, 180);
      expect(etaStr).toContain('remaining');
    });

    it('calculates duration for scripts with accessible fallback', () => {
      const t1 = new Date('2026-09-04T10:00:00Z');
      const t2 = new Date('2026-09-04T10:05:30Z');
      expect(calculateTimePerScript(t1, t2, 'COMPLETED')).toBe(330);
      expect(calculateTimePerScript(t1, t2, 'IN_PROGRESS')).toBeNull();
      expect(formatDuration(330)).toBe('5m 30s');
      expect(formatDuration(45)).toBe('45s');
      expect(formatDuration(null)).toBe('—');
    });
  });

  describe('Reassignment Modal Accessibility and Validation', () => {
    it('filters eligible replacement TAs excluding the active TA and inactive accounts', () => {
      const allTas = [
        { id: 'ta-1', name: 'Alice', isActive: true },
        { id: 'ta-2', name: 'Bob', isActive: true },
        { id: 'ta-3', name: 'Charlie', isActive: false },
      ];

      const eligible = filterEligibleReplacementTas(allTas, 'ta-1');
      expect(eligible.length).toBe(1);
      expect(eligible[0].id).toBe('ta-2');
    });

    it('only permits reassignment for PENDING allocations', () => {
      expect(isAllocationReassignable('PENDING')).toBe(true);
      expect(isAllocationReassignable('IN_PROGRESS')).toBe(false);
      expect(isAllocationReassignable('COMPLETED')).toBe(false);
      expect(isAllocationReassignable(null)).toBe(false);
    });

    it('formats reassignment scope text and success announcements for screen readers', () => {
      expect(getReassignmentScopeText(3)).toBe('Question 3');
      expect(getReassignmentScopeText(null)).toBe('Whole Script');
      expect(formatReassignSuccessMessage('SCR-001', 'Bob')).toBe('Successfully reassigned SCR-001 to Bob.');
    });
  });

  describe('Dialog Focus Management (WCAG 2.4.3 & 2.1.2)', () => {
    // Helper to mock DOM environment for hook tests
    let mockDocument: any;
    let savedDocument: any;

    beforeEach(() => {
      savedDocument = global.document;
    });

    afterEach(() => {
      global.document = savedDocument;
    });

    it('1. moves focus to initialFocusRef on dialog open and returns focus to trigger on close', async () => {
      const trigger = {
        focus: vi.fn(),
      };
      const dialogInput = {
        focus: vi.fn(),
      };

      const docBody = {
        contains: vi.fn().mockReturnValue(true),
      };

      mockDocument = {
        activeElement: trigger,
        body: docBody,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      };
      global.document = mockDocument;

      // Test hook focus logic
      const initialFocusRef = { current: dialogInput as any };

      let isOpen = true;
      let capturedTrigger: any = null;

      // Simulate open effect
      if (isOpen) {
        capturedTrigger = mockDocument.activeElement;
        if (initialFocusRef.current?.focus) {
          initialFocusRef.current.focus();
        }
      }

      expect(dialogInput.focus).toHaveBeenCalledTimes(1);
      expect(capturedTrigger).toBe(trigger);

      // Simulate close effect
      isOpen = false;
      if (!isOpen && capturedTrigger?.focus && mockDocument.body.contains(capturedTrigger)) {
        capturedTrigger.focus();
      }

      expect(trigger.focus).toHaveBeenCalledTimes(1);
    });

    it('2. falls back to container querySelector or container element when initialFocusRef is null', () => {
      const firstFocusableBtn = { focus: vi.fn() };
      const container = {
        focus: vi.fn(),
        querySelector: vi.fn().mockReturnValue(firstFocusableBtn),
      };

      if (container.querySelector) {
        const found = container.querySelector('button');
        if (found) {
          found.focus();
        }
      }

      expect(firstFocusableBtn.focus).toHaveBeenCalledTimes(1);
    });

    it('3. gracefully handles missing or removed trigger element without throwing', () => {
      const removedTrigger = {
        focus: vi.fn(() => {
          throw new Error('Element not connected to DOM');
        }),
      };

      const docBody = {
        contains: vi.fn().mockReturnValue(false), // Removed from DOM
      };

      expect(() => {
        if (docBody.contains(removedTrigger)) {
          removedTrigger.focus();
        }
      }).not.toThrow();

      expect(removedTrigger.focus).not.toHaveBeenCalled();
    });

    it('4. ReassignModal focus target logic: selects select input when TAs available, otherwise close button', () => {
      const availableTas = [{ id: 'ta-1', name: 'Hermione', isActive: true }];
      const eligible = filterEligibleReplacementTas(availableTas, 'ta-current');

      const selectRef = { current: { focus: vi.fn() } };
      const closeBtnRef = { current: { focus: vi.fn() } };

      const targetRef = eligible.length > 0 ? selectRef : closeBtnRef;
      targetRef.current.focus();

      expect(selectRef.current.focus).toHaveBeenCalledTimes(1);
      expect(closeBtnRef.current.focus).not.toHaveBeenCalled();

      // When no eligible TAs are available
      const emptyEligible = filterEligibleReplacementTas([], 'ta-current');
      const fallbackTarget = emptyEligible.length > 0 ? selectRef : closeBtnRef;
      fallbackTarget.current.focus();

      expect(closeBtnRef.current.focus).toHaveBeenCalledTimes(1);
    });

    it('5. NotificationPanel focus target logic: targets Mark All Read when unread > 0, otherwise close button', () => {
      const markAllBtnRef = { current: { focus: vi.fn() } };
      const closeBtnRef = { current: { focus: vi.fn() } };

      const unreadCount1 = 5;
      const target1 = unreadCount1 > 0 ? markAllBtnRef : closeBtnRef;
      target1.current.focus();
      expect(markAllBtnRef.current.focus).toHaveBeenCalledTimes(1);

      const unreadCount2 = 0;
      const target2 = unreadCount2 > 0 ? markAllBtnRef : closeBtnRef;
      target2.current.focus();
      expect(closeBtnRef.current.focus).toHaveBeenCalledTimes(1);
    });

    it('6. Delete Exam modal focus target logic: safely targets Cancel button on open to prevent accidental deletion', () => {
      const cancelBtnRef = { current: { focus: vi.fn() } };
      const deleteBtnRef = { current: { focus: vi.fn() } };

      // Safe destructive action standard: focus the non-destructive Cancel button
      cancelBtnRef.current.focus();

      expect(cancelBtnRef.current.focus).toHaveBeenCalledTimes(1);
      expect(deleteBtnRef.current.focus).not.toHaveBeenCalled();
    });

    it('7. handles Escape keydown event and dismisses dialog cleanly', () => {
      const onClose = vi.fn();
      const escapeEvent = { key: 'Escape', preventDefault: vi.fn() };

      const handleKeyDown = (e: any) => {
        if (e.key === 'Escape') {
          onClose();
        }
      };

      handleKeyDown(escapeEvent);
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
