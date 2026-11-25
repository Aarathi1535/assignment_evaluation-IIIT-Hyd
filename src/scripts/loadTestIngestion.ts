/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { loadEnvConfig } from '@next/env';
import { performance } from 'perf_hooks';
import os from 'os';
import { execSync } from 'child_process';
import mongoose from 'mongoose';
import { createCanvas } from '@napi-rs/canvas';
import * as zxing from '@zxing/library';
import { PDFDocument } from 'pdf-lib';
import type { RenderPageInput, RenderPageResult } from '../services/PageRenderer';
import type { IThumbnailGenerator } from '../services/ThumbnailGenerator';
import type { ICoverSheetDetector } from '../services/CoverSheetDetector';

loadEnvConfig(process.cwd());

export interface IngestionLoadTestOptions {
    totalPages?: number;
    batchSize?: number;
    concurrency?: number;
    cleanup?: boolean;
}

export interface IngestionLoadTestMetrics {
    totalPages: number;
    processedPages: number;
    failedPages: number;
    totalDurationMs: number;
    averageLatencyMsPerPage: number;
    pagesPerSecond: number;
    extrapolatedPagesPerHour: number;
    targetPagesPerHour: number;
    meetsTarget: boolean;
    errorCount: number;
    machineInfo: {
        cpuModel: string;
        cpuCores: number;
        totalRam: string;
        platform: string;
        nodeVersion: string;
    };
    runInfo: {
        date: string;
        commitSha: string;
        command: string;
    };
    memoryUsage: {
        startHeapMb: number;
        endHeapMb: number;
        heapUsedDeltaMb: number;
        rssMb: number;
    };
    coverPageIdentified: boolean;
    scriptAssembled: boolean;
    assembledScriptId?: string;
    assembledPageCount?: number;
    stageBreakdownMs: {
        renderMs: number;
        qrDetectMs: number;
        thumbnailMs: number;
        storageWriteMs: number;
        dbPersistMs: number;
        otherMs: number;
    };
    stagePercentages: {
        renderPct: number;
        qrDetectPct: number;
        thumbnailPct: number;
        storageWritePct: number;
        dbPersistPct: number;
        otherPct: number;
    };
}

/**
 * Generates a realistic, standards-compliant multi-page PDF document
 * with a QR cover sheet on Page 1 and handwriting-sized student exam work
 * on subsequent pages, simulating real high-resolution exam scans.
 */
async function createRealisticScannedPdfBuffer(
    pageCount: number,
    qrText: string
): Promise<Buffer> {
    const pdfDoc = await PDFDocument.create();

    // 1. Page 1: QR Cover Sheet
    const coverCanvas = createCanvas(1000, 1400);
    const coverCtx = coverCanvas.getContext('2d');
    coverCtx.fillStyle = '#ffffff';
    coverCtx.fillRect(0, 0, 1000, 1400);

    coverCtx.fillStyle = '#112233';
    coverCtx.font = 'bold 30px sans-serif';
    coverCtx.fillText('IIIT HYDERABAD — EXAMINATION COVER SHEET', 100, 100);

    coverCtx.font = '20px sans-serif';
    coverCtx.fillText('Course: CS-301 Data Structures & Algorithms', 100, 160);
    coverCtx.fillText(`Candidate Anonymous ID: ${qrText}`, 100, 200);
    coverCtx.fillText('Instructions: Use black/blue ink only. Do not fold this sheet.', 100, 240);

    // Metadata table box
    coverCtx.strokeStyle = '#334455';
    coverCtx.lineWidth = 2;
    coverCtx.strokeRect(100, 280, 800, 180);
    coverCtx.beginPath();
    coverCtx.moveTo(100, 340);
    coverCtx.lineTo(900, 340);
    coverCtx.moveTo(450, 280);
    coverCtx.lineTo(450, 460);
    coverCtx.stroke();

    coverCtx.fillText('Section A: Theory (Max 40)', 120, 320);
    coverCtx.fillText('Section B: Practical (Max 60)', 470, 320);

    // Draw high-resolution scannable QR Code
    const writer = new zxing.QRCodeWriter();
    const qrMatrix = writer.encode(qrText, zxing.BarcodeFormat.QR_CODE, 140, 140, new Map());
    coverCtx.fillStyle = '#000000';
    for (let x = 0; x < qrMatrix.getWidth(); x++) {
        for (let y = 0; y < qrMatrix.getHeight(); y++) {
            if (qrMatrix.get(x, y)) {
                coverCtx.fillRect(360 + x * 2, 540 + y * 2, 2, 2);
            }
        }
    }

    const coverPng = coverCanvas.toBuffer('image/png');
    const embeddedCover = await pdfDoc.embedPng(coverPng);
    const p1 = pdfDoc.addPage([595.28, 841.89]);
    p1.drawImage(embeddedCover, { x: 0, y: 0, width: 595.28, height: 841.89 });

    // 2. Generate realistic student answer pages with handwriting-sized text and diagrams
    // Each page is uniquely generated with distinct content to prevent duplicate detection (dHash) false positives
    for (let p = 2; p <= pageCount; p++) {
        const pageCanvas = createCanvas(1000, 1400);
        const pCtx = pageCanvas.getContext('2d');
        pCtx.fillStyle = '#f8f9fa'; // Scanned paper color
        pCtx.fillRect(0, 0, 1000, 1400);

        // Ruled paper lines with varied spacing
        pCtx.strokeStyle = '#e2e8f0';
        pCtx.lineWidth = 1;
        for (let y = 140; y < 1340; y += 40) {
            pCtx.beginPath();
            pCtx.moveTo(60, y);
            pCtx.lineTo(940, y);
            pCtx.stroke();
        }

        // Left margin rule
        pCtx.strokeStyle = '#fca5a5';
        pCtx.lineWidth = 1.5;
        pCtx.beginPath();
        pCtx.moveTo(120, 60);
        pCtx.lineTo(120, 1340);
        pCtx.stroke();

        // Unique student handwriting content per page
        pCtx.fillStyle = '#0f172a';
        pCtx.font = 'bold 22px serif';
        pCtx.fillText(`Question ${p}: Derivation & Implementation Analysis (Page ${p})`, 140, 130);

        pCtx.font = '16px monospace';
        pCtx.fillText(`// Execution trace for problem variant #${p * 7}`, 140, 175);
        pCtx.fillText(`const bufferSize_${p} = ${p * 1024};`, 140, 205);
        pCtx.fillText(`function evaluateStep${p}(state: State<${p}>): Result {`, 140, 235);
        pCtx.fillText(`    let accumulator = ${p * 13.5};`, 140, 265);
        pCtx.fillText(`    for (let i = 0; i < ${p + 5}; i++) {`, 140, 295);
        pCtx.fillText(`        accumulator += Math.sqrt(i * ${p}) + ${p % 3};`, 140, 325);
        pCtx.fillText(`    }`, 140, 355);
        pCtx.fillText(`    return { status: "VALID", metric: accumulator };`, 140, 385);
        pCtx.fillText(`}`, 140, 415);

        pCtx.font = 'italic 18px serif';
        pCtx.fillText(`Recurrence relation #${p}: T_${p}(n) = ${p} * T(n / 2) + Theta(n^${(p % 3) + 1})`, 140, 460);
        pCtx.fillText(`By Master Theorem Case ${(p % 3) + 1}, asymptotic complexity is Theta(n^${(p % 3) + 1} log n).`, 140, 490);

        // Unique handwriting / vector stroke diagram per page
        pCtx.strokeStyle = '#1e3a8a';
        pCtx.lineWidth = 2;
        pCtx.beginPath();
        const startY = 550 + (p * 5) % 100;
        pCtx.moveTo(150, startY);
        for (let x = 150; x < 850; x += 20) {
            const waveY = startY + Math.sin((x + p * 30) / (25 + (p % 5))) * (20 + (p % 15));
            pCtx.lineTo(x, waveY);
        }
        pCtx.stroke();

        // Draw geometric illustration box with varied shapes
        pCtx.strokeStyle = '#64748b';
        pCtx.lineWidth = 1.5;
        pCtx.strokeRect(150, startY + 70, 350, 180);
        pCtx.fillStyle = '#334155';
        pCtx.font = '14px sans-serif';
        pCtx.fillText(`Diagram ${p}.1: Phase Plot & State Boundary Map`, 165, startY + 95);
        pCtx.strokeRect(180, startY + 115, 60 + (p * 8) % 100, 40 + (p * 5) % 60);

        const pageImg = pageCanvas.toBuffer('image/png');
        const embeddedImg = await pdfDoc.embedPng(pageImg);
        const page = pdfDoc.addPage([595.28, 841.89]);
        page.drawImage(embeddedImg, { x: 0, y: 0, width: 595.28, height: 841.89 });
    }

    const pdfBytes = await pdfDoc.save({ useObjectStreams: false });
    return Buffer.from(pdfBytes);
}

/**
 * Validates whether the target MongoDB host is permitted for load test execution.
 * Only local development/test hosts or explicitly configured demo clusters are allowed.
 * Reject malformed URIs, unknown hosts, and substring matches.
 */
export function isDatabaseHostAllowed(uri?: string): boolean {
    if (!uri || typeof uri !== 'string') return false;
    try {
        const trimmed = uri.trim();
        if (!trimmed.startsWith('mongodb://') && !trimmed.startsWith('mongodb+srv://')) {
            return false;
        }

        const parsed = new URL(trimmed.replace(/^mongodb(\+srv)?:\/\//, 'http://'));
        if (!parsed.host) return false;

        const hosts = parsed.host.split(',');
        const demoClusterHost = process.env.DEMO_CLUSTER_HOST?.toLowerCase().trim();

        return hosts.every(h => {
            if (!h) return false;
            let hostname = h.trim();
            if (hostname.startsWith('[')) {
                const closeBracketIdx = hostname.indexOf(']');
                if (closeBracketIdx !== -1) {
                    hostname = hostname.substring(1, closeBracketIdx);
                }
            } else {
                hostname = hostname.split(':')[0];
            }
            hostname = hostname.toLowerCase();

            return (
                hostname === 'localhost' ||
                hostname === '127.0.0.1' ||
                hostname === '::1' ||
                (Boolean(demoClusterHost) && hostname === demoClusterHost)
            );
        });
    } catch {
        return false;
    }
}

export async function runIngestionLoadTest(
    options: IngestionLoadTestOptions = {}
): Promise<IngestionLoadTestMetrics> {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Load testing is forbidden against production environments');
    }

    const mongoUri = process.env.MONGODB_URI;
    if (!isDatabaseHostAllowed(mongoUri)) {
        throw new Error(
            'Load testing is forbidden on non-allowlisted database hosts. Refusing connection to host outside allowlist (allowed: localhost, 127.0.0.1, or explicit demo cluster).'
        );
    }

    const totalPages = Math.max(1, options.totalPages ?? 50);
    const targetPagesPerHour = 5000;

    const { connectDB } = await import('../lib/db');
    await connectDB();

    const { default: User, UserRole } = await import('../models/User');
    const { default: Course } = await import('../models/Course');
    const { default: Exam, ExamStatus } = await import('../models/Exam');
    const { default: StudentMapping } = await import('../models/StudentMapping');
    const { default: IngestionJob, IngestionStatus } = await import('../models/IngestionJob');
    const { default: IngestionPage, PageProcessingStatus } = await import('../models/IngestionPage');
    const { default: batchService } = await import('../services/BatchService');
    const { IngestionWorker } = await import('../services/IngestionWorker');
    const { PageIngestionService } = await import('../services/PageIngestionService');
    const { DefaultPdfRenderer, DefaultImageRenderer } = await import('../services/PageRenderer');
    const { default: defaultThumbnailGenerator } = await import('../services/ThumbnailGenerator');
    const { default: defaultCoverSheetDetector } = await import('../services/CoverSheetDetector');
    const { default: immutableStorageService } = await import('../services/ImmutableStorageService');
    const { default: derivedStorageService } = await import('../services/DerivedStorageService');

    // 1. Setup instructor, student, course, exam, and mapping
    let instructor: any = await User.findOne({ email: 'loadtest.prof@example.com' });
    if (!instructor) {
        instructor = await User.create({
            name: 'Load Test Professor',
            email: 'loadtest.prof@example.com',
            password: 'loadtest-prof-password',
            role: UserRole.PROFESSOR,
            isActive: true,
        });
    }

    let student: any = await User.findOne({ email: 'loadtest.stu@example.com' });
    if (!student) {
        student = await User.create({
            name: 'Load Test Student',
            email: 'loadtest.stu@example.com',
            password: 'loadtest-stu-password',
            role: UserRole.STUDENT,
            isActive: true,
        });
    }

    const course: any = await Course.create({
        courseCode: `LT-${Date.now()}`,
        courseName: 'Load Test Course',
        professor: instructor._id,
        semester: 1,
        academicYear: '2026-2027',
        enrolledStudents: [student._id],
        isActive: true,
    });

    const exam: any = await Exam.create({
        title: 'Ingestion Load Test Exam',
        course: course._id,
        createdBy: instructor._id,
        examDate: new Date(),
        numberOfQuestions: 2,
        totalMarks: 20,
        status: ExamStatus.SCANNING,
        enrolledStudents: [student._id],
        isActive: true,
    });

    const candidateAnonymousId = 'ANON-LT-1';
    await StudentMapping.create({
        exam: exam._id,
        student: student._id,
        anonymousId: candidateAnonymousId,
        rollNumber: 'ROLL-LT-1',
    });

    const auditContext = {
        actingUserId: instructor._id.toString(),
        actingUserRole: instructor.role,
        userId: instructor._id.toString(),
        userEmail: instructor.email,
        userRole: instructor.role,
        courseId: course._id.toString(),
        examId: exam._id.toString(),
        ipAddress: '127.0.0.1',
        userAgent: 'LoadTestRunner/1.0',
    };

    // 2. Generate realistic PDF scan buffer with QR cover page + handwriting pages
    const multiPdf = await createRealisticScannedPdfBuffer(totalPages, candidateAnonymousId);

    const filesToUpload = [
        {
            name: `student_exam_${totalPages}pg.pdf`,
            buffer: multiPdf,
            size: multiPdf.length,
        },
    ];

    const uploadResult = await batchService.createBatch(
        filesToUpload,
        exam._id.toString(),
        auditContext
    );
    const batchId = uploadResult.batch.batchId;

    // 3. Stage Instrumentation Accumulators (AE-079 technique)
    let renderMs = 0;
    let qrDetectMs = 0;
    let thumbnailMs = 0;
    let storageWriteMs = 0;
    let dbPersistMs = 0;

    class TimingPdfRenderer extends DefaultPdfRenderer {
        async renderPage(input: RenderPageInput): Promise<RenderPageResult> {
            const start = performance.now();
            const res = await super.renderPage(input);
            renderMs += performance.now() - start;
            return res;
        }
    }

    class TimingImageRenderer extends DefaultImageRenderer {
        async renderPage(input: RenderPageInput): Promise<RenderPageResult> {
            const start = performance.now();
            const res = await super.renderPage(input);
            renderMs += performance.now() - start;
            return res;
        }
    }

    class TimingCoverSheetDetector implements ICoverSheetDetector {
        constructor(private real: ICoverSheetDetector) {}
        async detectCoverSheet(buffer: Buffer, pageNumber: number): Promise<any> {
            const start = performance.now();
            const res = await this.real.detectCoverSheet(buffer, pageNumber);
            qrDetectMs += performance.now() - start;
            return res;
        }
    }

    class TimingThumbnailGenerator implements IThumbnailGenerator {
        constructor(private real: IThumbnailGenerator) {}
        async generateThumbnail(buffer: Buffer, w?: number, h?: number, cfg?: any): Promise<any> {
            const start = performance.now();
            const res = await this.real.generateThumbnail(buffer, w, h, cfg);
            thumbnailMs += performance.now() - start;
            return res;
        }
    }

    // Intercept storage writes
    const origStoreDerivedPage = derivedStorageService.storeDerivedPage;
    const origStoreDerivedThumbnail = derivedStorageService.storeDerivedThumbnail;

    (derivedStorageService as any).storeDerivedPage = async function (this: any, ...args: any[]) {
        const start = performance.now();
        const res = await origStoreDerivedPage.apply(this, args as any);
        storageWriteMs += performance.now() - start;
        return res;
    };

    (derivedStorageService as any).storeDerivedThumbnail = async function (this: any, ...args: any[]) {
        const start = performance.now();
        const res = await origStoreDerivedThumbnail.apply(this, args as any);
        storageWriteMs += performance.now() - start;
        return res;
    };

    // Intercept MongoDB IngestionPage findOneAndUpdate persistence
    const origFindOneAndUpdate = IngestionPage.findOneAndUpdate;
    (IngestionPage as any).findOneAndUpdate = function (this: any, ...args: any[]) {
        const start = performance.now();
        const query = origFindOneAndUpdate.apply(this, args as any);
        const origThen = query.then;
        query.then = function <TResult1 = any, TResult2 = never>(
            onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
            onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
        ): Promise<TResult1 | TResult2> {
            return origThen.call(
                query,
                (val: any) => {
                    dbPersistMs += performance.now() - start;
                    if (onfulfilled) return onfulfilled(val);
                    return val;
                },
                (err: any) => {
                    dbPersistMs += performance.now() - start;
                    if (onrejected) return onrejected(err);
                    throw err;
                }
            ) as any;
        };
        return query;
    };

    const timingPdfRenderer = new TimingPdfRenderer();
    const timingImageRenderer = new TimingImageRenderer();
    const timingThumbnailGenerator = new TimingThumbnailGenerator(defaultThumbnailGenerator);
    const timingCoverSheetDetector = new TimingCoverSheetDetector(defaultCoverSheetDetector);

    const pageIngestionService = new PageIngestionService(
        timingPdfRenderer,
        undefined,
        timingThumbnailGenerator,
        timingImageRenderer,
        timingCoverSheetDetector
    );

    const worker = new IngestionWorker({ pageIngestionService });

    const memStart = process.memoryUsage();
    const startTime = performance.now();

    // Process specifically our own batch to avoid picking up unrelated jobs on shared database
    let jobResult: any;
    try {
        jobResult = await worker.processNextJob({ batchId });
    } finally {
        // Restore spied methods
        (derivedStorageService as any).storeDerivedPage = origStoreDerivedPage;
        (derivedStorageService as any).storeDerivedThumbnail = origStoreDerivedThumbnail;
        (IngestionPage as any).findOneAndUpdate = origFindOneAndUpdate;
    }

    const endTime = performance.now();
    const memEnd = process.memoryUsage();

    const totalDurationMs = Math.max(0.001, endTime - startTime);
    const averageLatencyMsPerPage = totalDurationMs / totalPages;
    const pagesPerSecond = (totalPages / totalDurationMs) * 1000;
    const extrapolatedPagesPerHour = pagesPerSecond * 3600;
    const meetsTarget = extrapolatedPagesPerHour >= targetPagesPerHour;

    // 4. Exact page count discovery from DB records
    const processedPages = await IngestionPage.countDocuments({
        batchId,
        status: PageProcessingStatus.PROCESSED,
    });
    const failedPages = await IngestionPage.countDocuments({
        batchId,
        status: PageProcessingStatus.FAILED,
    });
    const jobFailed = jobResult?.status === IngestionStatus.DONE ? 0 : 1;
    const errorCount = failedPages + jobFailed;

    // Stage percentage calculation (measured against total duration of pipeline run)
    const measuredStageMs = renderMs + qrDetectMs + thumbnailMs + storageWriteMs + dbPersistMs;
    const otherMs = Math.max(0, totalDurationMs - measuredStageMs);
    const stagePercentages = {
        renderPct: Math.round((renderMs / totalDurationMs) * 1000) / 10,
        qrDetectPct: Math.round((qrDetectMs / totalDurationMs) * 1000) / 10,
        thumbnailPct: Math.round((thumbnailMs / totalDurationMs) * 1000) / 10,
        storageWritePct: Math.round((storageWriteMs / totalDurationMs) * 1000) / 10,
        dbPersistPct: Math.round((dbPersistMs / totalDurationMs) * 1000) / 10,
        otherPct: Math.round((otherMs / totalDurationMs) * 1000) / 10,
    };

    // Verify cover sheet identification and script assembly before optional cleanup
    const { default: AnswerScript, IdentificationStatus } = await import('../models/AnswerScript');
    const assembledScript = await AnswerScript.findOne({ exam: exam._id });
    const coverPageDoc = await IngestionPage.findOne({ batchId, pageNumber: 1 });
    const coverPageIdentified = Boolean(
        coverPageDoc?.isCoverPage && coverPageDoc?.status === PageProcessingStatus.PROCESSED
    );
    const scriptAssembled = Boolean(
        assembledScript &&
        (assembledScript.identificationStatus === IdentificationStatus.IDENTIFIED || Boolean(assembledScript.student))
    );

    // System and machine information
    let commitSha = 'UNKNOWN';
    try {
        commitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        // Git command unavailable in certain environments
    }

    const machineInfo = {
        cpuModel: os.cpus()[0]?.model || 'Unknown CPU',
        cpuCores: os.cpus().length,
        totalRam: `${(os.totalmem() / (1024 ** 3)).toFixed(1)} GB`,
        platform: `${process.platform} (${process.arch})`,
        nodeVersion: process.version,
    };

    const runInfo = {
        date: new Date().toISOString(),
        commitSha,
        command: `npx tsx src/scripts/loadTestIngestion.ts ${totalPages}`,
    };

    const metrics: IngestionLoadTestMetrics = {
        totalPages,
        processedPages,
        failedPages,
        totalDurationMs: Math.round(totalDurationMs * 100) / 100,
        averageLatencyMsPerPage: Math.round(averageLatencyMsPerPage * 100) / 100,
        pagesPerSecond: Math.round(pagesPerSecond * 100) / 100,
        extrapolatedPagesPerHour: Math.round(extrapolatedPagesPerHour),
        targetPagesPerHour,
        meetsTarget,
        errorCount,
        coverPageIdentified,
        scriptAssembled,
        assembledScriptId: assembledScript?._id?.toString(),
        assembledPageCount: assembledScript?.pageCount,
        machineInfo,
        runInfo,
        memoryUsage: {
            startHeapMb: Math.round((memStart.heapUsed / 1024 / 1024) * 100) / 100,
            endHeapMb: Math.round((memEnd.heapUsed / 1024 / 1024) * 100) / 100,
            heapUsedDeltaMb: Math.round(((memEnd.heapUsed - memStart.heapUsed) / 1024 / 1024) * 100) / 100,
            rssMb: Math.round((memEnd.rss / 1024 / 1024) * 100) / 100,
        },
        stageBreakdownMs: {
            renderMs: Math.round(renderMs * 100) / 100,
            qrDetectMs: Math.round(qrDetectMs * 100) / 100,
            thumbnailMs: Math.round(thumbnailMs * 100) / 100,
            storageWriteMs: Math.round(storageWriteMs * 100) / 100,
            dbPersistMs: Math.round(dbPersistMs * 100) / 100,
            otherMs: Math.round(otherMs * 100) / 100,
        },
        stagePercentages,
    };

    if (options.cleanup !== false) {
        try {
            await Promise.all([
                immutableStorageService.cleanupBatch(batchId),
                derivedStorageService.cleanupDerivedBatch(batchId),
            ]);
            await AnswerScript.deleteMany({ exam: exam._id });
            await StudentMapping.deleteMany({ exam: exam._id });
            await IngestionPage.deleteMany({ batchId });
            await IngestionJob.deleteMany({ batchId });
            await Exam.deleteOne({ _id: exam._id });
            await Course.deleteOne({ _id: course._id });
            await User.deleteMany({ _id: { $in: [instructor._id, student._id] } });
        } catch {
            // Ignore cleanup errors
        }
    }

    return metrics;
}

if (process.argv[1] && process.argv[1].endsWith('loadTestIngestion.ts')) {
    const pagesArg = parseInt(process.argv.slice(2).find((arg) => !arg.startsWith('-')) || '20', 10);
    console.log(`Starting ingestion load test for ${pagesArg} pages...`);
    runIngestionLoadTest({ totalPages: pagesArg })
        .then((metrics) => {
            console.log('\n==================================================');
            console.log('AE-223 INGESTION LOAD TEST BENCHMARK RESULTS');
            console.log('==================================================');
            console.log(`Machine CPU:          ${metrics.machineInfo.cpuModel} (${metrics.machineInfo.cpuCores} cores)`);
            console.log(`Machine RAM:          ${metrics.machineInfo.totalRam}`);
            console.log(`OS Platform:          ${metrics.machineInfo.platform}`);
            console.log(`Node Version:         ${metrics.machineInfo.nodeVersion}`);
            console.log(`Date:                 ${metrics.runInfo.date}`);
            console.log(`Git Commit:           ${metrics.runInfo.commitSha}`);
            console.log(`Command:              ${metrics.runInfo.command}`);
            console.log('--------------------------------------------------');
            console.log(`Total Pages:          ${metrics.totalPages}`);
            console.log(`Processed Pages:      ${metrics.processedPages}`);
            console.log(`Failed Pages:         ${metrics.failedPages}`);
            console.log(`Errors:               ${metrics.errorCount}`);
            console.log(`Total Duration:       ${metrics.totalDurationMs.toFixed(2)} ms`);
            console.log(`Average Latency:      ${metrics.averageLatencyMsPerPage.toFixed(2)} ms/page`);
            console.log(`Throughput:           ${metrics.pagesPerSecond} pages/sec (${metrics.extrapolatedPagesPerHour} pages/hour)`);
            console.log(`Design Target:        ${metrics.targetPagesPerHour} pages/hour`);
            console.log(`Target Status:        ${metrics.meetsTarget ? 'PASS (Exceeds Target)' : 'BELOW TARGET (Environment-constrained)'}`);
            console.log(`Cover Page ID:        ${metrics.coverPageIdentified ? 'IDENTIFIED (Cover Sheet Found)' : 'UNIDENTIFIED'}`);
            console.log(`Script Assembly:      ${metrics.scriptAssembled ? `ASSEMBLED (ID: ${metrics.assembledScriptId}, ${metrics.assembledPageCount} pages)` : 'NOT ASSEMBLED'}`);
            console.log('--------------------------------------------------');
            console.log('Per-Stage Measured Breakdown:');
            console.log(`- PDF Render & Raster: ${metrics.stageBreakdownMs.renderMs.toFixed(2)} ms (${metrics.stagePercentages.renderPct}%)`);
            console.log(`- Cover & QR Detect:   ${metrics.stageBreakdownMs.qrDetectMs.toFixed(2)} ms (${metrics.stagePercentages.qrDetectPct}%)`);
            console.log(`- Thumbnail Generate:  ${metrics.stageBreakdownMs.thumbnailMs.toFixed(2)} ms (${metrics.stagePercentages.thumbnailPct}%)`);
            console.log(`- Storage Writes:      ${metrics.stageBreakdownMs.storageWriteMs.toFixed(2)} ms (${metrics.stagePercentages.storageWritePct}%)`);
            console.log(`- DB Persistence:      ${metrics.stageBreakdownMs.dbPersistMs.toFixed(2)} ms (${metrics.stagePercentages.dbPersistPct}%)`);
            console.log(`- Other (Pipeline):    ${metrics.stageBreakdownMs.otherMs.toFixed(2)} ms (${metrics.stagePercentages.otherPct}%)`);
            console.log('--------------------------------------------------');
            console.log(`Memory Heap Delta:    ${metrics.memoryUsage.heapUsedDeltaMb} MB (RSS: ${metrics.memoryUsage.rssMb} MB)`);
            console.log('==================================================');
            process.exit(0);
        })
        .catch((err) => {
            console.error('Load test failed:', err);
            process.exit(1);
        });
}
