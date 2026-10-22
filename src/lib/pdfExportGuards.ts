export const MAX_CONCURRENT_PDF_EXPORTS = 1;
export const MAX_STUDENT_EXPORTS_PER_HOUR = 5;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export class PdfExportCapacityError extends Error {
    readonly retryAfterSeconds: number;
    constructor(message = 'PDF export capacity reached. Please retry shortly.', retryAfterSeconds = 5) {
        super(message);
        this.name = 'PdfExportCapacityError';
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

let activePdfExports = 0;
const studentExportHistory = new Map<string, number[]>();

/**
 * Acquires the single instance-wide concurrency slot for PDF export.
 * Throws PdfExportCapacityError (503) if another export is currently running.
 */
export function tryAcquirePdfExportSlot(): () => void {
    if (activePdfExports >= MAX_CONCURRENT_PDF_EXPORTS) {
        throw new PdfExportCapacityError('PDF export capacity reached. Please retry shortly.', 5);
    }
    activePdfExports++;
    let released = false;
    return () => {
        if (!released) {
            released = true;
            activePdfExports = Math.max(0, activePdfExports - 1);
        }
    };
}

export function getActivePdfExportCount(): number {
    return activePdfExports;
}

/**
 * Checks if the student has exceeded the rate limit (5 exports per hour).
 * Uses a sliding 1-hour window.
 */
export function checkStudentExportRateLimit(
    userId: string,
    now: number = Date.now()
): { allowed: boolean; retryAfterSeconds?: number } {
    const history = studentExportHistory.get(userId) || [];
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    const recent = history.filter((ts) => ts > windowStart);
    studentExportHistory.set(userId, recent);

    if (recent.length >= MAX_STUDENT_EXPORTS_PER_HOUR) {
        const oldestInWindow = recent[0];
        const retryAfterSeconds = Math.max(1, Math.ceil((oldestInWindow + RATE_LIMIT_WINDOW_MS - now) / 1000));
        return {
            allowed: false,
            retryAfterSeconds,
        };
    }

    return { allowed: true };
}

/**
 * Records a successful export for a student.
 */
export function recordStudentExport(userId: string, timestamp: number = Date.now()): void {
    const history = studentExportHistory.get(userId) || [];
    const windowStart = timestamp - RATE_LIMIT_WINDOW_MS;
    const recent = history.filter((ts) => ts > windowStart);
    recent.push(timestamp);
    studentExportHistory.set(userId, recent);
}

/**
 * Reset guards state for test isolation.
 */
export function resetPdfExportGuards(): void {
    activePdfExports = 0;
    studentExportHistory.clear();
}
