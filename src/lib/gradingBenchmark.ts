/**
 * AE-160: Grading UX Review / TA Workflow Benchmark Utility
 * 
 * Lightweight benchmark data structures and calculation helpers for capturing
 * grading workflow timings, recount/correction counts, and lifecycle observations
 * across Paper and System grading sessions.
 */

export type WorkflowType = 'PAPER' | 'SYSTEM';

export interface GradingSessionRecord {
  scriptId: string;
  workflowType: WorkflowType;
  startTime: number; // Unix timestamp in ms
  endTime: number; // Unix timestamp in ms
  durationMs: number; // Total duration in ms
  correctionsRecountsCount: number; // Number of score corrections or recounts
  recalculationsCount: number; // Number of arithmetic recalculations
  notes?: string;
  lifecycleObservations?: string;
}

export interface WorkflowSummary {
  workflowType: WorkflowType;
  scriptCount: number;
  totalDurationMs: number;
  averageDurationMs: number;
  totalCorrectionsRecounts: number;
  averageCorrectionsPerScript: number;
  totalRecalculations: number;
  averageRecalculationsPerScript: number;
}

export interface BenchmarkComparison {
  paperSummary: WorkflowSummary;
  systemSummary: WorkflowSummary;
  durationDeltaMs: number; // system - paper (negative means system is faster)
  durationDeltaPercent: number; // percentage change relative to paper
  correctionsDelta: number; // system - paper
}

/**
 * Validates a session record to ensure start/end timestamps and counts are coherent.
 */
export function validateSessionRecord(record: Partial<GradingSessionRecord>): record is GradingSessionRecord {
  if (!record.scriptId || typeof record.scriptId !== 'string') return false;
  if (record.workflowType !== 'PAPER' && record.workflowType !== 'SYSTEM') return false;
  if (typeof record.startTime !== 'number' || isNaN(record.startTime)) return false;
  if (typeof record.endTime !== 'number' || isNaN(record.endTime)) return false;
  if (record.endTime < record.startTime) return false;
  if (typeof record.durationMs !== 'number' || record.durationMs < 0) return false;
  if (typeof record.correctionsRecountsCount !== 'number' || record.correctionsRecountsCount < 0) return false;
  if (typeof record.recalculationsCount !== 'number' || record.recalculationsCount < 0) return false;
  return true;
}

/**
 * Creates a valid GradingSessionRecord given timestamps and metrics.
 */
export function createSessionRecord(params: {
  scriptId: string;
  workflowType: WorkflowType;
  startTime: number;
  endTime: number;
  correctionsRecountsCount?: number;
  recalculationsCount?: number;
  notes?: string;
  lifecycleObservations?: string;
}): GradingSessionRecord {
  const durationMs = Math.max(0, params.endTime - params.startTime);
  const record: GradingSessionRecord = {
    scriptId: params.scriptId,
    workflowType: params.workflowType,
    startTime: params.startTime,
    endTime: params.endTime,
    durationMs,
    correctionsRecountsCount: params.correctionsRecountsCount ?? 0,
    recalculationsCount: params.recalculationsCount ?? 0,
    notes: params.notes,
    lifecycleObservations: params.lifecycleObservations,
  };

  if (!validateSessionRecord(record)) {
    throw new Error('Invalid grading session record parameters');
  }

  return record;
}

/**
 * Calculates aggregate summary metrics for a list of grading sessions.
 */
export function calculateBenchmarkSummary(
  records: GradingSessionRecord[],
  workflowType: WorkflowType
): WorkflowSummary {
  const matchingRecords = records.filter(r => r.workflowType === workflowType);
  const scriptCount = matchingRecords.length;

  if (scriptCount === 0) {
    return {
      workflowType,
      scriptCount: 0,
      totalDurationMs: 0,
      averageDurationMs: 0,
      totalCorrectionsRecounts: 0,
      averageCorrectionsPerScript: 0,
      totalRecalculations: 0,
      averageRecalculationsPerScript: 0,
    };
  }

  const totalDurationMs = matchingRecords.reduce((sum, r) => sum + r.durationMs, 0);
  const totalCorrectionsRecounts = matchingRecords.reduce((sum, r) => sum + r.correctionsRecountsCount, 0);
  const totalRecalculations = matchingRecords.reduce((sum, r) => sum + r.recalculationsCount, 0);

  return {
    workflowType,
    scriptCount,
    totalDurationMs,
    averageDurationMs: Math.round(totalDurationMs / scriptCount),
    totalCorrectionsRecounts,
    averageCorrectionsPerScript: Number((totalCorrectionsRecounts / scriptCount).toFixed(2)),
    totalRecalculations,
    averageRecalculationsPerScript: Number((totalRecalculations / scriptCount).toFixed(2)),
  };
}

/**
 * Compares Paper vs System benchmark summaries.
 */
export function compareWorkflows(
  paperRecords: GradingSessionRecord[],
  systemRecords: GradingSessionRecord[]
): BenchmarkComparison {
  const paperSummary = calculateBenchmarkSummary(paperRecords, 'PAPER');
  const systemSummary = calculateBenchmarkSummary(systemRecords, 'SYSTEM');

  const durationDeltaMs = systemSummary.totalDurationMs - paperSummary.totalDurationMs;
  const durationDeltaPercent = paperSummary.totalDurationMs > 0
    ? Number(((durationDeltaMs / paperSummary.totalDurationMs) * 100).toFixed(2))
    : 0;
  const correctionsDelta = systemSummary.totalCorrectionsRecounts - paperSummary.totalCorrectionsRecounts;

  return {
    paperSummary,
    systemSummary,
    durationDeltaMs,
    durationDeltaPercent,
    correctionsDelta,
  };
}

/**
 * Formats duration in milliseconds to human-readable string (e.g., "2m 15s" or "45s").
 */
export function formatDurationMs(ms: number): string {
  if (ms <= 0 || isNaN(ms)) return '0s';
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes === 0) {
    return `${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}
