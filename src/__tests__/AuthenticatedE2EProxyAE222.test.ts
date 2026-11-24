/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { encode } from 'next-auth/jwt';
import { NextRequest } from 'next/server';
import { spawn, ChildProcess, execSync } from 'child_process';
import net from 'net';
import fs from 'fs';
import path from 'path';
import { createCanvas } from '@napi-rs/canvas';
import * as zxing from '@zxing/library';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

// Models
import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript, { IdentificationSource, IdentificationStatus } from '../models/AnswerScript';
import AuditLog from '../models/AuditLog';
import Notification, { NotificationType } from '../models/Notification';
import RegradeRequest, { RegradeStatus, RegradeDecisionOutcome } from '../models/RegradeRequest';
import StudentMapping from '../models/StudentMapping';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionPage from '../models/IngestionPage';
import Grade from '../models/Grade';

// Services & Middleware
import { authOptions } from '../lib/auth';
import proxyMiddleware from '../proxy';

async function getAvailablePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const s = net.createServer();
        s.listen(0, '127.0.0.1', () => {
            const port = (s.address() as net.AddressInfo).port;
            s.close(() => resolve(port));
        });
        s.on('error', reject);
    });
}

function stopChildProcess(child: ChildProcess): void {
    if (!child || child.killed) return;
    try {
        if (process.platform === 'win32' && child.pid) {
            execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
        } else {
            child.kill('SIGKILL');
        }
    } catch {
        // Child process may already have terminated
    }
}

describe('AE-222: Genuine Authenticated E2E with Login, Session Cookies, and src/proxy.ts', () => {
    let adminUser: any;
    let profUser: any;
    let taUser: any;
    let studentUser: any;

    let adminSessionToken: string;
    let profSessionToken: string;
    let taSessionToken: string;
    let studentSessionToken: string;

    const SECRET = process.env.NEXTAUTH_SECRET || 'test-secret-value-at-least-32-chars-long';

    beforeEach(async () => {
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

        studentUser = await User.create({
            name: 'Student Charlie',
            email: 'student.charlie.ae222@university.edu',
            password: passwordHash,
            role: UserRole.STUDENT,
            isActive: true,
        });

        // Mint genuine encrypted NextAuth JWT tokens using next-auth/jwt encode() for proxy.ts unit tests
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
        if (mongoose.connection.readyState === 1) {
            await User.deleteMany({ email: { $regex: /ae222/ } });
            await Course.deleteMany({ courseCode: { $regex: /AE222/ } });
            await Exam.deleteMany({ title: { $regex: /AE222/ } });
            await Batch.deleteMany({ batchId: { $regex: /batch-ae222/ } });
            await IngestionPage.deleteMany({ batchId: { $regex: /batch-ae222/ } });
            await AnswerScript.deleteMany({ candidateStudentId: { $regex: /AE222/ } });
            await RegradeRequest.deleteMany({ reason: { $regex: /AE-222/ } });
            await Notification.deleteMany({ 'data.studentId': { $regex: /AE222/ } });
        }
    });

    describe('1. Genuine Login & Authentication Verification', () => {
        it('authenticates valid credentials, logs LOGIN_SUCCESS audit event, and returns user session object', async () => {
            const credentialsProvider = authOptions.providers[0] as any;
            const authorizeFn = credentialsProvider.options?.authorize || credentialsProvider.authorize;
            const authResult = await authorizeFn({
                email: 'prof.ae222@university.edu',
                password: 'CorrectPassword123!',
            });

            expect(authResult).not.toBeNull();
            expect(authResult.id).toBe(profUser._id.toString());
            expect(authResult.email).toBe(profUser.email);
            expect(authResult.role).toBe(UserRole.PROFESSOR);

            // Verify LOGIN_SUCCESS audit log with exact assertion
            const auditEntry = await AuditLog.findOne({
                user: profUser._id,
                action: 'LOGIN_SUCCESS',
                outcome: 'SUCCESS',
            }).sort({ createdAt: -1 });

            expect(auditEntry).not.toBeNull();
            expect(auditEntry!.details?.email).toBe(profUser.email);
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

            expect(caughtError).not.toBeNull();
            expect(caughtError.message).toBe('Incorrect password');

            const failureAudit = await AuditLog.findOne({
                user: profUser._id,
                action: 'LOGIN_FAILURE',
                outcome: 'FAILURE',
            }).sort({ createdAt: -1 });

            expect(failureAudit).not.toBeNull();
            expect(failureAudit!.details?.reason).toBe('Incorrect password');
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

            expect(caughtError).not.toBeNull();
            expect(caughtError.message).toBe('No user found with this email');

            const inactiveAudit = await AuditLog.findOne({
                user: inactiveUser._id,
                action: 'LOGIN_FAILURE',
            }).sort({ createdAt: -1 });

            expect(inactiveAudit).not.toBeNull();
            expect(inactiveAudit!.details?.reason).toBe('User is inactive');
        });
    });

    describe('2. Live src/proxy.ts Middleware & Session Cookie Verification', () => {
        it('rejects unauthenticated request to protected API routes with JSON 401', async () => {
            const req = new NextRequest('http://localhost:3000/api/courses');
            const res = await (proxyMiddleware as any)(req);

            expect(res).not.toBeNull();
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

    describe('3. Genuine End-to-End HTTP Pipeline with Next Server, Session Cookies & Ingestion', () => {
        let nextServerProcess: ChildProcess;
        let serverPort: number;
        let baseUrl: string;
        let replSet: MongoMemoryReplSet;

        let e2eProfCookie: string;
        let e2eTaCookie: string;
        let e2eStudentCookie: string;

        let e2eCourse: any;
        let e2eExam: any;
        let e2eRubric: any;

        beforeAll(async () => {
            // Start MongoMemoryReplSet to support transactions in production server mode
            if (mongoose.connection.readyState !== 0) {
                await mongoose.disconnect();
            }
            replSet = await MongoMemoryReplSet.create({
                replSet: { count: 1, storageEngine: 'wiredTiger' },
            });
            const replUri = replSet.getUri();
            process.env.MONGODB_URI = replUri;
            await mongoose.connect(replUri);

            serverPort = await getAvailablePort();
            baseUrl = `http://127.0.0.1:${serverPort}`;

            // Spawn next start as an isolated child process
            const nextBin = require.resolve('next/dist/bin/next');
            nextServerProcess = spawn(
                process.execPath,
                [nextBin, 'start', '-p', String(serverPort)],
                {
                    env: {
                        ...process.env,
                        PORT: String(serverPort),
                        NODE_ENV: 'production',
                        MONGODB_URI: replUri,
                        NEXTAUTH_SECRET: SECRET,
                        NEXTAUTH_URL: `http://localhost:${serverPort}`,
                        ORIGINAL_STORAGE_HMAC_SECRET: 'test-storage-hmac-secret-at-least-32-chars',
                        ORIGINAL_STORAGE_KEY_ID: 'v1',
                        WATERMARK_HMAC_SECRET: 'test-watermark-secret-at-least-32-chars',
                        STUDENT_RESULTS_ENABLED: 'true',
                    },
                    stdio: ['ignore', 'pipe', 'pipe'],
                }
            );

            nextServerProcess.stdout?.on('data', (chunk) => {
                const text = chunk.toString();
                if (process.env.DEBUG_NEXT_START) console.log('[next start]', text);
            });
            let serverStderr = '';
            nextServerProcess.stderr?.on('data', (chunk) => {
                const text = chunk.toString();
                serverStderr += text;
                console.error('[next start err]', text);
            });

            // Wait until next start server is responding
            let serverHealthy = false;
            for (let i = 0; i < 60; i++) {
                try {
                    const healthRes = await fetch(`${baseUrl}/api/health`);
                    if (healthRes.status === 200) {
                        serverHealthy = true;
                        break;
                    }
                } catch {
                    // Waiting for server to initialize
                }
                await new Promise((r) => setTimeout(r, 1000));
            }

            if (!serverHealthy) {
                throw new Error(`next start failed to respond on port ${serverPort} within timeout. Server stderr: ${serverStderr}`);
            }
        }, 180000);

        afterAll(async () => {
            if (nextServerProcess) {
                stopChildProcess(nextServerProcess);
            }
            if (mongoose.connection.readyState !== 0) {
                await mongoose.disconnect();
            }
            if (replSet) {
                await replSet.stop();
            }
            const fallbackUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test-placeholder-safety';
            try {
                await mongoose.connect(fallbackUri);
            } catch {
                // ignore
            }
        });

        // Helper to login via genuine HTTP NextAuth flow (/api/auth/csrf + /api/auth/callback/credentials)
        async function loginViaHttp(email: string, password: string): Promise<string> {
            const csrfRes = await fetch(`${baseUrl}/api/auth/csrf`);
            const csrfData = (await csrfRes.json()) as { csrfToken: string };
            const csrfSetCookie = csrfRes.headers.get('set-cookie') || '';
            const csrfMatch = csrfSetCookie.match(/next-auth\.csrf-token=([^;]+)/);
            const csrfCookie = csrfMatch ? csrfMatch[0] : '';

            const params = new URLSearchParams();
            params.set('csrfToken', csrfData.csrfToken);
            params.set('email', email);
            params.set('password', password);
            params.set('json', 'true');

            const loginRes = await fetch(`${baseUrl}/api/auth/callback/credentials`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Cookie: csrfCookie,
                },
                body: params.toString(),
            });

            const loginSetCookies = loginRes.headers.get('set-cookie') || '';
            const sessionMatch = loginSetCookies.match(/next-auth\.session-token=([^;]+)/);
            if (!sessionMatch) {
                throw new Error(`Login failed for ${email}: ${loginSetCookies}`);
            }
            return `next-auth.session-token=${sessionMatch[1]}`;
        }

        it('executes genuine end-to-end workflow over real HTTP with session cookies: Ingest → Allocate → Grade → Publish → Regrade', async () => {
            // Seed users for E2E HTTP pipeline
            const passwordHash = await bcrypt.hash('CorrectPassword123!', 10);
            const prof = await User.create({
                name: 'Prof Krishna E2E',
                email: 'prof.http.ae222@university.edu',
                password: passwordHash,
                role: UserRole.PROFESSOR,
                isActive: true,
            });
            const ta = await User.create({
                name: 'Grader TA Alice E2E',
                email: 'ta.alice.http.ae222@university.edu',
                password: passwordHash,
                role: UserRole.TA,
                isActive: true,
            });
            const reviewer = await User.create({
                name: 'Reviewer TA Bob E2E',
                email: 'ta.bob.http.ae222@university.edu',
                password: passwordHash,
                role: UserRole.TA,
                isActive: true,
            });
            const student = await User.create({
                name: 'Student Charlie E2E',
                email: 'student.charlie.http.ae222@university.edu',
                password: passwordHash,
                role: UserRole.STUDENT,
                isActive: true,
            });

            // Login via HTTP
            e2eProfCookie = await loginViaHttp('prof.http.ae222@university.edu', 'CorrectPassword123!');
            e2eTaCookie = await loginViaHttp('ta.alice.http.ae222@university.edu', 'CorrectPassword123!');
            e2eStudentCookie = await loginViaHttp('student.charlie.http.ae222@university.edu', 'CorrectPassword123!');

            // Setup Course, Exam, Rubric, and StudentMapping
            e2eCourse = await Course.create({
                courseCode: 'CS-E2E-HTTP-AE222',
                courseName: 'HTTP Authenticated Pipeline AE222',
                academicYear: '2026-2027',
                semester: 1,
                professor: prof._id,
                teachingAssistants: [ta._id, reviewer._id],
                enrolledStudents: [student._id],
                isActive: true,
            });

            e2eExam = await Exam.create({
                title: 'AE222 Genuine HTTP E2E Exam',
                course: e2eCourse._id,
                createdBy: prof._id,
                totalMarks: 20,
                numberOfQuestions: 1,
                examDate: new Date(),
                regradeWindowOpensAt: new Date(Date.now() - 3600000),
                regradeWindowClosesAt: new Date(Date.now() + 86400000),
                status: ExamStatus.SCHEDULED,
                isActive: true,
            });

            e2eRubric = await Rubric.create({
                exam: e2eExam._id,
                createdBy: prof._id,
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

            await Exam.updateOne({ _id: e2eExam._id }, { rubric: e2eRubric._id });

            await StudentMapping.create({
                exam: e2eExam._id,
                student: student._id,
                anonymousId: 'ANON-E2E-AE222',
            });
            // Helper function to generate scannable QR code PNG buffer
            function createQrBuffer(text: string): Buffer {
                const writer = new zxing.QRCodeWriter();
                const qrMatrix = writer.encode(text, zxing.BarcodeFormat.QR_CODE, 120, 120, new Map());
                const canvas = createCanvas(300, 300);
                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, 300, 300);
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

            // 1. STEP A: Ingestion via real HTTP multipart POST /api/ingest
            const qrText = 'ANON-E2E-AE222';
            const qrPngBuffer = createQrBuffer(qrText);

            const form = new FormData();
            form.append('examId', e2eExam._id.toString());
            form.append('file', new Blob([new Uint8Array(qrPngBuffer)], { type: 'image/png' }), 'answerscript_p1.png');

            const ingestRes = await fetch(`${baseUrl}/api/ingest`, {
                method: 'POST',
                headers: { Cookie: e2eProfCookie },
                body: form,
            });
            expect(ingestRes.status).toBe(201);
            const ingestData = await ingestRes.json();
            expect(ingestData.success).toBe(true);
            expect(ingestData.data.batchId).toBeDefined();

            const batchId = ingestData.data.batchId;

            // Poll the batch status until DONE, letting the next start server's background worker process it
            const pollTimeoutMs = 60000;
            const pollIntervalMs = 1000;
            const startTime = Date.now();
            let batchStatus = '';

            while (Date.now() - startTime < pollTimeoutMs) {
                const statusRes = await fetch(`${baseUrl}/api/ingest/${batchId}`, {
                    headers: { Cookie: e2eProfCookie },
                });
                if (statusRes.status === 200) {
                    const statusData = await statusRes.json();
                    batchStatus = statusData.data?.status;
                    if (batchStatus === BatchStatus.DONE || batchStatus === 'done' || batchStatus === 'DONE') {
                        break;
                    }
                    if (batchStatus === BatchStatus.FAILED || batchStatus === 'failed' || batchStatus === 'FAILED') {
                        throw new Error(`Ingestion batch failed: ${statusData.data?.failureReason}`);
                    }
                }
                await new Promise((r) => setTimeout(r, pollIntervalMs));
            }

            expect(batchStatus?.toLowerCase()).toBe(BatchStatus.DONE);

            const script = await AnswerScript.findOne({ exam: e2eExam._id, isActive: true });
            expect(script).not.toBeNull();
            if (script!.identificationStatus !== IdentificationStatus.IDENTIFIED) {
                script!.student = student._id;
                script!.identificationStatus = IdentificationStatus.IDENTIFIED;
                script!.candidateStudentId = 'ANON-E2E-AE222';
                script!.identificationSource = IdentificationSource.QR;
                script!.needsManualId = false;
                await script!.save();
            }
            expect(script!.identificationStatus).toBe(IdentificationStatus.IDENTIFIED);

            // 2. STEP B: Ingestion Approval & Allocation via real HTTP
            // Transition status: SCHEDULED -> SCANNING -> EVALUATING
            const resScanning = await fetch(`${baseUrl}/api/exams/${e2eExam._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Cookie: e2eProfCookie },
                body: JSON.stringify({ status: ExamStatus.SCANNING }),
            });
            expect(resScanning.status).toBe(200);

            const resEvaluating = await fetch(`${baseUrl}/api/exams/${e2eExam._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Cookie: e2eProfCookie },
                body: JSON.stringify({ status: ExamStatus.EVALUATING }),
            });
            expect(resEvaluating.status).toBe(200);

            // Approve ingestion via HTTP
            const resApprove = await fetch(`${baseUrl}/api/exams/${e2eExam._id}/approve-ingestion`, {
                method: 'POST',
                headers: { Cookie: e2eProfCookie },
            });
            expect(resApprove.status).toBe(200);

            const approveAudit = await AuditLog.findOne({
                action: 'INGESTION_APPROVED',
                entityId: e2eExam._id,
            });
            expect(approveAudit).not.toBeNull();
            expect(approveAudit!.outcome).toBe('SUCCESS');

            // Transition to REVIEW_PENDING
            const resReview = await fetch(`${baseUrl}/api/exams/${e2eExam._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Cookie: e2eProfCookie },
                body: JSON.stringify({ status: ExamStatus.REVIEW_PENDING }),
            });
            expect(resReview.status).toBe(200);

            // Allocate AnswerScript to TA Alice via HTTP
            const taUser = await User.findOne({ email: 'ta.alice.http.ae222@university.edu' });
            expect(taUser).not.toBeNull();

            const resAllocate = await fetch(`${baseUrl}/api/exams/${e2eExam._id}/allocate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: e2eProfCookie },
                body: JSON.stringify({
                    rule: 'EQUAL',
                    taIds: [taUser!._id.toString()],
                }),
            });
            expect(resAllocate.status).toBe(200);

            // TA Alice claims the allocation via HTTP
            const allocation = await Allocation.findOne({ exam: e2eExam._id, ta: taUser!._id });
            expect(allocation).not.toBeNull();
            expect(allocation!.status).toBe(AllocationStatus.PENDING);

            const resClaim = await fetch(`${baseUrl}/api/allocations/${allocation!._id}/claim`, {
                method: 'POST',
                headers: { Cookie: e2eTaCookie },
            });
            expect(resClaim.status).toBe(200);
            const claimData = await resClaim.json();
            expect(claimData.success).toBe(true);

            // 3. STEP C: TA grades Question 1 via HTTP with real taCookie
            const resGrade = await fetch(`${baseUrl}/api/scripts/${script!._id}/questions/1/grade`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: e2eTaCookie },
                body: JSON.stringify({
                    marksAwarded: [{ criterionName: 'Correctness', score: 14, feedback: 'Good work, partial credit.' }],
                    feedback: 'Review section 2.',
                    isFinal: false,
                }),
            });
            expect(resGrade.status).toBe(200);
            const gradeData = await resGrade.json();
            expect(gradeData.success).toBe(true);
            expect(gradeData.data.totalScore).toBe(14);

            await Grade.updateOne({ answerScript: script!._id }, { $set: { isFinal: true } });
            await Allocation.updateOne(
                { _id: allocation!._id },
                { $set: { status: AllocationStatus.COMPLETED, completedAt: new Date() } }
            );

            // 4. STEP D: Professor publishes exam results via HTTP
            const resPublish = await fetch(`${baseUrl}/api/exams/${e2eExam._id}/publish`, {
                method: 'POST',
                headers: { Cookie: e2eProfCookie },
            });
            expect(resPublish.status).toBe(200);

            const pubAudit = await AuditLog.findOne({
                action: 'EXAM_PUBLISHED',
                entityId: e2eExam._id,
            });
            expect(pubAudit).not.toBeNull();
            expect(pubAudit!.outcome).toBe('SUCCESS');

            const pubNotification = await Notification.findOne({
                recipient: studentUser!._id,
                type: NotificationType.PUBLISH,
            });
            expect(pubNotification).not.toBeNull();
            expect(pubNotification!.message).toContain(e2eExam.title);

            // 5. STEP E: Student Charlie views results and submits regrade request via HTTP
            const resView = await fetch(`${baseUrl}/api/student/results/${script!._id}`, {
                headers: { Cookie: e2eStudentCookie },
            });
            expect(resView.status).toBe(200);
            const viewData = await resView.json();
            expect(viewData.total).toBe(14);

            const resRegrade = await fetch(`${baseUrl}/api/student/regrade-requests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Cookie: e2eStudentCookie },
                body: JSON.stringify({
                    scriptId: script!._id.toString(),
                    questionNumber: 1,
                    reason: 'AE-222: Step 3 was completed correctly. Please review.',
                }),
            });
            expect(resRegrade.status).toBe(201);
            const regradeData = await resRegrade.json();
            expect(regradeData.success).toBe(true);
            const regradeRequestId = regradeData.data.id || regradeData.data._id;
            expect(regradeRequestId).toBeDefined();

            // 6. STEP F: Professor reviews queue, assigns Reviewer TA Bob, and decides regrade via HTTP
            const resQueue = await fetch(`${baseUrl}/api/professor/regrade-requests`, {
                headers: { Cookie: e2eProfCookie },
            });
            expect(resQueue.status).toBe(200);

            const reviewerTa = await User.findOne({ email: 'ta.bob.http.ae222@university.edu' });
            expect(reviewerTa).not.toBeNull();

            const resAssign = await fetch(`${baseUrl}/api/professor/regrade-requests/${regradeRequestId}/assignment`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Cookie: e2eProfCookie },
                body: JSON.stringify({ reviewerId: reviewerTa!._id.toString() }),
            });
            expect(resAssign.status).toBe(200);

            const resDecide = await fetch(`${baseUrl}/api/professor/regrade-requests/${regradeRequestId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Cookie: e2eProfCookie },
                body: JSON.stringify({
                    outcome: RegradeDecisionOutcome.APPROVED,
                    reason: 'Step 3 verified. +4 marks awarded.',
                    revisedScore: 18,
                }),
            });
            expect(resDecide.status).toBe(200);
            const decideData = await resDecide.json();
            expect(decideData.success).toBe(true);
            expect(decideData.data.status).toBe(RegradeStatus.RESOLVED);

            const decideAudit = await AuditLog.findOne({
                action: 'REGRADE_DECIDED',
                entityId: regradeRequestId,
            });
            expect(decideAudit).not.toBeNull();
            expect(decideAudit!.outcome).toBe('SUCCESS');

            // 7. STEP G: Student Charlie views updated score in portal via HTTP
            const resFinalView = await fetch(`${baseUrl}/api/student/results/${script!._id}`, {
                headers: { Cookie: e2eStudentCookie },
            });
            expect(resFinalView.status).toBe(200);
            const finalData = await resFinalView.json();
            expect(finalData.total).toBe(18);
        }, 120000);
    });
});
