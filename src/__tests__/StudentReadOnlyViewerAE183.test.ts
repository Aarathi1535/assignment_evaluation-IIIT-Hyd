/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import Grade from '../models/Grade';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Rubric from '../models/Rubric';
import DerivedStorageService from '../services/DerivedStorageService';
import { calculateImageFitBounds } from '../lib/annotations';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';

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

describe('AE-183: Student Read-Only Graded Script Viewer', () => {
    let pagesGET: any;
    let imageGET: any;
    let annotationsGET: any;

    let studentA: any;
    let studentB: any;
    let prof: any;
    let ta: any;
    let course: any;
    let exam: any;
    let rubric: any;
    let scriptA: any;
    let scriptB: any;
    let pageA1: any;
    let pageA2: any;
    let pageB1: any;

    beforeAll(async () => {
        pagesGET = (await import('../app/api/student/results/[scriptId]/pages/route')).GET;
        imageGET = (await import('../app/api/student/results/[scriptId]/pages/[pageId]/image/route')).GET;
        annotationsGET = (await import('../app/api/student/results/[scriptId]/pages/[pageId]/annotations/route')).GET;
    });

    beforeEach(async () => {
        process.env.STUDENT_RESULTS_ENABLED = 'true';

        studentA = await User.create({
            name: 'Student Alice',
            email: 'alice.183@iiit.ac.in',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        studentB = await User.create({
            name: 'Student Bob',
            email: 'bob.183@iiit.ac.in',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        prof = await User.create({
            name: 'Professor McGonagall',
            email: 'mcgonagall.183@iiit.ac.in',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true,
        });

        ta = await User.create({
            name: 'TA Lupin',
            email: 'lupin.183@iiit.ac.in',
            password: 'password123',
            role: UserRole.TA,
            isActive: true,
        });

        course = await Course.create({
            courseCode: 'CS183',
            courseName: 'Compilers',
            academicYear: '2026-2027',
            semester: 1,
            professor: prof._id,
            enrolledStudents: [studentA._id, studentB._id],
            teachingAssistants: [ta._id],
            isActive: true,
        });

        exam = await Exam.create({
            title: 'Compilers Midterm',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-10-25'),
            totalMarks: 50,
            numberOfQuestions: 1,
            status: ExamStatus.PUBLISHED,
            isActive: true,
            enrolledStudents: [studentA._id, studentB._id],
        });

        rubric = await Rubric.create({
            exam: exam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            questions: [
                { questionNumber: 1, maxMarks: 50, criteria: [{ criterionName: 'Parsing', points: 50 }] }
            ],
            isActive: true,
        });
        await Exam.findByIdAndUpdate(exam._id, { rubric: rubric._id });

        // Create released script for Student A
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
            marksAwarded: [{ criterionName: 'Parsing', score: 45 }],
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

        // Create released script for Student B
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
            marksAwarded: [{ criterionName: 'Parsing', score: 48 }],
            totalScore: 48,
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

        const jobId = new mongoose.Types.ObjectId();

        // Store sample derived page files for testing
        const sampleImageBuffer = Buffer.from('fake-png-image-content-for-ae183');
        const storedPageA1 = await DerivedStorageService.storeDerivedPage({
            batchId: 'batch-183',
            fileId: 'file-183-a',
            pageNumber: 1,
            buffer: sampleImageBuffer,
            format: 'png',
        });

        const storedPageA2 = await DerivedStorageService.storeDerivedPage({
            batchId: 'batch-183',
            fileId: 'file-183-a',
            pageNumber: 2,
            buffer: sampleImageBuffer,
            format: 'png',
        });

        const storedPageB1 = await DerivedStorageService.storeDerivedPage({
            batchId: 'batch-183',
            fileId: 'file-183-b',
            pageNumber: 1,
            buffer: sampleImageBuffer,
            format: 'png',
        });

        // Seed pages with annotations containing sensitive annotatedBy
        pageA1 = await IngestionPage.create({
            batchId: 'batch-183',
            job: jobId,
            fileId: 'file-183-a',
            fileIndex: 0,
            pageNumber: 1,
            width: 1200,
            height: 1600,
            storageKey: storedPageA1.storageKey,
            status: PageProcessingStatus.PROCESSED,
            answerScript: scriptA._id,
            metadata: {
                annotatedBy: ta._id.toString(),
                annotations: {
                    annotations: [
                        {
                            id: 'check-1',
                            tool: 'check',
                            type: 'check',
                            x: 100,
                            y: 200,
                            color: '#10b981',
                            size: 24,
                            annotatedBy: ta._id.toString(),
                            createdAt: new Date().toISOString(),
                        },
                        {
                            id: 'text-1',
                            tool: 'text',
                            type: 'text',
                            x: 150,
                            y: 250,
                            text: 'Good syntax tree diagram',
                            color: '#000000',
                            fontSize: 14,
                            annotatedBy: ta._id.toString(),
                        },
                    ],
                    strokes: [
                        {
                            id: 'stroke-1',
                            tool: 'pen',
                            color: '#ef4444',
                            width: 3,
                            points: [{ x: 10, y: 10 }, { x: 20, y: 25 }],
                            annotatedBy: ta._id.toString(),
                        },
                    ],
                },
            },
        });

        pageA2 = await IngestionPage.create({
            batchId: 'batch-183',
            job: jobId,
            fileId: 'file-183-a',
            fileIndex: 0,
            pageNumber: 2,
            width: 1200,
            height: 1600,
            storageKey: storedPageA2.storageKey,
            status: PageProcessingStatus.PROCESSED,
            answerScript: scriptA._id,
        });

        pageB1 = await IngestionPage.create({
            batchId: 'batch-183',
            job: jobId,
            fileId: 'file-183-b',
            fileIndex: 1,
            pageNumber: 1,
            width: 1200,
            height: 1600,
            storageKey: storedPageB1.storageKey,
            status: PageProcessingStatus.PROCESSED,
            answerScript: scriptB._id,
        });

        // Set default authenticated student as Alice (Student A)
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            name: studentA.name,
            role: UserRole.STUDENT,
        };
    });

    // 1. Student can list pages of their own released script
    it('1. allows student to retrieve ordered pages of their own released script', async () => {
        const req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}/pages`);
        const res = await pagesGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('private, no-store');
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');

        const pages = await res.json();
        expect(Array.isArray(pages)).toBe(true);
        expect(pages).toHaveLength(2);
        expect(pages[0].pageId).toBe(pageA1._id.toString());
        expect(pages[0].pageNumber).toBe(1);
        expect(pages[0].width).toBe(1200);
        expect(pages[0].height).toBe(1600);
        expect(pages[1].pageId).toBe(pageA2._id.toString());
        expect(pages[1].pageNumber).toBe(2);
    });

    // 2. Cross-student access is strictly rejected with 404
    it("2. returns generic 404 when student attempts to access another student's script pages", async () => {
        // Alice attempts to access Bob's script pages
        const req = new NextRequest(`http://localhost:3000/api/student/results/${scriptB._id}/pages`);
        const res = await pagesGET(req, {
            params: Promise.resolve({ scriptId: scriptB._id.toString() }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toBe('Not found');
    });

    // 3. Student can stream their own page image with security headers
    it('3. streams page image for released script with private cache control and nosniff', async () => {
        const req = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/image`
        );
        const res = await imageGET(req, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA1._id.toString(),
            }),
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toContain('image/png');
        expect(res.headers.get('Cache-Control')).toBe('private, no-store');
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');

        const arrayBuf = await res.arrayBuffer();
        const content = Buffer.from(arrayBuf).toString();
        expect(content).toBe('fake-png-image-content-for-ae183');
    });

    // 4. Cross-student image access returns generic 404
    it("4. returns 404 when student attempts to stream another student's page image", async () => {
        const req = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptB._id}/pages/${pageB1._id}/image`
        );
        const res = await imageGET(req, {
            params: Promise.resolve({
                scriptId: scriptB._id.toString(),
                pageId: pageB1._id.toString(),
            }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.message).toBe('Not found');
    });

    // 5. Mismatched page ID returns generic 404
    it('5. returns 404 when requesting a page that does not belong to the requested script', async () => {
        // Requesting Bob's page under Alice's script
        const req = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageB1._id}/image`
        );
        const res = await imageGET(req, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageB1._id.toString(),
            }),
        });

        expect(res.status).toBe(404);
    });

    // 6. Annotation retrieval strips annotatedBy and grader metadata
    it('6. returns annotations and strokes strictly stripped of annotatedBy and internal metadata', async () => {
        const req = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/annotations`
        );
        const res = await annotationsGET(req, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA1._id.toString(),
            }),
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('private, no-store');
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');

        const rawText = await res.text();
        // Crucial security requirement: annotatedBy must never appear anywhere in the serialized response
        expect(rawText).not.toContain('annotatedBy');
        expect(rawText).not.toContain(ta._id.toString());

        const body = JSON.parse(rawText);
        expect(body.annotations).toHaveLength(2);
        expect(body.annotations[0].tool).toBe('check');
        expect(body.annotations[0].annotatedBy).toBeUndefined();
        expect(body.annotations[1].text).toBe('Good syntax tree diagram');
        expect(body.annotations[1].annotatedBy).toBeUndefined();

        expect(body.strokes).toHaveLength(1);
        expect(body.strokes[0].tool).toBe('pen');
        expect(body.strokes[0].annotatedBy).toBeUndefined();
    });

    // 7. Unreleased script returns 404 for pages, image, and annotations
    it('7. returns generic 404 for pages, image, and annotations when script is unreleased', async () => {
        // Mark allocation as IN_PROGRESS (unreleased)
        await Allocation.findOneAndUpdate(
            { answerScript: scriptA._id },
            { status: AllocationStatus.IN_PROGRESS }
        );

        // Pages route
        let req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}/pages`);
        let res = await pagesGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });
        expect(res.status).toBe(404);

        // Image route
        req = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/image`
        );
        res = await imageGET(req, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA1._id.toString(),
            }),
        });
        expect(res.status).toBe(404);

        // Annotations route
        req = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/annotations`
        );
        res = await annotationsGET(req, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA1._id.toString(),
            }),
        });
        expect(res.status).toBe(404);
    });

    // 8. Unauthenticated or non-student role returns 401/403
    it('8. enforces authentication and role guards (401/403)', async () => {
        // Unauthenticated
        mockSessionUser = null;
        let req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}/pages`);
        let res = await pagesGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });
        expect(res.status).toBe(401);

        // TA role calling student routes
        mockSessionUser = {
            id: ta._id.toString(),
            email: ta.email,
            role: UserRole.TA,
        };
        req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}/pages`);
        res = await pagesGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });
        expect(res.status).toBe(403);
    });

    // 9. Static code inspection: ReadOnlyScriptViewer must not import AnswerSheetCanvas, offline drafts, or write APIs
    it('9. strictly verifies ReadOnlyScriptViewer does not import AnswerSheetCanvas, offline drafts, or mutate data', () => {
        const viewerPath = path.join(
            process.cwd(),
            'src',
            'components',
            'student',
            'ReadOnlyScriptViewer.tsx'
        );
        expect(fs.existsSync(viewerPath)).toBe(true);

        const sourceCode = fs.readFileSync(viewerPath, 'utf-8');

        // Verify prohibited imports & patterns
        expect(sourceCode).not.toContain('AnswerSheetCanvas');
        expect(sourceCode).not.toContain('offlineDrafts');
        expect(sourceCode).not.toContain('/api/scripts');
        expect(sourceCode).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    });

    // 10. Coordinate alignment fixture: verifies natural coordinates align identically via baseBounds
    it('10. aligns annotations consistently in invariant image pixels via baseBounds', () => {
        // Natural image dimensions (e.g. 1200 x 1600 scanned page)
        const naturalWidth = 1200;
        const naturalHeight = 1600;

        // Container stage dimensions (e.g. 800 x 600 viewport)
        const stageWidth = 800;
        const stageHeight = 600;

        const bounds = calculateImageFitBounds(stageWidth, stageHeight, naturalWidth, naturalHeight, 'contain');

        // Annotation placed at natural coordinates (300, 400)
        const checkMarkX = 300;
        const checkMarkY = 400;

        // Position on stage at 1.0x zoom
        const stageX = bounds.x + checkMarkX * bounds.scale;
        const stageY = bounds.y + checkMarkY * bounds.scale;

        expect(bounds.scale).toBeCloseTo(600 / 1600, 4); // 0.375
        expect(bounds.width).toBeCloseTo(1200 * 0.375, 4); // 450
        expect(bounds.x).toBeCloseTo((800 - 450) / 2, 4); // 175
        expect(bounds.y).toBe(0);

        expect(stageX).toBeCloseTo(175 + 300 * 0.375, 4);
        expect(stageY).toBeCloseTo(0 + 400 * 0.375, 4);
    });
});
