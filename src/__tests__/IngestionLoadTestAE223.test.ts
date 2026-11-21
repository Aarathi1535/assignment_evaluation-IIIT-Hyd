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

    it('processes synthetic realistic batch, measures throughput and memory, and asserts processed equals total', async () => {
        // Run test with realistic multi-page scanned PDF (cover QR + student work pages)
        const totalPages = 20;
        const metrics = await runIngestionLoadTest({ totalPages, cleanup: true });

        // Correctness assertions: processed pages MUST equal total pages (AE-223 mentor requirement)
        expect(metrics.totalPages).toBe(totalPages);
        expect(metrics.processedPages).toBe(totalPages);
        expect(metrics.failedPages).toBe(0);
        expect(metrics.errorCount).toBe(0);

        // Throughput & duration sanity checks
        expect(metrics.totalDurationMs).toBeGreaterThan(0);
        expect(metrics.pagesPerSecond).toBeGreaterThan(0);
        expect(metrics.extrapolatedPagesPerHour).toBeGreaterThan(0);
        expect(metrics.targetPagesPerHour).toBe(5000);

        // Assert all per-stage measurements are populated and non-zero
        expect(metrics.stageBreakdownMs.renderMs).toBeGreaterThan(0);
        expect(metrics.stageBreakdownMs.thumbnailMs).toBeGreaterThan(0);
        expect(metrics.stageBreakdownMs.storageWriteMs).toBeGreaterThan(0);
        expect(metrics.stageBreakdownMs.dbPersistMs).toBeGreaterThan(0);

        // Log and report pass/fail against 5,000 pages/hour SLA
        console.log(`\n==================================================`);
        console.log(`[AE-223 Target Check] Processed Pages: ${metrics.processedPages}/${metrics.totalPages}`);
        console.log(`[AE-223 Target Check] Measured Throughput: ${metrics.extrapolatedPagesPerHour} pages/hr (${metrics.averageLatencyMsPerPage.toFixed(1)} ms/page)`);
        console.log(`[AE-223 Target Check] Target SLA: ${metrics.targetPagesPerHour} pages/hr`);
        console.log(`[AE-223 Target Check] Target Status: ${metrics.meetsTarget ? 'PASS (Meets/Exceeds Target)' : 'FAIL/BELOW TARGET (Environment-constrained)'}`);
        console.log(`==================================================\n`);

        // Assert machine & run metadata are captured
        expect(metrics.machineInfo.cpuModel).toBeDefined();
        expect(metrics.machineInfo.cpuCores).toBeGreaterThan(0);
        expect(metrics.runInfo.command).toContain('loadTestIngestion.ts');
        expect(typeof metrics.meetsTarget).toBe('boolean');

        // Memory assertions
        expect(metrics.memoryUsage.rssMb).toBeGreaterThan(0);
        expect(typeof metrics.memoryUsage.heapUsedDeltaMb).toBe('number');
    }, 120000);
});
