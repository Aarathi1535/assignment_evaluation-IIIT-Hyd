import { describe, it, expect } from 'vitest';
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
});
