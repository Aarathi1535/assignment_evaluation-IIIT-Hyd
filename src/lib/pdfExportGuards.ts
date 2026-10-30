import {
    tryAcquireWatermarkSlot,
} from './watermark';

export const MAX_CONCURRENT_PDF_EXPORTS = 1;
export const MAX_STUDENT_EXPORTS_PER_HOUR = 5;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const DEFAULT_EXPORT_DEADLINE_MS = 60 * 1000; // 60 seconds

let activePdfExports = 0;
const studentExportHistory = new Map<string, number[]>();
let currentExportDeadlineMs = DEFAULT_EXPORT_DEADLINE_MS;

export class PdfExportCapacityError extends Error {
    readonly retryAfterSeconds: number;
    constructor(
        message = 'PDF export capacity reached. Please retry shortly.',
        retryAfterSeconds = 5
    ) {
        super(message);
        this.name = 'PdfExportCapacityError';
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

export class ExportTimeoutError extends Error {
    readonly retryAfterSeconds: number;
    constructor(
        message = 'PDF export timed out. Please retry shortly.',
        retryAfterSeconds = 5
    ) {
        super(message);
        this.name = 'ExportTimeoutError';
        this.retryAfterSeconds = retryAfterSeconds;
    }
}

/**
 * Returns the active export deadline in milliseconds.
 */
export function getExportDeadlineMs(): number {
    return currentExportDeadlineMs;
}

/**
 * For testing timeout handling without long waits.
 */
export function setExportDeadlineMsForTest(ms: number): void {
    currentExportDeadlineMs = ms;
}

/**
 * Resets the export deadline back to default 60s.
 */
export function resetExportDeadlineMs(): void {
    currentExportDeadlineMs = DEFAULT_EXPORT_DEADLINE_MS;
}

/**
 * Acquires both the instance-wide PDF export admission slot (max 1 concurrent export)
 * AND one of the shared watermark render slots (max 2 concurrent renders across the application).
 *
 * This ensures that a PDF export operation shares the overall render-capacity budget
 * with single-page image watermarking, preventing process memory exhaustion while
 * keeping CPU and canvas resources strictly bounded.
 *
 * NOTE: The complete PDF is buffered in memory in Node.js before delivery (`pdfDoc.save()`)
 * rather than streamed over HTTP chunk-by-chunk. Memory footprint is strictly bounded by:
 * 1. The 40-page cap per export.
 * 2. Per-page pixel dimension bounds (maxLongEdge: 2500, maxPixels: 4_000_000).
 * 3. Single-pass JPEG encoding per page (lossless PNG intermediate).
 * 4. 60-second total export time deadline.
 * 5. This shared render semaphore + 1-export limit.
 */
export function tryAcquirePdfExportSlot(): () => void {
    if (activePdfExports >= MAX_CONCURRENT_PDF_EXPORTS) {
        throw new PdfExportCapacityError('PDF export capacity reached. Please retry shortly.', 5);
    }

    // Acquire shared watermark render slot to avoid exceeding shared canvas capacity
    const releaseWatermark = tryAcquireWatermarkSlot();

    activePdfExports++;
    let released = false;
    return () => {
        if (!released) {
            released = true;
            activePdfExports = Math.max(0, activePdfExports - 1);
            releaseWatermark();
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
    resetExportDeadlineMs();
}
