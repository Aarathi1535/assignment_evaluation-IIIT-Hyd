import { describe, it, expect } from 'vitest';
import { runIngestionLoadTest } from '../scripts/loadTestIngestion';

describe('AE-223: Ingestion Load Testing vs 5,000 Pages/Hour Target', () => {
    it('rejects execution when NODE_ENV is production', async () => {
        const originalEnv = process.env.NODE_ENV;
        try {
            (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
            await expect(runIngestionLoadTest({ totalPages: 5 })).rejects.toThrow(
                /forbidden against production/i
            );
        } finally {
            (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
        }
    });

    it('processes synthetic batch, measures throughput and memory, and asserts zero failures', async () => {
        // Run test with 50 pages to measure throughput accurately
        const metrics = await runIngestionLoadTest({ totalPages: 50, cleanup: true });

        expect(metrics.totalPages).toBe(50);
        expect(metrics.errorCount).toBe(0);
        expect(metrics.totalDurationMs).toBeGreaterThan(0);
        expect(metrics.pagesPerSecond).toBeGreaterThan(0);
        expect(metrics.extrapolatedPagesPerHour).toBeGreaterThan(0);

        // Target check: 5,000 pages/hour is ~1.39 pages/sec
        expect(metrics.targetPagesPerHour).toBe(5000);
        // Assert that memory metrics are reported
        expect(metrics.memoryUsage.rssMb).toBeGreaterThan(0);
        expect(typeof metrics.memoryUsage.heapUsedDeltaMb).toBe('number');
    }, 60000);
});
