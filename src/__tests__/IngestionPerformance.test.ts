/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import * as zxing from '@zxing/library';
import { performance } from 'perf_hooks';

// Models
import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus, SplittingStrategyType } from '../models/Exam';
import StudentMapping from '../models/StudentMapping';
import Batch from '../models/Batch';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import IngestionPage from '../models/IngestionPage';
import AnswerScript from '../models/AnswerScript';

// Services
import batchService from '../services/BatchService';
import { IngestionWorker } from '../services/IngestionWorker';
import { PageIngestionService } from '../services/PageIngestionService';
import { DefaultPdfRenderer, DefaultImageRenderer, RenderPageInput, RenderPageResult } from '../services/PageRenderer';
import defaultThumbnailGenerator, { IThumbnailGenerator } from '../services/ThumbnailGenerator';
import defaultCoverSheetDetector, { ICoverSheetDetector } from '../services/CoverSheetDetector';
import defaultOMRReader, { OMRReader } from '../services/OMRReader';
import immutableStorageService from '../services/ImmutableStorageService';
import derivedStorageService from '../services/DerivedStorageService';

const ALICE_QR_TEXT = 'ROLL-ALICE';
const CHARLIE_QR_TEXT = 'ROLL-CHARLIE';

// Timing Accumulators
let renderTime = 0;
let thumbnailTime = 0;
let qrTime = 0;
let omrTime = 0;

vi.mock('../services/ImageEnhancer', () => {
    return {
        defaultImageEnhancer: {
            enhancePage: vi.fn().mockImplementation(async (buffer) => {
                const start = performance.now();
                const res = { buffer, deskewAngle: 0, orientation: 0, applied: false };
                if (!(globalThis as any).enhanceTime) {
                    (globalThis as any).enhanceTime = 0;
                }
                (globalThis as any).enhanceTime += performance.now() - start;
                return res;
            })
        }
    };
});

// Helper to generate a minimal PDF page structure with custom page count
function createCustomPdfBuffer(pageCount = 1, widthPt = 612, heightPt = 792): Buffer {
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

// Helper to generate a single-page image containing a QR code
function createQrCodeImageBuffer(text: string, width = 1000, height = 1000): Buffer {
    const writer = new zxing.QRCodeWriter();
    const qrMatrix = writer.encode(text, zxing.BarcodeFormat.QR_CODE, 120, 120, new Map());

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#000000';
    for (let x = 0; x < qrMatrix.getWidth(); x++) {
        for (let y = 0; y < qrMatrix.getHeight(); y++) {
            if (qrMatrix.get(x, y)) {
                ctx.fillRect(30 + x, 30 + y, 1, 1);
            }
        }
    }

    return canvas.toBuffer('image/png');
}

// Helper to generate a single-page image containing OMR bubble marks
function createOmrImageBuffer(width = 1000, height = 1000, marks: { x: number, y: number }[]): Buffer {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#000000';
    for (const mark of marks) {
        const px = Math.round(mark.x * width);
        const py = Math.round(mark.y * height);
        ctx.fillRect(px, py, 50, 50);
    }

    return canvas.toBuffer('image/png');
}

// Helper to generate a single-page image containing both QR code and OMR bubble marks
function createQrAndOmrImageBuffer(qrText: string, marks: { x: number, y: number }[], width = 1000, height = 1000): Buffer {
    const writer = new zxing.QRCodeWriter();
    const qrMatrix = writer.encode(qrText, zxing.BarcodeFormat.QR_CODE, 120, 120, new Map());

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Draw QR code at top left
    ctx.fillStyle = '#000000';
    for (let x = 0; x < qrMatrix.getWidth(); x++) {
        for (let y = 0; y < qrMatrix.getHeight(); y++) {
            if (qrMatrix.get(x, y)) {
                ctx.fillRect(30 + x, 30 + y, 1, 1);
            }
        }
    }

    // Draw OMR marks
    for (const mark of marks) {
        const px = Math.round(mark.x * width);
        const py = Math.round(mark.y * height);
        ctx.fillRect(px, py, 50, 50);
    }

    return canvas.toBuffer('image/png');
}

// Helper to generate a single-page image with multiple QR codes
function createMultipleQrCodeImageBuffer(texts: string[], width = 1000, height = 1000): Buffer {
    const writer = new zxing.QRCodeWriter();
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    const positions = [
        { x: 30, y: 30 },
        { x: 600, y: 30 }
    ];

    texts.forEach((text, i) => {
        const qrMatrix = writer.encode(text, zxing.BarcodeFormat.QR_CODE, 120, 120, new Map());
        const pos = positions[i % positions.length];
        ctx.fillStyle = '#000000';
        for (let x = 0; x < qrMatrix.getWidth(); x++) {
            for (let y = 0; y < qrMatrix.getHeight(); y++) {
                if (qrMatrix.get(x, y)) {
                    ctx.fillRect(pos.x + x, pos.y + y, 1, 1);
                }
            }
        }
    });

    return canvas.toBuffer('image/png');
}

// Helper to generate a plain cover page without any QR or OMR marking
function createBlankImageBuffer(width = 1000, height = 1000): Buffer {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#333333';
    ctx.font = '24px sans-serif';
    ctx.fillText('Plain Cover Sheet Page without Codes', 100, 100);
    return canvas.toBuffer('image/png');
}

// Custom PDF Renderer to inject a QR code on Page 1 of the multi-page PDF document
class CustomPdfRenderer extends DefaultPdfRenderer {
    async renderPage(input: RenderPageInput): Promise<RenderPageResult> {
        const start = performance.now();
        let result: RenderPageResult;
        if (input.pageNumber === 1) {
            const qrBuf = createQrCodeImageBuffer(ALICE_QR_TEXT);
            result = {
                success: true,
                pageNumber: 1,
                image: {
                    buffer: qrBuf,
                    format: 'png',
                    width: 1000,
                    height: 1000,
                    dpi: 150,
                    pageNumber: 1,
                    sizeBytes: qrBuf.length
                },
                metadata: {
                    fileType: 'pdf',
                    pageNumber: 1,
                    totalPages: 95,
                    width: 1000,
                    height: 1000,
                    dpi: 150,
                    format: 'png',
                    renderedAt: new Date().toISOString(),
                    sizeBytes: qrBuf.length
                }
            };
        } else {
            result = await super.renderPage(input);
        }
        renderTime += performance.now() - start;
        return result;
    }
}

class TimingImageRenderer extends DefaultImageRenderer {
    async renderPage(input: RenderPageInput): Promise<RenderPageResult> {
        const start = performance.now();
        const result = await super.renderPage(input);
        renderTime += performance.now() - start;
        return result;
    }
}

class TimingThumbnailGenerator implements IThumbnailGenerator {
    constructor(private realGenerator: IThumbnailGenerator) {}
    async generateThumbnail(
        pageImageBuffer: Buffer,
        sourceWidth?: number,
        sourceHeight?: number,
        config?: Partial<any>
    ): Promise<any> {
        const start = performance.now();
        const result = await this.realGenerator.generateThumbnail(pageImageBuffer, sourceWidth, sourceHeight, config);
        thumbnailTime += performance.now() - start;
        return result;
    }
}

class TimingCoverSheetDetector implements ICoverSheetDetector {
    constructor(private realDetector: ICoverSheetDetector) {}
    async detectCoverSheet(buffer: Buffer, pageNumber: number): Promise<any> {
        const start = performance.now();
        const result = await this.realDetector.detectCoverSheet(buffer, pageNumber);
        qrTime += performance.now() - start;
        return result;
    }
}

class TimingOMRReader extends OMRReader {
    constructor(private realReader: OMRReader) {
        super();
    }
    async readOMR(buffer: Buffer, template: any): Promise<any> {
        const start = performance.now();
        const result = await this.realReader.readOMR(buffer, template);
        omrTime += performance.now() - start;
        return result;
    }
}

describe('AE-079 — Ingestion Performance Check vs 5000 Pages/Hour', () => {
    let professorUser: any;
    let studentAlice: any;
    let studentBob: any;
    let studentCharlie: any;
    let course: any;
    let exam: any;
    let auditContext: any;
    let batchId: string;

    const testTemplate = {
        pageIndex: 0,
        columns: [
            {
                columnIndex: 0,
                bubbles: [
                    { value: '0', x: 0.5, y: 0.6, width: 0.05, height: 0.05 },
                    { value: '1', x: 0.5, y: 0.7, width: 0.05, height: 0.05 }
                ]
            },
            {
                columnIndex: 1,
                bubbles: [
                    { value: '0', x: 0.6, y: 0.6, width: 0.05, height: 0.05 },
                    { value: '1', x: 0.6, y: 0.7, width: 0.05, height: 0.05 }
                ]
            }
        ]
    };

    beforeAll(async () => {
        await Course.init();
        await Exam.init();
        await User.init();
        await StudentMapping.init();
        await Batch.init();
        await IngestionJob.init();
        await IngestionPage.init();
        await AnswerScript.init();
    });

    beforeEach(async () => {
        // Reset Accumulators
        renderTime = 0;
        thumbnailTime = 0;
        qrTime = 0;
        omrTime = 0;
        (globalThis as any).enhanceTime = 0;

        // Seed users
        professorUser = await User.create({
            name: 'Professor Snape',
            email: 'snape@hogwarts.edu',
            password: 'hashedpassword',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        auditContext = {
            actingUserId: professorUser._id.toString(),
            actingUserRole: UserRole.PROFESSOR,
            ipAddress: '127.0.0.1'
        };

        studentAlice = await User.create({
            name: 'Alice Granger',
            email: 'alice.granger@hogwarts.edu',
            password: 'hashedpassword',
            role: UserRole.STUDENT,
            isActive: true
        });

        studentBob = await User.create({
            name: 'Bob Potter',
            email: 'bob.potter@hogwarts.edu',
            password: 'hashedpassword',
            role: UserRole.STUDENT,
            isActive: true
        });

        studentCharlie = await User.create({
            name: 'Charlie Weasley',
            email: 'charlie.weasley@hogwarts.edu',
            password: 'hashedpassword',
            role: UserRole.STUDENT,
            isActive: true
        });

        course = await Course.create({
            courseCode: 'POTIONS-101',
            courseName: 'Potions Masterclass',
            professor: professorUser._id,
            semester: 1,
            academicYear: '2026-2027',
            enrolledStudents: [studentAlice._id, studentBob._id, studentCharlie._id],
            isActive: true
        });

        exam = await Exam.create({
            title: 'Midterm Potions Exam',
            course: course._id,
            createdBy: professorUser._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 5,
            splittingStrategy: SplittingStrategyType.COVER_PAGE,
            omrTemplate: testTemplate,
            enrolledStudents: [studentAlice._id, studentBob._id, studentCharlie._id],
            isActive: true
        });

        await StudentMapping.create([
            { exam: exam._id, student: studentAlice._id, anonymousId: 'STU-ALICE', rollNumber: 'ROLL-ALICE', isVerified: true },
            { exam: exam._id, student: studentBob._id, anonymousId: '10', rollNumber: 'ROLL-BOB', isVerified: true },
            { exam: exam._id, student: studentCharlie._id, anonymousId: '01', rollNumber: 'ROLL-CHARLIE', isVerified: true }
        ]);
    });

    afterAll(async () => {
        if (batchId) {
            await Promise.all([
                immutableStorageService.cleanupBatch(batchId),
                derivedStorageService.cleanupDerivedBatch(batchId)
            ]);
        }
        vi.restoreAllMocks();
    });

    it('benchmarks ingestion pipeline and measures per-stage and overall execution metrics against target throughput', async () => {
        // Generate deterministic test buffers
        const pdf95Pages = createCustomPdfBuffer(95);
        const omrBob = createOmrImageBuffer(1000, 1000, [
            { x: 0.5, y: 0.7 },
            { x: 0.6, y: 0.6 }
        ]);
        const qrAndOmrCharlie = createQrAndOmrImageBuffer(CHARLIE_QR_TEXT, [
            { x: 0.5, y: 0.6 },
            { x: 0.6, y: 0.7 }
        ]);
        const qrUnknown = createQrCodeImageBuffer('ROLL-UNKNOWN');
        const imgBlank = createBlankImageBuffer();
        const imgMultipleQr = createMultipleQrCodeImageBuffer(['ROLL-ALICE', 'ROLL-BOB']);

        // Upload batch
        const uploadResult = await batchService.createBatch(
            [
                { name: 'alice_exam_95pg.pdf', buffer: pdf95Pages, size: pdf95Pages.length },
                { name: 'bob_omr_1pg.png', buffer: omrBob, size: omrBob.length },
                { name: 'charlie_qr_omr_1pg.png', buffer: qrAndOmrCharlie, size: qrAndOmrCharlie.length },
                { name: 'unknown_student_1pg.png', buffer: qrUnknown, size: qrUnknown.length },
                { name: 'nocode_blank_1pg.png', buffer: imgBlank, size: imgBlank.length },
                { name: 'multiple_qr_1pg.png', buffer: imgMultipleQr, size: imgMultipleQr.length }
            ],
            exam._id.toString(),
            auditContext
        );

        const batch = uploadResult.batch;
        batchId = batch.batchId;

        // Instrumentation setup
        const customPdfRenderer = new CustomPdfRenderer();
        const timingImageRenderer = new TimingImageRenderer();
        const timingThumbnailGenerator = new TimingThumbnailGenerator(defaultThumbnailGenerator);
        const timingCoverSheetDetector = new TimingCoverSheetDetector(defaultCoverSheetDetector);
        const timingOMRReader = new TimingOMRReader(defaultOMRReader);

        const pageIngestionService = new PageIngestionService(
            customPdfRenderer,
            undefined,
            timingThumbnailGenerator,
            timingImageRenderer,
            timingCoverSheetDetector,
            undefined,
            timingOMRReader
        );

        const worker = new IngestionWorker({ pageIngestionService });

        // Instrument Database Persistence via Mongoose findOneAndUpdate spy
        let persistTime = 0;
        const originalFindOneAndUpdate = IngestionPage.findOneAndUpdate;
        vi.spyOn(IngestionPage, 'findOneAndUpdate').mockImplementation(function(this: any, ...args: any[]) {
            const query = originalFindOneAndUpdate.apply(this, args as any);
            const originalThen = query.then;
            query.then = function<TResult1 = any, TResult2 = never>(
                onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
                onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
            ): Promise<TResult1 | TResult2> {
                const startThen = performance.now();
                return originalThen.call(query, (value: any) => {
                    persistTime += performance.now() - startThen;
                    if (onfulfilled) return onfulfilled(value);
                    return value;
                }, (err: any) => {
                    persistTime += performance.now() - startThen;
                    if (onrejected) return onrejected(err);
                    throw err;
                }) as any;
            };
            return query as any;
        } as any);

        // Overall execution timing
        const startTime = performance.now();
        const processResult = await worker.processNextJob();
        const endTime = performance.now();

        const totalDurationMs = endTime - startTime;
        const averageMsPerPage = totalDurationMs / 100;
        const pagesPerHour = (100 / totalDurationMs) * 3600000;
        const targetPagesPerHour = 5000;

        const targetStatus = pagesPerHour >= targetPagesPerHour ? 'ABOVE SAMPLE TARGET' : 'BELOW SAMPLE TARGET';

        // Correctness assertions
        expect(processResult.processed).toBe(true);
        expect(processResult.status).toBe(IngestionStatus.DONE);
        expect(processResult.processedPages).toBe(100);

        const pages = await IngestionPage.find({ batchId });
        expect(pages.length).toBe(100);

        const scripts = await AnswerScript.find({ batchId });
        expect(scripts.length).toBe(6);

        // Sanity assertions on timing metrics (must be positive and non-zero where expected)
        expect(totalDurationMs).toBeGreaterThan(0);
        expect(averageMsPerPage).toBeGreaterThan(0);
        expect(pagesPerHour).toBeGreaterThan(0);
        expect(renderTime).toBeGreaterThan(0);
        expect(thumbnailTime).toBeGreaterThan(0);
        expect(qrTime).toBeGreaterThan(0);
        expect(omrTime).toBeGreaterThan(0);
        expect(persistTime).toBeGreaterThan(0);

        const enhanceTime = (globalThis as any).enhanceTime || 0;

        const timings = {
            'Render': renderTime,
            'Enhance (Mocked)': enhanceTime,
            'Thumbnail/Preview': thumbnailTime,
            'QR': qrTime,
            'OMR': omrTime,
            'Persist': persistTime
        };

        let slowestStage = '';
        let maxTime = -1;
        for (const [stage, time] of Object.entries(timings)) {
            if (time > maxTime) {
                maxTime = time;
                slowestStage = stage;
            }
        }

        // Print Structured Performance Report
        console.log('==================================================');
        console.log('AE-079 INGESTION PERFORMANCE METRICS');
        console.log('==================================================');
        console.log(`Total Duration:        ${totalDurationMs.toFixed(2)} ms`);
        console.log(`Pages Processed:       100`);
        console.log(`Average/Page:          ${averageMsPerPage.toFixed(2)} ms/page`);
        console.log(`Estimated Pages/Hour:  ${pagesPerHour.toFixed(2)}`);
        console.log(`Target Pages/Hour:     ${targetPagesPerHour}`);
        console.log(`Target Status:         ${targetStatus}`);
        console.log('');
        console.log('Per-Stage Timing:');
        console.log(`- Render:              ${renderTime.toFixed(2)} ms`);
        console.log(`- Enhance:             ${enhanceTime.toFixed(2)} ms (Mocked)`);
        console.log(`- Thumbnail/Preview:   ${thumbnailTime.toFixed(2)} ms`);
        console.log(`- QR:                  ${qrTime.toFixed(2)} ms`);
        console.log(`- OMR:                 ${omrTime.toFixed(2)} ms`);
        console.log(`- Persist:             ${persistTime.toFixed(2)} ms`);
        console.log('');
        console.log(`Slowest Measured Stage: ${slowestStage}`);
        console.log('Worker Model Finding:   Single-threaded at job level');
        console.log('==================================================');
    }, 180000);
});
