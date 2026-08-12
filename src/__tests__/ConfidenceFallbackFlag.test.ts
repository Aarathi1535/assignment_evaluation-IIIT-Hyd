/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import AnswerScript, { ManualIdReason } from '../models/AnswerScript';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import Batch, { BatchStatus } from '../models/Batch';
import Exam, { ExamStatus } from '../models/Exam';
import Course from '../models/Course';
import StudentMapping from '../models/StudentMapping';
import User, { UserRole } from '../models/User';
import { StudentRosterMappingService } from '../services/StudentRosterMappingService';

describe('AE-053 — Confidence + Fallback Flag', () => {
    let service: StudentRosterMappingService;
    let profUser: any;
    let enrolledStudent1: any;
    let enrolledStudent2: any;
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

        profUser = await User.create({
            name: 'Prof Confidence Test',
            email: `prof-ae053-${Date.now()}-${Math.random()}@university.edu`,
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        enrolledStudent1 = await User.create({
            name: 'Enrolled Alice',
            email: `alice-ae053-${Date.now()}-${Math.random()}@university.edu`,
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        enrolledStudent2 = await User.create({
            name: 'Enrolled Bob',
            email: `bob-ae053-${Date.now()}-${Math.random()}@university.edu`,
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        course = await Course.create({
            courseCode: `CS-AE053-${Date.now()}`,
            courseName: 'Evaluation Engineering',
            semester: 1,
            academicYear: '2026-2027',
            professor: profUser._id,
            enrolledStudents: [enrolledStudent1._id, enrolledStudent2._id],
            isActive: true
        });

        exam = await Exam.create({
            title: 'AE-053 Final Exam',
            course: course._id,
            createdBy: profUser._id,
            examDate: new Date('2026-10-01T00:00:00.000Z'),
            totalMarks: 100,
            numberOfQuestions: 5,
            status: ExamStatus.SCHEDULED,
            enrolledStudents: [enrolledStudent1._id, enrolledStudent2._id],
            isActive: true
        });

        // Student 1 mapped with anonymous ID
        await StudentMapping.create({
            exam: exam._id,
            student: enrolledStudent1._id,
            anonymousId: 'ANON-ALICE-053',
            isVerified: true
        });
    });

    describe('1. Five Explicit Identification Outcomes', () => {
        it('Outcome A: SUCCESSFULLY_IDENTIFIED — assigns student, needsManualId=false, manualIdReason=null', async () => {
            const batchId = `batch-identified-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'f0',
                        fileIndex: 0,
                        originalFilename: 'alice_submission.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        storageKey: `batches/${batchId}/0.pdf`,
                        pageCount: 2,
                        size: 2048,
                        sequenceNumber: 1
                    }
                ],
                totalFiles: 1,
                totalSize: 2048,
                totalPageCount: 2,
                status: BatchStatus.DONE,
                isActive: true
            });

            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 1,
                    storageKey: `batches/${batchId}/pages/0_1.png`,
                    status: PageProcessingStatus.PROCESSED,
                    isCoverPage: true,
                    candidateStudentId: 'ANON-ALICE-053',
                    decodeOutcome: 'found'
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 2,
                    storageKey: `batches/${batchId}/pages/0_2.png`,
                    status: PageProcessingStatus.PROCESSED,
                    isCoverPage: false,
                    candidateStudentId: null,
                    decodeOutcome: null
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId);

            expect(scripts.length).toBe(1);
            const script = scripts[0];

            expect(script.student?.toString()).toBe(enrolledStudent1._id.toString());
            expect(script.needsManualId).toBe(false);
            expect(script.manualIdReason).toBeNull();
            expect(script.candidateStudentId).toBe('ANON-ALICE-053');
            expect(script.startPageNumber).toBe(1);
            expect(script.endPageNumber).toBe(2);
            expect(script.pageCount).toBe(2);
        });

        it('Outcome B: NO_CODE_FOUND — persists script with student=null, needsManualId=true, manualIdReason="NO_CODE_FOUND"', async () => {
            const batchId = `batch-nocode-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'f0',
                        fileIndex: 0,
                        originalFilename: 'unidentified.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        storageKey: `batches/${batchId}/0.pdf`,
                        pageCount: 1,
                        size: 1024,
                        sequenceNumber: 1
                    }
                ],
                totalFiles: 1,
                totalSize: 1024,
                totalPageCount: 1,
                status: BatchStatus.DONE,
                isActive: true
            });

            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 1,
                    storageKey: `batches/${batchId}/pages/0_1.png`,
                    status: PageProcessingStatus.PROCESSED,
                    isCoverPage: true,
                    candidateStudentId: null,
                    decodeOutcome: 'not_found'
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId);

            expect(scripts.length).toBe(1);
            const script = scripts[0];

            expect(script.student).toBeNull();
            expect(script.needsManualId).toBe(true);
            expect(script.manualIdReason).toBe(ManualIdReason.NO_CODE_FOUND);
            expect(script.candidateStudentId).toBeNull();
        });

        it('Outcome C: MULTIPLE_CODES — persists script with student=null, needsManualId=true, manualIdReason="MULTIPLE_CODES"', async () => {
            const batchId = `batch-multi-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'f0',
                        fileIndex: 0,
                        originalFilename: 'multiple_codes.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        storageKey: `batches/${batchId}/0.pdf`,
                        pageCount: 1,
                        size: 1024,
                        sequenceNumber: 1
                    }
                ],
                totalFiles: 1,
                totalSize: 1024,
                totalPageCount: 1,
                status: BatchStatus.DONE,
                isActive: true
            });

            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 1,
                    storageKey: `batches/${batchId}/pages/0_1.png`,
                    status: PageProcessingStatus.PROCESSED,
                    isCoverPage: true,
                    candidateStudentId: null,
                    decodeOutcome: 'multiple',
                    metadata: { detectedCount: 2, codes: ['STU-01', 'STU-02'] }
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId);

            expect(scripts.length).toBe(1);
            const script = scripts[0];

            expect(script.student).toBeNull();
            expect(script.needsManualId).toBe(true);
            expect(script.manualIdReason).toBe(ManualIdReason.MULTIPLE_CODES);
            expect(script.decodeOutcome).toBe('multiple');
        });

        it('Outcome D: NOT_IN_ROSTER — persists script with student=null, needsManualId=true, manualIdReason="NOT_IN_ROSTER", preserving candidate identifier', async () => {
            const batchId = `batch-outsider-${Date.now()}`;
            const unknownCandidate = 'STU-UNKNOWN-9999';

            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'f0',
                        fileIndex: 0,
                        originalFilename: 'outsider.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        storageKey: `batches/${batchId}/0.pdf`,
                        pageCount: 1,
                        size: 1024,
                        sequenceNumber: 1
                    }
                ],
                totalFiles: 1,
                totalSize: 1024,
                totalPageCount: 1,
                status: BatchStatus.DONE,
                isActive: true
            });

            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 1,
                    storageKey: `batches/${batchId}/pages/0_1.png`,
                    status: PageProcessingStatus.PROCESSED,
                    isCoverPage: true,
                    candidateStudentId: unknownCandidate,
                    decodeOutcome: 'found'
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId);

            expect(scripts.length).toBe(1);
            const script = scripts[0];

            expect(script.student).toBeNull();
            expect(script.needsManualId).toBe(true);
            expect(script.manualIdReason).toBe(ManualIdReason.NOT_IN_ROSTER);
            expect(script.candidateStudentId).toBe(unknownCandidate);
        });

        it('Outcome E: DUPLICATE_STUDENT — preserves original script untouched, persists second script with student=null, DUPLICATE_STUDENT, preserving candidate identifier', async () => {
            // 1. First script already identified for Alice
            const existingScript = await AnswerScript.create({
                exam: exam._id,
                student: enrolledStudent1._id,
                batchId: 'batch-original',
                fileIndex: 0,
                startPageNumber: 1,
                endPageNumber: 2,
                pageCount: 2,
                candidateStudentId: enrolledStudent1._id.toString(),
                decodeOutcome: 'found',
                needsManualId: false,
                manualIdReason: null,
                isActive: true
            });

            // 2. Second batch arrives with another submission for Alice
            const duplicateBatchId = `batch-duplicate-${Date.now()}`;
            await Batch.create({
                batchId: duplicateBatchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'f0',
                        fileIndex: 0,
                        originalFilename: 'alice_duplicate_submission.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        storageKey: `batches/${duplicateBatchId}/0.pdf`,
                        pageCount: 2,
                        size: 2048,
                        sequenceNumber: 1
                    }
                ],
                totalFiles: 1,
                totalSize: 2048,
                totalPageCount: 2,
                status: BatchStatus.DONE,
                isActive: true
            });

            await IngestionPage.create([
                {
                    batchId: duplicateBatchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 1,
                    storageKey: `batches/${duplicateBatchId}/pages/0_1.png`,
                    status: PageProcessingStatus.PROCESSED,
                    isCoverPage: true,
                    candidateStudentId: enrolledStudent1._id.toString(),
                    decodeOutcome: 'found'
                },
                {
                    batchId: duplicateBatchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 2,
                    storageKey: `batches/${duplicateBatchId}/pages/0_2.png`,
                    status: PageProcessingStatus.PROCESSED,
                    isCoverPage: false
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(duplicateBatchId);

            expect(scripts.length).toBe(1);
            const duplicateScript = scripts[0];

            // Verify duplicate script properties
            expect(duplicateScript._id.toString()).not.toBe(existingScript._id.toString());
            expect(duplicateScript.student).toBeNull();
            expect(duplicateScript.needsManualId).toBe(true);
            expect(duplicateScript.manualIdReason).toBe(ManualIdReason.DUPLICATE_STUDENT);
            expect(duplicateScript.candidateStudentId).toBe(enrolledStudent1._id.toString());

            // Verify original script is completely untouched
            const originalInDb = await AnswerScript.findById(existingScript._id);
            expect(originalInDb).toBeDefined();
            expect(originalInDb!.student?.toString()).toBe(enrolledStudent1._id.toString());
            expect(originalInDb!.needsManualId).toBe(false);
            expect(originalInDb!.manualIdReason).toBeNull();
        });
    });

    describe('2. Partial Unique Index & Ingestion Integrity', () => {
        it('allows multiple unidentified scripts (student: null) for the same exam without violating unique index', async () => {
            const batchId = `batch-unidentified-multi-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    { fileId: 'f0', fileIndex: 0, originalFilename: 'doc0.pdf', fileType: 'pdf', mimeType: 'application/pdf', storageKey: `batches/${batchId}/0.pdf`, pageCount: 1, size: 1000, sequenceNumber: 1 },
                    { fileId: 'f1', fileIndex: 1, originalFilename: 'doc1.pdf', fileType: 'pdf', mimeType: 'application/pdf', storageKey: `batches/${batchId}/1.pdf`, pageCount: 1, size: 1000, sequenceNumber: 2 },
                    { fileId: 'f2', fileIndex: 2, originalFilename: 'doc2.pdf', fileType: 'pdf', mimeType: 'application/pdf', storageKey: `batches/${batchId}/2.pdf`, pageCount: 1, size: 1000, sequenceNumber: 3 }
                ],
                totalFiles: 3,
                totalSize: 3000,
                totalPageCount: 3,
                status: BatchStatus.DONE,
                isActive: true
            });

            await IngestionPage.create([
                { batchId, job: defaultJobId, fileId: 'f0', fileIndex: 0, pageNumber: 1, storageKey: `batches/${batchId}/pages/0_1.png`, isCoverPage: true, decodeOutcome: 'not_found', status: PageProcessingStatus.PROCESSED },
                { batchId, job: defaultJobId, fileId: 'f1', fileIndex: 1, pageNumber: 1, storageKey: `batches/${batchId}/pages/1_1.png`, isCoverPage: true, decodeOutcome: 'multiple', status: PageProcessingStatus.PROCESSED },
                { batchId, job: defaultJobId, fileId: 'f2', fileIndex: 2, pageNumber: 1, storageKey: `batches/${batchId}/pages/2_1.png`, isCoverPage: true, decodeOutcome: 'found', candidateStudentId: 'UNKNOWN-ID', status: PageProcessingStatus.PROCESSED }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId);

            expect(scripts.length).toBe(3);

            // All 3 scripts must have student=null and different manualIdReason
            expect(scripts[0].student).toBeNull();
            expect(scripts[0].manualIdReason).toBe(ManualIdReason.NO_CODE_FOUND);

            expect(scripts[1].student).toBeNull();
            expect(scripts[1].manualIdReason).toBe(ManualIdReason.MULTIPLE_CODES);

            expect(scripts[2].student).toBeNull();
            expect(scripts[2].manualIdReason).toBe(ManualIdReason.NOT_IN_ROSTER);

            // Verify all 3 persisted in database for this exam
            const countInDb = await AnswerScript.countDocuments({ exam: exam._id, student: null });
            expect(countInDb).toBe(3);
        });

        it('guarantees associated IngestionPage records remain completely intact after AnswerScript assembly', async () => {
            const batchId = `batch-page-integrity-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    { fileId: 'f0', fileIndex: 0, originalFilename: 'script.pdf', fileType: 'pdf', mimeType: 'application/pdf', storageKey: `batches/${batchId}/0.pdf`, pageCount: 2, size: 2000, sequenceNumber: 1 }
                ],
                totalFiles: 1,
                totalSize: 2000,
                totalPageCount: 2,
                status: BatchStatus.DONE,
                isActive: true
            });

            const page1 = await IngestionPage.create({
                batchId,
                job: defaultJobId,
                fileId: 'f0',
                fileIndex: 0,
                pageNumber: 1,
                storageKey: `batches/${batchId}/pages/0_1.png`,
                status: PageProcessingStatus.PROCESSED,
                isCoverPage: true,
                candidateStudentId: 'UNKNOWN-ROSTER-999',
                decodeOutcome: 'found'
            });

            const page2 = await IngestionPage.create({
                batchId,
                job: defaultJobId,
                fileId: 'f0',
                fileIndex: 0,
                pageNumber: 2,
                storageKey: `batches/${batchId}/pages/0_2.png`,
                status: PageProcessingStatus.PROCESSED,
                isCoverPage: false
            });

            await service.assembleAndMapAnswerScripts(batchId);

            // IngestionPages must not have been modified, corrupted, or deleted
            const page1After = await IngestionPage.findById(page1._id);
            const page2After = await IngestionPage.findById(page2._id);

            expect(page1After?.status).toBe(PageProcessingStatus.PROCESSED);
            expect(page1After?.candidateStudentId).toBe('UNKNOWN-ROSTER-999');
            expect(page1After?.isCoverPage).toBe(true);

            expect(page2After?.status).toBe(PageProcessingStatus.PROCESSED);
            expect(page2After?.isCoverPage).toBe(false);
        });
    });
});
