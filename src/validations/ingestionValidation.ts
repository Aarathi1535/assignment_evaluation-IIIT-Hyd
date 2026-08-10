import { IngestionStatus } from '../models/IngestionJob';

const VALID_TRANSITIONS: Record<IngestionStatus, IngestionStatus[]> = {
    [IngestionStatus.QUEUED]: [IngestionStatus.PROCESSING],
    [IngestionStatus.PROCESSING]: [
        IngestionStatus.DONE,
        IngestionStatus.FAILED
    ],
    [IngestionStatus.DONE]: [],
    [IngestionStatus.FAILED]: []
};

/**
 * Validates state transitions for ingestion jobs:
 * queued -> processing
 * processing -> done
 * processing -> failed
 * Same-state updates remain valid.
 */
export function isValidIngestionTransition(
    current: IngestionStatus,
    next: IngestionStatus
): boolean {
    if (current === next) return true;
    return VALID_TRANSITIONS[current]?.includes(next) || false;
}

/**
 * Sanitizes a failure reason string so internal stack traces and paths are stripped.
 */
export function sanitizeFailureReason(rawReason?: string): string | undefined {
    if (!rawReason || typeof rawReason !== 'string') {
        return undefined;
    }

    // Split into lines and strip stack trace lines ('at ...')
    const lines = rawReason.split(/\r?\n/);
    const cleanLines = lines.filter(line => !/^\s*at\s+.*$/i.test(line) && !/^\s*Error:\s*$/i.test(line));

    let sanitized = cleanLines.join(' ').trim();

    // Strip common stack trace artifacts or file paths
    sanitized = sanitized.replace(/\s+/g, ' ');

    if (!sanitized) {
        return 'Ingestion processing failed';
    }

    // Truncate to maximum 500 characters
    if (sanitized.length > 500) {
        sanitized = sanitized.substring(0, 500);
    }

    return sanitized;
}
