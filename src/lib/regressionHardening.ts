/**
 * Regression Hardening & Resilience Utilities (AE-240)
 * Provides boundary validations, multi-tab conflict resolution,
 * payload guards, and score sanitization across platform lifecycles.
 */

export interface RegradeWindowStatus {
  isOpen: boolean;
  status: 'NOT_OPEN_YET' | 'OPEN' | 'EXPIRED';
  remainingMs: number;
}

export interface DraftRecord {
  version: number;
  updatedAt: number;
  [key: string]: unknown;
}

export interface ConflictResolutionResult<T extends DraftRecord> {
  winner: 'local' | 'incoming';
  resolved: T;
  conflictDetected: boolean;
}

export interface MarkSanitizationResult {
  valid: boolean;
  sanitized: number;
  error?: string;
}

/**
 * Evaluates whether an examination regrade window is open.
 * Strictly enforces start and end deadlines with NO late grace period.
 */
export function isRegradeWindowOpen(
  windowStart: Date | string | number,
  windowEnd: Date | string | number,
  currentTimestamp: Date | string | number = Date.now()
): RegradeWindowStatus {
  const start = new Date(windowStart).getTime();
  const end = new Date(windowEnd).getTime();
  const now = new Date(currentTimestamp).getTime();

  if (isNaN(start) || isNaN(end) || isNaN(now) || start > end) {
    throw new Error('Invalid date parameter provided to isRegradeWindowOpen');
  }

  // Before window start
  if (now < start) {
    return {
      isOpen: false,
      status: 'NOT_OPEN_YET',
      remainingMs: 0,
    };
  }

  // Strictly within window (no late grace tolerance)
  if (now <= end) {
    const remainingMs = Math.max(0, end - now);
    return {
      isOpen: true,
      status: 'OPEN',
      remainingMs,
    };
  }

  // After window expiration
  return {
    isOpen: false,
    status: 'EXPIRED',
    remainingMs: 0,
  };
}

/**
 * Resolves concurrent multi-tab or multi-device offline draft conflicts deterministically.
 */
export function resolveDraftConflict<T extends DraftRecord>(
  localDraft: T,
  incomingDraft: T
): ConflictResolutionResult<T> {
  const versionDiff = incomingDraft.version - localDraft.version;

  if (versionDiff > 0) {
    // Incoming draft has higher version
    return {
      winner: 'incoming',
      resolved: incomingDraft,
      conflictDetected: true,
    };
  }

  if (versionDiff < 0) {
    // Local draft has higher version
    return {
      winner: 'local',
      resolved: localDraft,
      conflictDetected: true,
    };
  }

  // Same version: tie-break on timestamp
  if (incomingDraft.updatedAt > localDraft.updatedAt) {
    return {
      winner: 'incoming',
      resolved: incomingDraft,
      conflictDetected: true,
    };
  }

  return {
    winner: 'local',
    resolved: localDraft,
    conflictDetected: false,
  };
}

/**
 * Validates payload buffer size to prevent memory starvation attacks.
 */
export function validatePayloadSize(
  byteLength: number,
  maxAllowedBytes = 15 * 1024 * 1024 // 15MB default
): { valid: boolean; error?: string } {
  if (byteLength < 0) {
    return { valid: false, error: 'Payload byte length cannot be negative' };
  }
  if (byteLength > maxAllowedBytes) {
    return {
      valid: false,
      error: `Payload size (${(byteLength / 1024 / 1024).toFixed(2)} MB) exceeds maximum allowed threshold of ${(maxAllowedBytes / 1024 / 1024).toFixed(2)} MB`,
    };
  }
  return { valid: true };
}

/**
 * Sanitizes and validates numerical question marks against maximum bounds and step steps.
 */
export function sanitizeMark(
  rawMark: unknown,
  maxQuestionMarks: number,
  scoreStep = 0.5
): MarkSanitizationResult {
  if (rawMark === null || rawMark === undefined || rawMark === '') {
    return { valid: false, sanitized: 0, error: 'Mark cannot be empty' };
  }

  const num = Number(rawMark);

  if (isNaN(num) || !isFinite(num)) {
    return { valid: false, sanitized: 0, error: 'Mark must be a valid finite number' };
  }

  if (num < 0) {
    return { valid: false, sanitized: 0, error: 'Mark cannot be negative' };
  }

  if (num > maxQuestionMarks) {
    return {
      valid: false,
      sanitized: maxQuestionMarks,
      error: `Mark (${num}) exceeds maximum allowed question marks (${maxQuestionMarks})`,
    };
  }

  // Verify score step alignment (e.g. divisible by 0.5)
  const remainder = Math.round((num % scoreStep) * 1000) / 1000;
  if (remainder !== 0 && Math.abs(remainder - scoreStep) > 0.001) {
    // Snap to nearest score step
    const snapped = Math.round(num / scoreStep) * scoreStep;
    return {
      valid: false,
      sanitized: Math.min(snapped, maxQuestionMarks),
      error: `Mark must be in increments of ${scoreStep}; snapped to ${snapped}`,
    };
  }

  return {
    valid: true,
    sanitized: num,
  };
}
