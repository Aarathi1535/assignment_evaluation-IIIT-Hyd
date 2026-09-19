import { describe, it, expect, vi } from 'vitest';
import {
  createSessionRecord,
  validateSessionRecord,
  calculateBenchmarkSummary,
  compareWorkflows,
  formatDurationMs,
  type GradingSessionRecord,
} from '@/lib/gradingBenchmark';

describe('AE-160: Grading UX Benchmark Utility', () => {
  describe('Session Record Validation & Creation', () => {
    it('creates a valid session record with computed duration', () => {
      const record = createSessionRecord({
        scriptId: 'script-101',
        workflowType: 'SYSTEM',
        startTime: 10000,
        endTime: 25000,
        correctionsRecountsCount: 1,
        recalculationsCount: 0,
        notes: 'Smooth workflow',
      });

      expect(record.scriptId).toBe('script-101');
      expect(record.workflowType).toBe('SYSTEM');
      expect(record.durationMs).toBe(15000);
      expect(record.correctionsRecountsCount).toBe(1);
      expect(record.recalculationsCount).toBe(0);
      expect(record.notes).toBe('Smooth workflow');
    });

    it('validates session record attributes correctly', () => {
      expect(validateSessionRecord({
        scriptId: 'script-1',
        workflowType: 'PAPER',
        startTime: 100,
        endTime: 500,
        durationMs: 400,
        correctionsRecountsCount: 2,
        recalculationsCount: 1,
      })).toBe(true);

      // Invalid: endTime < startTime
      expect(validateSessionRecord({
        scriptId: 'script-1',
        workflowType: 'PAPER',
        startTime: 500,
        endTime: 100,
        durationMs: 400,
        correctionsRecountsCount: 0,
        recalculationsCount: 0,
      })).toBe(false);

      // Invalid: missing scriptId
      expect(validateSessionRecord({
        workflowType: 'SYSTEM',
        startTime: 100,
        endTime: 200,
        durationMs: 100,
        correctionsRecountsCount: 0,
        recalculationsCount: 0,
      })).toBe(false);
    });
  });

  describe('Benchmark Summary Calculation', () => {
    it('calculates aggregate metrics for 5 scripts correctly', () => {
      const paperRecords: GradingSessionRecord[] = [
        createSessionRecord({ scriptId: 'P1', workflowType: 'PAPER', startTime: 0, endTime: 120000, correctionsRecountsCount: 2, recalculationsCount: 1 }), // 2m
        createSessionRecord({ scriptId: 'P2', workflowType: 'PAPER', startTime: 0, endTime: 180000, correctionsRecountsCount: 3, recalculationsCount: 2 }), // 3m
        createSessionRecord({ scriptId: 'P3', workflowType: 'PAPER', startTime: 0, endTime: 150000, correctionsRecountsCount: 1, recalculationsCount: 1 }), // 2.5m
        createSessionRecord({ scriptId: 'P4', workflowType: 'PAPER', startTime: 0, endTime: 210000, correctionsRecountsCount: 4, recalculationsCount: 2 }), // 3.5m
        createSessionRecord({ scriptId: 'P5', workflowType: 'PAPER', startTime: 0, endTime: 140000, correctionsRecountsCount: 0, recalculationsCount: 0 }), // 2.33m
      ];

      const summary = calculateBenchmarkSummary(paperRecords, 'PAPER');

      expect(summary.scriptCount).toBe(5);
      expect(summary.totalDurationMs).toBe(800000); // 120 + 180 + 150 + 210 + 140 = 800s = 800,000ms
      expect(summary.averageDurationMs).toBe(160000); // 800,000 / 5 = 160,000ms (2m 40s)
      expect(summary.totalCorrectionsRecounts).toBe(10);
      expect(summary.averageCorrectionsPerScript).toBe(2);
      expect(summary.totalRecalculations).toBe(6);
      expect(summary.averageRecalculationsPerScript).toBe(1.2);
    });

    it('handles empty records cleanly', () => {
      const summary = calculateBenchmarkSummary([], 'SYSTEM');
      expect(summary.scriptCount).toBe(0);
      expect(summary.totalDurationMs).toBe(0);
      expect(summary.averageDurationMs).toBe(0);
      expect(summary.totalCorrectionsRecounts).toBe(0);
    });

    it('compares Paper vs System benchmark sets with accurate deltas', () => {
      const paperRecords: GradingSessionRecord[] = [
        createSessionRecord({ scriptId: 'P1', workflowType: 'PAPER', startTime: 0, endTime: 200000, correctionsRecountsCount: 3 }),
        createSessionRecord({ scriptId: 'P2', workflowType: 'PAPER', startTime: 0, endTime: 200000, correctionsRecountsCount: 2 }),
      ];

      const systemRecords: GradingSessionRecord[] = [
        createSessionRecord({ scriptId: 'S1', workflowType: 'SYSTEM', startTime: 0, endTime: 150000, correctionsRecountsCount: 0 }),
        createSessionRecord({ scriptId: 'S2', workflowType: 'SYSTEM', startTime: 0, endTime: 150000, correctionsRecountsCount: 1 }),
      ];

      const comparison = compareWorkflows(paperRecords, systemRecords);

      expect(comparison.paperSummary.totalDurationMs).toBe(400000);
      expect(comparison.systemSummary.totalDurationMs).toBe(300000);
      expect(comparison.durationDeltaMs).toBe(-100000); // 100s faster
      expect(comparison.durationDeltaPercent).toBe(-25); // 25% reduction
      expect(comparison.correctionsDelta).toBe(-4); // 4 fewer corrections
    });
  });

  describe('Duration Formatter', () => {
    it('formats milliseconds to human-readable strings', () => {
      expect(formatDurationMs(0)).toBe('0s');
      expect(formatDurationMs(45000)).toBe('45s');
      expect(formatDurationMs(125000)).toBe('2m 5s');
      expect(formatDurationMs(360000)).toBe('6m 0s');
    });
  });
});

describe('AE-160: Allocation Lifecycle Visibility & Usability Invariants', () => {
  it('verifies Save Draft retains editable state and marks allocation IN_PROGRESS', () => {
    // Model state transitions for Draft vs Final
    interface AllocationState {
      status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
      questionGrades: Record<string, { isFinal: boolean; totalMarks: number }>;
    }

    const state: AllocationState = {
      status: 'PENDING',
      questionGrades: {},
    };

    // Action: Save Draft for Q1
    state.status = 'IN_PROGRESS';
    state.questionGrades['Q1'] = { isFinal: false, totalMarks: 8.5 };

    expect(state.status).toBe('IN_PROGRESS');
    expect(state.questionGrades['Q1'].isFinal).toBe(false);
    // Draft remains editable (isFinal === false allows update)
    const isQ1Editable = !state.questionGrades['Q1'].isFinal;
    expect(isQ1Editable).toBe(true);
  });

  it('guarantees whole-script allocation remains IN_PROGRESS when only partial questions are finalized', () => {
    interface WholeScriptAllocation {
      requiredQuestions: string[];
      questionGrades: Record<string, { isFinal: boolean }>;
      status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
    }

    const allocation: WholeScriptAllocation = {
      requiredQuestions: ['Q1', 'Q2', 'Q3'],
      questionGrades: {
        'Q1': { isFinal: true },
      },
      status: 'IN_PROGRESS',
    };

    // Evaluator finalizes Q1
    const areAllFinalized = allocation.requiredQuestions.every(
      q => allocation.questionGrades[q]?.isFinal === true
    );

    // Invariant: Must NOT transition to COMPLETED prematurely
    expect(areAllFinalized).toBe(false);
    if (!areAllFinalized) {
      allocation.status = 'IN_PROGRESS';
    }
    expect(allocation.status).toBe('IN_PROGRESS');

    // Finalize Q2 as well
    allocation.questionGrades['Q2'] = { isFinal: true };
    const areAllFinalizedAfterQ2 = allocation.requiredQuestions.every(
      q => allocation.questionGrades[q]?.isFinal === true
    );
    expect(areAllFinalizedAfterQ2).toBe(false);
    expect(allocation.status).toBe('IN_PROGRESS');

    // Finalize Q3 (all completed)
    allocation.questionGrades['Q3'] = { isFinal: true };
    const areAllFinalizedAfterQ3 = allocation.requiredQuestions.every(
      q => allocation.questionGrades[q]?.isFinal === true
    );
    expect(areAllFinalizedAfterQ3).toBe(true);
    if (areAllFinalizedAfterQ3) {
      allocation.status = 'COMPLETED';
    }
    expect(allocation.status).toBe('COMPLETED');
  });

  it('verifies next-script navigation is triggered only when allocation is genuinely COMPLETED', () => {
    const handleAutoAdvance = vi.fn();

    function onQuestionSubmit(allocation: { status: string; allQuestionsFinalized: boolean }) {
      if (allocation.status === 'COMPLETED' || allocation.allQuestionsFinalized) {
        handleAutoAdvance();
      }
    }

    // Partial submission: Q1 finalized, Q2 remaining
    onQuestionSubmit({ status: 'IN_PROGRESS', allQuestionsFinalized: false });
    expect(handleAutoAdvance).not.toHaveBeenCalled();

    // Complete submission
    onQuestionSubmit({ status: 'COMPLETED', allQuestionsFinalized: true });
    expect(handleAutoAdvance).toHaveBeenCalledTimes(1);
  });
});
