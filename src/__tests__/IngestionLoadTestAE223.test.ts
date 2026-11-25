import { describe, it, expect } from 'vitest';
import { runIngestionLoadTest, isDatabaseHostAllowed } from '../scripts/loadTestIngestion';

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

    it('refuses to run load testing on non-allowlisted database hosts', async () => {
        expect(isDatabaseHostAllowed('mongodb://127.0.0.1:27017/test')).toBe(true);
        expect(isDatabaseHostAllowed('mongodb://localhost:27017/test')).toBe(true);
        expect(isDatabaseHostAllowed('mongodb://[::1]:27017/test')).toBe(true);
        expect(isDatabaseHostAllowed('mongodb://demo-cluster.internal:27017/test')).toBe(false);
        expect(isDatabaseHostAllowed('mongodb://prod.cluster.internal:27017/live')).toBe(false);
        expect(isDatabaseHostAllowed('not-a-mongo-uri')).toBe(false);
        expect(isDatabaseHostAllowed('')).toBe(false);
        expect(isDatabaseHostAllowed(undefined)).toBe(false);

        const originalDemoCluster = process.env.DEMO_CLUSTER_HOST;
        try {
            process.env.DEMO_CLUSTER_HOST = 'demo-cluster.internal';
            expect(isDatabaseHostAllowed('mongodb://demo-cluster.internal:27017/test')).toBe(true);
            expect(isDatabaseHostAllowed('mongodb://other-cluster.internal:27017/test')).toBe(false);
        } finally {
            if (originalDemoCluster !== undefined) {
                process.env.DEMO_CLUSTER_HOST = originalDemoCluster;
            } else {
                delete process.env.DEMO_CLUSTER_HOST;
            }
        }

        const originalUri = process.env.MONGODB_URI;
        try {
            process.env.MONGODB_URI = 'mongodb://prod-cluster.mongodb.net:27017/production_db';
            await expect(runIngestionLoadTest({ totalPages: 2 })).rejects.toThrow(
                /non-allowlisted database hosts/i
            );
        } finally {
            process.env.MONGODB_URI = originalUri;
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

        // Assert cover page identification and answer script assembly (AE-223 mentor requirement)
        expect(metrics.coverPageIdentified).toBe(true);
        expect(metrics.scriptAssembled).toBe(true);
        expect(metrics.assembledPageCount).toBe(totalPages);

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
        expect(metrics.stageBreakdownMs.otherMs).toBeGreaterThan(0);

        // Assert stage percentages: render percentage is calibrated against total duration (~19%), not 62%
        expect(metrics.stagePercentages.renderPct).toBeGreaterThan(0);
        expect(metrics.stagePercentages.renderPct).toBeLessThan(50);
        expect(metrics.stagePercentages.otherPct).toBeGreaterThan(0);

        // Log and report pass/fail against 5,000 pages/hour SLA
        console.log(`\n==================================================`);
        console.log(`[AE-223 Target Check] Processed Pages: ${metrics.processedPages}/${metrics.totalPages}`);
        console.log(`[AE-223 Target Check] Measured Throughput: ${metrics.extrapolatedPagesPerHour} pages/hr (${metrics.averageLatencyMsPerPage.toFixed(1)} ms/page)`);
        console.log(`[AE-223 Target Check] Target SLA: ${metrics.targetPagesPerHour} pages/hr`);
        console.log(`[AE-223 Target Check] Cover Page Identified: ${metrics.coverPageIdentified}`);
        console.log(`[AE-223 Target Check] Script Assembled: ${metrics.scriptAssembled} (Page count: ${metrics.assembledPageCount})`);
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

    it('cleans up load-test users, mappings, batch and script when cleanup is true', async () => {
        const { default: User } = await import('../models/User');
        const { default: StudentMapping } = await import('../models/StudentMapping');
        const { default: AnswerScript } = await import('../models/AnswerScript');
        const { default: IngestionPage } = await import('../models/IngestionPage');

        const metrics = await runIngestionLoadTest({ totalPages: 3, cleanup: true });
        expect(metrics.processedPages).toBe(3);

        expect(await User.countDocuments({ email: /loadtest\.(prof|stu)@example\.com/ })).toBe(0);
        expect(await StudentMapping.countDocuments({ anonymousId: 'ANON-LT-1' })).toBe(0);
        if (metrics.assembledScriptId) {
            expect(await AnswerScript.findById(metrics.assembledScriptId)).toBeNull();
        }
        expect(await IngestionPage.countDocuments({ batchId: { $exists: true } })).toBe(0);
    }, 60000);
});
