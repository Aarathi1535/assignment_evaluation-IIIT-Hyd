/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { PDFDocument } from 'pdf-lib';
import Exam, { ExamStatus } from '../models/Exam';
import Course from '../models/Course';
import User, { UserRole } from '../models/User';
import StudentMapping from '../models/StudentMapping';
import { CoverSheetService } from '../services/CoverSheetService';
import { DefaultPdfRenderer } from '../services/PageRenderer';
import { CoverSheetDetector } from '../services/CoverSheetDetector';
import { StudentRosterMappingService } from '../services/StudentRosterMappingService';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import Batch, { BatchStatus } from '../models/Batch';
import AnswerScript from '../models/AnswerScript';
import { HttpError } from '../lib/errors';
import * as apiAuth from '../lib/apiAuth';

describe('AE-052 — Generate Printable QR Cover Sheets', () => {
    let service: CoverSheetService;
    let profUser: any;
    let otherProfUser: any;
    let student1: any;
    let student2: any;
    let student3: any;
    let outsiderStudent: any;
    let course: any;
    let exam: any;

    beforeAll(async () => {
        await Exam.init();
        await Course.init();
        await User.init();
        await StudentMapping.init();
        await IngestionPage.init();
        await Batch.init();
        await AnswerScript.init();
    });

    beforeEach(async () => {
        service = new CoverSheetService();

        // 1. Create Professor users
        profUser = await User.create({
            name: 'Prof Cover Test',
            email: `prof-${Date.now()}-${Math.random()}@university.edu`,
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        otherProfUser = await User.create({
            name: 'Prof Other',
            email: `prof-other-${Date.now()}-${Math.random()}@university.edu`,
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        // 2. Create Student users
        student1 = await User.create({
            name: 'Alice Johnson',
            email: `alice-${Date.now()}-${Math.random()}@university.edu`,
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        student2 = await User.create({
            name: 'Bob Smith',
            email: `bob-${Date.now()}-${Math.random()}@university.edu`,
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        student3 = await User.create({
            name: 'Charlie Davis',
            email: `charlie-${Date.now()}-${Math.random()}@university.edu`,
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        outsiderStudent = await User.create({
            name: 'Outsider Dave',
            email: `outsider-${Date.now()}-${Math.random()}@university.edu`,
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        // 3. Create Course
        course = await Course.create({
            courseCode: `CS-${Date.now()}`,
            courseName: 'Algorithms & Data Structures',
            semester: 1,
            academicYear: '2026-2027',
            professor: profUser._id,
            enrolledStudents: [student1._id, student2._id],
            isActive: true
        });

        // 4. Create Exam (enrolling student 1 and student 2 directly, and student 3 via StudentMapping)
        exam = await Exam.create({
            title: 'Midterm Evaluation Exam 2026',
            course: course._id,
            createdBy: profUser._id,
            examDate: new Date('2026-09-15T00:00:00.000Z'),
            totalMarks: 100,
            numberOfQuestions: 4,
            status: ExamStatus.SCHEDULED,
            enrolledStudents: [student1._id, student2._id],
            isActive: true
        });

        // Student 3 mapped to exam
        await StudentMapping.create({
            exam: exam._id,
            student: student3._id,
            anonymousId: 'ANON-STU-3',
            isVerified: true
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('1. PDF Generation & Format Specifications', () => {
        it('should generate a valid PDF for a single specified student with exactly 1 page', async () => {
            const pdfBuffer = await service.generateCoverSheets(
                exam._id.toString(),
                { studentIds: [student1._id.toString()] },
                { actingUserId: profUser._id.toString(), actingUserRole: UserRole.PROFESSOR }
            );

            expect(pdfBuffer).toBeInstanceOf(Buffer);
            expect(pdfBuffer.length).toBeGreaterThan(1000);

            // Load with pdf-lib to verify page count & dimensions
            const loadedPdf = await PDFDocument.load(pdfBuffer);
            expect(loadedPdf.getPageCount()).toBe(1);

            const page = loadedPdf.getPage(0);
            const { width, height } = page.getSize();
            // Standard A4 point dimensions: 595.28 x 841.89 (within tolerance)
            expect(Math.round(width)).toBe(595);
            expect(Math.round(height)).toBe(842);
        });

        it('should generate a multi-page PDF when multiple students are requested (1 page per student)', async () => {
            const pdfBuffer = await service.generateCoverSheets(
                exam._id.toString(),
                { studentIds: [student1._id.toString(), student2._id.toString(), student3._id.toString()] },
                { actingUserId: profUser._id.toString(), actingUserRole: UserRole.PROFESSOR }
            );

            const loadedPdf = await PDFDocument.load(pdfBuffer);
            expect(loadedPdf.getPageCount()).toBe(3);

            for (let i = 0; i < 3; i++) {
                const page = loadedPdf.getPage(i);
                const { width, height } = page.getSize();
                expect(Math.round(width)).toBe(595);
                expect(Math.round(height)).toBe(842);
            }
        });

        it('should generate cover sheets for all enrolled roster students when studentIds is omitted', async () => {
            const pdfBuffer = await service.generateCoverSheets(
                exam._id.toString(),
                {},
                { actingUserId: profUser._id.toString(), actingUserRole: UserRole.PROFESSOR }
            );

            const loadedPdf = await PDFDocument.load(pdfBuffer);
            // All 3 students (student1, student2 from enrolledStudents, student3 from StudentMapping)
            expect(loadedPdf.getPageCount()).toBe(3);
        });
    });

    describe('2. Authorization, Limits & Roster Validation', () => {
        it('should reject non-owning professor with 404 Not Found (deny-by-default)', async () => {
            await expect(
                service.generateCoverSheets(
                    exam._id.toString(),
                    {},
                    { actingUserId: otherProfUser._id.toString(), actingUserRole: UserRole.PROFESSOR }
                )
            ).rejects.toThrow(HttpError);

            try {
                await service.generateCoverSheets(
                    exam._id.toString(),
                    {},
                    { actingUserId: otherProfUser._id.toString(), actingUserRole: UserRole.PROFESSOR }
                );
            } catch (err: any) {
                expect(err.statusCode).toBe(404);
            }
        });

        it('should allow ADMIN to generate cover sheets for any exam', async () => {
            const adminId = new mongoose.Types.ObjectId().toString();
            const pdfBuffer = await service.generateCoverSheets(
                exam._id.toString(),
                { studentIds: [student1._id.toString()] },
                { actingUserId: adminId, actingUserRole: UserRole.ADMIN }
            );

            expect(pdfBuffer).toBeInstanceOf(Buffer);
            const loadedPdf = await PDFDocument.load(pdfBuffer);
            expect(loadedPdf.getPageCount()).toBe(1);
        });

        it('should reject non-enrolled students with 400 Bad Request', async () => {
            await expect(
                service.generateCoverSheets(
                    exam._id.toString(),
                    { studentIds: [student1._id.toString(), outsiderStudent._id.toString()] },
                    { actingUserId: profUser._id.toString(), actingUserRole: UserRole.PROFESSOR }
                )
            ).rejects.toThrow(HttpError);

            try {
                await service.generateCoverSheets(
                    exam._id.toString(),
                    { studentIds: [student1._id.toString(), outsiderStudent._id.toString()] },
                    { actingUserId: profUser._id.toString(), actingUserRole: UserRole.PROFESSOR }
                );
            } catch (err: any) {
                expect(err.statusCode).toBe(400);
                expect(err.message).toContain('not enrolled');
            }
        });

        it('should reject requests exceeding MAX_COVER_SHEETS_PER_REQUEST with 400 Bad Request', async () => {
            const originalLimit = process.env.MAX_COVER_SHEETS_PER_REQUEST;
            process.env.MAX_COVER_SHEETS_PER_REQUEST = '2';

            try {
                await expect(
                    service.generateCoverSheets(
                        exam._id.toString(),
                        {}, // resolves to 3 students
                        { actingUserId: profUser._id.toString(), actingUserRole: UserRole.PROFESSOR }
                    )
                ).rejects.toThrow(HttpError);

                try {
                    await service.generateCoverSheets(
                        exam._id.toString(),
                        {},
                        { actingUserId: profUser._id.toString(), actingUserRole: UserRole.PROFESSOR }
                    );
                } catch (err: any) {
                    expect(err.statusCode).toBe(400);
                    expect(err.message).toContain('exceeds the maximum limit');
                }
            } finally {
                process.env.MAX_COVER_SHEETS_PER_REQUEST = originalLimit;
            }
        });

        it('should reject empty studentIds array with 400 Bad Request', async () => {
            await expect(
                service.generateCoverSheets(
                    exam._id.toString(),
                    { studentIds: [] },
                    { actingUserId: profUser._id.toString(), actingUserRole: UserRole.PROFESSOR }
                )
            ).rejects.toThrow(HttpError);
        });

        it('should reject invalid examId format with 400 Bad Request', async () => {
            await expect(
                service.generateCoverSheets(
                    'invalid-not-an-objectid',
                    {},
                    { actingUserId: profUser._id.toString(), actingUserRole: UserRole.PROFESSOR }
                )
            ).rejects.toThrow(HttpError);
        });
    });

    describe('3. AE-052 → AE-050 → AE-051 End-to-End Round-Trip', () => {
        it('should generate an exact examId:studentId QR payload that is decodable by CoverSheetDetector and mapped by StudentRosterMappingService', async () => {
            // 1. Generate cover sheet for student 1
            const pdfBuffer = await service.generateCoverSheets(
                exam._id.toString(),
                { studentIds: [student1._id.toString()] },
                { actingUserId: profUser._id.toString(), actingUserRole: UserRole.PROFESSOR }
            );

            // 2. Render Page 1 to normalized image buffer using DefaultPdfRenderer
            const renderer = new DefaultPdfRenderer();
            const renderedPage = await renderer.renderPage({
                batchId: 'test-ae052-batch',
                fileId: 'test-cover.pdf',
                pageNumber: 1,
                fileType: 'pdf',
                fileBuffer: pdfBuffer
            });

            expect(renderedPage.image).toBeDefined();
            expect(renderedPage.image!.buffer).toBeInstanceOf(Buffer);

            // 3. Scan cover page with CoverSheetDetector (AE-050)
            const detector = new CoverSheetDetector();
            const detection = await detector.detectCoverSheet(renderedPage.image!.buffer, 1);

            expect(detection.isCoverPage).toBe(true);
            expect(detection.decodeOutcome).toBe('found');

            // Payload MUST be exact examId:studentId
            const expectedPayload = `${exam._id.toString()}:${student1._id.toString()}`;
            expect(detection.candidateStudentId).toBe(expectedPayload);
            expect(detection.metadata?.code).toBe(expectedPayload);
            expect(detection.metadata?.examId).toBe(exam._id.toString());
            expect(detection.metadata?.studentId).toBe(student1._id.toString());

            // 4. Ingest and assemble with StudentRosterMappingService (AE-051)
            const batchId = crypto.randomUUID();
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: crypto.randomUUID(),
                        fileIndex: 0,
                        originalFilename: 'coversheet.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: pdfBuffer.length,
                        pageCount: 1,
                        storageKey: `batches/${batchId}/0.pdf`,
                        sequenceNumber: 1
                    }
                ],
                totalFiles: 1,
                totalSize: pdfBuffer.length,
                totalPageCount: 1,
                status: BatchStatus.DONE,
                isActive: true
            });

            const jobId = new mongoose.Types.ObjectId();
            await IngestionPage.create({
                batchId,
                job: jobId,
                fileId: crypto.randomUUID(),
                fileIndex: 0,
                pageNumber: 1,
                storageKey: `batches/${batchId}/pages/0_1.png`,
                status: PageProcessingStatus.PROCESSED,
                isCoverPage: true,
                candidateStudentId: detection.candidateStudentId,
                decodeOutcome: detection.decodeOutcome,
                metadata: detection.metadata
            });

            const mappingService = new StudentRosterMappingService();
            const scripts = await mappingService.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: UserRole.PROFESSOR
            });

            expect(scripts.length).toBe(1);
            expect(scripts[0].student?.toString()).toBe(student1._id.toString());
            expect(scripts[0].exam.toString()).toBe(exam._id.toString());
            expect(scripts[0].needsManualId).toBe(false);
            expect(scripts[0].candidateStudentId).toBe(expectedPayload);
        });
    });

    describe('4. API Route: POST /api/exams/[id]/cover-sheets', () => {
        let routePOST: any;

        beforeAll(async () => {
            routePOST = (await import('../app/api/exams/[id]/cover-sheets/route')).POST;
        });

        it('should return 200 with PDF binary stream for authorized professor', async () => {
            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: true,
                user: {
                    id: profUser._id.toString(),
                    name: profUser.name,
                    email: profUser.email,
                    role: UserRole.PROFESSOR
                }
            } as any);

            const req = new Request(`http://localhost:3000/api/exams/${exam._id.toString()}/cover-sheets`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ studentIds: [student1._id.toString()] })
            });

            const context = { params: Promise.resolve({ id: exam._id.toString() }) };
            const res = await routePOST(req as any, context);

            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toBe('application/pdf');
            expect(res.headers.get('content-disposition')).toContain(`coversheets-${exam._id.toString()}.pdf`);

            const arrayBuffer = await res.arrayBuffer();
            const loadedPdf = await PDFDocument.load(Buffer.from(arrayBuffer));
            expect(loadedPdf.getPageCount()).toBe(1);
        });

        it('should return 404 when exam is not found or owned by another professor', async () => {
            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: true,
                user: {
                    id: otherProfUser._id.toString(),
                    name: otherProfUser.name,
                    email: otherProfUser.email,
                    role: UserRole.PROFESSOR
                }
            } as any);

            const req = new Request(`http://localhost:3000/api/exams/${exam._id.toString()}/cover-sheets`, {
                method: 'POST'
            });

            const context = { params: Promise.resolve({ id: exam._id.toString() }) };
            const res = await routePOST(req as any, context);

            expect(res.status).toBe(404);
            const data = await res.json();
            expect(data.success).toBe(false);
            expect(data.message).toBe('Exam not found');
        });

        it('should return 400 for invalid exam ID format', async () => {
            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: true,
                user: {
                    id: profUser._id.toString(),
                    name: profUser.name,
                    email: profUser.email,
                    role: UserRole.PROFESSOR
                }
            } as any);

            const req = new Request(`http://localhost:3000/api/exams/not-a-valid-id/cover-sheets`, {
                method: 'POST'
            });

            const context = { params: Promise.resolve({ id: 'not-a-valid-id' }) };
            const res = await routePOST(req as any, context);

            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.message).toContain('Invalid Exam ID format');
        });
    });
});
