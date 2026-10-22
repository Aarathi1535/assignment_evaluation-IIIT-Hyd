/**
 * @vitest-environment jsdom
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Konva from 'konva';
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
import type { RenderedImageBounds } from '../lib/annotations';
import type { PanZoomTransform } from '../lib/panZoom';
import type { MarkAnnotation } from '../lib/stampTool';
import { ReadOnlyScriptViewer } from '../components/student/ReadOnlyScriptViewer';
import { MarkLayer } from '../components/canvas/MarkLayer';
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

vi.mock('../components/canvas/CanvasStage', () => ({
    CanvasStage: ({ children }: any) => React.createElement('div', { 'data-testid': 'mock-canvas-stage' }, children),
    useCanvasStage: () => ({
        stage: null,
        dimensions: { width: 800, height: 600 },
        isReady: true,
    }),
}));

vi.mock('../components/canvas/PageImageLayer', () => ({
    PageImageLayer: ({ onImageLoad }: any) => {
        React.useEffect(() => {
            onImageLoad?.({} as HTMLImageElement, { x: 175, y: 0, width: 450, height: 600, scale: 0.375 });
        }, [onImageLoad]);
        return React.createElement('div', { 'data-testid': 'mock-page-image-layer' });
    },
}));

vi.mock('../components/canvas/PenLayer', () => ({
    PenLayer: () => React.createElement('div', { 'data-testid': 'mock-pen-layer' }),
}));

describe('AE-183: Student Read-Only Graded Script Viewer', () => {
    let pagesGET: any;
    let imageGET: any;
    let annotationsGET: any;
    let resultsListGET: any;
    let resultDetailGET: any;
    let staffScriptGET: any;
    let staffGradesGET: any;
    let staffGradesPOST: any;
    let staffPagesGET: any;
    let staffAnnotationsGET: any;
    let staffAnnotationsPUT: any;
    let staffImageGET: any;
    let staffThumbnailGET: any;
    let verifyAssemblyPOST: any;

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
        if (typeof window !== 'undefined' && window.HTMLCanvasElement) {
            window.HTMLCanvasElement.prototype.getContext = function () {
                return {
                    fillRect: vi.fn(),
                    clearRect: vi.fn(),
                    getImageData: vi.fn(() => ({ data: [] })),
                    putImageData: vi.fn(),
                    createImageData: vi.fn(() => []),
                    setTransform: vi.fn(),
                    drawImage: vi.fn(),
                    save: vi.fn(),
                    fillText: vi.fn(),
                    restore: vi.fn(),
                    beginPath: vi.fn(),
                    moveTo: vi.fn(),
                    lineTo: vi.fn(),
                    closePath: vi.fn(),
                    stroke: vi.fn(),
                    translate: vi.fn(),
                    scale: vi.fn(),
                    rotate: vi.fn(),
                    arc: vi.fn(),
                    fill: vi.fn(),
                    measureText: vi.fn(() => ({ width: 0 })),
                    transform: vi.fn(),
                    rect: vi.fn(),
                    clip: vi.fn(),
                } as any;
            };
        }

        pagesGET = (await import('../app/api/student/results/[scriptId]/pages/route')).GET;
        imageGET = (await import('../app/api/student/results/[scriptId]/pages/[pageId]/image/route')).GET;
        annotationsGET = (await import('../app/api/student/results/[scriptId]/pages/[pageId]/annotations/route')).GET;
        resultsListGET = (await import('../app/api/student/results/route')).GET;
        resultDetailGET = (await import('../app/api/student/results/[scriptId]/route')).GET;

        staffScriptGET = (await import('../app/api/scripts/[id]/route')).GET;
        staffGradesGET = (await import('../app/api/scripts/[id]/grades/route')).GET;
        staffGradesPOST = (await import('../app/api/scripts/[id]/grades/route')).POST;
        staffPagesGET = (await import('../app/api/scripts/[id]/pages/route')).GET;
        staffAnnotationsGET = (await import('../app/api/scripts/[id]/pages/[p]/annotations/route')).GET;
        staffAnnotationsPUT = (await import('../app/api/scripts/[id]/pages/[p]/annotations/route')).PUT;
        staffImageGET = (await import('../app/api/ingest/[id]/pages/[pageId]/image/route')).GET;
        staffThumbnailGET = (await import('../app/api/ingest/[id]/pages/[pageId]/thumbnail/route')).GET;
        verifyAssemblyPOST = (await import('../app/api/exams/[id]/verify-assembly/route')).POST;
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
                            strokeWidth: 3,
                            points: [10, 10, 20, 25],
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
        expect(body.annotations[0].type).toBe('check');
        expect(body.annotations[0].annotatedBy).toBeUndefined();
        expect(body.annotations[0].tool).toBeUndefined();
        expect(body.annotations[1].text).toBe('Good syntax tree diagram');
        expect(body.annotations[1].annotatedBy).toBeUndefined();

        expect(body.strokes).toHaveLength(1);
        expect(body.strokes[0].points).toHaveLength(4);
        expect(body.strokes[0].annotatedBy).toBeUndefined();
        expect(body.strokes[0].tool).toBeUndefined();
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

    // 9. QR/OMR identification conflict returns generic 404 on all three routes
    it('9. returns generic 404 on all three routes when script has QR/OMR identification conflict', async () => {
        await AnswerScript.findByIdAndUpdate(scriptA._id, { hasIdentificationConflict: true });

        try {
            // Pages route
            const pagesReq = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}/pages`);
            const pagesRes = await pagesGET(pagesReq, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });
            expect(pagesRes.status).toBe(404);
            expect(pagesRes.headers.get('Cache-Control')).toBe('private, no-store');
            expect(pagesRes.headers.get('X-Content-Type-Options')).toBe('nosniff');

            // Image route
            const imageReq = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/image`
            );
            const imageRes = await imageGET(imageReq, {
                params: Promise.resolve({
                    scriptId: scriptA._id.toString(),
                    pageId: pageA1._id.toString(),
                }),
            });
            expect(imageRes.status).toBe(404);
            expect(imageRes.headers.get('Cache-Control')).toBe('private, no-store');
            expect(imageRes.headers.get('X-Content-Type-Options')).toBe('nosniff');

            // Annotations route
            const annReq = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/annotations`
            );
            const annRes = await annotationsGET(annReq, {
                params: Promise.resolve({
                    scriptId: scriptA._id.toString(),
                    pageId: pageA1._id.toString(),
                }),
            });
            expect(annRes.status).toBe(404);
            expect(annRes.headers.get('Cache-Control')).toBe('private, no-store');
            expect(annRes.headers.get('X-Content-Type-Options')).toBe('nosniff');
        } finally {
            await AnswerScript.findByIdAndUpdate(scriptA._id, { hasIdentificationConflict: false });
        }
    });

    // 10. STUDENT_RESULTS_ENABLED=false returns generic 404 on all three routes
    it('10. returns generic 404 on all three routes when STUDENT_RESULTS_ENABLED=false', async () => {
        process.env.STUDENT_RESULTS_ENABLED = 'false';

        try {
            const pagesReq = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}/pages`);
            const pagesRes = await pagesGET(pagesReq, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });
            expect(pagesRes.status).toBe(404);

            const imageReq = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/image`
            );
            const imageRes = await imageGET(imageReq, {
                params: Promise.resolve({
                    scriptId: scriptA._id.toString(),
                    pageId: pageA1._id.toString(),
                }),
            });
            expect(imageRes.status).toBe(404);

            const annReq = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/annotations`
            );
            const annRes = await annotationsGET(annReq, {
                params: Promise.resolve({
                    scriptId: scriptA._id.toString(),
                    pageId: pageA1._id.toString(),
                }),
            });
            expect(annRes.status).toBe(404);
        } finally {
            process.env.STUDENT_RESULTS_ENABLED = 'true';
        }
    });

    // 11. Reopening allocation makes script unavailable (404) on all three routes
    it('11. returns generic 404 on all three routes after reopening an allocation', async () => {
        const reopenPOST = (await import('../app/api/allocations/[id]/reopen/route')).POST;
        const allocA = await Allocation.findOne({ answerScript: scriptA._id });

        mockSessionUser = {
            id: prof._id.toString(),
            email: prof.email,
            name: prof.name,
            role: UserRole.PROFESSOR,
        };

        const reopenReq = new NextRequest(`http://localhost:3000/api/allocations/${allocA!._id}/reopen`, {
            method: 'POST',
            body: JSON.stringify({ reason: 'Reopened for grading review' }),
        });
        const reopenRes = await reopenPOST(reopenReq, {
            params: Promise.resolve({ id: allocA!._id.toString() }),
        });
        expect(reopenRes.status).toBe(200);

        // Switch back to Student A session
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            name: studentA.name,
            role: UserRole.STUDENT,
        };

        const pagesReq = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}/pages`);
        const pagesRes = await pagesGET(pagesReq, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });
        expect(pagesRes.status).toBe(404);

        const imageReq = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/image`
        );
        const imageRes = await imageGET(imageReq, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA1._id.toString(),
            }),
        });
        expect(imageRes.status).toBe(404);

        const annReq = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/annotations`
        );
        const annRes = await annotationsGET(annReq, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA1._id.toString(),
            }),
        });
        expect(annRes.status).toBe(404);

        // Restore allocation for subsequent tests
        await Allocation.findByIdAndUpdate(allocA!._id, { status: AllocationStatus.COMPLETED });
        await Grade.updateMany({ answerScript: scriptA._id }, { isFinal: true });
    });

    // 12. Response excludes sensitive properties (graderEmail, annotatedBy, internal metadata) outside the explicit allowlist
    it('12. excludes sensitive properties (graderEmail, annotatedBy, internal metadata) outside the explicit allowlist', async () => {
        await IngestionPage.findByIdAndUpdate(pageA2._id, {
            'metadata.annotations': {
                annotations: [
                    {
                        id: 'check-sensitive-1',
                        type: 'check',
                        x: 150,
                        y: 220,
                        size: 24,
                        color: '#10b981',
                        graderEmail: 'ta.secret@iiit.ac.in',
                        annotatedBy: ta._id.toString(),
                        internalNotes: 'Internal grading note',
                        confidenceScore: 0.99,
                        rubricItemRef: 'criterion-1',
                        createdAt: 1700000000000,
                    },
                    {
                        id: 'text-sensitive-1',
                        type: 'text',
                        x: 200,
                        y: 350,
                        text: 'Clear derivation shown',
                        fontSize: 14,
                        color: '#000000',
                        graderEmail: 'ta.secret@iiit.ac.in',
                        annotatedBy: ta._id.toString(),
                        auditTrail: ['created_by_ta'],
                        createdAt: 1700000000000,
                    },
                ],
                strokes: [
                    {
                        id: 'stroke-sensitive-1',
                        color: '#ef4444',
                        strokeWidth: 3,
                        points: [100, 100, 150, 150],
                        graderEmail: 'ta.secret@iiit.ac.in',
                        annotatedBy: ta._id.toString(),
                        secretScore: 42,
                        createdAt: 1700000000000,
                    },
                ],
            },
        });

        const req = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA2._id}/annotations`
        );
        const res = await annotationsGET(req, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageA2._id.toString(),
            }),
        });

        expect(res.status).toBe(200);
        const rawText = await res.text();

        // Must not contain sensitive keys or values
        expect(rawText).not.toContain('ta.secret@iiit.ac.in');
        expect(rawText).not.toContain('graderEmail');
        expect(rawText).not.toContain('annotatedBy');
        expect(rawText).not.toContain('internalNotes');
        expect(rawText).not.toContain('confidenceScore');
        expect(rawText).not.toContain('rubricItemRef');
        expect(rawText).not.toContain('auditTrail');
        expect(rawText).not.toContain('secretScore');

        const body = JSON.parse(rawText);
        expect(body.annotations).toHaveLength(2);
        expect(body.strokes).toHaveLength(1);

        // Strict allowlist key assertions
        expect(Object.keys(body.annotations[0]).sort()).toEqual(
            ['color', 'createdAt', 'id', 'pageKey', 'size', 'type', 'x', 'y'].sort()
        );
        expect(Object.keys(body.annotations[1]).sort()).toEqual(
            ['color', 'createdAt', 'fontSize', 'id', 'pageKey', 'text', 'type', 'x', 'y'].sort()
        );
        expect(Object.keys(body.strokes[0]).sort()).toEqual(
            ['color', 'createdAt', 'id', 'pageKey', 'points', 'strokeWidth'].sort()
        );
    });

    // 13. RTL component test: ReadOnlyScriptViewer is read-only, handles navigation and states without mutations
    it('13. renders ReadOnlyScriptViewer with RTL, exercises controls, and asserts zero mutation requests', async () => {
        const fetchCalls: Array<{ url: string; method: string }> = [];
        const originalFetch = global.fetch;

        global.fetch = vi.fn().mockImplementation((input: any, init?: any) => {
            const url = typeof input === 'string' ? input : input?.url || '';
            const method = init?.method?.toUpperCase() || 'GET';
            fetchCalls.push({ url, method });

            if (url.includes('/pages') && !url.includes('/annotations') && !url.includes('/image')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () =>
                        Promise.resolve([
                            { pageId: 'page-1', pageNumber: 1, width: 1200, height: 1600 },
                            { pageId: 'page-2', pageNumber: 2, width: 1200, height: 1600 },
                        ]),
                });
            }

            if (url.includes('/annotations')) {
                return Promise.resolve({
                    ok: true,
                    status: 200,
                    json: () =>
                        Promise.resolve({
                            annotations: [
                                {
                                    id: 'check-rtl-1',
                                    type: 'check',
                                    x: 200,
                                    y: 300,
                                    size: 24,
                                    color: '#10b981',
                                    createdAt: 1000,
                                },
                            ],
                            strokes: [],
                        }),
                });
            }

            return Promise.resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({}),
            });
        });

        try {
            // Render the viewer component
            const { unmount } = render(
                React.createElement(ReadOnlyScriptViewer, {
                    scriptId: scriptA._id.toString(),
                    examTitle: 'Compilers Midterm',
                })
            );

            // Initially shows loading state
            expect(screen.getByText('Loading answer sheet...')).toBeDefined();

            // Wait for pages and annotations to resolve
            await waitFor(() => {
                expect(screen.getByText('Compilers Midterm')).toBeDefined();
            });

            // Read-Only badge and Page 1 of 2 indicator
            expect(screen.getByText('Read-Only')).toBeDefined();
            expect(screen.getByText('Page 1 of 2')).toBeDefined();

            const prevButton = screen.getByTitle('Previous Page');
            const nextButton = screen.getByTitle('Next Page');
            expect((prevButton as HTMLButtonElement).disabled).toBe(true);
            expect((nextButton as HTMLButtonElement).disabled).toBe(false);

            // Exercise page navigation forward
            fireEvent.click(nextButton);
            expect(screen.getByText('Page 2 of 2')).toBeDefined();
            expect((nextButton as HTMLButtonElement).disabled).toBe(true);
            expect((prevButton as HTMLButtonElement).disabled).toBe(false);

            // Exercise page navigation backward
            fireEvent.click(prevButton);
            expect(screen.getByText('Page 1 of 2')).toBeDefined();
            expect((prevButton as HTMLButtonElement).disabled).toBe(true);

            // Exercise zoom controls
            const zoomInBtn = screen.getByTitle('Zoom In');
            const zoomOutBtn = screen.getByTitle('Zoom Out');
            const resetBtn = screen.getByTitle('Reset Fit');
            fireEvent.click(zoomInBtn);
            fireEvent.click(zoomOutBtn);
            fireEvent.click(resetBtn);

            // Exercise annotation visibility toggle
            const hideBtn = screen.getByTitle('Hide Annotations');
            fireEvent.click(hideBtn);
            expect(screen.getByTitle('Show Annotations')).toBeDefined();
            fireEvent.click(screen.getByTitle('Show Annotations'));
            expect(screen.getByTitle('Hide Annotations')).toBeDefined();

            // Crucial: Assert that EVERY fetch call is GET and NO mutation request (POST, PUT, PATCH, DELETE) occurred
            expect(fetchCalls.length).toBeGreaterThan(0);
            for (const call of fetchCalls) {
                expect(call.method).toBe('GET');
                expect(['POST', 'PUT', 'PATCH', 'DELETE']).not.toContain(call.method);
            }

            unmount();

            // Test error state when pages fail to load
            global.fetch = vi.fn().mockImplementation(() =>
                Promise.resolve({
                    ok: false,
                    status: 404,
                })
            );

            const { unmount: unmountError } = render(
                React.createElement(ReadOnlyScriptViewer, {
                    scriptId: 'invalid-script-id',
                })
            );

            await waitFor(() => {
                expect(screen.getByText('Answer Sheet Unavailable')).toBeDefined();
                expect(
                    screen.getByText('Unable to load answer sheet. The result may not be available yet.')
                ).toBeDefined();
            });

            unmountError();
        } finally {
            global.fetch = originalFetch;
        }
    });

    // 14. Coordinate stage alignment: TA canvas and Student viewer place check mark at identical stage position
    it('14. renders actual MarkLayer for TA and student viewer configurations placing check mark at identical stage position', () => {
        const fixtureAnnotation: MarkAnnotation = {
            id: 'shared-check-stage-1',
            pageKey: 'page-1',
            type: 'check',
            x: 300,
            y: 400,
            size: 24,
            color: '#10b981',
            createdAt: 1000,
        };

        const baseBounds: RenderedImageBounds = {
            x: 175,
            y: 0,
            width: 450,
            height: 600,
            scale: 0.375,
        };

        const transform: PanZoomTransform = {
            x: 175,
            y: 0,
            zoom: 1.0,
            rotation: 0,
        };

        // 1. Render MarkLayer in TA Canvas configuration (interactive, activeTool='select', disabled=false)
        const taContainer = document.createElement('div');
        const taStage = new Konva.Stage({ container: taContainer, width: 800, height: 600 });
        const { unmount: unmountTA } = render(
            React.createElement(MarkLayer, {
                stage: taStage,
                transform,
                pageKey: 'page-1',
                activeTool: 'select',
                annotations: [fixtureAnnotation],
                selectedAnnotationId: null,
                visible: true,
                disabled: false,
                baseBounds,
            })
        );

        // 2. Render MarkLayer in Student Viewer configuration (read-only, activeTool='none', disabled=true)
        const studentContainer = document.createElement('div');
        const studentStage = new Konva.Stage({ container: studentContainer, width: 800, height: 600 });
        const { unmount: unmountStudent } = render(
            React.createElement(MarkLayer, {
                stage: studentStage,
                transform,
                pageKey: 'page-1',
                activeTool: 'none',
                annotations: [fixtureAnnotation],
                visible: true,
                disabled: true,
                baseBounds,
            })
        );

        // 3. Find check mark Konva groups on both stages
        const taGroup = taStage.findOne('#shared-check-stage-1');
        const studentGroup = studentStage.findOne('#shared-check-stage-1');

        expect(taGroup).toBeDefined();
        expect(studentGroup).toBeDefined();

        const taStagePos = taGroup!.getAbsolutePosition();
        const studentStagePos = studentGroup!.getAbsolutePosition();

        // 4. Verify check mark appears at the exact same stage coordinates
        expect(studentStagePos.x).toBeCloseTo(taStagePos.x, 2);
        expect(studentStagePos.y).toBeCloseTo(taStagePos.y, 2);
        expect(studentStagePos.x).toBeGreaterThan(0);
        expect(studentStagePos.y).toBeGreaterThan(0);

        // Also verify inner check line node aligns identically between TA canvas and student viewer
        const taLine = taStage.findOne('.check-line');
        const studentLine = studentStage.findOne('.check-line');
        expect(taLine).toBeDefined();
        expect(studentLine).toBeDefined();
        expect(studentLine!.getAbsolutePosition().x).toBeCloseTo(taLine!.getAbsolutePosition().x, 2);
        expect(studentLine!.getAbsolutePosition().y).toBeCloseTo(taLine!.getAbsolutePosition().y, 2);

        unmountTA();
        unmountStudent();
        taStage.destroy();
        studentStage.destroy();
    });

    // 15. Static code inspection: ReadOnlyScriptViewer must not import AnswerSheetCanvas, offline drafts, or write APIs
    it('15. strictly verifies ReadOnlyScriptViewer does not import AnswerSheetCanvas, offline drafts, or mutate data', () => {
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

    // 16. (AE-189 A) Cross-student annotations returns generic 404
    it("16. (AE-189 A) returns generic 404 for cross-student annotation requests (Bob's script + page, or Alice's script + Bob's page)", async () => {
        // Case 1: Alice requests Bob's script and Bob's page
        const req1 = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptB._id}/pages/${pageB1._id}/annotations`
        );
        const res1 = await annotationsGET(req1, {
            params: Promise.resolve({
                scriptId: scriptB._id.toString(),
                pageId: pageB1._id.toString(),
            }),
        });
        expect(res1.status).toBe(404);
        const body1 = await res1.json();
        expect(body1).toEqual({ success: false, message: 'Not found' });
        expect(res1.headers.get('Cache-Control')).toBe('private, no-store');
        expect(res1.headers.get('X-Content-Type-Options')).toBe('nosniff');

        // Case 2: Alice requests Alice's script but Bob's page
        const req2 = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageB1._id}/annotations`
        );
        const res2 = await annotationsGET(req2, {
            params: Promise.resolve({
                scriptId: scriptA._id.toString(),
                pageId: pageB1._id.toString(),
            }),
        });
        expect(res2.status).toBe(404);
        const body2 = await res2.json();
        expect(body2).toEqual({ success: false, message: 'Not found' });
        expect(res2.headers.get('Cache-Control')).toBe('private, no-store');
        expect(res2.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    // 17. (AE-189 B) Role matrix on student routes
    it('17. (AE-189 B) enforces 403 role matrix across student route families (ADMIN, PROFESSOR, deactivated STUDENT, role mismatch) and 401 for unauthenticated', async () => {
        const admin = await User.create({
            name: 'Admin Dumbledore',
            email: 'admin.189@iiit.ac.in',
            password: 'password123',
            role: UserRole.ADMIN,
            isActive: true,
        });

        const testAllFourRoutes = async (expectedStatus: number) => {
            // 1. student results detail
            const detailReq = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`);
            const detailRes = await resultDetailGET(detailReq, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });
            expect(detailRes.status).toBe(expectedStatus);

            // 2. student pages
            const pagesReq = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}/pages`);
            const pagesRes = await pagesGET(pagesReq, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });
            expect(pagesRes.status).toBe(expectedStatus);

            // 3. student image
            const imageReq = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/image`
            );
            const imageRes = await imageGET(imageReq, {
                params: Promise.resolve({
                    scriptId: scriptA._id.toString(),
                    pageId: pageA1._id.toString(),
                }),
            });
            expect(imageRes.status).toBe(expectedStatus);

            // 4. student annotations
            const annReq = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/annotations`
            );
            const annRes = await annotationsGET(annReq, {
                params: Promise.resolve({
                    scriptId: scriptA._id.toString(),
                    pageId: pageA1._id.toString(),
                }),
            });
            expect(annRes.status).toBe(expectedStatus);
        };

        // 1. Unauthenticated (401)
        mockSessionUser = null;
        await testAllFourRoutes(401);

        // 2. ADMIN role (403)
        mockSessionUser = {
            id: admin._id.toString(),
            email: admin.email,
            name: admin.name,
            role: UserRole.ADMIN,
        };
        await testAllFourRoutes(403);

        // 3. PROFESSOR role (403)
        mockSessionUser = {
            id: prof._id.toString(),
            email: prof.email,
            name: prof.name,
            role: UserRole.PROFESSOR,
        };
        await testAllFourRoutes(403);

        // 4. Deactivated STUDENT (403)
        await User.findByIdAndUpdate(studentA._id, { isActive: false });
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            name: studentA.name,
            role: UserRole.STUDENT,
        };
        await testAllFourRoutes(403);
        await User.findByIdAndUpdate(studentA._id, { isActive: true });

        // 5. Session claiming STUDENT when the database role has changed (403)
        await User.findByIdAndUpdate(studentA._id, { role: UserRole.TA });
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            name: studentA.name,
            role: UserRole.STUDENT,
        };
        await testAllFourRoutes(403);
        await User.findByIdAndUpdate(studentA._id, { role: UserRole.STUDENT });
    });

    // 18. (AE-189 C) Student access to staff routes
    it('18. (AE-189 C) asserts that a STUDENT receives 403 across all staff routes using actual fixture IDs', async () => {
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            name: studentA.name,
            role: UserRole.STUDENT,
        };

        const actualScriptId = scriptA._id.toString();
        const actualPageId = pageA1._id.toString();
        const actualBatchId = 'batch-183';
        const actualExamId = exam._id.toString();

        // 1. GET /api/scripts/[id]
        const scriptReq = new NextRequest(`http://localhost:3000/api/scripts/${actualScriptId}`);
        const scriptRes = await staffScriptGET(scriptReq, {
            params: Promise.resolve({ id: actualScriptId }),
        });
        expect(scriptRes.status).toBe(403);

        // 2. GET & POST /api/scripts/[id]/grades
        const gradesGetReq = new NextRequest(`http://localhost:3000/api/scripts/${actualScriptId}/grades`);
        const gradesGetRes = await staffGradesGET(gradesGetReq, {
            params: Promise.resolve({ id: actualScriptId }),
        });
        expect(gradesGetRes.status).toBe(403);

        const gradesPostReq = new NextRequest(`http://localhost:3000/api/scripts/${actualScriptId}/grades`, {
            method: 'POST',
            body: JSON.stringify({ question: 1, marksAwarded: [], clientTotalScore: 0, isFinal: true }),
        });
        const gradesPostRes = await staffGradesPOST(gradesPostReq, {
            params: Promise.resolve({ id: actualScriptId }),
        });
        expect(gradesPostRes.status).toBe(403);

        // 3. GET /api/scripts/[id]/pages
        const staffPagesReq = new NextRequest(`http://localhost:3000/api/scripts/${actualScriptId}/pages`);
        const staffPagesRes = await staffPagesGET(staffPagesReq, {
            params: Promise.resolve({ id: actualScriptId }),
        });
        expect(staffPagesRes.status).toBe(403);

        // 4. GET & PUT /api/scripts/[id]/pages/[p]/annotations
        const staffAnnGetReq = new NextRequest(
            `http://localhost:3000/api/scripts/${actualScriptId}/pages/${actualPageId}/annotations`
        );
        const staffAnnGetRes = await staffAnnotationsGET(staffAnnGetReq, {
            params: Promise.resolve({ id: actualScriptId, p: actualPageId }),
        });
        expect(staffAnnGetRes.status).toBe(403);

        const staffAnnPutReq = new NextRequest(
            `http://localhost:3000/api/scripts/${actualScriptId}/pages/${actualPageId}/annotations`,
            {
                method: 'PUT',
                body: JSON.stringify({ annotations: [], strokes: [] }),
            }
        );
        const staffAnnPutRes = await staffAnnotationsPUT(staffAnnPutReq, {
            params: Promise.resolve({ id: actualScriptId, p: actualPageId }),
        });
        expect(staffAnnPutRes.status).toBe(403);

        // 5. GET /api/ingest/[id]/pages/[pageId]/image
        const staffImgReq = new NextRequest(
            `http://localhost:3000/api/ingest/${actualBatchId}/pages/${actualPageId}/image`
        );
        const staffImgRes = await staffImageGET(staffImgReq, {
            params: Promise.resolve({ id: actualBatchId, pageId: actualPageId }),
        });
        expect(staffImgRes.status).toBe(403);

        // 6. GET /api/ingest/[id]/pages/[pageId]/thumbnail
        const staffThumbReq = new NextRequest(
            `http://localhost:3000/api/ingest/${actualBatchId}/pages/${actualPageId}/thumbnail`
        );
        const staffThumbRes = await staffThumbnailGET(staffThumbReq, {
            params: Promise.resolve({ id: actualBatchId, pageId: actualPageId }),
        });
        expect(staffThumbRes.status).toBe(403);

        // 7. POST /api/exams/[id]/verify-assembly
        const verifyReq = new NextRequest(
            `http://localhost:3000/api/exams/${actualExamId}/verify-assembly`,
            { method: 'POST' }
        );
        const verifyRes = await verifyAssemblyPOST(verifyReq, {
            params: Promise.resolve({ id: actualExamId }),
        });
        expect(verifyRes.status).toBe(403);
    });

    // 19. (AE-189 D) Indistinguishable student-resource failures
    it('19. (AE-189 D) asserts identical 404 status codes and identical response bodies for other student ID, nonexistent ID, and malformed ID', async () => {
        const nonexistentId = new mongoose.Types.ObjectId().toString();
        const malformedId = 'malformed-not-an-object-id';

        // Helper to check status & exact JSON body equality across the 3 failure cases
        const assertIndistinguishableFailures = async (
            invoke: (id: string) => Promise<any>
        ) => {
            const resOther = await invoke(scriptB._id.toString());
            const resNonexistent = await invoke(nonexistentId);
            const resMalformed = await invoke(malformedId);

            expect(resOther.status).toBe(404);
            expect(resNonexistent.status).toBe(404);
            expect(resMalformed.status).toBe(404);

            const bodyOther = await resOther.json();
            const bodyNonexistent = await resNonexistent.json();
            const bodyMalformed = await resMalformed.json();

            expect(bodyOther).toEqual({ success: false, message: 'Not found' });
            expect(bodyNonexistent).toEqual(bodyOther);
            expect(bodyMalformed).toEqual(bodyOther);
        };

        // 1. Itemized feedback detail route: /api/student/results/[scriptId]
        await assertIndistinguishableFailures((sId) =>
            resultDetailGET(new NextRequest(`http://localhost:3000/api/student/results/${sId}`), {
                params: Promise.resolve({ scriptId: sId }),
            })
        );

        // 2. Pages route: /api/student/results/[scriptId]/pages
        await assertIndistinguishableFailures((sId) =>
            pagesGET(new NextRequest(`http://localhost:3000/api/student/results/${sId}/pages`), {
                params: Promise.resolve({ scriptId: sId }),
            })
        );

        // 3. Image route: /api/student/results/[scriptId]/pages/[pageId]/image
        // 3a. ScriptId failure cases
        await assertIndistinguishableFailures((sId) =>
            imageGET(
                new NextRequest(
                    `http://localhost:3000/api/student/results/${sId}/pages/${pageA1._id}/image`
                ),
                {
                    params: Promise.resolve({ scriptId: sId, pageId: pageA1._id.toString() }),
                }
            )
        );
        // 3b. PageId failure cases under student's own script
        const resImgOtherPage = await imageGET(
            new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageB1._id}/image`
            ),
            {
                params: Promise.resolve({ scriptId: scriptA._id.toString(), pageId: pageB1._id.toString() }),
            }
        );
        const resImgNonexistentPage = await imageGET(
            new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${nonexistentId}/image`
            ),
            {
                params: Promise.resolve({ scriptId: scriptA._id.toString(), pageId: nonexistentId }),
            }
        );
        const resImgMalformedPage = await imageGET(
            new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${malformedId}/image`
            ),
            {
                params: Promise.resolve({ scriptId: scriptA._id.toString(), pageId: malformedId }),
            }
        );
        expect(resImgOtherPage.status).toBe(404);
        expect(resImgNonexistentPage.status).toBe(404);
        expect(resImgMalformedPage.status).toBe(404);
        const bodyImgOther = await resImgOtherPage.json();
        const bodyImgNonexistent = await resImgNonexistentPage.json();
        const bodyImgMalformed = await resImgMalformedPage.json();
        expect(bodyImgOther).toEqual({ success: false, message: 'Not found' });
        expect(bodyImgNonexistent).toEqual(bodyImgOther);
        expect(bodyImgMalformed).toEqual(bodyImgOther);

        // 4. Annotations route: /api/student/results/[scriptId]/pages/[pageId]/annotations
        // 4a. ScriptId failure cases
        await assertIndistinguishableFailures((sId) =>
            annotationsGET(
                new NextRequest(
                    `http://localhost:3000/api/student/results/${sId}/pages/${pageA1._id}/annotations`
                ),
                {
                    params: Promise.resolve({ scriptId: sId, pageId: pageA1._id.toString() }),
                }
            )
        );
        // 4b. PageId failure cases under student's own script
        const resAnnOtherPage = await annotationsGET(
            new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageB1._id}/annotations`
            ),
            {
                params: Promise.resolve({ scriptId: scriptA._id.toString(), pageId: pageB1._id.toString() }),
            }
        );
        const resAnnNonexistentPage = await annotationsGET(
            new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${nonexistentId}/annotations`
            ),
            {
                params: Promise.resolve({ scriptId: scriptA._id.toString(), pageId: nonexistentId }),
            }
        );
        const resAnnMalformedPage = await annotationsGET(
            new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${malformedId}/annotations`
            ),
            {
                params: Promise.resolve({ scriptId: scriptA._id.toString(), pageId: malformedId }),
            }
        );
        expect(resAnnOtherPage.status).toBe(404);
        expect(resAnnNonexistentPage.status).toBe(404);
        expect(resAnnMalformedPage.status).toBe(404);
        const bodyAnnOther = await resAnnOtherPage.json();
        const bodyAnnNonexistent = await resAnnNonexistentPage.json();
        const bodyAnnMalformed = await resAnnMalformedPage.json();
        expect(bodyAnnOther).toEqual({ success: false, message: 'Not found' });
        expect(bodyAnnNonexistent).toEqual(bodyAnnOther);
        expect(bodyAnnMalformed).toEqual(bodyAnnOther);
    });

    // 20. (AE-189 E) Duplicate page returns 404 on image and annotations
    it('20. (AE-189 E) returns generic 404 on image and annotations routes when own page has isDuplicate: true', async () => {
        await IngestionPage.findByIdAndUpdate(pageA2._id, { isDuplicate: true });

        try {
            // Image route
            const imgReq = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA2._id}/image`
            );
            const imgRes = await imageGET(imgReq, {
                params: Promise.resolve({
                    scriptId: scriptA._id.toString(),
                    pageId: pageA2._id.toString(),
                }),
            });
            expect(imgRes.status).toBe(404);
            const imgBody = await imgRes.json();
            expect(imgBody).toEqual({ success: false, message: 'Not found' });

            // Annotations route
            const annReq = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA2._id}/annotations`
            );
            const annRes = await annotationsGET(annReq, {
                params: Promise.resolve({
                    scriptId: scriptA._id.toString(),
                    pageId: pageA2._id.toString(),
                }),
            });
            expect(annRes.status).toBe(404);
            const annBody = await annRes.json();
            expect(annBody).toEqual({ success: false, message: 'Not found' });

            // Also verify pages list excludes the duplicate page
            const pagesReq = new NextRequest(
                `http://localhost:3000/api/student/results/${scriptA._id}/pages`
            );
            const pagesRes = await pagesGET(pagesReq, {
                params: Promise.resolve({ scriptId: scriptA._id.toString() }),
            });
            expect(pagesRes.status).toBe(200);
            const pagesList = await pagesRes.json();
            const foundDup = pagesList.find((p: any) => p.pageId === pageA2._id.toString());
            expect(foundDup).toBeUndefined();
        } finally {
            await IngestionPage.findByIdAndUpdate(pageA2._id, { isDuplicate: false });
        }
    });

    // 21. (AE-189 F) Exam visibility changes (non-PUBLISHED and isActive: false)
    it('21. (AE-189 F) returns generic 404 for pages, image, annotations, and itemized feedback when exam is non-PUBLISHED or inactive', async () => {
        const assertAllFourReturn404 = async () => {
            // 1. Pages
            const pagesRes = await pagesGET(
                new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}/pages`),
                { params: Promise.resolve({ scriptId: scriptA._id.toString() }) }
            );
            expect(pagesRes.status).toBe(404);
            const pagesBody = await pagesRes.json();
            expect(pagesBody).toEqual({ success: false, message: 'Not found' });

            // 2. Image
            const imgRes = await imageGET(
                new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/image`),
                { params: Promise.resolve({ scriptId: scriptA._id.toString(), pageId: pageA1._id.toString() }) }
            );
            expect(imgRes.status).toBe(404);
            const imgBody = await imgRes.json();
            expect(imgBody).toEqual({ success: false, message: 'Not found' });

            // 3. Annotations
            const annRes = await annotationsGET(
                new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/annotations`),
                { params: Promise.resolve({ scriptId: scriptA._id.toString(), pageId: pageA1._id.toString() }) }
            );
            expect(annRes.status).toBe(404);
            const annBody = await annRes.json();
            expect(annBody).toEqual({ success: false, message: 'Not found' });

            // 4. Itemized feedback detail
            const detailRes = await resultDetailGET(
                new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`),
                { params: Promise.resolve({ scriptId: scriptA._id.toString() }) }
            );
            expect(detailRes.status).toBe(404);
            const detailBody = await detailRes.json();
            expect(detailBody).toEqual({ success: false, message: 'Not found' });
        };

        // Scenario 1: Change exam to non-PUBLISHED state (DRAFT)
        await Exam.findByIdAndUpdate(exam._id, { status: ExamStatus.DRAFT });
        await assertAllFourReturn404();

        // Restore exam status to PUBLISHED and verify access is restored
        await Exam.findByIdAndUpdate(exam._id, { status: ExamStatus.PUBLISHED });
        const restoredDetailRes = await resultDetailGET(
            new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`),
            { params: Promise.resolve({ scriptId: scriptA._id.toString() }) }
        );
        expect(restoredDetailRes.status).toBe(200);

        // Scenario 2: Separately set isActive: false on exam
        await Exam.findByIdAndUpdate(exam._id, { isActive: false });
        await assertAllFourReturn404();

        // Restore exam isActive: true
        await Exam.findByIdAndUpdate(exam._id, { isActive: true });
        const restoredDetailRes2 = await resultDetailGET(
            new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`),
            { params: Promise.resolve({ scriptId: scriptA._id.toString() }) }
        );
        expect(restoredDetailRes2.status).toBe(200);
    });

    // 22. (AE-189 G) Query-parameter spoofing cannot bypass identity or ownership
    it('22. (AE-189 G) ensures ?studentId and ?userId query parameters cannot spoof identity or bypass ownership', async () => {
        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            name: studentA.name,
            role: UserRole.STUDENT,
        };

        const bobId = studentB._id.toString();
        const spoofQuery = `?studentId=${bobId}&userId=${bobId}`;

        // Case 1: Alice accesses her own resources while supplying Bob's IDs in query params -> SUCCEEDS (200)
        // 1a. Results list
        const listReq = new NextRequest(`http://localhost:3000/api/student/results${spoofQuery}`);
        const listRes = await resultsListGET(listReq);
        expect(listRes.status).toBe(200);
        const listBody = await listRes.json();
        expect(listBody.success).toBe(true);
        // Ensure Alice's own scriptId is in the data, not Bob's
        const aliceRecord = listBody.data.find((r: any) => r.scriptId === scriptA._id.toString());
        expect(aliceRecord).toBeDefined();
        const bobRecord = listBody.data.find((r: any) => r.scriptId === scriptB._id.toString());
        expect(bobRecord).toBeUndefined();

        // 1b. Results detail
        const detailReq = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}${spoofQuery}`);
        const detailRes = await resultDetailGET(detailReq, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });
        expect(detailRes.status).toBe(200);
        const detailBody = await detailRes.json();
        expect(detailBody.total).toBe(45); // Alice's awarded score

        // 1c. Pages
        const pagesReq = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}/pages${spoofQuery}`);
        const pagesRes = await pagesGET(pagesReq, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });
        expect(pagesRes.status).toBe(200);

        // 1d. Image
        const imgReq = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/image${spoofQuery}`
        );
        const imgRes = await imageGET(imgReq, {
            params: Promise.resolve({ scriptId: scriptA._id.toString(), pageId: pageA1._id.toString() }),
        });
        expect(imgRes.status).toBe(200);

        // 1e. Annotations
        const annReq = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptA._id}/pages/${pageA1._id}/annotations${spoofQuery}`
        );
        const annRes = await annotationsGET(annReq, {
            params: Promise.resolve({ scriptId: scriptA._id.toString(), pageId: pageA1._id.toString() }),
        });
        expect(annRes.status).toBe(200);

        // Case 2: Alice attempts to access Bob's resource while supplying Bob's IDs in query params -> REJECTED (404)
        // 2a. Results detail
        const bobDetailReq = new NextRequest(`http://localhost:3000/api/student/results/${scriptB._id}${spoofQuery}`);
        const bobDetailRes = await resultDetailGET(bobDetailReq, {
            params: Promise.resolve({ scriptId: scriptB._id.toString() }),
        });
        expect(bobDetailRes.status).toBe(404);
        expect(await bobDetailRes.json()).toEqual({ success: false, message: 'Not found' });

        // 2b. Pages
        const bobPagesReq = new NextRequest(`http://localhost:3000/api/student/results/${scriptB._id}/pages${spoofQuery}`);
        const bobPagesRes = await pagesGET(bobPagesReq, {
            params: Promise.resolve({ scriptId: scriptB._id.toString() }),
        });
        expect(bobPagesRes.status).toBe(404);
        expect(await bobPagesRes.json()).toEqual({ success: false, message: 'Not found' });

        // 2c. Image
        const bobImgReq = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptB._id}/pages/${pageB1._id}/image${spoofQuery}`
        );
        const bobImgRes = await imageGET(bobImgReq, {
            params: Promise.resolve({ scriptId: scriptB._id.toString(), pageId: pageB1._id.toString() }),
        });
        expect(bobImgRes.status).toBe(404);
        expect(await bobImgRes.json()).toEqual({ success: false, message: 'Not found' });

        // 2d. Annotations
        const bobAnnReq = new NextRequest(
            `http://localhost:3000/api/student/results/${scriptB._id}/pages/${pageB1._id}/annotations${spoofQuery}`
        );
        const bobAnnRes = await annotationsGET(bobAnnReq, {
            params: Promise.resolve({ scriptId: scriptB._id.toString(), pageId: pageB1._id.toString() }),
        });
        expect(bobAnnRes.status).toBe(404);
        expect(await bobAnnRes.json()).toEqual({ success: false, message: 'Not found' });
    });
});
