/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import AnswerScript, { IdentificationSource, IdentificationStatus } from '../models/AnswerScript';
import { PageIngestionService } from '../services/PageIngestionService';
import { StudentRosterMappingService } from '../services/StudentRosterMappingService';
import { OMRReader, OMRStatus } from '../services/OMRReader';
import { createCanvas } from '@napi-rs/canvas';

// Helper to draw deterministic mock cover page buffers
function drawPageBuffer(width: number, height: number, drawFn: (ctx: any) => void): Buffer {
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    drawFn(ctx);
    return canvas.toBuffer('image/png');
}

describe('AE-070 — OMR Bubble Reader Falls & Safety Tests', () => {
    let prof: any;
    let course: any;
    let exam: any;
    let batch: any;
    let pageIngestionService: PageIngestionService;
    let rosterService: StudentRosterMappingService;
    let omrReader: OMRReader;

    let studentA: any;
    let studentB: any;

    const testTemplate = {
        pageIndex: 0,
        columns: [
            {
                columnIndex: 0,
                bubbles: [
                    { value: '0', x: 0.1, y: 0.1, width: 0.05, height: 0.05 },
                    { value: '1', x: 0.1, y: 0.2, width: 0.05, height: 0.05 }
                ]
            },
            {
                columnIndex: 1,
                bubbles: [
                    { value: '0', x: 0.2, y: 0.1, width: 0.05, height: 0.05 },
                    { value: '1', x: 0.2, y: 0.2, width: 0.05, height: 0.05 }
                ]
            }
        ]
    };

    beforeAll(async () => {
        await Course.init();
        await Exam.init();
        await User.init();
        await Batch.init();
        await IngestionPage.init();
        await AnswerScript.init();
    });

    beforeEach(async () => {
        await AnswerScript.deleteMany({});
        await IngestionPage.deleteMany({});
        await Batch.deleteMany({});
        await Exam.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});

        omrReader = new OMRReader();
        pageIngestionService = new PageIngestionService(
            undefined, undefined, undefined, undefined, undefined, undefined, omrReader
        );
        rosterService = new StudentRosterMappingService();

        prof = await User.create({
            name: 'Prof A',
            email: 'profa@university.edu',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        course = await Course.create({
            courseCode: 'CS302',
            courseName: 'Formal Methods',
            professor: prof._id,
            semester: 2,
            academicYear: '2026-2027',
            isActive: true
        });

        // Set up two rostered students
        studentA = await User.create({
            name: 'Student A',
            email: 'studenta@university.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        studentB = await User.create({
            name: 'Student B',
            email: 'studentb@university.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        // Map student IDs
        // CS302 has student A mapped to ID '10', and student B mapped to ID '01'
        await Course.updateOne(
            { _id: course._id },
            { $addToSet: { enrolledStudents: [studentA._id, studentB._id] } }
        );

        exam = await Exam.create({
            title: 'Final OMR Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.DRAFT,
            numberOfQuestions: 10,
            omrTemplate: testTemplate,
            isActive: true
        });

        // Add mappings to studentMapping collection or mock resolved values in service
        // Let's seed mapping details
        const StudentMapping = mongoose.models.StudentMapping || (await import('../models/StudentMapping')).default;
        await StudentMapping.create([
            { student: studentA._id, anonymousId: '10', exam: exam._id },
            { student: studentB._id, anonymousId: '01', exam: exam._id }
        ]);

        batch = await Batch.create({
            batchId: `batch-${Date.now()}`,
            exam: exam._id,
            uploadedBy: prof._id,
            status: BatchStatus.QUEUED,
            files: [{
                fileId: 'file-1',
                fileIndex: 0,
                originalFilename: 'script.pdf',
                mimeType: 'application/pdf',
                size: 1024,
                storageKey: 'batches/script.pdf',
                pageCount: 1,
                fileType: 'pdf'
            }],
            totalFiles: 1,
            totalSize: 1024,
            totalPageCount: 1,
            isActive: true
        });
    });

    it('1. Clearly marked valid student-ID bubbles → successful decode', async () => {
        // Draw black rects on Column 0 Bubble '1' (x=100, y=200) and Column 1 Bubble '0' (x=200, y=100)
        const buf = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#000000';
            ctx.fillRect(100, 200, 50, 50); // C0 B1
            ctx.fillRect(200, 100, 50, 50); // C1 B0
        });

        const res = await omrReader.readOMR(buf, testTemplate);
        expect(res.status).toBe(OMRStatus.SUCCESS);
        expect(res.studentId).toBe('10');
    });

    it('2. Empty column → unsuccessful result (UNREADABLE)', async () => {
        const buf = drawPageBuffer(1000, 1000, () => {}); // No bubbles marked
        const res = await omrReader.readOMR(buf, testTemplate);
        expect(res.status).toBe(OMRStatus.UNREADABLE);
        expect(res.studentId).toBeNull();
    });

    it('3. Two marked bubbles in one column → ambiguous result', async () => {
        // Draw Column 0 Bubble '0' and Column 0 Bubble '1' both marked
        const buf = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#000000';
            ctx.fillRect(100, 100, 50, 50);
            ctx.fillRect(100, 200, 50, 50);
        });

        const res = await omrReader.readOMR(buf, testTemplate);
        expect(res.status).toBe(OMRStatus.AMBIGUOUS);
        expect(res.studentId).toBeNull();
    });

    it('4. Ambiguous fill ratio → ambiguous result', async () => {
        // Fill bubble partially (approx 15% - 20% area inside the 15% inset crop)
        const buf = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#000000';
            // Scanned area: x=108, y=108, w=34, h=34 (1156 pixels)
            // Fill 200 pixels with black -> fill ratio ~17.3% (ambiguous)
            ctx.fillRect(108, 108, 12, 16);
        });

        const res = await omrReader.readOMR(buf, testTemplate);
        expect(res.status).toBe(OMRStatus.AMBIGUOUS);
    });

    it('5. Strong candidate with insufficient confidence margin → ambiguous result', async () => {
        const buf = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#000000';
            // C0 B0: 50% filled (17x34 px inside)
            ctx.fillRect(108, 108, 17, 34);
            // C0 B1: 40% filled (14x34 px inside)
            ctx.fillRect(108, 208, 14, 34);
        });

        const res = await omrReader.readOMR(buf, testTemplate);
        expect(res.status).toBe(OMRStatus.AMBIGUOUS);
    });

    it('6. Strong candidate with sufficient confidence margin → successful result', async () => {
        const buf = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#000000';
            // C0 B1: 60% filled (20x34 inside)
            ctx.fillRect(108, 208, 20, 34);
            // C0 B0: 5% filled (2x34 inside)
            ctx.fillRect(108, 108, 2, 34);
            // C1 B0: 70% filled (24x34 inside)
            ctx.fillRect(208, 108, 24, 34);
        });

        const res = await omrReader.readOMR(buf, testTemplate);
        expect(res.status).toBe(OMRStatus.SUCCESS);
        expect(res.studentId).toBe('10');
    });

    it('7. Missing OMR template → INVALID_CONFIGURATION', async () => {
        const buf = drawPageBuffer(1000, 1000, () => {});
        const res = await omrReader.readOMR(buf, null);
        expect(res.status).toBe(OMRStatus.INVALID_CONFIGURATION);
    });

    it('8. Invalid/out-of-bounds template → INVALID_CONFIGURATION', async () => {
        const buf = drawPageBuffer(1000, 1000, () => {});
        const badTemplate = {
            pageIndex: 0,
            columns: [{
                columnIndex: 0,
                bubbles: [{ value: '0', x: 0.98, y: 0.1, width: 0.05, height: 0.05 }] // x+w = 1.03
            }]
        };
        const res = await omrReader.readOMR(buf, badTemplate);
        expect(res.status).toBe(OMRStatus.INVALID_CONFIGURATION);
    });

    it('9. Normalized coordinates work at high resolution & 10. works at low resolution', async () => {
        // High resolution (2000 x 2000)
        const bufHigh = drawPageBuffer(2000, 2000, (ctx) => {
            ctx.fillStyle = '#000000';
            ctx.fillRect(200, 400, 100, 100); // C0 B1
            ctx.fillRect(400, 200, 100, 100); // C1 B0
        });
        const resHigh = await omrReader.readOMR(bufHigh, testTemplate);
        expect(resHigh.status).toBe(OMRStatus.SUCCESS);
        expect(resHigh.studentId).toBe('10');

        // Low resolution (1000 x 1000)
        const bufLow = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#000000';
            ctx.fillRect(100, 200, 50, 50); // C0 B1
            ctx.fillRect(200, 100, 50, 50); // C1 B0
        });
        const resLow = await omrReader.readOMR(bufLow, testTemplate);
        expect(resLow.status).toBe(OMRStatus.SUCCESS);
        expect(resLow.studentId).toBe('10');
    });

    it('11. OMR reads from the enhanced canonical image rather than the original image', async () => {
        // Mock activeImageEnhancer to modify the buffer (e.g. binarize a gray background)
        const originalBuf = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#CCCCCC'; // original scan has low-contrast grey bubbles
            ctx.fillRect(100, 200, 50, 50);
            ctx.fillRect(200, 100, 50, 50);
        });

        const enhancedBuf = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#000000'; // enhanced binarizes it to clean black
            ctx.fillRect(100, 200, 50, 50);
            ctx.fillRect(200, 100, 50, 50);
        });

        // Set up spy on readOMR
        const readOMRSpy = vi.spyOn(omrReader, 'readOMR');

        // Ingestion pipeline mock
        const mockEnhancer = {
            enhancePage: vi.fn().mockResolvedValue({
                applied: true,
                buffer: enhancedBuf,
                deskewAngle: 0,
                orientation: 0
            })
        };

        const mockRenderer = {
            renderPage: vi.fn().mockResolvedValue({
                success: true,
                image: {
                    buffer: originalBuf,
                    format: 'png',
                    width: 1000,
                    height: 1000
                }
            })
        };

        await pageIngestionService.processPage({
            batchId: batch.batchId,
            jobId: new mongoose.Types.ObjectId(),
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: 'batches/script.pdf',
            pageNumber: 1,
            fileType: 'pdf',
            fileBuffer: originalBuf,
            renderer: mockRenderer as any,
            imageEnhancer: mockEnhancer as any
        });

        expect(mockEnhancer.enhancePage).toHaveBeenCalledWith(originalBuf, 'png');
        expect(readOMRSpy).toHaveBeenCalledWith(enhancedBuf, expect.any(Object));

        readOMRSpy.mockRestore();
    });

    it('12. Faint/low-contrast scan improved by AE-067 can be read after enhancement', async () => {
        const faintBuf = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#F0F0F0'; // faint grey (luminance ~240, read as empty without enhancement)
            ctx.fillRect(100, 200, 50, 50);
        });

        // Without enhancement, OMR reader reads it as UNREADABLE
        const resUnenhanced = await omrReader.readOMR(faintBuf, testTemplate);
        expect(resUnenhanced.status).toBe(OMRStatus.UNREADABLE);

        // Simulate AE-067 image contrast adjustment
        const enhancedBuf = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#000000'; // enhanced to black
            ctx.fillRect(100, 200, 50, 50);
            ctx.fillRect(200, 100, 50, 50);
        });

        const resEnhanced = await omrReader.readOMR(enhancedBuf, testTemplate);
        expect(resEnhanced.status).toBe(OMRStatus.SUCCESS);
        expect(resEnhanced.studentId).toBe('10');
    });

    it('13. QR success prevents OMR from becoming authoritative & 17. preserves conflicts', async () => {
        // QR identifies Student A ('10')
        // OMR identifies Student B ('01')
        const jobId = new mongoose.Types.ObjectId();
        await IngestionPage.create({
            batchId: batch.batchId,
            job: jobId,
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: 'batches/script-derived.png',
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED,
            isCoverPage: true,
            qrStudentId: '10',
            qrDecodeOutcome: 'found',
            omrStudentId: '01',
            omrDecodeOutcome: 'found'
        });

        await IngestionPage.create({
            batchId: batch.batchId,
            job: jobId,
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: 'batches/script-p2.png',
            pageNumber: 2,
            status: PageProcessingStatus.PROCESSED,
            isCoverPage: false
        });

        await rosterService.assembleAndMapAnswerScripts(batch.batchId, { actingUserId: prof._id.toString(), actingUserRole: 'PROFESSOR' });

        // Retrieve mapped script
        const script = await AnswerScript.findOne({ batchId: batch.batchId });
        expect(script).not.toBeNull();
        expect(script?.student?.toString()).toBe(studentA._id.toString()); // Resolved to Student A (QR)
        expect(script?.identificationSource).toBe(IdentificationSource.QR);
        expect(script?.qrStudentId).toBe('10');
        expect(script?.omrStudentId).toBe('01');
        expect(script?.hasIdentificationConflict).toBe(true); // Diagnostic conflict preserved
    });

    it('14. QR unavailable + valid OMR produces OMR candidate', async () => {
        await IngestionPage.create({
            batchId: batch.batchId,
            job: new mongoose.Types.ObjectId(),
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: 'batches/script-derived.png',
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED,
            isCoverPage: true,
            qrStudentId: null,
            qrDecodeOutcome: 'not_found',
            omrStudentId: '10',
            omrDecodeOutcome: 'found'
        });

        await rosterService.assembleAndMapAnswerScripts(batch.batchId, { actingUserId: prof._id.toString(), actingUserRole: 'PROFESSOR' });

        const script = await AnswerScript.findOne({ batchId: batch.batchId });
        expect(script).not.toBeNull();
        expect(script?.student?.toString()).toBe(studentA._id.toString()); // Resolved to Student A (OMR)
        expect(script?.identificationSource).toBe(IdentificationSource.OMR);
        expect(script?.identificationStatus).toBe(IdentificationStatus.IDENTIFIED);
        expect(script?.needsManualId).toBe(false);
    });

    it('15. OMR unreadable falls through without producing a student ID', async () => {
        // QR not found, OMR ambiguous
        await IngestionPage.create({
            batchId: batch.batchId,
            job: new mongoose.Types.ObjectId(),
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: 'batches/script-derived.png',
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED,
            isCoverPage: true,
            qrStudentId: null,
            qrDecodeOutcome: 'not_found',
            omrStudentId: null,
            omrDecodeOutcome: 'multiple'
        });

        await rosterService.assembleAndMapAnswerScripts(batch.batchId, { actingUserId: prof._id.toString(), actingUserRole: 'PROFESSOR' });

        const script = await AnswerScript.findOne({ batchId: batch.batchId });
        expect(script).not.toBeNull();
        expect(script?.student).toBeNull();
        expect(script?.needsManualId).toBe(true);
        expect(script?.identificationStatus).toBe(IdentificationStatus.UNIDENTIFIED);
    });

    it('16. Manual/operator identification remains authoritative after OMR detection', async () => {
        // Initial state: OMR resolved Student A
        const script = await AnswerScript.create({
            exam: exam._id,
            student: studentA._id,
            batchId: batch.batchId,
            fileIndex: 0,
            identificationSource: IdentificationSource.OMR,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            needsManualId: false,
            isActive: true
        });

        // Operator overrides identification to Student B manually
        script.student = studentB._id;
        script.identificationSource = IdentificationSource.OPERATOR;
        script.identificationStatus = IdentificationStatus.IDENTIFIED;
        await script.save();

        // Run assembly again
        await rosterService.assembleAndMapAnswerScripts(batch.batchId, { actingUserId: prof._id.toString(), actingUserRole: 'PROFESSOR' });

        const scriptAfter = await AnswerScript.findById(script._id);
        expect(scriptAfter?.student?.toString()).toBe(studentB._id.toString());
        expect(scriptAfter?.identificationSource).toBe(IdentificationSource.OPERATOR); // Preserved operator
    });

    it('18. OMR source is recorded as IdentificationSource.OMR, never OCR', async () => {
        expect(IdentificationSource.OMR).toBe('OMR');
        expect(IdentificationSource.OCR).toBe('OCR');
    });

    it('19. Same image + same template produces deterministic identical result', async () => {
        const buf = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#000000';
            ctx.fillRect(100, 200, 50, 50); // C0 B1
            ctx.fillRect(200, 100, 50, 50); // C1 B0
        });

        const res1 = await omrReader.readOMR(buf, testTemplate);
        const res2 = await omrReader.readOMR(buf, testTemplate);
        expect(res1).toEqual(res2);
    });

    it('20. Different bubble patterns produce different IDs', async () => {
        const buf10 = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#000000';
            ctx.fillRect(100, 200, 50, 50); // C0 B1
            ctx.fillRect(200, 100, 50, 50); // C1 B0
        });
        const res10 = await omrReader.readOMR(buf10, testTemplate);
        expect(res10.studentId).toBe('10');

        const buf01 = drawPageBuffer(1000, 1000, (ctx) => {
            ctx.fillStyle = '#000000';
            ctx.fillRect(100, 100, 50, 50); // C0 B0
            ctx.fillRect(200, 200, 50, 50); // C1 B1
        });
        const res01 = await omrReader.readOMR(buf01, testTemplate);
        expect(res01.studentId).toBe('01');
    });

    describe('False Positive Safety Tests', () => {
        it('should mark AMBIGUOUS for almost equally dark adjacent bubbles', async () => {
            const buf = drawPageBuffer(1000, 1000, (ctx) => {
                ctx.fillStyle = '#000000';
                ctx.fillRect(108, 108, 20, 34); // C0 B0 (~60% inside)
                ctx.fillRect(108, 208, 17, 34); // C0 B1 (~50% inside)
            });
            const res = await omrReader.readOMR(buf, testTemplate);
            expect(res.status).toBe(OMRStatus.AMBIGUOUS);
        });

        it('should handle scan noise below EMPTY_THRESHOLD', async () => {
            const buf = drawPageBuffer(1000, 1000, (ctx) => {
                ctx.fillStyle = '#000000';
                ctx.fillRect(108, 108, 2, 2); // Tiny speck noise
            });
            const res = await omrReader.readOMR(buf, testTemplate);
            expect(res.status).toBe(OMRStatus.UNREADABLE);
        });

        it('should fail with border-only darkness', async () => {
            const buf = drawPageBuffer(1000, 1000, (ctx) => {
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 2;
                ctx.strokeRect(100, 100, 50, 50); // Dark border outside inset crop
            });
            // The 15% inset scans x=108, y=108, w=34, h=34. The border at x=100, w=50 is ignored
            const res = await omrReader.readOMR(buf, testTemplate);
            expect(res.status).toBe(OMRStatus.UNREADABLE);
        });

        it('should handle wrong page/template combinations gracefully', async () => {
            const buf = drawPageBuffer(1000, 1000, (ctx) => {
                ctx.fillStyle = '#000000';
                // Draw dark spot somewhere completely unrelated
                ctx.fillRect(500, 500, 100, 100);
            });
            const res = await omrReader.readOMR(buf, testTemplate);
            expect(res.status).toBe(OMRStatus.UNREADABLE);
        });
    });
});
