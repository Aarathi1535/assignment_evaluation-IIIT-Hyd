/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Course from '../models/Course';
import Exam, { ExamStatus, StudentDownloadPolicy } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import Grade from '../models/Grade';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Rubric from '../models/Rubric';
import StudentMapping from '../models/StudentMapping';
import DerivedStorageService from '../services/DerivedStorageService';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import * as auditModule from '../lib/audit';
import * as compositorModule from '../services/AnnotationCompositor';
import * as watermarkModule from '../lib/watermark';
import {
    resetPdfExportGuards,
    tryAcquirePdfExportSlot,
} from '../lib/pdfExportGuards';
import { shapeExamForStudent } from '../repositories/ExamRepository';

let mockSessionUser: any = null;

vi.mock('next-auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('next-auth')>();
    return {
        ...original,
        getServerSession: vi.fn().mockImplementation(() => {
            if (!mockSessionUser) return Promise.resolve(null);
            return Promise.resolve({ user: mockSessionUser });
        }),
    };
});

describe('AE-187: Student PDF Download Policy and Watermarked Export (#265)', () => {
    let exportGET: any;
    let examPUT: any;
    let examPATCH: any;

    let studentA: any;
    let studentB: any;
    let prof: any;
    let ta: any;
    let course: any;
    let rubric: any;
    let exam: any;
    let scriptA: any;
    let scriptB: any;
    let pageA1: any;
    let pageA2: any;
    let sampleSourceBuffer: Buffer;
    const testSecret = 'ae187-super-secret-key-for-watermarking-999';

    beforeAll(async () => {
        exportGET = (
            await import('../app/api/student/results/[scriptId]/export/route')
        ).GET;
        const examRoute = await import('../app/api/exams/[id]/route');
        examPUT = examRoute.PUT;
        examPATCH = examRoute.PATCH;

        // Generate synthetic source image buffer (1200x1600)
        const canvas = createCanvas(1200, 1600);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f8fafc';
        ctx.fillRect(0, 0, 1200, 1600);
        ctx.fillStyle = '#0f172a';
        ctx.font = '28px sans-serif';
        ctx.fillText('Natural Exam Page 1 Content', 100, 150);
        sampleSourceBuffer = canvas.toBuffer('image/png');
    });

    beforeEach(async () => {
        resetPdfExportGuards();
        watermarkModule.resetWatermarkConcurrencySlots();
        process.env.STUDENT_RESULTS_ENABLED = 'true';
        process.env.WATERMARK_HMAC_SECRET = testSecret;

        // 1. Users
        studentA = await User.create({
            name: 'Student Alice',
            email: 'alice@iiit.ac.in',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        studentB = await User.create({
            name: 'Student Bob',
            email: 'bob@iiit.ac.in',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        prof = await User.create({
            name: 'Professor Snape',
            email: 'snape@iiit.ac.in',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true,
        });

        ta = await User.create({
            name: 'TA Draco',
            email: 'draco@iiit.ac.in',
            password: 'password123',
            role: UserRole.TA,
            isActive: true,
        });

        // 2. Course
        course = await Course.create({
            courseCode: 'CS401',
            courseName: 'Advanced Algorithms',
            academicYear: '2026-2027',
            semester: 1,
            professor: prof._id,
            enrolledStudents: [studentA._id, studentB._id],
            teachingAssistants: [ta._id],
            isActive: true,
        });

        // 3. Exam with WATERMARKED policy
        exam = await Exam.create({
            title: 'Midterm Examination',
            course: course._id,
            examDate: new Date('2026-10-15'),
            totalMarks: 50,
            status: ExamStatus.PUBLISHED,
            numberOfQuestions: 1,
            createdBy: prof._id,
            studentDownloadPolicy: StudentDownloadPolicy.WATERMARKED,
            isActive: true,
        });

        // 4. Rubric
        rubric = await Rubric.create({
            exam: exam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 50,
                    criteria: [{ criterionName: 'Logic', points: 50 }],
                },
            ],
            isActive: true,
        });
        await Exam.findByIdAndUpdate(exam._id, { rubric: rubric._id });

        // 5. Answer scripts
        scriptA = await AnswerScript.create({
            exam: exam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            hasIdentificationConflict: false,
            needsManualId: false,
            isActive: true,
        });

        scriptB = await AnswerScript.create({
            exam: exam._id,
            student: studentB._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            hasIdentificationConflict: false,
            needsManualId: false,
            isActive: true,
        });

        // 6. Complete Grading & Allocations
        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubric._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Logic', score: 45 }],
            totalScore: 45,
            isFinal: true,
        });

        await Allocation.create({
            exam: exam._id,
            answerScript: scriptA._id,
            ta: ta._id,
            question: 1,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED,
        });

        // 7. StudentMapping (roll numbers)
        await StudentMapping.create({
            exam: exam._id,
            student: studentA._id,
            anonymousId: 'ANON-ALICE-187',
            rollNumber: '2023101001',
            isVerified: true,
        });

        // 8. Derived storage files
        const batchId = 'batch-ae187-001';
        const fileId = 'file-ae187-001';

        const storedPage1 = await DerivedStorageService.storeDerivedPage({
            batchId,
            fileId,
            pageNumber: 1,
            buffer: sampleSourceBuffer,
            format: 'png',
        });

        const storedPage2 = await DerivedStorageService.storeDerivedPage({
            batchId,
            fileId,
            pageNumber: 2,
            buffer: sampleSourceBuffer,
            format: 'png',
        });

        const page1Key = storedPage1.storageKey;
        const page2Key = storedPage2.storageKey;

        // IngestionPages
        const dummyJobId = new mongoose.Types.ObjectId();
        pageA1 = await IngestionPage.create({
            batchId,
            job: dummyJobId,
            fileId,
            fileIndex: 0,
            storageKey: page1Key,
            width: 1200,
            height: 1600,
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED,
            answerScript: scriptA._id,
            metadata: {
                annotations: {
                    pageNumber: 1,
                    annotations: [
                        {
                            id: 'ann-1',
                            type: 'check',
                            x: 200,
                            y: 300,
                            size: 24,
                            color: '#16a34a',
                            graderEmail: 'secret-grader@leak.com',
                        },
                    ],
                    strokes: [
                        {
                            id: 'stroke-1',
                            pageKey: 1,
                            tool: 'pen',
                            color: '#dc2626',
                            strokeWidth: 3,
                            points: [100, 100, 150, 150],
                        },
                    ],
                },
            },
        });

        pageA2 = await IngestionPage.create({
            batchId,
            job: dummyJobId,
            fileId,
            fileIndex: 0,
            storageKey: page2Key,
            width: 1200,
            height: 1600,
            pageNumber: 2,
            status: PageProcessingStatus.PROCESSED,
            answerScript: scriptA._id,
        });

        // Default session: Student Alice
        mockSessionUser = {
            id: studentA._id.toString(),
            name: studentA.name,
            email: studentA.email,
            role: UserRole.STUDENT,
        };
    });

    describe('1. Exam Download Policy Model & Defaults', () => {
        it('defaults a newly created Exam to DISABLED', async () => {
            const newExam = await Exam.create({
                title: 'New Exam Default Policy',
                course: course._id,
                examDate: new Date('2026-11-01'),
                totalMarks: 100,
                status: ExamStatus.DRAFT,
                numberOfQuestions: 5,
                createdBy: prof._id,
            });
            expect(newExam.studentDownloadPolicy).toBe(StudentDownloadPolicy.DISABLED);
        });

        it('treats missing, null, or unknown policy values as DISABLED at runtime in shapeExamForStudent', () => {
            const shapedNull = shapeExamForStudent({
                _id: new mongoose.Types.ObjectId(),
                title: 'Exam With Null Policy',
                studentDownloadPolicy: null,
            });
            expect(shapedNull.canDownload).toBe(false);

            const shapedUndefined = shapeExamForStudent({
                _id: new mongoose.Types.ObjectId(),
                title: 'Exam With Undefined Policy',
            });
            expect(shapedUndefined.canDownload).toBe(false);

            const shapedUnknown = shapeExamForStudent({
                _id: new mongoose.Types.ObjectId(),
                title: 'Exam With Unknown Policy',
                studentDownloadPolicy: 'UNKNOWN_POLICY',
            });
            expect(shapedUnknown.canDownload).toBe(false);
            expect((shapedUnknown as any).studentDownloadPolicy).toBeUndefined();

            const shapedWatermarked = shapeExamForStudent({
                _id: new mongoose.Types.ObjectId(),
                title: 'Exam With Watermarked Policy',
                studentDownloadPolicy: 'WATERMARKED',
            });
            expect(shapedWatermarked.canDownload).toBe(true);
            expect((shapedWatermarked as any).studentDownloadPolicy).toBeUndefined();
        });

        it('allows Professor and Admin to update policy, rejects unauthorized roles and invalid values', async () => {
            // 1. Professor updates policy via PUT
            mockSessionUser = {
                id: prof._id.toString(),
                name: prof.name,
                email: prof.email,
                role: UserRole.PROFESSOR,
            };

            const profReq = new NextRequest(`http://localhost:3000/api/exams/${exam._id}`, {
                method: 'PUT',
                body: JSON.stringify({ studentDownloadPolicy: 'DISABLED' }),
            });
            const profRes = await examPUT(profReq, { params: Promise.resolve({ id: exam._id.toString() }) });
            expect(profRes.status).toBe(200);
            const profData = await profRes.json();
            expect(profData.data.studentDownloadPolicy).toBe('DISABLED');

            // 2. Professor updates policy via PATCH
            const patchReq = new NextRequest(`http://localhost:3000/api/exams/${exam._id}`, {
                method: 'PATCH',
                body: JSON.stringify({ studentDownloadPolicy: 'WATERMARKED' }),
            });
            const patchRes = await examPATCH(patchReq, { params: Promise.resolve({ id: exam._id.toString() }) });
            expect(patchRes.status).toBe(200);
            const patchData = await patchRes.json();
            expect(patchData.data.studentDownloadPolicy).toBe('WATERMARKED');

            // 3. Validation rejection on invalid policy value
            const invalidReq = new NextRequest(`http://localhost:3000/api/exams/${exam._id}`, {
                method: 'PUT',
                body: JSON.stringify({ studentDownloadPolicy: 'ALLOW_RAW_DOWNLOAD' }),
            });
            const invalidRes = await examPUT(invalidReq, { params: Promise.resolve({ id: exam._id.toString() }) });
            expect(invalidRes.status).toBe(400);

            // 4. Unauthorized role (TA) rejected
            mockSessionUser = {
                id: ta._id.toString(),
                name: ta.name,
                email: ta.email,
                role: UserRole.TA,
            };
            const taReq = new NextRequest(`http://localhost:3000/api/exams/${exam._id}`, {
                method: 'PUT',
                body: JSON.stringify({ studentDownloadPolicy: 'DISABLED' }),
            });
            const taRes = await examPUT(taReq, { params: Promise.resolve({ id: exam._id.toString() }) });
            expect(taRes.status).toBe(403);

            // 5. Unauthorized role (Student) rejected
            mockSessionUser = {
                id: studentA._id.toString(),
                name: studentA.name,
                email: studentA.email,
                role: UserRole.STUDENT,
            };
            const studentReq = new NextRequest(`http://localhost:3000/api/exams/${exam._id}`, {
                method: 'PUT',
                body: JSON.stringify({ studentDownloadPolicy: 'DISABLED' }),
            });
            const studentRes = await examPUT(studentReq, { params: Promise.resolve({ id: exam._id.toString() }) });
            expect(studentRes.status).toBe(403);
        });
    });

    describe('2. Student PDF Export Authorization & Policy Enforcement', () => {
        it('returns generic 403 when download policy is DISABLED', async () => {
            await Exam.updateOne(
                { _id: exam._id },
                { studentDownloadPolicy: StudentDownloadPolicy.DISABLED }
            );

            mockSessionUser = {
                id: studentA._id.toString(),
                name: studentA.name,
                email: studentA.email,
                role: UserRole.STUDENT,
            };

            const req = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/export`
            );
            const res = await exportGET(req, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });

            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.message).toBe('Forbidden');
        });

        it('returns generic 403 when policy is null, missing, or unknown at runtime', async () => {
            await Exam.updateOne(
                { _id: exam._id },
                { $set: { studentDownloadPolicy: null } }
            );

            mockSessionUser = {
                id: studentA._id.toString(),
                name: studentA.name,
                email: studentA.email,
                role: UserRole.STUDENT,
            };

            const req = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/export`
            );
            const res = await exportGET(req, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });

            expect(res.status).toBe(403);
        });

        it('returns generic 404 when student attempts to access another student script', async () => {
            expect(pageA2.pageNumber).toBe(2);

            mockSessionUser = {
                id: studentB._id.toString(),
                name: studentB.name,
                email: studentB.email,
                role: UserRole.STUDENT,
            };

            const req = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/export`
            );
            const res = await exportGET(req, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });

            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.message).toBe('Not found');

            // Conversely, Alice attempting to access Bob's script also returns 404
            mockSessionUser = {
                id: studentA._id.toString(),
                name: studentA.name,
                email: studentA.email,
                role: UserRole.STUDENT,
            };
            const reqAliceOnBob = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptB._id}/export`
            );
            const resAliceOnBob = await exportGET(reqAliceOnBob, {
                params: Promise.resolve({ scriptId: scriptB._id.toString() }),
            });
            expect(resAliceOnBob.status).toBe(404);
        });

        it('returns generic 404 for nonexistent or invalid script ID', async () => {
            const fakeId = new mongoose.Types.ObjectId().toString();
            const req = new NextRequest(
                `http://localhost:3000/api/student/results/${fakeId}/export`
            );
            const res = await exportGET(req, {
                params: Promise.resolve({ scriptId: fakeId }),
            });
            expect(res.status).toBe(404);

            const badReq = new NextRequest(
                'http://localhost:3000/api/student/results/invalid-object-id/export'
            );
            const badRes = await exportGET(badReq, {
                params: Promise.resolve({ scriptId: 'invalid-object-id' }),
            });
            expect(badRes.status).toBe(404);
        });

        it('rejects TA and Professor sessions from using student export endpoint', async () => {
            // Professor attempt
            mockSessionUser = {
                id: prof._id.toString(),
                name: prof.name,
                email: prof.email,
                role: UserRole.PROFESSOR,
            };
            const profReq = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/export`
            );
            const profRes = await exportGET(profReq, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });
            expect(profRes.status).toBe(403);

            // TA attempt
            mockSessionUser = {
                id: ta._id.toString(),
                name: ta.name,
                email: ta.email,
                role: UserRole.TA,
            };
            const taReq = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/export`
            );
            const taRes = await exportGET(taReq, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });
            expect(taRes.status).toBe(403);
        });
    });

    describe('3. Valid Watermarked PDF Export Behavior', () => {
        it('exports a valid PDF with expected page count and proper security headers', async () => {
            const compositorSpy = vi.spyOn(compositorModule, 'compositePageAnnotations');
            const watermarkSpy = vi.spyOn(watermarkModule, 'applyWatermark');

            const req = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/export`
            );
            const res = await exportGET(req, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });

            expect(res.status).toBe(200);
            expect(res.headers.get('Content-Type')).toBe('application/pdf');
            expect(res.headers.get('Cache-Control')).toBe('private, no-store');
            expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
            expect(res.headers.get('Content-Disposition')).toContain(
                `attachment; filename="graded-script-${scriptA._id}.pdf"`
            );

            const pdfBytes = Buffer.from(await res.arrayBuffer());
            expect(pdfBytes.length).toBeGreaterThan(100);

            // Verify with pdf-lib
            const pdfDoc = await PDFDocument.load(pdfBytes);
            expect(pdfDoc.getPageCount()).toBe(2);

            // Verify compositing and watermarking were invoked
            expect(compositorSpy).toHaveBeenCalledTimes(2);
            expect(watermarkSpy).toHaveBeenCalledTimes(2);

            // Verify watermark text contains rollNumber, IST timestamp, and trace code
            const firstCallWatermarkText = watermarkSpy.mock.calls[0][1];
            expect(firstCallWatermarkText).toContain('2023101001');
            expect(firstCallWatermarkText).toContain('IST');
            expect(/[0-9a-f]{10}/.test(firstCallWatermarkText)).toBe(true);
            // Must NOT contain student's name or email
            expect(firstCallWatermarkText).not.toContain('Alice');
            expect(firstCallWatermarkText).not.toContain('alice@iiit.ac.in');

            compositorSpy.mockRestore();
            watermarkSpy.mockRestore();
        });

        it('ensures source images and stored derived pages remain unmodified', async () => {
            const batchId = 'batch-ae187-001';
            const fileId = 'file-ae187-001';
            const page1Key = DerivedStorageService.getDerivedPageKey(batchId, fileId, 1, 'png');

            const beforeBuf = await DerivedStorageService.readDerivedPage(page1Key);

            const req = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/export`
            );
            const res = await exportGET(req, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });
            expect(res.status).toBe(200);

            const afterBuf = await DerivedStorageService.readDerivedPage(page1Key);
            expect(Buffer.compare(beforeBuf, afterBuf)).toBe(0);
        });
    });

    describe('4. Guard Limits: Concurrency, Rate Limit, and 40-Page Cap', () => {
        it('enforces 40-page maximum cap', async () => {
            // Mock IngestionPage.find to return 41 pages
            const dummyPages = Array.from({ length: 41 }, (_, i) => ({
                _id: new mongoose.Types.ObjectId(),
                pageNumber: i + 1,
                storageKey: pageA1.storageKey,
                batchId: pageA1.batchId,
                fileId: pageA1.fileId,
                width: 1200,
                height: 1600,
            }));

            const findSpy = vi.spyOn(IngestionPage, 'find').mockReturnValue({
                sort: vi.fn().mockReturnValue({
                    lean: vi.fn().mockResolvedValue(dummyPages),
                }),
            } as any);

            const req = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/export`
            );
            const res = await exportGET(req, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });

            expect(res.status).toBe(422);
            const body = await res.json();
            expect(body.message).toContain('Export exceeds maximum allowed page count (40 pages)');

            findSpy.mockRestore();
        });

        it('returns 503 with Retry-After when concurrent export capacity (1) is saturated', async () => {
            // Schedulers/workers saturate the single instance concurrency slot
            const release = tryAcquirePdfExportSlot();

            try {
                const req = new NextRequest(
                    `http://localhost:3000/api/student/results/${scriptA._id}/export`
                );
                const res = await exportGET(req, {
                    params: Promise.resolve({ scriptId: scriptA._id.toString() }),
                });

                expect(res.status).toBe(503);
                expect(res.headers.get('Retry-After')).toBe('5');
                const body = await res.json();
                expect(body.success).toBe(false);
                expect(body.message).toContain('PDF export capacity reached');
            } finally {
                release();
            }

            // After release, export proceeds normally
            const req2 = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/export`
            );
            const res2 = await exportGET(req2, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });
            expect(res2.status).toBe(200);
        });

        it('enforces 5 exports per hour per student rate limit', async () => {
            const req = () =>
                new NextRequest(
                    `http://localhost:3000/api/student/results/${scriptA._id}/export`
                );

            // Execute 5 successful exports
            for (let i = 0; i < 5; i++) {
                const res = await exportGET(req(), {
                    params: Promise.resolve({ scriptId: scriptA._id.toString() }),
                });
                expect(res.status).toBe(200);
            }

            // 6th export within the hour must fail with 429
            const blockedRes = await exportGET(req(), {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });

            expect(blockedRes.status).toBe(429);
            expect(blockedRes.headers.get('Retry-After')).toBeTruthy();
            const body = await blockedRes.json();
            expect(body.message).toBe('Rate limit exceeded');
        });
    });

    describe('5. Audit and Information Leakage Protections', () => {
        it('fails closed and does not return PDF bytes if audit logging fails', async () => {
            const auditSpy = vi.spyOn(auditModule, 'writeAuditLog').mockResolvedValue(false);

            const req = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/export`
            );
            const res = await exportGET(req, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });

            expect(res.status).toBe(500);
            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.message).toBe('Export failed');

            auditSpy.mockRestore();
        });

        it('does not leak secrets, storage paths, names, or emails in error responses', async () => {
            // Trigger 403 Forbidden
            await Exam.updateOne(
                { _id: exam._id },
                { studentDownloadPolicy: StudentDownloadPolicy.DISABLED }
            );

            const req403 = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/export`
            );
            const res403 = await exportGET(req403, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });
            const text403 = await res403.text();
            expect(text403).not.toContain(testSecret);
            expect(text403).not.toContain('batches/');
            expect(text403).not.toContain(studentA.name);
            expect(text403).not.toContain(studentA.email);

            // Trigger 404 Not Found
            mockSessionUser = {
                id: studentB._id.toString(),
                name: studentB.name,
                email: studentB.email,
                role: UserRole.STUDENT,
            };
            const req404 = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/export`
            );
            const res404 = await exportGET(req404, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });
            const text404 = await res404.text();
            expect(text404).not.toContain(testSecret);
            expect(text404).not.toContain('batches/');
            expect(text404).not.toContain(studentA.name);
            expect(text404).not.toContain(studentA.email);
        });
    });
});
