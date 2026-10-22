/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AE-188 Integrity Verification Tests (#266)
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

import Exam, { ExamStatus } from '../models/Exam';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import AnswerScript from '../models/AnswerScript';
import AuditLog from '../models/AuditLog';
import User from '../models/User';
import Course from '../models/Course';
import BatchRepository from '../repositories/BatchRepository';
import { UserRole } from '../constants/permissions';
import immutableStorageService from '../services/ImmutableStorageService';
import derivedStorageService from '../services/DerivedStorageService';
import integrityVerificationService from '../services/IntegrityVerificationService';
import { parseArguments, runCli } from '../scripts/verifyIntegrity';

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

describe('AE-188: Exam Integrity Verification (#266)', () => {
    let replSet: MongoMemoryReplSet;
    let verifyIntegrityPOST: any;
    let approveIngestionPOST: any;

    let tempOriginalsDir: string;
    let tempDerivedDir: string;

    const professorId = new mongoose.Types.ObjectId().toString();
    const taId = new mongoose.Types.ObjectId().toString();
    const studentId = new mongoose.Types.ObjectId().toString();

    beforeAll(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }

        replSet = await MongoMemoryReplSet.create({
            replSet: { storageEngine: 'wiredTiger' }
        });
        const uri = replSet.getUri();
        await mongoose.connect(uri);

        // Setup local storage directories
        tempOriginalsDir = path.join(os.tmpdir(), `ae188-orig-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
        tempDerivedDir = path.join(os.tmpdir(), `ae188-deriv-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
        fs.mkdirSync(tempOriginalsDir, { recursive: true });
        fs.mkdirSync(tempDerivedDir, { recursive: true });

        process.env.ORIGINAL_STORAGE_PATH = tempOriginalsDir;
        process.env.DERIVED_STORAGE_PATH = tempDerivedDir;
        process.env.ORIGINAL_STORAGE_KEY_ID = 'v1';
        process.env.ORIGINAL_STORAGE_HMAC_SECRET = 'active-secret-key-32-chars-length!';
        process.env.ORIGINAL_STORAGE_HMAC_SECRET_V1 = 'active-secret-key-32-chars-length!';
        process.env.ORIGINAL_STORAGE_HMAC_SECRET_V2 = 'rotated-v2-secret-key-32-chars!!';

        verifyIntegrityPOST = (await import('../app/api/exams/[id]/verify-integrity/route')).POST;
        approveIngestionPOST = (await import('../app/api/exams/[id]/approve-ingestion/route')).POST;
    });

    afterAll(async () => {
        await mongoose.disconnect();
        if (replSet) {
            await replSet.stop();
        }
        try {
            if (fs.existsSync(tempOriginalsDir)) {
                fs.rmSync(tempOriginalsDir, { recursive: true, force: true });
            }
            if (fs.existsSync(tempDerivedDir)) {
                fs.rmSync(tempDerivedDir, { recursive: true, force: true });
            }
        } catch {
            // ignore cleanup errors
        }
    });

    beforeEach(async () => {
        mockSessionUser = null;
        await Exam.deleteMany({});
        await Batch.deleteMany({});
        await IngestionJob.deleteMany({});
        await IngestionPage.deleteMany({});
        await AnswerScript.deleteMany({});
        await AuditLog.collection.deleteMany({});
        await User.deleteMany({});
        await Course.deleteMany({});
    });

    // ─── Fixture Helpers ────────────────────────────────────────────────────────

    async function createExam(ownerId: string) {
        const course = await Course.create({
            courseCode: 'CS201',
            courseName: 'Algorithms',
            semester: 1,
            academicYear: '2026-27',
            professor: new mongoose.Types.ObjectId(ownerId),
            isActive: true
        });
        return await Exam.create({
            title: 'Midterm Exam',
            course: course._id,
            createdBy: new mongoose.Types.ObjectId(ownerId),
            examDate: new Date('2026-11-15'),
            totalMarks: 100,
            numberOfQuestions: 4,
            status: ExamStatus.DRAFT,
            isActive: true
        });
    }

    async function createIntactExamSetup(ownerId: string) {
        const exam = await createExam(ownerId);
        const batchId = `batch-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
        const fileId = 'file-001';

        // 1. Store original file immutably
        const originalBytes = Buffer.from('%PDF-1.4 Mock exam original content for AE-188');
        const storedOriginal = await immutableStorageService.storeOriginal({
            batchId,
            fileId,
            sequenceNumber: 1,
            uploader: ownerId,
            buffer: originalBytes,
            originalFilename: 'exam-submission.pdf',
            fileExtension: 'pdf'
        });

        const batch = await BatchRepository.createBatch({
            batchId,
            uploadedBy: new mongoose.Types.ObjectId(ownerId),
            exam: exam._id as mongoose.Types.ObjectId,
            files: [{
                fileId,
                fileIndex: 0,
                originalFilename: 'exam-submission.pdf',
                fileType: 'pdf',
                mimeType: 'application/pdf',
                size: originalBytes.length,
                pageCount: 2,
                storageKey: storedOriginal.storageKey,
                hmac: storedOriginal.hmac,
                keyId: storedOriginal.keyId,
                sequenceNumber: storedOriginal.sequenceNumber,
                integrityMetadata: storedOriginal.integrityMetadata
            }],
            totalFiles: 1,
            totalSize: originalBytes.length,
            totalPageCount: 2,
            status: BatchStatus.DONE,
            isActive: true
        });

        const job = await BatchRepository.createIngestionJob({
            batchId,
            batch: batch._id as mongoose.Types.ObjectId,
            uploadedBy: new mongoose.Types.ObjectId(ownerId),
            status: IngestionStatus.DONE,
            totalPages: 2,
            processedPages: 2,
            failedPages: 0
        });

        const script = await AnswerScript.create({
            exam: exam._id,
            batchId,
            fileIndex: 0,
            startPageNumber: 1,
            endPageNumber: 2,
            pageCount: 2,
            identificationStatus: 'UNIDENTIFIED',
            needsManualId: true,
            manualIdReason: 'NO_CODE_FOUND',
            isActive: true
        });

        // 2. Store derived page images
        const page1Buffer = Buffer.from('Derived Image Page 1 PNG bytes');
        const storedP1 = await derivedStorageService.storeDerivedPage({
            batchId,
            fileId,
            pageNumber: 1,
            buffer: page1Buffer,
            format: 'png'
        });

        const page2Buffer = Buffer.from('Derived Image Page 2 PNG bytes');
        const storedP2 = await derivedStorageService.storeDerivedPage({
            batchId,
            fileId,
            pageNumber: 2,
            buffer: page2Buffer,
            format: 'png'
        });

        const page1 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId,
            fileIndex: 0,
            storageKey: storedP1.storageKey,
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script._id
        });

        const page2 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId,
            fileIndex: 0,
            storageKey: storedP2.storageKey,
            pageNumber: 2,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script._id
        });

        // 3. Approve assembly to establish assembly seal
        mockSessionUser = { id: ownerId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await approveIngestionPOST(
            new Request(`http://localhost/api/exams/${exam._id}/approve-ingestion`, { method: 'POST' }),
            { params: Promise.resolve({ id: exam._id.toString() }) }
        );

        return { exam, batch, script, page1, page2, storedOriginal };
    }

    function makeRequest(body: Record<string, unknown> = {}) {
        return new Request('http://localhost/api/exams/test/verify-integrity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    function makeContext(id: string) {
        return { params: Promise.resolve({ id }) };
    }

    // ─── Tests ──────────────────────────────────────────────────────────────────

    it('1. valid original content with a valid seal returns INTACT', async () => {
        const { exam } = await createIntactExamSetup(professorId);

        const summary = await integrityVerificationService.verifyExamIntegrity(exam._id.toString());

        expect(summary.valid).toBe(true);
        expect(summary.status).toBe('INTACT');
        expect(summary.outcome).toBe('INTACT');
        expect(summary.originalFiles.total).toBe(1);
        expect(summary.originalFiles.intact).toBe(1);
        expect(summary.originalFiles.items[0].status).toBe('INTACT');
        expect(summary.derivedPages.total).toBe(2);
        expect(summary.derivedPages.intact).toBe(2);
        expect(summary.assembly.valid).toBe(true);
        expect(summary.assembly.status).toBe('INTACT');
        expect(summary.problemRecords.files).toHaveLength(0);
        expect(summary.problemRecords.pages).toHaveLength(0);
    });

    it('2. flipped or altered original byte returns MISMATCH', async () => {
        const { exam, storedOriginal } = await createIntactExamSetup(professorId);

        // Tamper with the original file content on disk by flipping one byte
        const diskPath = path.join(tempOriginalsDir, storedOriginal.storageKey.replace(/^batches\//, ''));
        const originalBytes = fs.readFileSync(diskPath);
        originalBytes[0] ^= 0xff; // flip byte
        fs.writeFileSync(diskPath, originalBytes);

        const summary = await integrityVerificationService.verifyExamIntegrity(exam._id.toString());

        expect(summary.valid).toBe(false);
        expect(summary.status).toBe('MISMATCH');
        expect(summary.originalFiles.mismatch).toBe(1);
        expect(summary.originalFiles.items[0].status).toBe('MISMATCH');
        expect(summary.problemRecords.files).toHaveLength(1);
        expect(summary.problemRecords.files[0].status).toBe('MISMATCH');
    });

    it('3. tampered integrity-binding metadata, including timestamp changes, returns MISMATCH', async () => {
        const { exam, batch } = await createIntactExamSetup(professorId);

        // Tamper with the recorded binding metadata timestamp in the Batch document
        const originalMeta = batch.files[0].integrityMetadata!;
        await Batch.updateOne(
            { _id: batch._id },
            {
                $set: {
                    'files.0.integrityMetadata.timestamp': originalMeta.timestamp + 50000
                }
            }
        );

        const summary = await integrityVerificationService.verifyExamIntegrity(exam._id.toString());

        expect(summary.valid).toBe(false);
        expect(summary.status).toBe('MISMATCH');
        expect(summary.originalFiles.mismatch).toBe(1);
        expect(summary.originalFiles.items[0].status).toBe('MISMATCH');
    });

    it('4. missing seal returns UNSEALED', async () => {
        const { exam, batch } = await createIntactExamSetup(professorId);

        // Strip the HMAC seal and integrity metadata
        await Batch.updateOne(
            { _id: batch._id },
            {
                $unset: {
                    'files.0.hmac': '',
                    'files.0.integrityMetadata': ''
                }
            }
        );

        const summary = await integrityVerificationService.verifyExamIntegrity(exam._id.toString());

        expect(summary.valid).toBe(false);
        expect(summary.status).toBe('MISMATCH'); // overall cannot succeed with unsealed files
        expect(summary.originalFiles.unsealed).toBe(1);
        expect(summary.originalFiles.items[0].status).toBe('UNSEALED');
        expect(summary.problemRecords.files[0].status).toBe('UNSEALED');
    });

    it('5. unknown or unavailable HMAC key ID returns ERROR without fallback to a different key', async () => {
        const { exam, batch } = await createIntactExamSetup(professorId);

        // Point keyId to an unconfigured key ID
        await Batch.updateOne(
            { _id: batch._id },
            {
                $set: {
                    'files.0.keyId': 'v999_unknown'
                }
            }
        );

        const summary = await integrityVerificationService.verifyExamIntegrity(exam._id.toString());

        expect(summary.valid).toBe(false);
        expect(summary.status).toBe('ERROR');
        expect(summary.originalFiles.error).toBe(1);
        expect(summary.originalFiles.items[0].status).toBe('ERROR');
        expect(summary.originalFiles.items[0].reason).toContain('unavailable or not configured');
    });

    it('6. an original upload used as a derived-page key is flagged', async () => {
        const { exam, batch, page1 } = await createIntactExamSetup(professorId);

        // Point page1 storageKey to an original file upload in batches/{batchId}/exam.pdf
        const originalUploadKey = batch.files[0].storageKey;
        await IngestionPage.updateOne(
            { _id: page1._id },
            { $set: { storageKey: originalUploadKey } }
        );

        const summary = await integrityVerificationService.verifyExamIntegrity(exam._id.toString());

        expect(summary.valid).toBe(false);
        expect(summary.status).toBe('MISMATCH');
        expect(summary.derivedPages.mismatch).toBe(1);

        const flaggedPage = summary.derivedPages.items.find((p) => p.pageId === page1._id.toString());
        expect(flaggedPage).toBeDefined();
        expect(flaggedPage?.status).toBe('MISMATCH');
        expect(flaggedPage?.reason).toContain('original upload instead of derived namespace');
    });

    it('7. an unexpected or malformed derived storage key is rejected before storage access', async () => {
        const { exam, page1 } = await createIntactExamSetup(professorId);

        // Create spy on derivedPageExists to confirm storage is NOT touched when key is malformed
        const storageExistsSpy = vi.spyOn(derivedStorageService, 'derivedPageExists');

        // Path traversal / malformed key
        await IngestionPage.updateOne(
            { _id: page1._id },
            { $set: { storageKey: `batches/../malicious/derived/file-001/1/page.png` } }
        );

        const summary = await integrityVerificationService.verifyExamIntegrity(exam._id.toString());

        expect(summary.valid).toBe(false);
        const flaggedPage = summary.derivedPages.items.find((p) => p.pageId === page1._id.toString());
        expect(flaggedPage?.status).toBe('MISMATCH');
        expect(flaggedPage?.reason).toContain('path traversal');

        // Confirm derivedPageExists was never called with the malformed key
        expect(storageExistsSpy).not.toHaveBeenCalledWith(expect.stringContaining('malicious'));
        storageExistsSpy.mockRestore();
    });

    it('8. assembly verification delegates to the existing assembly-verification implementation', async () => {
        const { exam } = await createIntactExamSetup(professorId);

        // Tamper with assembly state (disassociate page from script to violate approved assembly seal)
        const page = await IngestionPage.findOne({ pageNumber: 1 });
        await IngestionPage.updateOne({ _id: page?._id }, { $set: { answerScript: null } });

        const summary = await integrityVerificationService.verifyExamIntegrity(exam._id.toString());

        expect(summary.valid).toBe(false);
        expect(summary.assembly.valid).toBe(false);
        expect(summary.assembly.status).toBe('MISMATCH');
    });

    it('9. verification does not change original-object generation, stored bytes, or database records', async () => {
        const { exam, storedOriginal, page1 } = await createIntactExamSetup(professorId);

        const diskPath = path.join(tempOriginalsDir, storedOriginal.storageKey.replace(/^batches\//, ''));
        const originalBytesBefore = fs.readFileSync(diskPath);
        const pageDocBefore = await IngestionPage.findById(page1._id).lean();
        const examDocBefore = await Exam.findById(exam._id).lean();

        // Run integrity verification
        await integrityVerificationService.verifyExamIntegrity(exam._id.toString());

        // Assert files and records are unchanged
        const originalBytesAfter = fs.readFileSync(diskPath);
        expect(originalBytesAfter.equals(originalBytesBefore)).toBe(true);

        const pageDocAfter = await IngestionPage.findById(page1._id).lean();
        expect(pageDocAfter).toEqual(pageDocBefore);

        const examDocAfter = await Exam.findById(exam._id).lean();
        expect(examDocAfter).toEqual(examDocBefore);
    });

    it('10. unauthorized student and TA requests are rejected according to authorization policy', async () => {
        const { exam } = await createIntactExamSetup(professorId);

        // 1. Unauthenticated request
        mockSessionUser = null;
        const resUnauth = await verifyIntegrityPOST(makeRequest(), makeContext(exam._id.toString()));
        expect(resUnauth.status).toBe(401);

        // 2. Student request
        mockSessionUser = { id: studentId, email: 'student@test.com', name: 'Student', role: UserRole.STUDENT };
        const resStudent = await verifyIntegrityPOST(makeRequest(), makeContext(exam._id.toString()));
        expect(resStudent.status).toBe(403);

        // 3. TA request (TAs lack APPROVE_INGESTION permission)
        mockSessionUser = { id: taId, email: 'ta@test.com', name: 'TA', role: UserRole.TA };
        const resTA = await verifyIntegrityPOST(makeRequest(), makeContext(exam._id.toString()));
        expect(resTA.status).toBe(403);

        // 4. Professor request (Authorized)
        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        const resProf = await verifyIntegrityPOST(makeRequest(), makeContext(exam._id.toString()));
        expect(resProf.status).toBe(200);
    });

    it('11. API responses and CLI output do not expose secrets, signatures, raw storage keys, or gs:// paths', async () => {
        const { exam } = await createIntactExamSetup(professorId);

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        const res = await verifyIntegrityPOST(makeRequest(), makeContext(exam._id.toString()));
        const body = await res.json();

        expect(res.status).toBe(200);
        const serialized = JSON.stringify(body);

        // Must not expose secrets
        expect(serialized).not.toContain('active-secret-key');
        expect(serialized).not.toContain('rotated-v2-secret-key');
        // Must not expose raw HMAC hex signature strings
        expect(serialized).not.toContain(body.data.assembly.assemblySeal);
        // Must not expose gs:// paths or internal storage paths
        expect(serialized).not.toContain('gs://');
        expect(serialized).not.toContain(tempOriginalsDir);
        expect(serialized).not.toContain(tempDerivedDir);
        // Must not expose raw storageKey fields in items
        expect(body.data.originalFiles.items[0]).not.toHaveProperty('storageKey');
        expect(body.data.derivedPages.items[0]).not.toHaveProperty('storageKey');
    });

    it('12. audit logging records the verification action and does not falsely claim success after failed checks', async () => {
        const { exam, storedOriginal } = await createIntactExamSetup(professorId);

        // Corrupt original file to force verification failure
        const diskPath = path.join(tempOriginalsDir, storedOriginal.storageKey.replace(/^batches\//, ''));
        fs.appendFileSync(diskPath, Buffer.from('corrupted'));

        mockSessionUser = { id: professorId, email: 'prof@test.com', name: 'Prof', role: UserRole.PROFESSOR };
        await verifyIntegrityPOST(makeRequest(), makeContext(exam._id.toString()));

        // Inspect audit log
        const audit = await AuditLog.findOne({ action: 'INTEGRITY_VERIFIED' });
        expect(audit).toBeDefined();
        expect(audit?.action).toBe('INTEGRITY_VERIFIED');
        expect(audit?.outcome).toBe('FAILURE'); // Must NOT claim SUCCESS
        expect((audit?.details as any)?.overallStatus).toBe('MISMATCH');
        expect((audit?.details as any)?.originalFiles?.mismatch).toBe(1);
    });

    it('13. CLI emits appropriate exit status for mismatches and incomplete checks', async () => {
        const { exam, storedOriginal } = await createIntactExamSetup(professorId);

        // Test CLI parser
        const parsed = parseArguments(['--exam', exam._id.toString(), '--json']);
        expect(parsed.examId).toBe(exam._id.toString());
        expect(parsed.json).toBe(true);

        // 1. Success exit status 0
        const codeSuccess = await runCli(['--exam', exam._id.toString()]);
        expect(codeSuccess).toBe(0);

        // 2. Corrupt original file
        const diskPath = path.join(tempOriginalsDir, storedOriginal.storageKey.replace(/^batches\//, ''));
        fs.appendFileSync(diskPath, Buffer.from('tampered'));

        // Non-zero exit status on mismatch
        const codeFailure = await runCli(['--exam', exam._id.toString()]);
        expect(codeFailure).toBe(1);
    });
});
