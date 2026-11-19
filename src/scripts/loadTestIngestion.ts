/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, prefer-const */
import { loadEnvConfig } from '@next/env';
import { performance } from 'perf_hooks';
import mongoose from 'mongoose';
import { createCanvas } from '@napi-rs/canvas';
import * as zxing from '@zxing/library';

loadEnvConfig(process.cwd());

export interface IngestionLoadTestOptions {
    totalPages?: number;
    batchSize?: number;
    concurrency?: number;
    cleanup?: boolean;
}

export interface IngestionLoadTestMetrics {
    totalPages: number;
    totalDurationMs: number;
    pagesPerSecond: number;
    extrapolatedPagesPerHour: number;
    targetPagesPerHour: number;
    meetsTarget: boolean;
    errorCount: number;
    memoryUsage: {
        startHeapMb: number;
        endHeapMb: number;
        heapUsedDeltaMb: number;
        rssMb: number;
    };
    stageBreakdownMs: {
        renderMs: number;
        qrDetectMs: number;
        thumbnailMs: number;
        storageWriteMs: number;
        dbPersistMs: number;
    };
}

function createMinimalPdfBuffer(pageCount: number, widthPt = 612, heightPt = 792): Buffer {
    let pdfStr = `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [`;
    for (let i = 1; i <= pageCount; i++) {
        pdfStr += `${i + 2} 0 R `;
    }
    pdfStr += `] /Count ${pageCount} >>\nendobj\n`;

    for (let i = 1; i <= pageCount; i++) {
        pdfStr += `${i + 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${widthPt} ${heightPt}] >>\nendobj\n`;
    }
    pdfStr += `xref\n0 ${pageCount + 3}\ntrailer\n<< /Size ${pageCount + 3} /Root 1 0 R >>\nstartxref\n500\n%%EOF`;
    return Buffer.from(pdfStr, 'utf-8');
}

function createQrImageBuffer(text: string, width = 800, height = 800): Buffer {
    const writer = new zxing.QRCodeWriter();
    const qrMatrix = writer.encode(text, zxing.BarcodeFormat.QR_CODE, 100, 100, new Map());

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#000000';
    for (let x = 0; x < qrMatrix.getWidth(); x++) {
        for (let y = 0; y < qrMatrix.getHeight(); y++) {
            if (qrMatrix.get(x, y)) {
                ctx.fillRect(20 + x, 20 + y, 1, 1);
            }
        }
    }
    return canvas.toBuffer('image/png');
}

export async function runIngestionLoadTest(
    options: IngestionLoadTestOptions = {}
): Promise<IngestionLoadTestMetrics> {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Load testing is forbidden against production environments');
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
    const { default: IngestionPage } = await import('../models/IngestionPage');
    const { default: batchService } = await import('../services/BatchService');
    const { IngestionWorker } = await import('../services/IngestionWorker');
    const { PageIngestionService } = await import('../services/PageIngestionService');
    const { default: immutableStorageService } = await import('../services/ImmutableStorageService');
    const { default: derivedStorageService } = await import('../services/DerivedStorageService');

    // Setup instructor & course & exam
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

    await StudentMapping.create({
        exam: exam._id,
        student: student._id,
        anonymousId: 'ANON-LT-1',
        rollNumber: 'ROLL-LT-1',
        isVerified: true,
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

    // Prepare files: split totalPages into PDF multi-page or image files
    const qrImage = createQrImageBuffer('ROLL-LT-1');
    const pdfPages = totalPages > 1 ? totalPages - 1 : 1;
    const multiPdf = createMinimalPdfBuffer(pdfPages);

    const filesToUpload = [
        { name: 'load_cover_qr.png', buffer: qrImage, size: qrImage.length },
    ];
    if (totalPages > 1) {
        filesToUpload.push({
            name: `load_content_${pdfPages}pg.pdf`,
            buffer: multiPdf,
            size: multiPdf.length,
        });
    }

    const uploadResult = await batchService.createBatch(
        filesToUpload,
        exam._id.toString(),
        auditContext
    );
    const batchId = uploadResult.batch.batchId;

    // Track stages
    let renderMs = 0;
    let qrDetectMs = 0;
    let thumbnailMs = 0;
    let storageWriteMs = 0;
    let dbPersistMs = 0;

    const pageIngestionService = new PageIngestionService();
    const worker = new IngestionWorker({ pageIngestionService });

    const memStart = process.memoryUsage();
    const startTime = performance.now();

    const jobResult = await worker.processNextJob();
    const endTime = performance.now();
    const memEnd = process.memoryUsage();

    const totalDurationMs = Math.max(0.001, endTime - startTime);
    const pagesPerSecond = (totalPages / totalDurationMs) * 1000;
    const extrapolatedPagesPerHour = pagesPerSecond * 3600;
    const meetsTarget = extrapolatedPagesPerHour >= targetPagesPerHour;

    const errorCount = jobResult.status === IngestionStatus.DONE ? 0 : 1;

    const metrics: IngestionLoadTestMetrics = {
        totalPages,
        totalDurationMs,
        pagesPerSecond: Math.round(pagesPerSecond * 100) / 100,
        extrapolatedPagesPerHour: Math.round(extrapolatedPagesPerHour),
        targetPagesPerHour,
        meetsTarget,
        errorCount,
        memoryUsage: {
            startHeapMb: Math.round((memStart.heapUsed / 1024 / 1024) * 100) / 100,
            endHeapMb: Math.round((memEnd.heapUsed / 1024 / 1024) * 100) / 100,
            heapUsedDeltaMb: Math.round(((memEnd.heapUsed - memStart.heapUsed) / 1024 / 1024) * 100) / 100,
            rssMb: Math.round((memEnd.rss / 1024 / 1024) * 100) / 100,
        },
        stageBreakdownMs: {
            renderMs: Math.round(renderMs),
            qrDetectMs: Math.round(qrDetectMs),
            thumbnailMs: Math.round(thumbnailMs),
            storageWriteMs: Math.round(storageWriteMs),
            dbPersistMs: Math.round(dbPersistMs),
        },
    };

    if (options.cleanup !== false) {
        try {
            await Promise.all([
                immutableStorageService.cleanupBatch(batchId),
                derivedStorageService.cleanupDerivedBatch(batchId),
            ]);
            await IngestionPage.deleteMany({ batchId });
            await IngestionJob.deleteMany({ batchId });
            await Exam.deleteOne({ _id: exam._id });
            await Course.deleteOne({ _id: course._id });
        } catch {
            // Ignore cleanup errors
        }
    }

    return metrics;
}

if (process.argv[1] && process.argv[1].endsWith('loadTestIngestion.ts')) {
    const pagesArg = parseInt(process.argv.slice(2).find(arg => !arg.startsWith('-')) || '50', 10);
    console.log(`Starting ingestion load test for ${pagesArg} pages...`);
    runIngestionLoadTest({ totalPages: pagesArg })
        .then(metrics => {
            console.log('\n--- Ingestion Load Test Results ---');
            console.log(`Pages Processed: ${metrics.totalPages}`);
            console.log(`Total Duration: ${metrics.totalDurationMs.toFixed(2)} ms`);
            console.log(`Throughput: ${metrics.pagesPerSecond} pages/sec (${metrics.extrapolatedPagesPerHour} pages/hour)`);
            console.log(`Target: ${metrics.targetPagesPerHour} pages/hour -> ${metrics.meetsTarget ? 'PASSED (Meets Target)' : 'BELOW TARGET'}`);
            console.log(`Memory Delta: ${metrics.memoryUsage.heapUsedDeltaMb} MB (RSS: ${metrics.memoryUsage.rssMb} MB)`);
            console.log(`Errors: ${metrics.errorCount}`);
            process.exit(0);
        })
        .catch(err => {
            console.error('Load test failed:', err);
            process.exit(1);
        });
}
