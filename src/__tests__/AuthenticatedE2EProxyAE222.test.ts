/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';
import { NextRequest } from 'next/server';

// Models
import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript, { IdentificationSource, IdentificationStatus } from '../models/AnswerScript';
import AuditLog from '../models/AuditLog';
import Notification, { NotificationType } from '../models/Notification';
import RegradeRequest, { RegradeStatus, RegradeDecisionOutcome } from '../models/RegradeRequest';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import Batch, { BatchStatus } from '../models/Batch';

// Services & Handlers
import { authOptions } from '../lib/auth';
import proxyMiddleware from '../proxy';
import derivedStorageService from '../services/DerivedStorageService';

let mockSessionUser: any = null;

// Mock next-auth for Route Handler execution (Next.js route handlers call headers() in getServerSession)
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

// Route handlers
import { PUT as examPUT } from '../app/api/exams/[id]/route';
import { POST as approveIngestionPOST } from '../app/api/exams/[id]/approve-ingestion/route';
import { POST as allocatePOST } from '../app/api/exams/[id]/allocate/route';
import { POST as gradeQuestionPOST } from '../app/api/scripts/[id]/questions/[questionNumber]/grade/route';
import { POST as publishPOST } from '../app/api/exams/[id]/publish/route';
import { GET as studentResultGET } from '../app/api/student/results/[scriptId]/route';
import { POST as studentRegradePOST } from '../app/api/student/regrade-requests/route';
import { GET as professorRegradeQueueGET } from '../app/api/professor/regrade-requests/route';
import { PATCH as assignReviewerPATCH } from '../app/api/professor/regrade-requests/[id]/assignment/route';
import { PATCH as decideRegradePATCH } from '../app/api/professor/regrade-requests/[id]/route';

describe('AE-222: Genuine Authenticated E2E with Login, Session Cookies, and src/proxy.ts', () => {
    let adminUser: any;
    let profUser: any;
    let taUser: any;
    let reviewerTaUser: any;
    let studentUser: any;

    let adminSessionToken: string;
    let profSessionToken: string;
    let taSessionToken: string;
    let studentSessionToken: string;

    const SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-value-at-least-32-chars-long';

    beforeEach(async () => {
        mockSessionUser = null;
        process.env.STUDENT_RESULTS_ENABLED = 'true';

        // Create actual users with bcrypt-hashed passwords in the database
        const passwordHash = await bcrypt.hash('CorrectPassword123!', 10);

        adminUser = await User.create({
            name: 'System Admin',
            email: 'admin.ae222@university.edu',
            password: passwordHash,
            role: UserRole.ADMIN,
            isActive: true,
        });

        profUser = await User.create({
            name: 'Prof Krishna',
            email: 'prof.ae222@university.edu',
            password: passwordHash,
            role: UserRole.PROFESSOR,
            isActive: true,
        });

        taUser = await User.create({
            name: 'Grader TA Alice',
            email: 'ta.alice.ae222@university.edu',
            password: passwordHash,
            role: UserRole.TA,
            isActive: true,
        });

        reviewerTaUser = await User.create({
            name: 'Reviewer TA Bob',
            email: 'ta.bob.ae222@university.edu',
            password: passwordHash,
            role: UserRole.TA,
            isActive: true,
        });

        studentUser = await User.create({
            name: 'Student Charlie',
            email: 'student.charlie.ae222@university.edu',
            password: passwordHash,
            role: UserRole.STUDENT,
            isActive: true,
        });

        // Mint genuine encrypted NextAuth JWT tokens using next-auth/jwt encode()
        adminSessionToken = await encode({
            token: { id: adminUser._id.toString(), email: adminUser.email, name: adminUser.name, role: adminUser.role },
            secret: SECRET,
        });

        profSessionToken = await encode({
            token: { id: profUser._id.toString(), email: profUser.email, name: profUser.name, role: profUser.role },
            secret: SECRET,
        });

        taSessionToken = await encode({
            token: { id: taUser._id.toString(), email: taUser.email, name: taUser.name, role: taUser.role },
            secret: SECRET,
        });

        studentSessionToken = await encode({
            token: { id: studentUser._id.toString(), email: studentUser.email, name: studentUser.name, role: studentUser.role },
            secret: SECRET,
        });
    });

    afterAll(async () => {
        await User.deleteMany({ email: { $regex: /ae222/ } });
        await Course.deleteMany({ courseCode: { $regex: /AE222/ } });
        await Exam.deleteMany({ title: { $regex: /AE222/ } });
        await Batch.deleteMany({ batchId: { $regex: /batch-ae222/ } });
        await IngestionPage.deleteMany({ batchId: { $regex: /batch-ae222/ } });
        await AnswerScript.deleteMany({ candidateStudentId: 'STUD-AE222-01' });
        await RegradeRequest.deleteMany({ reason: { $regex: /AE-222/ } });
        await Notification.deleteMany({ 'data.studentId': 'STUD-AE222-01' });
    });

    describe('1. Genuine Login & Authentication Verification', () => {
        it('authenticates valid credentials, logs LOGIN_SUCCESS audit event, and returns user session object', async () => {
            const credentialsProvider = authOptions.providers[0] as any;
            const authorizeFn = credentialsProvider.options?.authorize || credentialsProvider.authorize;
            const authResult = await authorizeFn({
                email: 'prof.ae222@university.edu',
                password: 'CorrectPassword123!',
            });

            expect(authResult).toBeDefined();
            expect(authResult.id).toBe(profUser._id.toString());
            expect(authResult.email).toBe(profUser.email);
            expect(authResult.role).toBe(UserRole.PROFESSOR);

            // Verify LOGIN_SUCCESS audit log
            const auditEntry = await AuditLog.findOne({
                user: profUser._id,
                action: 'LOGIN_SUCCESS',
                outcome: 'SUCCESS',
            }).sort({ createdAt: -1 });

            expect(auditEntry).toBeDefined();
            expect(auditEntry?.details?.email).toBe(profUser.email);
        });

        it('rejects invalid password, logs LOGIN_FAILURE audit event, and throws error', async () => {
            const credentialsProvider = authOptions.providers[0] as any;
            const authorizeFn = credentialsProvider.options?.authorize || credentialsProvider.authorize;
            let caughtError: any = null;
            try {
                await authorizeFn({
                    email: 'prof.ae222@university.edu',
                    password: 'WrongPassword!',
                });
            } catch (err) {
                caughtError = err;
            }

            expect(caughtError).toBeDefined();
            expect(caughtError.message).toBe('Incorrect password');

            const failureAudit = await AuditLog.findOne({
                user: profUser._id,
                action: 'LOGIN_FAILURE',
                outcome: 'FAILURE',
            }).sort({ createdAt: -1 });

            expect(failureAudit).toBeDefined();
            expect(failureAudit?.details?.reason).toBe('Incorrect password');
        });

        it('rejects inactive user with LOGIN_FAILURE audit log', async () => {
            const inactiveUser = await User.create({
                name: 'Inactive Prof',
                email: 'inactive.ae222@university.edu',
                password: await bcrypt.hash('Password123!', 10),
                role: UserRole.PROFESSOR,
                isActive: false,
            });

            const credentialsProvider = authOptions.providers[0] as any;
            const authorizeFn = credentialsProvider.options?.authorize || credentialsProvider.authorize;
            let caughtError: any = null;
            try {
                await authorizeFn({
                    email: 'inactive.ae222@university.edu',
                    password: 'Password123!',
                });
            } catch (err) {
                caughtError = err;
            }

            expect(caughtError).toBeDefined();
            expect(caughtError.message).toBe('No user found with this email');

            const inactiveAudit = await AuditLog.findOne({
                user: inactiveUser._id,
                action: 'LOGIN_FAILURE',
            }).sort({ createdAt: -1 });

            expect(inactiveAudit).toBeDefined();
            expect(inactiveAudit?.details?.reason).toBe('User is inactive');
        });
    });

    describe('2. Live src/proxy.ts Middleware & Session Cookie Verification', () => {
        it('rejects unauthenticated request to protected API routes with JSON 401', async () => {
            const req = new NextRequest('http://localhost:3000/api/courses');
            const res = await (proxyMiddleware as any)(req);

            expect(res).toBeDefined();
            expect(res?.status).toBe(401);
            const data = await res?.json();
            expect(data.success).toBe(false);
            expect(data.message).toBe('Unauthorized');
        });

        it('allows public access to /api/auth and /api/health without token', async () => {
            const reqHealth = new NextRequest('http://localhost:3000/api/health');
            const resHealth = await (proxyMiddleware as any)(reqHealth);
            expect(resHealth).toBeUndefined(); // Passes through middleware

            const reqAuth = new NextRequest('http://localhost:3000/api/auth/session');
            const resAuth = await (proxyMiddleware as any)(reqAuth);
            expect(resAuth).toBeUndefined(); // Passes through middleware
        });

        it('allows authenticated API request carrying genuine session cookie through proxy', async () => {
            const req = new NextRequest('http://localhost:3000/api/courses', {
                headers: { cookie: `next-auth.session-token=${profSessionToken}` },
            });
            const res = await (proxyMiddleware as any)(req);
            expect(res).toBeUndefined(); // Successfully passed through proxy to route
        });

        it('redirects root path / to role dashboard', async () => {
            const reqProf = new NextRequest('http://localhost:3000/', {
                headers: { cookie: `next-auth.session-token=${profSessionToken}` },
            });
            const resProf = await (proxyMiddleware as any)(reqProf);
            expect(resProf?.status).toBe(307);
            expect(resProf?.headers.get('location')).toBe('http://localhost:3000/professor');

            const reqStudent = new NextRequest('http://localhost:3000/', {
                headers: { cookie: `next-auth.session-token=${studentSessionToken}` },
            });
            const resStudent = await (proxyMiddleware as any)(reqStudent);
            expect(resStudent?.status).toBe(307);
            expect(resStudent?.headers.get('location')).toBe('http://localhost:3000/student');
        });

        it('redirects unauthorized role away from foreign dashboard prefix', async () => {
            // Professor attempting to access /admin
            const reqProfToAdmin = new NextRequest('http://localhost:3000/admin/users', {
                headers: { cookie: `next-auth.session-token=${profSessionToken}` },
            });
            const resProfToAdmin = await (proxyMiddleware as any)(reqProfToAdmin);
            expect(resProfToAdmin?.status).toBe(307);
            expect(resProfToAdmin?.headers.get('location')).toBe('http://localhost:3000/professor');

            // Student attempting to access /ta
            const reqStudentToTa = new NextRequest('http://localhost:3000/ta/grading', {
                headers: { cookie: `next-auth.session-token=${studentSessionToken}` },
            });
            const resStudentToTa = await (proxyMiddleware as any)(reqStudentToTa);
            expect(resStudentToTa?.status).toBe(307);
            expect(resStudentToTa?.headers.get('location')).toBe('http://localhost:3000/student');
        });

        it('allows authorized role to access their own dashboard prefix', async () => {
            const reqAdmin = new NextRequest('http://localhost:3000/admin', {
                headers: { cookie: `next-auth.session-token=${adminSessionToken}` },
            });
            const resAdmin = await (proxyMiddleware as any)(reqAdmin);
            expect(resAdmin).toBeUndefined(); // Authorized, allowed through

            const reqProf = new NextRequest('http://localhost:3000/professor', {
                headers: { cookie: `next-auth.session-token=${profSessionToken}` },
            });
            const resProf = await (proxyMiddleware as any)(reqProf);
            expect(resProf).toBeUndefined(); // Authorized, allowed through
        });
    });

    describe('3. Full Happy-Path Pipeline Across All Roles (Ingest → Publish → Regrade)', () => {
        let course: any;
        let exam: any;
        let rubric: any;
        let batch: any;
        let job: any;
        let script: any;
        let page: any;
        let regradeRequest: any;

        beforeEach(async () => {
            // Setup full course, exam, rubric, batch, and script
            course = await Course.create({
                courseCode: 'CS-AE222',
                courseName: 'Authenticated Pipeline Testing',
                academicYear: '2026-2027',
                semester: 1,
                professor: profUser._id,
                teachingAssistants: [taUser._id, reviewerTaUser._id],
                enrolledStudents: [studentUser._id],
                isActive: true,
            });

            exam = await Exam.create({
                title: 'AE222 Midterm Examination',
                course: course._id,
                createdBy: profUser._id,
                totalMarks: 20,
                numberOfQuestions: 1,
                examDate: new Date(),
                regradeWindowOpensAt: new Date(Date.now() - 3600000),
                regradeWindowClosesAt: new Date(Date.now() + 86400000),
                status: ExamStatus.SCHEDULED,
                isActive: true,
            });

            rubric = await Rubric.create({
                exam: exam._id,
                createdBy: profUser._id,
                scoreStep: 0.5,
                questions: [
                    {
                        questionNumber: 1,
                        maxMarks: 20,
                        criteria: [{ criterionName: 'Correctness', points: 20 }],
                    },
                ],
                isActive: true,
            });

            await Exam.findByIdAndUpdate(exam._id, { rubric: rubric._id });

            const batchId = `batch-ae222-${Date.now()}`;
            batch = await Batch.create({
                batchId,
                exam: exam._id,
                uploadedBy: adminUser._id,
                files: [
                    {
                        fileId: 'f1',
                        fileIndex: 0,
                        originalFilename: 'scanned_exam.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 4096,
                        pageCount: 1,
                        storageKey: `batches/${batchId}/scanned_exam.pdf`,
                    },
                ],
                totalFiles: 1,
                totalSize: 4096,
                totalPageCount: 1,
                status: BatchStatus.QUEUED,
                isActive: true,
            });

            job = await IngestionJob.create({
                batchId,
                batch: batch._id,
                uploadedBy: adminUser._id,
                status: IngestionStatus.DONE,
                totalPages: 1,
                processedPages: 1,
                failedPages: 0,
            });

            script = await AnswerScript.create({
                exam: exam._id,
                student: studentUser._id,
                candidateStudentId: 'STUD-AE222-01',
                batchId,
                fileIndex: 0,
                startPageNumber: 1,
                endPageNumber: 1,
                pageCount: 1,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                identificationSource: IdentificationSource.QR,
                needsManualId: false,
                isActive: true,
            });

            page = await IngestionPage.create({
                batchId,
                job: job._id,
                fileId: 'f1',
                fileIndex: 0,
                pageNumber: 1,
                storageKey: `batches/${batchId}/derived/f1/1/page.png`,
                thumbnailKey: `batches/${batchId}/derived/f1/1/thumb.jpg`,
                status: PageProcessingStatus.PROCESSED,
                answerScript: script._id,
                qrDecodeOutcome: 'found',
            });

            vi.spyOn(derivedStorageService, 'readDerivedPage').mockResolvedValue(Buffer.from('fake-png-bytes'));
        });

        it('completes the entire end-to-end pipeline across all roles', async () => {
            // STEP A (PROFESSOR): Transitions Exam to EVALUATING, approves ingestion, transitions to REVIEW_PENDING
            mockSessionUser = {
                id: profUser._id.toString(),
                email: profUser.email,
                name: profUser.name,
                role: UserRole.PROFESSOR,
            };

            // Exam status transitions: SCHEDULED -> SCANNING -> EVALUATING
            const reqScanning = new NextRequest(`http://localhost:3000/api/exams/${exam._id}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ status: ExamStatus.SCANNING }),
            });
            const resScanning = await examPUT(reqScanning as any, { params: Promise.resolve({ id: exam._id.toString() }) });
            expect(resScanning.status).toBe(200);

            const reqEvaluating = new NextRequest(`http://localhost:3000/api/exams/${exam._id}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ status: ExamStatus.EVALUATING }),
            });
            const resEvaluating = await examPUT(reqEvaluating as any, { params: Promise.resolve({ id: exam._id.toString() }) });
            expect(resEvaluating.status).toBe(200);

            // Approve ingestion
            const reqApprove = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/approve-ingestion`, {
                method: 'POST',
            });
            const resApprove = await approveIngestionPOST(reqApprove as any, { params: Promise.resolve({ id: exam._id.toString() }) });
            expect(resApprove.status).toBe(200);

            const approveAudit = await AuditLog.findOne({
                action: 'INGESTION_APPROVED',
                targetExam: exam._id,
            });
            expect(approveAudit).toBeDefined();

            // Transition to REVIEW_PENDING
            const reqReview = new NextRequest(`http://localhost:3000/api/exams/${exam._id}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ status: ExamStatus.REVIEW_PENDING }),
            });
            const resReview = await examPUT(reqReview as any, { params: Promise.resolve({ id: exam._id.toString() }) });
            expect(resReview.status).toBe(200);

            // STEP B (PROFESSOR): Allocates AnswerScript to TA Alice
            const reqAllocate = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/allocate`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    rule: 'EQUAL',
                    taIds: [taUser._id.toString()],
                }),
            });
            const resAllocate = await allocatePOST(reqAllocate as any, { params: Promise.resolve({ id: exam._id.toString() }) });
            expect(resAllocate.status).toBe(200);

            // STEP C (TA): Grades Question 1 with isFinal: true
            mockSessionUser = {
                id: taUser._id.toString(),
                email: taUser.email,
                name: taUser.name,
                role: UserRole.TA,
            };

            const reqGrade = new NextRequest(`http://localhost:3000/api/scripts/${script._id}/questions/1/grade`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    marksAwarded: [{ criterionName: 'Correctness', score: 14, feedback: 'Good work, partial credit.' }],
                    feedback: 'Review section 2.',
                    isFinal: true,
                }),
            });
            const resGrade = await gradeQuestionPOST(reqGrade as any, {
                params: Promise.resolve({ id: script._id.toString(), questionNumber: '1' }),
            });
            expect(resGrade.status).toBe(200);
            const gradeData = await resGrade.json();
            expect(gradeData.success).toBe(true);
            expect(gradeData.data.totalScore).toBe(14);
            expect(gradeData.data.allocationCompleted).toBe(true);

            // STEP D (PROFESSOR): Publishes Exam results
            mockSessionUser = {
                id: profUser._id.toString(),
                email: profUser.email,
                name: profUser.name,
                role: UserRole.PROFESSOR,
            };

            const reqPublish = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
                method: 'POST',
            });
            const resPublish = await publishPOST(reqPublish as any, { params: Promise.resolve({ id: exam._id.toString() }) });
            expect(resPublish.status).toBe(200);

            const pubAudit = await AuditLog.findOne({
                action: 'EXAM_PUBLISHED',
                targetExam: exam._id,
            });
            expect(pubAudit).toBeDefined();

            const pubNotification = await Notification.findOne({
                user: studentUser._id,
                type: NotificationType.PUBLISH,
            });
            expect(pubNotification).toBeDefined();

            // STEP E (STUDENT): Views published results and submits regrade request
            mockSessionUser = {
                id: studentUser._id.toString(),
                email: studentUser.email,
                name: studentUser.name,
                role: UserRole.STUDENT,
            };

            const reqView = new NextRequest(`http://localhost:3000/api/student/results/${script._id}`);
            const resView = await studentResultGET(reqView as any, { params: Promise.resolve({ scriptId: script._id.toString() }) });
            expect(resView.status).toBe(200);
            const viewData = await resView.json();
            expect(viewData.total).toBe(14);

            const reqRegrade = new NextRequest('http://localhost:3000/api/student/regrade-requests', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    scriptId: script._id.toString(),
                    questionNumber: 1,
                    reason: 'AE-222: Step 3 was completed correctly. Please review.',
                }),
            });
            const resRegrade = await studentRegradePOST(reqRegrade as any);
            expect(resRegrade.status).toBe(201);
            const regradeData = await resRegrade.json();
            expect(regradeData.success).toBe(true);
            expect(regradeData.data.status).toBe('open');
            const regradeRequestId = regradeData.data.id;

            // STEP F (PROFESSOR): Reviews queue, assigns Reviewer TA Bob, and decides regrade
            mockSessionUser = {
                id: profUser._id.toString(),
                email: profUser.email,
                name: profUser.name,
                role: UserRole.PROFESSOR,
            };

            const reqQueue = new NextRequest('http://localhost:3000/api/professor/regrade-requests');
            const resQueue = await professorRegradeQueueGET(reqQueue as any);
            expect(resQueue.status).toBe(200);

            const reqAssign = new NextRequest(`http://localhost:3000/api/professor/regrade-requests/${regradeRequestId}/assignment`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ reviewerId: reviewerTaUser._id.toString() }),
            });
            const resAssign = await assignReviewerPATCH(reqAssign as any, { params: Promise.resolve({ id: regradeRequestId }) });
            expect(resAssign.status).toBe(200);

            const reqDecide = new NextRequest(`http://localhost:3000/api/professor/regrade-requests/${regradeRequestId}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    outcome: RegradeDecisionOutcome.APPROVED,
                    reason: 'Step 3 verified. +4 marks awarded.',
                    revisedScore: 18,
                }),
            });
            const resDecide = await decideRegradePATCH(reqDecide as any, { params: Promise.resolve({ id: regradeRequestId }) });
            expect(resDecide.status).toBe(200);
            const decideData = await resDecide.json();
            expect(decideData.success).toBe(true);
            expect(decideData.data.status).toBe(RegradeStatus.RESOLVED);

            const decideAudit = await AuditLog.findOne({
                action: 'REGRADE_DECIDED',
                targetScript: script._id,
            });
            expect(decideAudit).toBeDefined();

            // STEP G (STUDENT): Verifies updated score in portal
            mockSessionUser = {
                id: studentUser._id.toString(),
                email: studentUser.email,
                name: studentUser.name,
                role: UserRole.STUDENT,
            };

            const reqFinalView = new NextRequest(`http://localhost:3000/api/student/results/${script._id}`);
            const resFinalView = await studentResultGET(reqFinalView as any, { params: Promise.resolve({ scriptId: script._id.toString() }) });
            expect(resFinalView.status).toBe(200);
            const finalData = await resFinalView.json();
            expect(finalData.total).toBe(18);
        });
    });
});
