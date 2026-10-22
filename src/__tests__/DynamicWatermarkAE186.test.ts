/**
 * @vitest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import Grade from '../models/Grade';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Rubric from '../models/Rubric';
import StudentMapping from '../models/StudentMapping';
import AuditLog from '../models/AuditLog';
import DerivedStorageService from '../services/DerivedStorageService';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import { createCanvas } from '@napi-rs/canvas';
import {
    buildWatermarkText,
    generateTraceCode,
    resolveWatermarkHmacSecret,
    tryAcquireWatermarkSlot,
    resetWatermarkConcurrencySlots,
    WatermarkCapacityError,
} from '../lib/watermark';

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

describe('AE-186: Dynamic Watermark with Student Credentials (#264)', () => {
    let imageGET: any;

    let studentA: any;
    let studentB: any;
    let studentNoRoll: any;
    let prof: any;
    let ta: any;
    let course: any;
    let exam: any;
    let rubric: any;
    let scriptA: any;
    let scriptB: any;
    let scriptNoRoll: any;
    let pageA: any;
    let pageB: any;
    let pageNoRoll: any;
    let oversizedPage: any;
    let sampleSourceBuffer: Buffer;
    let storedPageA: any;

    beforeAll(async () => {
        imageGET = (
            await import(
                '../app/api/student/results/[scriptId]/pages/[pageId]/image/route'
            )
        ).GET;

        // Generate synthetic source image buffer (1200x1600)
        const canvas = createCanvas(1200, 1600);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 1200, 1600);
        ctx.fillStyle = '#000000';
        ctx.font = '32px sans-serif';
        ctx.fillText('Original Test Exam Paper Content', 100, 200);
        sampleSourceBuffer = canvas.toBuffer('image/png');
    });

    beforeEach(async () => {
        resetWatermarkConcurrencySlots();
        process.env.STUDENT_RESULTS_ENABLED = 'true';
        process.env.WATERMARK_HMAC_SECRET = 'test-watermark-secret-key-12345';

        // 1. Users
        studentA = await User.create({
            name: 'Student Alice',
            email: 'alice@iiit.ac.in',
            password: 'password123',
            role: UserRole.STUDENT,
        });

        studentB = await User.create({
            name: 'Student Bob',
            email: 'bob@iiit.ac.in',
            password: 'password123',
            role: UserRole.STUDENT,
        });

        studentNoRoll = await User.create({
            name: 'Student Charlie',
            email: 'charlie@iiit.ac.in',
            password: 'password123',
            role: UserRole.STUDENT,
        });

        prof = await User.create({
            name: 'Prof Krishna',
            email: 'krishna@iiit.ac.in',
            password: 'password123',
            role: UserRole.PROFESSOR,
        });

        ta = await User.create({
            name: 'TA Dave',
            email: 'dave@iiit.ac.in',
            password: 'password123',
            role: UserRole.TA,
        });

        // 2. Course & Exam
        course = await Course.create({
            courseCode: 'CS186',
            courseName: 'Watermark Security Testing',
            academicYear: '2026-2027',
            semester: 1,
            professor: prof._id,
            enrolledStudents: [studentA._id, studentB._id, studentNoRoll._id],
            teachingAssistants: [ta._id],
            isActive: true,
        });

        exam = await Exam.create({
            title: 'Final Security Exam 2026',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-10-25'),
            totalMarks: 50,
            numberOfQuestions: 1,
            status: ExamStatus.PUBLISHED,
            isActive: true,
            enrolledStudents: [studentA._id, studentB._id, studentNoRoll._id],
        });

        rubric = await Rubric.create({
            exam: exam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            questions: [
                { questionNumber: 1, maxMarks: 50, criteria: [{ criterionName: 'Security', points: 50 }] }
            ],
            isActive: true,
        });
        await Exam.findByIdAndUpdate(exam._id, { rubric: rubric._id });

        // 3. StudentMappings
        // Student A has rollNumber
        await StudentMapping.create({
            exam: exam._id,
            student: studentA._id,
            anonymousId: 'ANON-ALICE-186',
            rollNumber: '202201001',
            isVerified: true,
        });

        // Student B has rollNumber
        await StudentMapping.create({
            exam: exam._id,
            student: studentB._id,
            anonymousId: 'ANON-BOB-186',
            rollNumber: '202201002',
            isVerified: true,
        });

        // Student Charlie has NO rollNumber
        await StudentMapping.create({
            exam: exam._id,
            student: studentNoRoll._id,
            anonymousId: 'ANON-CHARLIE-186',
            rollNumber: null,
            isVerified: false,
        });

        // 4. AnswerScripts (Identified, active)
        scriptA = await AnswerScript.create({
            exam: exam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false,
        });

        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubric._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Security', score: 48 }],
            totalScore: 48,
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

        scriptB = await AnswerScript.create({
            exam: exam._id,
            student: studentB._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false,
        });

        await Grade.create({
            answerScript: scriptB._id,
            rubric: rubric._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Security', score: 45 }],
            totalScore: 45,
            isFinal: true,
        });

        await Allocation.create({
            exam: exam._id,
            answerScript: scriptB._id,
            ta: ta._id,
            question: 1,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED,
        });

        scriptNoRoll = await AnswerScript.create({
            exam: exam._id,
            student: studentNoRoll._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false,
        });

        await Grade.create({
            answerScript: scriptNoRoll._id,
            rubric: rubric._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Security', score: 40 }],
            totalScore: 40,
            isFinal: true,
        });

        await Allocation.create({
            exam: exam._id,
            answerScript: scriptNoRoll._id,
            ta: ta._id,
            question: 1,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED,
        });

        // 5. Store derived pages
        storedPageA = await DerivedStorageService.storeDerivedPage({
            batchId: 'batch-ae186',
            fileId: 'file-ae186-a',
            pageNumber: 1,
            buffer: sampleSourceBuffer,
            format: 'png',
        });

        const storedPageB = await DerivedStorageService.storeDerivedPage({
            batchId: 'batch-ae186',
            fileId: 'file-ae186-b',
            pageNumber: 1,
            buffer: sampleSourceBuffer,
            format: 'png',
        });

        const storedPageNoRoll = await DerivedStorageService.storeDerivedPage({
            batchId: 'batch-ae186',
            fileId: 'file-ae186-noroll',
            pageNumber: 1,
            buffer: sampleSourceBuffer,
            format: 'png',
        });

        const jobId = new mongoose.Types.ObjectId();

        pageA = await IngestionPage.create({
            batchId: 'batch-ae186',
            job: jobId,
            fileId: 'file-ae186-a',
            fileIndex: 0,
            pageNumber: 1,
            width: 1200,
            height: 1600,
            storageKey: storedPageA.storageKey,
            status: PageProcessingStatus.PROCESSED,
            answerScript: scriptA._id,
        });

        pageB = await IngestionPage.create({
            batchId: 'batch-ae186',
            job: jobId,
            fileId: 'file-ae186-b',
            fileIndex: 1,
            pageNumber: 1,
            width: 1200,
            height: 1600,
            storageKey: storedPageB.storageKey,
            status: PageProcessingStatus.PROCESSED,
            answerScript: scriptB._id,
        });

        pageNoRoll = await IngestionPage.create({
            batchId: 'batch-ae186',
            job: jobId,
            fileId: 'file-ae186-noroll',
            fileIndex: 2,
            pageNumber: 1,
            width: 1200,
            height: 1600,
            storageKey: storedPageNoRoll.storageKey,
            status: PageProcessingStatus.PROCESSED,
            answerScript: scriptNoRoll._id,
        });

        // Oversized page: exceeds 2048px maxLongEdge
        oversizedPage = await IngestionPage.create({
            batchId: 'batch-ae186',
            job: jobId,
            fileId: 'file-ae186-a',
            fileIndex: 3,
            pageNumber: 1,
            width: 2500,
            height: 3000,
            storageKey: storedPageA.storageKey,
            status: PageProcessingStatus.PROCESSED,
            answerScript: scriptA._id,
        });

        // Default login as Alice
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            role: UserRole.STUDENT,
        };
    });

    afterEach(() => {
        mockSessionUser = null;
        resetWatermarkConcurrencySlots();
    });

    // 1. Watermark text includes roll number when available, timestamp and trace code
    it('1. Watermark text includes roll number when available, timestamp and trace code', () => {
        const text = buildWatermarkText({
            rollNumber: '202201001',
            timestamp: new Date('2026-10-22T10:00:00Z'),
            traceCode: 'a1b2c3d4e5',
        });

        expect(text).toContain('202201001');
        expect(text).toContain('IST');
        expect(text).toContain('a1b2c3d4e5');
        expect(text).toBe('202201001 • 2026-10-22 15:30:00 IST • a1b2c3d4e5');
    });

    // 2. Missing roll number does not cause names, emails or anonymousId to be used
    it('2. Missing roll number does not cause names, emails or anonymousId to be used', () => {
        const text = buildWatermarkText({
            rollNumber: null,
            timestamp: new Date('2026-10-22T10:00:00Z'),
            traceCode: 'a1b2c3d4e5',
        });

        expect(text).not.toContain('Charlie');
        expect(text).not.toContain('charlie@iiit.ac.in');
        expect(text).not.toContain('ANON-CHARLIE-186');
        expect(text).toBe('2026-10-22 15:30:00 IST • a1b2c3d4e5');
    });

    // 3. The HMAC trace code is generated correctly without exposing the secret
    it('3. The HMAC trace code is generated correctly without exposing the secret', () => {
        const traceCode = generateTraceCode({
            userId: 'user123',
            scriptId: 'script456',
            pageId: 'page789',
            issuedAt: '2026-10-22T10:00:00.000Z',
            secret: 'super-secret-key',
        });

        expect(traceCode).toHaveLength(10);
        expect(/^[0-9a-f]{10}$/.test(traceCode)).toBe(true);
        expect(traceCode).not.toContain('super-secret-key');

        // Deterministic check
        const traceCode2 = generateTraceCode({
            userId: 'user123',
            scriptId: 'script456',
            pageId: 'page789',
            issuedAt: '2026-10-22T10:00:00.000Z',
            secret: 'super-secret-key',
        });
        expect(traceCode).toBe(traceCode2);

        // Fallback to getHmacSecret when WATERMARK_HMAC_SECRET is unset
        delete process.env.WATERMARK_HMAC_SECRET;
        process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'original-storage-hmac-test-secret';
        const fallbackSecret = resolveWatermarkHmacSecret();
        expect(fallbackSecret).toBe('original-storage-hmac-test-secret');

        // Fail closed safely when no secret is configured
        delete process.env.WATERMARK_HMAC_SECRET;
        delete process.env.ORIGINAL_STORAGE_HMAC_SECRET;
        expect(() => resolveWatermarkHmacSecret()).toThrow('HMAC secret configuration is missing or invalid');
        expect(() =>
            generateTraceCode({
                userId: 'user123',
                scriptId: 'script456',
                pageId: 'page789',
                issuedAt: '2026-10-22T10:00:00.000Z',
            })
        ).toThrow('HMAC secret configuration is missing or invalid');

        // Restore WATERMARK_HMAC_SECRET for subsequent tests
        process.env.WATERMARK_HMAC_SECRET = 'test-watermark-secret-key-12345';
    });

    // 4. Returned image bytes differ from the stored source and retain the same dimensions
    it('4. Returned image bytes differ from stored source and retain natural dimensions', async () => {
        const req = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA._id}/image`
        );
        const res = await imageGET(req, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA._id.toString(),
            }),
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('image/jpeg');

        const arrayBuf = await res.arrayBuffer();
        const returnedBuffer = Buffer.from(arrayBuf);

        // Bytes differ from original
        expect(returnedBuffer.equals(sampleSourceBuffer)).toBe(false);

        // Natural dimensions preserved (verify by loading returned JPEG)
        const { loadImage } = await import('@napi-rs/canvas');
        const img = await loadImage(returnedBuffer);
        expect(img.width).toBe(1200);
        expect(img.height).toBe(1600);
    });

    // 5. A request with spoofed ?studentId= or ?userId= cannot change identity
    it('5. A request with spoofed ?studentId= or ?userId= cannot change identity', async () => {
        // Alice is logged in. Spoof query parameters with Bob's ID.
        const req = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA._id}/image?studentId=${studentB._id}&userId=${studentB._id}`
        );
        const res = await imageGET(req, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA._id.toString(),
            }),
        });

        expect(res.status).toBe(200);

        // Check the audit log: actor and target details must strictly reflect Alice, never Bob
        const logs = await AuditLog.find({
            action: 'STUDENT_PAGE_IMAGE_WATERMARKED',
            user: studentA._id,
        });
        expect(logs.length).toBeGreaterThanOrEqual(1);
        const entry = logs[logs.length - 1];
        expect(entry.details?.userId).toBe(studentA._id.toString());
        expect(entry.details?.rollNumber).toBe('202201001'); // Alice's roll number
    });

    // 6. A student cannot fetch another student's page
    it("6. A student cannot fetch another student's page (returns 404)", async () => {
        // Alice attempts to access Bob's script and page
        const req = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptB._id}/pages/${pageB._id}/image`
        );
        const res = await imageGET(req, {
            params: Promise.resolve({
                scriptId: scriptB._id.toString(),
                pageId: pageB._id.toString(),
            }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toBe('Not found');
    });

    // 7. Alice's cached render is never served to Bob
    it("7. Alice's cached render is never served to Bob", async () => {
        // 1. Alice fetches her page image (populates Alice's cache)
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            role: UserRole.STUDENT,
        };
        const reqAlice = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA._id}/image`
        );
        const resAlice = await imageGET(reqAlice, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA._id.toString(),
            }),
        });
        expect(resAlice.status).toBe(200);

        // 2. Bob tries to access Alice's page (must be rejected 404, never served Alice's cache)
        mockSessionUser = {
            id: studentB._id.toString(),
            email: studentB.email,
            role: UserRole.STUDENT,
        };
        const reqBobAlicePage = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA._id}/image`
        );
        const resBobAlicePage = await imageGET(reqBobAlicePage, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA._id.toString(),
            }),
        });
        expect(resBobAlicePage.status).toBe(404);

        // 3. Bob accesses Bob's own page: gets Bob's own watermarked render with Bob's rollNumber
        const reqBobOwnPage = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptB._id}/pages/${pageB._id}/image`
        );
        const resBobOwn = await imageGET(reqBobOwnPage, {
            params: Promise.resolve({
                scriptId: scriptB._id.toString(),
                pageId: pageB._id.toString(),
            }),
        });
        expect(resBobOwn.status).toBe(200);

        const logsBob = await AuditLog.find({
            action: 'STUDENT_PAGE_IMAGE_WATERMARKED',
            user: studentB._id,
        });
        expect(logsBob.length).toBe(1);
        expect(logsBob[0].details?.rollNumber).toBe('202201002');
    });

    // 8. Stored source bytes and object generation remain unchanged
    it('8. Stored source bytes and object generation remain unchanged', async () => {
        const beforeBuffer = await DerivedStorageService.readDerivedPage(storedPageA.storageKey);

        const req = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA._id}/image`
        );
        await imageGET(req, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA._id.toString(),
            }),
        });

        const afterBuffer = await DerivedStorageService.readDerivedPage(storedPageA.storageKey);
        expect(beforeBuffer.equals(afterBuffer)).toBe(true);
        expect(afterBuffer.equals(sampleSourceBuffer)).toBe(true);
    });

    // 9. More than two concurrent renders returns 503 with Retry-After
    it('9. More than two concurrent renders returns 503 with Retry-After', async () => {
        // Manually acquire 2 slots to saturate capacity
        const release1 = tryAcquireWatermarkSlot();
        const release2 = tryAcquireWatermarkSlot();

        expect(() => tryAcquireWatermarkSlot()).toThrow(WatermarkCapacityError);

        // Request a page image that is not cached (e.g. Charlie's page)
        mockSessionUser = {
            id: studentNoRoll._id.toString(),
            email: studentNoRoll.email,
            role: UserRole.STUDENT,
        };

        const req = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptNoRoll._id}/pages/${pageNoRoll._id}/image`
        );
        const res = await imageGET(req, {
            params: Promise.resolve({
                scriptId: scriptNoRoll._id.toString(),
                pageId: pageNoRoll._id.toString(),
            }),
        });

        expect(res.status).toBe(503);
        expect(res.headers.get('Retry-After')).toBe('1');
        const body = await res.json();
        expect(body.success).toBe(false);

        // Release slots and verify normal rendering resumes
        release1();
        release2();

        const res2 = await imageGET(req, {
            params: Promise.resolve({
                scriptId: scriptNoRoll._id.toString(),
                pageId: pageNoRoll._id.toString(),
            }),
        });
        expect(res2.status).toBe(200);
    });

    // 10. Oversized and invalid dimension images are rejected
    it('10. Oversized and invalid dimension images are rejected with 422', async () => {
        // 10a. Oversized dimensions (exceeds maxLongEdge or maxPixels)
        const reqOversized = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${oversizedPage._id}/image`
        );
        const resOversized = await imageGET(reqOversized, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: oversizedPage._id.toString(),
            }),
        });

        expect(resOversized.status).toBe(422);
        const bodyOversized = await resOversized.json();
        expect(bodyOversized.success).toBe(false);
        expect(bodyOversized.message).toContain('Page exceeds maximum allowed dimensions');

        // 10b. Invalid / missing dimensions
        const invalidPageMissing = await IngestionPage.create({
            batchId: 'batch-ae186',
            job: pageA.job,
            fileId: 'file-ae186-a',
            fileIndex: 10,
            pageNumber: 1,
            // width and height intentionally omitted
            storageKey: storedPageA.storageKey,
            status: PageProcessingStatus.PROCESSED,
            answerScript: scriptA._id,
        });

        const reqMissing = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${invalidPageMissing._id}/image`
        );
        const resMissing = await imageGET(reqMissing, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: invalidPageMissing._id.toString(),
            }),
        });
        expect(resMissing.status).toBe(422);
        const bodyMissing = await resMissing.json();
        expect(bodyMissing.message).toBe('Invalid page dimensions');

        // 10c. Storage key outside derived namespace (e.g. original or arbitrary key)
        const invalidKeyPage = await IngestionPage.create({
            batchId: 'batch-ae186',
            job: pageA.job,
            fileId: 'file-ae186-a',
            fileIndex: 11,
            pageNumber: 1,
            width: 1200,
            height: 1600,
            storageKey: 'originals/batch-ae186/secret.pdf',
            status: PageProcessingStatus.PROCESSED,
            answerScript: scriptA._id,
        });

        const reqInvalidKey = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${invalidKeyPage._id}/image`
        );
        const resInvalidKey = await imageGET(reqInvalidKey, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: invalidKeyPage._id.toString(),
            }),
        });
        expect(resInvalidKey.status).toBe(404);
        const bodyInvalidKey = await resInvalidKey.json();
        expect(bodyInvalidKey.message).toBe('Not found');
    });

    // 11. Audit entries contain userId, scriptId, pageId, and traceCode, with daily deduplication
    it('11. Audit entries contain userId, scriptId, pageId, and traceCode, with daily deduplication', async () => {
        const initialLogs = await AuditLog.find({
            action: 'STUDENT_PAGE_IMAGE_WATERMARKED',
            user: studentA._id,
        });
        const initialCount = initialLogs.length;

        // Request 1: Fresh render -> creates audit record
        const req1 = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA._id}/image`
        );
        const res1 = await imageGET(req1, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA._id.toString(),
            }),
        });
        expect(res1.status).toBe(200);

        const logsAfterFirst = await AuditLog.find({
            action: 'STUDENT_PAGE_IMAGE_WATERMARKED',
            user: studentA._id,
        });
        expect(logsAfterFirst.length).toBe(initialCount + 1);
        const log = logsAfterFirst[logsAfterFirst.length - 1];
        expect(log.details?.userId).toBe(studentA._id.toString());
        expect(log.details?.scriptId).toBe(scriptA._id.toString());
        expect(log.details?.pageId).toBe(pageA._id.toString());
        expect(log.details?.traceCode).toBeDefined();
        expect(log.details?.rollNumber).toBe('202201001');

        // Request 2 on same day: Served from cache -> NO duplicate audit entry
        const req2 = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA._id}/image`
        );
        const res2 = await imageGET(req2, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA._id.toString(),
            }),
        });
        expect(res2.status).toBe(200);

        const logsAfterSecond = await AuditLog.find({
            action: 'STUDENT_PAGE_IMAGE_WATERMARKED',
            user: studentA._id,
        });
        expect(logsAfterSecond.length).toBe(initialCount + 1);

        // Request 3: When audit write fails, output must NOT be cached
        const auditModule = await import('../lib/audit');
        const writeAuditLogSpy = vi.spyOn(auditModule, 'writeAuditLog').mockResolvedValueOnce(false);

        // Use Charlie's uncached page
        mockSessionUser = {
            id: studentNoRoll._id.toString(),
            email: studentNoRoll.email,
            role: UserRole.STUDENT,
        };

        const reqCharlie1 = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptNoRoll._id}/pages/${pageNoRoll._id}/image`
        );
        const resCharlie1 = await imageGET(reqCharlie1, {
            params: Promise.resolve({
                scriptId: scriptNoRoll._id.toString(),
                pageId: pageNoRoll._id.toString(),
            }),
        });
        expect(resCharlie1.status).toBe(200);

        // Verify cache was NOT populated because audit failed
        const { buildRenderCacheKey, getCachedWatermarkRender, formatISTDateOnly } = await import('../lib/watermark');
        const charlieCacheKey = buildRenderCacheKey({
            userId: studentNoRoll._id.toString(),
            pageId: pageNoRoll._id.toString(),
            day: formatISTDateOnly(new Date()),
            width: pageNoRoll.width,
            height: pageNoRoll.height,
            storageKey: pageNoRoll.storageKey,
        });
        const charlieCached = await getCachedWatermarkRender(charlieCacheKey);
        expect(charlieCached).toBeNull();

        writeAuditLogSpy.mockRestore();
    });

    // 12. The route never sends unwatermarked bytes on an error or fallback path
    it('12. The route never sends unwatermarked bytes on an error or fallback path', async () => {
        // Attempt requesting a non-existent page
        const fakePageId = new mongoose.Types.ObjectId();
        const reqNotFound = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${fakePageId}/image`
        );
        const resNotFound = await imageGET(reqNotFound, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: fakePageId.toString(),
            }),
        });
        expect(resNotFound.status).toBe(404);
        const ct = resNotFound.headers.get('Content-Type') || '';
        expect(ct).toContain('application/json');
        expect(ct).not.toContain('image/');

        // Corrupt storageKey to trigger an internal read error
        const corruptedPage = await IngestionPage.create({
            batchId: 'batch-ae186',
            job: pageA.job,
            fileId: 'file-ae186-corrupt',
            fileIndex: 99,
            pageNumber: 99,
            width: 1200,
            height: 1600,
            storageKey: 'non-existent-storage-key-path.png',
            status: PageProcessingStatus.PROCESSED,
            answerScript: scriptA._id,
        });

        const reqCorrupted = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${corruptedPage._id}/image`
        );
        const resCorrupted = await imageGET(reqCorrupted, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: corruptedPage._id.toString(),
            }),
        });

        // Must reject safely (404), never leaking unwatermarked bytes
        expect(resCorrupted.status).toBe(404);
        const corruptedCt = resCorrupted.headers.get('Content-Type') || '';
        expect(corruptedCt).toContain('application/json');
        expect(corruptedCt).not.toContain('image/');
    });
});
