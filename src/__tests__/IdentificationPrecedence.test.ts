/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import AnswerScript, { IdentificationSource } from '../models/AnswerScript';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import Batch, { BatchStatus } from '../models/Batch';
import Exam, { ExamStatus } from '../models/Exam';
import Course from '../models/Course';
import StudentMapping from '../models/StudentMapping';
import User, { UserRole } from '../models/User';
import { StudentRosterMappingService } from '../services/StudentRosterMappingService';
import { POST as identifyRoute } from '../app/api/answerscripts/[id]/identify/route';
import { NextRequest } from 'next/server';

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

describe('AE-072 — QR vs OMR vs Manual Identification Precedence', () => {
    let service: StudentRosterMappingService;
    let profUser: any;
    let studentA: any;
    let studentB: any;
    let course: any;
    let exam: any;
    let defaultJobId: mongoose.Types.ObjectId;

    beforeAll(async () => {
        await AnswerScript.init();
        await IngestionPage.init();
        await Batch.init();
        await Exam.init();
        await Course.init();
        await StudentMapping.init();
        await User.init();
    });

    beforeEach(async () => {
        service = new StudentRosterMappingService();
        defaultJobId = new mongoose.Types.ObjectId();
        mockSessionUser = null;

        profUser = await User.create({
            name: 'Prof Alpha',
            email: `prof-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        studentA = await User.create({
            name: 'Alice Student',
            email: `alice-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.STUDENT,
            isActive: true
        });

        studentB = await User.create({
            name: 'Bob Student',
            email: `bob-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.STUDENT,
            isActive: true
        });

        course = await Course.create({
            courseCode: `CS-${Date.now()}`,
            courseName: 'Data Structures',
            semester: 1,
            academicYear: '2026-2027',
            professor: profUser._id,
            enrolledStudents: [studentA._id, studentB._id],
            isActive: true
        });

        exam = await Exam.create({
            title: 'Midterm Exam 2026',
            course: course._id,
            createdBy: profUser._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 5,
            enrolledStudents: [studentA._id, studentB._id],
            isActive: true
        });

        // Set up student mappings
        await StudentMapping.create({
            exam: exam._id,
            student: studentA._id,
            anonymousId: 'ANON-ALICE',
            rollNumber: 'ROLL-ALICE',
            isVerified: true
        });

        await StudentMapping.create({
            exam: exam._id,
            student: studentB._id,
            anonymousId: 'ANON-BOB',
            rollNumber: 'ROLL-BOB',
            isVerified: true
        });
    });

    const createTestBatch = async (batchId: string) => {
        return await Batch.create({
            batchId,
            uploadedBy: profUser._id,
            exam: exam._id,
            files: [
                {
                    fileId: 'file-1',
                    fileIndex: 0,
                    originalFilename: 'exam.pdf',
                    fileType: 'pdf',
                    mimeType: 'application/pdf',
                    size: 5000,
                    pageCount: 1,
                    storageKey: `batches/${batchId}/0/file-1.pdf`
                }
            ],
            totalFiles: 1,
            totalSize: 5000,
            totalPageCount: 1,
            status: BatchStatus.PROCESSING
        });
    };

    it('precedence: QR takes precedence over OMR when both are valid and same student', async () => {
        const batchId = `batch-precedence-1-${Date.now()}`;
        await createTestBatch(batchId);

        await IngestionPage.create({
            batchId,
            job: defaultJobId,
            fileId: 'file-1',
            fileIndex: 0,
            pageNumber: 1,
            isCoverPage: true,
            status: PageProcessingStatus.PROCESSED,
            storageKey: `batches/${batchId}/derived/1/page.png`,
            qrStudentId: 'ROLL-ALICE',
            qrDecodeOutcome: 'found',
            omrStudentId: 'ROLL-ALICE',
            omrDecodeOutcome: 'found'
        });

        const scripts = await service.assembleAndMapAnswerScripts(batchId, {
            actingUserId: profUser._id.toString(),
            actingUserRole: 'PROFESSOR'
        });

        expect(scripts.length).toBe(1);
        const script = scripts[0];
        expect(script.student?.toString()).toBe(studentA._id.toString());
        expect(script.identificationSource).toBe(IdentificationSource.QR);
        expect(script.hasIdentificationConflict).toBe(false);
        expect(script.qrStudentId).toBe('ROLL-ALICE');
        expect(script.omrStudentId).toBe('ROLL-ALICE');
    });

    it('precedence: QR takes precedence over OMR when both are valid but conflict', async () => {
        const batchId = `batch-precedence-2-${Date.now()}`;
        await createTestBatch(batchId);

        await IngestionPage.create({
            batchId,
            job: defaultJobId,
            fileId: 'file-1',
            fileIndex: 0,
            pageNumber: 1,
            isCoverPage: true,
            status: PageProcessingStatus.PROCESSED,
            storageKey: `batches/${batchId}/derived/1/page.png`,
            qrStudentId: 'ROLL-ALICE',
            qrDecodeOutcome: 'found',
            omrStudentId: 'ROLL-BOB',
            omrDecodeOutcome: 'found'
        });

        const scripts = await service.assembleAndMapAnswerScripts(batchId, {
            actingUserId: profUser._id.toString(),
            actingUserRole: 'PROFESSOR'
        });

        expect(scripts.length).toBe(1);
        const script = scripts[0];
        expect(script.student?.toString()).toBe(studentA._id.toString()); // QR Wins
        expect(script.identificationSource).toBe(IdentificationSource.QR);
        expect(script.hasIdentificationConflict).toBe(true); // Conflict recorded
        expect(script.qrStudentId).toBe('ROLL-ALICE');
        expect(script.omrStudentId).toBe('ROLL-BOB');
    });

    it('precedence: OMR is used when QR does not produce a usable student ID', async () => {
        const batchId = `batch-precedence-3-${Date.now()}`;
        await createTestBatch(batchId);

        await IngestionPage.create({
            batchId,
            job: defaultJobId,
            fileId: 'file-1',
            fileIndex: 0,
            pageNumber: 1,
            isCoverPage: true,
            status: PageProcessingStatus.PROCESSED,
            storageKey: `batches/${batchId}/derived/1/page.png`,
            qrStudentId: null,
            qrDecodeOutcome: 'not_found',
            omrStudentId: 'ROLL-BOB',
            omrDecodeOutcome: 'found'
        });

        const scripts = await service.assembleAndMapAnswerScripts(batchId, {
            actingUserId: profUser._id.toString(),
            actingUserRole: 'PROFESSOR'
        });

        expect(scripts.length).toBe(1);
        const script = scripts[0];
        expect(script.student?.toString()).toBe(studentB._id.toString()); // OMR Wins
        expect(script.identificationSource).toBe(IdentificationSource.OMR);
        expect(script.hasIdentificationConflict).toBe(false);
        expect(script.qrStudentId).toBeNull();
        expect(script.omrStudentId).toBe('ROLL-BOB');
    });

    it('precedence: manual/operator override can override automated QR result and updates history', async () => {
        const batchId = `batch-manual-1-${Date.now()}`;
        await createTestBatch(batchId);

        await IngestionPage.create({
            batchId,
            job: defaultJobId,
            fileId: 'file-1',
            fileIndex: 0,
            pageNumber: 1,
            isCoverPage: true,
            status: PageProcessingStatus.PROCESSED,
            storageKey: `batches/${batchId}/derived/1/page.png`,
            qrStudentId: 'ROLL-ALICE',
            qrDecodeOutcome: 'found'
        });

        const scripts = await service.assembleAndMapAnswerScripts(batchId, {
            actingUserId: profUser._id.toString(),
            actingUserRole: 'PROFESSOR'
        });

        expect(scripts[0].student?.toString()).toBe(studentA._id.toString());
        expect(scripts[0].identificationSource).toBe(IdentificationSource.QR);

        // Perform manual override using identifyRoute
        mockSessionUser = {
            id: profUser._id.toString(),
            role: UserRole.PROFESSOR,
            email: profUser.email
        };

        const req = new NextRequest(`http://localhost:3000/api/answerscripts/${scripts[0]._id}/identify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ studentId: studentB._id.toString() })
        });

        const res = await identifyRoute(req, { params: Promise.resolve({ id: scripts[0]._id.toString() }) });
        expect(res.status).toBe(200);

        const updatedScript = await AnswerScript.findById(scripts[0]._id);
        expect(updatedScript?.student?.toString()).toBe(studentB._id.toString());
        expect(updatedScript?.identificationSource).toBe(IdentificationSource.OPERATOR);

        // Verify history contains previous automated QR identity
        expect(updatedScript?.identificationHistory.length).toBe(1);
        expect(updatedScript?.identificationHistory[0].student?.toString()).toBe(studentA._id.toString());
        expect(updatedScript?.identificationHistory[0].identificationSource).toBe(IdentificationSource.QR);
    });

    it('reprocessing a page with manual override preserves operator override but updates diagnostics', async () => {
        const batchId = `batch-reprocess-${Date.now()}`;
        await createTestBatch(batchId);

        const page = await IngestionPage.create({
            batchId,
            job: defaultJobId,
            fileId: 'file-1',
            fileIndex: 0,
            pageNumber: 1,
            isCoverPage: true,
            status: PageProcessingStatus.PROCESSED,
            storageKey: `batches/${batchId}/derived/1/page.png`,
            qrStudentId: 'ROLL-ALICE',
            qrDecodeOutcome: 'found'
        });

        let scripts = await service.assembleAndMapAnswerScripts(batchId, {
            actingUserId: profUser._id.toString(),
            actingUserRole: 'PROFESSOR'
        });

        // Manual override to Bob
        mockSessionUser = {
            id: profUser._id.toString(),
            role: UserRole.PROFESSOR,
            email: profUser.email
        };

        const req = new NextRequest(`http://localhost:3000/api/answerscripts/${scripts[0]._id}/identify`, {
            method: 'POST',
            body: JSON.stringify({ studentId: studentB._id.toString() })
        });

        await identifyRoute(req, { params: Promise.resolve({ id: scripts[0]._id.toString() }) });

        // Update IngestionPage to different QR and OMR (reprocessing simulation)
        page.qrStudentId = 'ROLL-ALICE';
        page.omrStudentId = 'ROLL-BOB';
        page.omrDecodeOutcome = 'found';
        await page.save();

        // Reprocess
        scripts = await service.assembleAndMapAnswerScripts(batchId, {
            actingUserId: profUser._id.toString(),
            actingUserRole: 'PROFESSOR'
        });

        const script = scripts[0];
        expect(script.student?.toString()).toBe(studentB._id.toString()); // Bob (OPERATOR override preserved)
        expect(script.identificationSource).toBe(IdentificationSource.OPERATOR);
        // Diagnostics updated:
        expect(script.qrStudentId).toBe('ROLL-ALICE');
        expect(script.omrStudentId).toBe('ROLL-BOB');
        expect(script.hasIdentificationConflict).toBe(true);
    });

    it('verify IdentificationSource.OMR is distinct from IdentificationSource.OCR', () => {
        expect(IdentificationSource.OMR).toBe('OMR');
        expect(IdentificationSource.OCR).toBe('OCR');
        expect(IdentificationSource.OMR).not.toBe(IdentificationSource.OCR);
    });
});
