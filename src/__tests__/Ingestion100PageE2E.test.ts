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
import AnswerScript, { IdentificationSource, IdentificationStatus, ManualIdReason } from '../models/AnswerScript';

// Services
import batchService from '../services/BatchService';
import { IngestionWorker } from '../services/IngestionWorker';
import { PageIngestionService } from '../services/PageIngestionService';
import { DefaultPdfRenderer, RenderPageInput, RenderPageResult } from '../services/PageRenderer';
import immutableStorageService from '../services/ImmutableStorageService';
import derivedStorageService from '../services/DerivedStorageService';

const ALICE_QR_TEXT = 'ROLL-ALICE';
const CHARLIE_QR_TEXT = 'ROLL-CHARLIE';

vi.mock('../services/ImageEnhancer', () => {
    return {
        defaultImageEnhancer: {
            enhancePage: vi.fn().mockImplementation(async (buffer) => {
                return { buffer, deskewAngle: 0, orientation: 0, applied: false };
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

    // Draw QR code at top left (starts at x=30, y=30, size 120x120)
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
        if (input.pageNumber === 1) {
            const qrBuf = createQrCodeImageBuffer(ALICE_QR_TEXT);
            return {
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
        }
        return super.renderPage(input);
    }
}

describe('AE-078 — End-to-End Ingestion QA with 100-Page Mixed Fixture', () => {
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
        // Enforce DB schema compilation
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

        // Set up StudentMappings
        await StudentMapping.create([
            { exam: exam._id, student: studentAlice._id, anonymousId: 'STU-ALICE', rollNumber: 'ROLL-ALICE', isVerified: true },
            // Bob student mapped to anonymousId '10' (OMR representation)
            { exam: exam._id, student: studentBob._id, anonymousId: '10', rollNumber: 'ROLL-BOB', isVerified: true },
            // Charlie student mapped to anonymousId '01' and rollNumber 'ROLL-CHARLIE'
            { exam: exam._id, student: studentCharlie._id, anonymousId: '01', rollNumber: 'ROLL-CHARLIE', isVerified: true }
        ]);
    });

    afterAll(async () => {
        // Cleanup storage assets generated during e2e execution
        if (batchId) {
            await Promise.all([
                immutableStorageService.cleanupBatch(batchId),
                derivedStorageService.cleanupDerivedBatch(batchId)
            ]);
        }
        vi.restoreAllMocks();
    });

    it('processes a 100-page mixed batch containing a 95-page PDF and 5 single-page images, running QR/OMR checks and recording timing metrics', async () => {
        // Generate deterministic test buffers in-memory
        const pdf95Pages = createCustomPdfBuffer(95);

        // Bob OMR image buffer (Column 0: 1, Column 1: 0 -> studentId = '10')
        const omrBob = createOmrImageBuffer(1000, 1000, [
            { x: 0.5, y: 0.7 }, // Column 0, Bubble '1'
            { x: 0.6, y: 0.6 }  // Column 1, Bubble '0'
        ]);

        // Charlie QR + OMR image buffer (QR: ROLL-CHARLIE, OMR: Column 0: 0, Column 1: 1 -> studentId = '01')
        const qrAndOmrCharlie = createQrAndOmrImageBuffer(CHARLIE_QR_TEXT, [
            { x: 0.5, y: 0.6 }, // Column 0, Bubble '0'
            { x: 0.6, y: 0.7 }  // Column 1, Bubble '1'
        ]);

        // Unknown student QR image buffer
        const qrUnknown = createQrCodeImageBuffer('ROLL-UNKNOWN');

        // No-code blank cover page image buffer
        const imgBlank = createBlankImageBuffer();

        // Multiple QR codes cover page image buffer
        const imgMultipleQr = createMultipleQrCodeImageBuffer(['ROLL-ALICE', 'ROLL-BOB']);

        // Assert file byte counts are non-zero
        expect(pdf95Pages.length).toBeGreaterThan(0);
        expect(omrBob.length).toBeGreaterThan(0);
        expect(qrAndOmrCharlie.length).toBeGreaterThan(0);
        expect(qrUnknown.length).toBeGreaterThan(0);
        expect(imgBlank.length).toBeGreaterThan(0);
        expect(imgMultipleQr.length).toBeGreaterThan(0);

        // 1. Batch upload preparation & creation
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
        const initialJob = uploadResult.job;

        // Verify sequential zero-based fileIndex assignment
        expect(batch.files.length).toBe(6);
        expect(batch.files.map(f => f.fileIndex)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(batch.files.map(f => f.originalFilename)).toEqual([
            'alice_exam_95pg.pdf',
            'bob_omr_1pg.png',
            'charlie_qr_omr_1pg.png',
            'unknown_student_1pg.png',
            'nocode_blank_1pg.png',
            'multiple_qr_1pg.png'
        ]);

        // Verify initial page count estimates
        expect(batch.files[0].pageCount).toBe(95);
        expect(batch.files[1].pageCount).toBe(1);
        expect(batch.files[2].pageCount).toBe(1);
        expect(batch.files[3].pageCount).toBe(1);
        expect(batch.files[4].pageCount).toBe(1);
        expect(batch.files[5].pageCount).toBe(1);
        expect(batch.totalPageCount).toBe(100);

        // 2. Ingestion Job Creation
        expect(initialJob).toBeDefined();
        expect(initialJob.status).toBe(IngestionStatus.QUEUED);
        expect(initialJob.totalPages).toBe(100);

        // 3. Set up Ingestion Worker with custom renderer for PDF to inject QR code on Page 1
        const customPdfRenderer = new CustomPdfRenderer();
        const pageIngestionService = new PageIngestionService(customPdfRenderer);
        const worker = new IngestionWorker({ pageIngestionService });

        // Record timing information during E2E processing
        const startTime = performance.now();

        // Run worker processing
        const processResult = await worker.processNextJob();

        const endTime = performance.now();
        const totalDurationMs = endTime - startTime;
        const averageMsPerPage = totalDurationMs / 100;

        // Structured performance logs
        console.log('==================================================');
        console.log('AE-078 E2E INGESTION TIMING & QA METRICS');
        console.log(`- Total Duration:         ${totalDurationMs.toFixed(2)} ms`);
        console.log(`- Total Pages Processed:  100 pages`);
        console.log(`- Avg Time Per Page:      ${averageMsPerPage.toFixed(2)} ms/page`);
        console.log('==================================================');

        // Verify Ingestion Worker execution result
        expect(processResult.processed).toBe(true);
        expect(processResult.status).toBe(IngestionStatus.DONE);
        expect(processResult.processedPages).toBe(100);
        expect(processResult.failedPages).toBe(0);

        // 4. Assert Page persistence in IngestionPage
        const pages = await IngestionPage.find({ batchId }).sort({ fileIndex: 1, pageNumber: 1 });
        expect(pages.length).toBe(100);

        // Verify correct fileIndex assignments on persisted pages
        expect(pages.filter(p => p.fileIndex === 0).length).toBe(95);
        expect(pages.filter(p => p.fileIndex === 1).length).toBe(1);
        expect(pages.filter(p => p.fileIndex === 2).length).toBe(1);
        expect(pages.filter(p => p.fileIndex === 3).length).toBe(1);
        expect(pages.filter(p => p.fileIndex === 4).length).toBe(1);
        expect(pages.filter(p => p.fileIndex === 5).length).toBe(1);

        // Page ordering validation for File 0 (1 to 95)
        for (let i = 0; i < 95; i++) {
            expect(pages[i].pageNumber).toBe(i + 1);
            expect(pages[i].fileIndex).toBe(0);
        }

        // Cover page assertions
        const coverPages = pages.filter(p => p.isCoverPage);
        // Page 1 of each of the 6 files must be flagged as a cover page
        expect(coverPages.length).toBe(6);
        expect(coverPages.map(p => p.fileIndex)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(coverPages.map(p => p.pageNumber)).toEqual([1, 1, 1, 1, 1, 1]);

        // 5. Ingestion Student Identification checks
        // File 0: Alice Granger (resolved by QR ROLL-ALICE)
        const coverAlice = pages.find(p => p.fileIndex === 0 && p.pageNumber === 1);
        expect(coverAlice!.qrDecodeOutcome).toBe('found');
        expect(coverAlice!.qrStudentId).toBe(ALICE_QR_TEXT);
        expect(coverAlice!.omrDecodeOutcome).toBe('not_found');

        // File 1: Bob Potter (resolved by OMR bubble reader fallback '10')
        const coverBob = pages.find(p => p.fileIndex === 1 && p.pageNumber === 1);
        expect(coverBob!.qrDecodeOutcome).toBe('not_found');
        expect(coverBob!.omrDecodeOutcome).toBe('found');
        expect(coverBob!.omrStudentId).toBe('10');

        // File 2: Charlie Weasley (contains both QR and OMR, checking QR precedence)
        const coverCharlie = pages.find(p => p.fileIndex === 2 && p.pageNumber === 1);
        expect(coverCharlie!.qrDecodeOutcome).toBe('found');
        expect(coverCharlie!.qrStudentId).toBe(CHARLIE_QR_TEXT);
        expect(coverCharlie!.omrDecodeOutcome).toBe('found');
        expect(coverCharlie!.omrStudentId).toBe('01');

        // File 3: Unknown Student (not in roster)
        const coverUnknown = pages.find(p => p.fileIndex === 3 && p.pageNumber === 1);
        expect(coverUnknown!.qrDecodeOutcome).toBe('found');
        expect(coverUnknown!.qrStudentId).toBe('ROLL-UNKNOWN');

        // File 4: No code page
        const coverNoCode = pages.find(p => p.fileIndex === 4 && p.pageNumber === 1);
        expect(coverNoCode!.qrDecodeOutcome).toBe('not_found');
        expect(coverNoCode!.omrDecodeOutcome).toBe('not_found');

        // File 5: Multiple QRs
        const coverMultiple = pages.find(p => p.fileIndex === 5 && p.pageNumber === 1);
        expect(coverMultiple!.qrDecodeOutcome).toBe('multiple');

        // 6. Assert AnswerScript creation and Student Roster Mapping
        const scripts = await AnswerScript.find({ batchId }).sort({ fileIndex: 1, startPageNumber: 1 });
        // Since splitting strategy is COVER_PAGE, and each file crosses boundary or starts with pageNumber === 1,
        // we expect exactly 6 logical scripts (one per file).
        expect(scripts.length).toBe(6);

        // Verify script page boundaries
        // Script 0 (Alice): pages 1 to 95 of fileIndex 0
        expect(scripts[0].fileIndex).toBe(0);
        expect(scripts[0].startPageNumber).toBe(1);
        expect(scripts[0].endPageNumber).toBe(95);
        expect(scripts[0].pageCount).toBe(95);
        expect(scripts[0].student?.toString()).toBe(studentAlice._id.toString());
        expect(scripts[0].identificationSource).toBe(IdentificationSource.QR);
        expect(scripts[0].identificationStatus).toBe(IdentificationStatus.IDENTIFIED);
        expect(scripts[0].needsManualId).toBe(false);

        // Script 1 (Bob): page 1 of fileIndex 1
        expect(scripts[1].fileIndex).toBe(1);
        expect(scripts[1].startPageNumber).toBe(1);
        expect(scripts[1].endPageNumber).toBe(1);
        expect(scripts[1].pageCount).toBe(1);
        expect(scripts[1].student?.toString()).toBe(studentBob._id.toString());
        expect(scripts[1].identificationSource).toBe(IdentificationSource.OMR);
        expect(scripts[1].identificationStatus).toBe(IdentificationStatus.IDENTIFIED);
        expect(scripts[1].needsManualId).toBe(false);

        // Script 2 (Charlie): page 1 of fileIndex 2
        expect(scripts[2].fileIndex).toBe(2);
        expect(scripts[2].startPageNumber).toBe(1);
        expect(scripts[2].endPageNumber).toBe(1);
        expect(scripts[2].pageCount).toBe(1);
        expect(scripts[2].student?.toString()).toBe(studentCharlie._id.toString());
        // Should use QR due to precedence
        expect(scripts[2].identificationSource).toBe(IdentificationSource.QR);
        expect(scripts[2].identificationStatus).toBe(IdentificationStatus.IDENTIFIED);
        expect(scripts[2].needsManualId).toBe(false);

        // Script 3 (Unknown): page 1 of fileIndex 3
        expect(scripts[3].fileIndex).toBe(3);
        expect(scripts[3].startPageNumber).toBe(1);
        expect(scripts[3].student).toBeNull();
        expect(scripts[3].identificationStatus).toBe(IdentificationStatus.UNIDENTIFIED);
        expect(scripts[3].needsManualId).toBe(true);
        expect(scripts[3].manualIdReason).toBe(ManualIdReason.NOT_IN_ROSTER);

        // Script 4 (No code): page 1 of fileIndex 4
        expect(scripts[4].fileIndex).toBe(4);
        expect(scripts[4].startPageNumber).toBe(1);
        expect(scripts[4].student).toBeNull();
        expect(scripts[4].identificationStatus).toBe(IdentificationStatus.UNIDENTIFIED);
        expect(scripts[4].needsManualId).toBe(true);
        expect(scripts[4].manualIdReason).toBe(ManualIdReason.NO_CODE_FOUND);

        // Script 5 (Multiple): page 1 of fileIndex 5
        expect(scripts[5].fileIndex).toBe(5);
        expect(scripts[5].startPageNumber).toBe(1);
        expect(scripts[5].student).toBeNull();
        expect(scripts[5].identificationStatus).toBe(IdentificationStatus.UNIDENTIFIED);
        expect(scripts[5].needsManualId).toBe(true);
        expect(scripts[5].manualIdReason).toBe(ManualIdReason.MULTIPLE_CODES);

        // 7. Verify cross-file boundaries:
        // Every single script starts at startPageNumber: 1 and is constrained inside its own file.
        // There is no range that crosses file boundaries. This verifies file-crossing boundaries are correctly closed.
        for (const script of scripts) {
            expect(script.startPageNumber).toBe(1);
        }
    }, 300000);
});
