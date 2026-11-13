/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createCanvas } from '@napi-rs/canvas';
import * as zxing from '@zxing/library';

// Models
import User, { IUser, UserRole } from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus, SplittingStrategyType } from '../models/Exam';
import Rubric from '../models/Rubric';
import StudentMapping from '../models/StudentMapping';
import { BatchStatus } from '../models/Batch';
import { IdentificationStatus } from '../models/AnswerScript';
import Allocation, { AllocationStatus } from '../models/Allocation';
import RegradeRequest, { RegradeDecisionOutcome, RegradeStatus } from '../models/RegradeRequest';
import Notification from '../models/Notification';

// Services
import batchService from '../services/BatchService';
import { IngestionWorker } from '../services/IngestionWorker';
import { PageIngestionService } from '../services/PageIngestionService';
import { DefaultPdfRenderer, RenderPageInput, RenderPageResult } from '../services/PageRenderer';
import defaultStudentRosterMappingService from '../services/StudentRosterMappingService';
import immutableStorageService from '../services/ImmutableStorageService';
import derivedStorageService from '../services/DerivedStorageService';

let mockSessionUser: { id: string; email?: string; name?: string; role: UserRole } | null = null;

vi.mock('next-auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('next-auth')>();
    return {
        ...original,
        getServerSession: vi.fn().mockImplementation(() => (
            mockSessionUser ? { user: mockSessionUser } : null
        ))
    };
});

vi.mock('../services/ImageEnhancer', () => {
    return {
        defaultImageEnhancer: {
            enhancePage: vi.fn().mockImplementation(async (buffer) => {
                return { buffer, deskewAngle: 0, orientation: 0, applied: false };
            })
        }
    };
});

const STUDENT_ROLL = 'ROLL-E2E-001';

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

class E2EPdfRenderer extends DefaultPdfRenderer {
    async renderPage(input: RenderPageInput): Promise<RenderPageResult> {
        const qrBuf = createQrCodeImageBuffer(STUDENT_ROLL);
        return {
            success: true,
            pageNumber: input.pageNumber,
            image: {
                buffer: qrBuf,
                format: 'png',
                width: 1000,
                height: 1000,
                dpi: 150,
                pageNumber: input.pageNumber,
                sizeBytes: qrBuf.length
            },
            metadata: {
                fileType: 'pdf',
                pageNumber: input.pageNumber,
                totalPages: 1,
                width: 1000,
                height: 1000,
                dpi: 150,
                format: 'png',
                renderedAt: new Date().toISOString(),
                sizeBytes: qrBuf.length
            }
        };
    }
}

describe('AE-222: Full happy-path E2E (ingest -> publish -> regrade)', () => {
    // API route handlers
    let gradeQuestionPOST: typeof import('../app/api/scripts/[id]/questions/[questionNumber]/grade/route').POST;
    let publishExamPOST: typeof import('../app/api/exams/[id]/publish/route').POST;
    let getStudentResultsGET: typeof import('../app/api/student/results/route').GET;
    let postStudentRegradePOST: typeof import('../app/api/student/regrade-requests/route').POST;
    let getStudentRegradesGET: typeof import('../app/api/student/regrade-requests/route').GET;
    let getProfessorRegradesGET: typeof import('../app/api/professor/regrade-requests/route').GET;
    let assignReviewerPATCH: typeof import('../app/api/professor/regrade-requests/[id]/assignment/route').PATCH;
    let decideRegradePATCH: typeof import('../app/api/professor/regrade-requests/[id]/route').PATCH;

    // Fixtures
    let professor: IUser;
    let operator: IUser;
    let ta: IUser;
    let student: IUser;
    let course: InstanceType<typeof Course>;
    let exam: InstanceType<typeof Exam>;
    let rubric: InstanceType<typeof Rubric>;
    let cleanUpBatchIds: string[] = [];

    const originalResultsEnabled = process.env.STUDENT_RESULTS_ENABLED;

    beforeAll(async () => {
        gradeQuestionPOST = (await import('../app/api/scripts/[id]/questions/[questionNumber]/grade/route')).POST;
        publishExamPOST = (await import('../app/api/exams/[id]/publish/route')).POST;
        getStudentResultsGET = (await import('../app/api/student/results/route')).GET;
        const studentRegradeRoutes = await import('../app/api/student/regrade-requests/route');
        postStudentRegradePOST = studentRegradeRoutes.POST;
        getStudentRegradesGET = studentRegradeRoutes.GET;
        getProfessorRegradesGET = (await import('../app/api/professor/regrade-requests/route')).GET;
        assignReviewerPATCH = (await import('../app/api/professor/regrade-requests/[id]/assignment/route')).PATCH;
        decideRegradePATCH = (await import('../app/api/professor/regrade-requests/[id]/route')).PATCH;

        await RegradeRequest.init();
        await Notification.init();
    });

    afterEach(async () => {
        mockSessionUser = null;
        process.env.STUDENT_RESULTS_ENABLED = originalResultsEnabled;
        for (const batchId of cleanUpBatchIds) {
            await Promise.allSettled([
                immutableStorageService.cleanupBatch(batchId),
                derivedStorageService.cleanupDerivedBatch(batchId)
            ]);
        }
        cleanUpBatchIds = [];
    });

    it('executes full pipeline across all roles: ingest -> grade -> publish -> regrade approval', async () => {
        process.env.STUDENT_RESULTS_ENABLED = 'true';
        const suffix = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;

        // 1. Role Setup
        professor = await User.create({
            name: 'Prof. Minerva McGonagall',
            email: `prof-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        operator = await User.create({
            name: 'Scanning Operator',
            email: `operator-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.ADMIN,
            isActive: true
        });

        ta = await User.create({
            name: 'TA Hermione Granger',
            email: `ta-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });

        const reviewerTa = await User.create({
            name: 'TA Ron Weasley',
            email: `reviewer-ta-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true
        });

        student = await User.create({
            name: 'Student Harry Potter',
            email: `student-${suffix}@example.edu`,
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true
        });

        course = await Course.create({
            courseCode: `CS-E2E-${suffix}`,
            courseName: 'Full End-to-End Testing',
            academicYear: '2026',
            semester: 1,
            professor: professor._id,
            enrolledStudents: [student._id],
            teachingAssistants: [ta._id, reviewerTa._id],
            isActive: true
        });

        exam = await Exam.create({
            title: 'End-to-End Comprehensive Examination',
            course: course._id,
            createdBy: professor._id,
            examDate: new Date(),
            totalMarks: 20,
            numberOfQuestions: 1,
            status: ExamStatus.SCHEDULED,
            splittingStrategy: SplittingStrategyType.COVER_PAGE,
            enrolledStudents: [student._id],
            regradeWindowOpensAt: new Date(Date.now() - 60_000),
            regradeWindowClosesAt: new Date(Date.now() + 24 * 60 * 60_000),
            isActive: true
        });

        rubric = await Rubric.create({
            exam: exam._id,
            createdBy: professor._id,
            scoreStep: 0.5,
            questions: [{
                questionNumber: 1,
                maxMarks: 20,
                criteria: [
                    { criterionName: 'Correctness', points: 15 },
                    { criterionName: 'Clarity', points: 5 }
                ]
            }],
            isActive: true
        });
        exam.rubric = rubric._id;
        await exam.save();

        await StudentMapping.create({
            exam: exam._id,
            student: student._id,
            anonymousId: 'ANON-E2E-001',
            rollNumber: STUDENT_ROLL,
            isVerified: true
        });

        // =========================================================================
        // STAGE 1: INGESTION (Operator uploads PDF scan -> Worker processes pages -> Roster maps to Student)
        // =========================================================================
        const pdfBuffer = createCustomPdfBuffer(1);
        const auditContext = {
            actingUserId: operator._id.toString(),
            actingUserRole: UserRole.ADMIN
        };

        const { batch } = await batchService.createBatch(
            [{ name: 'harry_script.pdf', buffer: pdfBuffer, size: pdfBuffer.length }],
            exam._id.toString(),
            auditContext
        );
        cleanUpBatchIds.push(batch.batchId);

        expect(batch.status).toBe(BatchStatus.QUEUED);
        expect(batch.totalFiles).toBe(1);

        // Process batch with E2EPdfRenderer
        const pageIngestionService = new PageIngestionService(new E2EPdfRenderer());
        const worker = new IngestionWorker({
            pageIngestionService
        });

        const workerResult = await worker.processNextJob();
        expect(workerResult.processed).toBe(true);
        expect(workerResult.processedPages).toBe(1);

        // Assemble answer scripts from extracted pages
        const assembledScripts = await defaultStudentRosterMappingService.assembleAndMapAnswerScripts(
            batch.batchId,
            auditContext
        );
        expect(assembledScripts).toHaveLength(1);

        const studentScript = assembledScripts[0];
        expect(studentScript.identificationStatus).toBe(IdentificationStatus.IDENTIFIED);
        expect(studentScript.student?.toString()).toBe(student._id.toString());
        expect(studentScript.exam.toString()).toBe(exam._id.toString());

        // Update exam state to REVIEW_PENDING for grading commencement
        await Exam.updateOne({ _id: exam._id }, { $set: { status: ExamStatus.REVIEW_PENDING } });

        // =========================================================================
        // STAGE 2: GRADING (TA claims/receives allocation -> Grades question 1 -> Finalizes)
        // =========================================================================
        const allocation = await Allocation.create({
            exam: exam._id,
            ta: ta._id,
            answerScript: studentScript._id,
            question: 1,
            allocatedBy: professor._id,
            status: AllocationStatus.IN_PROGRESS
        });

        mockSessionUser = {
            id: ta._id.toString(),
            email: ta.email,
            name: ta.name,
            role: UserRole.TA
        };

        const gradeResponse = await gradeQuestionPOST(
            new NextRequest(`http://localhost:3000/api/scripts/${studentScript._id}/questions/1/grade`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    marksAwarded: [
                        { criterionName: 'Correctness', score: 10, feedback: 'Minor arithmetic oversight' },
                        { criterionName: 'Clarity', score: 4, feedback: 'Good presentation' }
                    ],
                    clientTotalScore: 14,
                    feedback: 'Solid attempt overall.',
                    isFinal: true
                })
            }),
            { params: Promise.resolve({ id: studentScript._id.toString(), questionNumber: '1' }) }
        );

        expect(gradeResponse.status).toBe(200);
        const gradeData = await gradeResponse.json();
        expect(gradeData.success).toBe(true);
        expect(gradeData.data.totalScore).toBe(14);
        expect(gradeData.data.isFinal).toBe(true);

        // Mark allocation complete
        await Allocation.updateOne({ _id: allocation._id }, { $set: { status: AllocationStatus.COMPLETED } });

        // =========================================================================
        // STAGE 3: PUBLISHING (Professor publishes results -> Student views scores)
        // =========================================================================
        mockSessionUser = {
            id: professor._id.toString(),
            email: professor.email,
            name: professor.name,
            role: UserRole.PROFESSOR
        };

        const publishResponse = await publishExamPOST(
            new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, { method: 'POST' }),
            { params: Promise.resolve({ id: exam._id.toString() }) }
        );
        expect(publishResponse.status).toBe(200);
        const publishData = await publishResponse.json();
        expect(publishData.data.status).toBe(ExamStatus.PUBLISHED);

        // Student logs in and fetches published results
        mockSessionUser = {
            id: student._id.toString(),
            email: student.email,
            name: student.name,
            role: UserRole.STUDENT
        };

        const studentResultsResponse = await getStudentResultsGET();
        expect(studentResultsResponse.status).toBe(200);
        const studentResults = await studentResultsResponse.json();
        expect(studentResults.data).toHaveLength(1);
        expect(studentResults.data[0]).toMatchObject({
            examId: exam._id.toString(),
            status: 'RELEASED',
            total: 14
        });

        // =========================================================================
        // STAGE 4: REGRADING (Student submits request -> Prof assigns TA -> TA approves -> Student sees revised score)
        // =========================================================================
        // 4a. Student submits regrade request
        const regradeSubmissionResponse = await postStudentRegradePOST(
            new NextRequest('http://localhost:3000/api/student/regrade-requests', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    scriptId: studentScript._id.toString(),
                    questionNumber: 1,
                    reason: 'Step 3 arithmetic is actually consistent with formula.'
                })
            })
        );
        expect(regradeSubmissionResponse.status).toBe(201);
        const regradeData = await regradeSubmissionResponse.json();
        const regradeId = regradeData.data.id;
        expect(regradeData.data.status).toBe('open');

        // Student checks active regrade requests
        const studentPendingRegrades = await getStudentRegradesGET();
        const studentRegradesBody = await studentPendingRegrades.json();
        expect(studentRegradesBody.data).toMatchObject([
            { id: regradeId, status: 'open', questionNumber: 1 }
        ]);

        // 4b. Professor inspects queue and assigns reviewer TA
        mockSessionUser = {
            id: professor._id.toString(),
            email: professor.email,
            name: professor.name,
            role: UserRole.PROFESSOR
        };

        const profQueueResponse = await getProfessorRegradesGET(
            new NextRequest(`http://localhost:3000/api/professor/regrade-requests?examId=${exam._id}`)
        );
        expect(profQueueResponse.status).toBe(200);
        const profQueue = await profQueueResponse.json();
        expect(profQueue.data.requests.some((r: any) => r.id === regradeId)).toBe(true);

        const assignmentResponse = await assignReviewerPATCH(
            new NextRequest(`http://localhost:3000/api/professor/regrade-requests/${regradeId}/assignment`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ reviewerId: reviewerTa._id.toString() })
            }),
            { params: Promise.resolve({ id: regradeId }) }
        );
        expect(assignmentResponse.status).toBe(200);

        // 4c. Reviewer TA inspects and decides regrade: approves with revised score 18
        mockSessionUser = {
            id: reviewerTa._id.toString(),
            email: reviewerTa.email,
            name: reviewerTa.name,
            role: UserRole.TA
        };

        const decisionResponse = await decideRegradePATCH(
            new NextRequest(`http://localhost:3000/api/professor/regrade-requests/${regradeId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    outcome: RegradeDecisionOutcome.APPROVED,
                    reason: 'Recalculation verified. Correctness increased from 10 to 14 marks.',
                    revisedScore: 18
                })
            }),
            { params: Promise.resolve({ id: regradeId }) }
        );
        expect(decisionResponse.status).toBe(200);
        const decisionData = await decisionResponse.json();
        expect(decisionData.data.status).toBe(RegradeStatus.RESOLVED);
        expect(decisionData.data.decision.outcome).toBe(RegradeDecisionOutcome.APPROVED);
        expect(decisionData.data.decision.revisedScore).toBe(18);

        // 4d. Student confirms final updated results reflect the approved regrade
        mockSessionUser = {
            id: student._id.toString(),
            email: student.email,
            name: student.name,
            role: UserRole.STUDENT
        };

        const finalResultsResponse = await getStudentResultsGET();
        expect(finalResultsResponse.status).toBe(200);
        const finalResults = await finalResultsResponse.json();
        expect(finalResults.data[0]).toMatchObject({
            examId: exam._id.toString(),
            status: 'RELEASED',
            total: 18
        });

        // Regrade status is now marked as resolved
        const finalStudentRegrades = await getStudentRegradesGET();
        const finalRegradesBody = await finalStudentRegrades.json();
        expect(finalRegradesBody.data[0]).toMatchObject({
            id: regradeId,
            status: 'resolved'
        });
    });
});

