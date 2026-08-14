/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import AnswerScript, { IdentificationSource, IdentificationStatus, ManualIdReason } from '../models/AnswerScript';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import Batch, { BatchStatus } from '../models/Batch';
import Exam, { ExamStatus, SplittingStrategyType } from '../models/Exam';
import Course from '../models/Course';
import StudentMapping from '../models/StudentMapping';
import User, { UserRole } from '../models/User';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import ExamRepository from '../repositories/ExamRepository';
import { StudentRosterMappingService } from '../services/StudentRosterMappingService';
import { IngestionWorker } from '../services/IngestionWorker';
import { HttpError } from '../lib/errors';
import { SYSTEM_PRINCIPAL_ID, SYSTEM_ROLE, SYSTEM_AUDIT_CONTEXT } from '../constants/permissions';

describe('AE-051 — Map Decoded ID → Roster Student', () => {
    let service: StudentRosterMappingService;
    let profUser: any;
    let otherProfUser: any;
    let enrolledStudent1: any;
    let enrolledStudent2: any;
    let unenrolledStudent: any;
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

        // Create test users
        profUser = await User.create({
            name: 'Prof Alpha',
            email: `prof-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        otherProfUser = await User.create({
            name: 'Prof Beta',
            email: `prof-other-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        enrolledStudent1 = await User.create({
            name: 'Alice Student',
            email: `alice-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.STUDENT,
            isActive: true
        });

        enrolledStudent2 = await User.create({
            name: 'Bob Student',
            email: `bob-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.STUDENT,
            isActive: true
        });

        unenrolledStudent = await User.create({
            name: 'Charlie Outsider',
            email: `charlie-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.STUDENT,
            isActive: true
        });

        // Create course
        course = await Course.create({
            courseCode: `CS-${Date.now()}`,
            courseName: 'Data Structures',
            semester: 1,
            academicYear: '2026-2027',
            professor: profUser._id,
            teachingAssistants: [],
            enrolledStudents: [enrolledStudent1._id, enrolledStudent2._id],
            isActive: true
        });

        // Create exam
        exam = await Exam.create({
            title: 'Midterm Exam 2026',
            course: course._id,
            createdBy: profUser._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 5,
            enrolledStudents: [enrolledStudent1._id, enrolledStudent2._id],
            isActive: true
        });

        // Create StudentMapping for anonymous ID matching
        await StudentMapping.create({
            exam: exam._id,
            student: enrolledStudent1._id,
            anonymousId: 'ANON-ALICE-99',
            isVerified: true
        });
    });

    describe('1. SUCCESS: Valid Candidate Identification & Roster Resolution', () => {
        it('resolves enrolled student by candidate user ObjectId string and creates AnswerScript', async () => {
            const batchId = `batch-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-1',
                        fileIndex: 0,
                        originalFilename: 'exam_alice.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 5000,
                        pageCount: 3,
                        storageKey: `batches/${batchId}/0/file-1.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 5000,
                totalPageCount: 3,
                status: BatchStatus.PROCESSING
            });

            // Create 3 ingestion pages: Page 1 cover with candidateStudentId = enrolledStudent1._id
            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-1',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    candidateStudentId: enrolledStudent1._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/1/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-1',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/2/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-1',
                    fileIndex: 0,
                    pageNumber: 3,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/3/page.png`
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(1);
            const script = scripts[0];
            expect(script.exam.toString()).toBe(exam._id.toString());
            expect(script.student?.toString()).toBe(enrolledStudent1._id.toString());
            expect(script.batchId).toBe(batchId);
            expect(script.fileIndex).toBe(0);
            expect(script.startPageNumber).toBe(1);
            expect(script.endPageNumber).toBe(3);
            expect(script.pageCount).toBe(3);
            expect(script.candidateStudentId).toBe(enrolledStudent1._id.toString());
            expect(script.decodeOutcome).toBe('found');
            expect(script.needsManualId).toBe(false);
            expect(script.isActive).toBe(true);
        });

        it('resolves enrolled student by email string case-insensitively', async () => {
            const batchId = `batch-email-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-bob',
                        fileIndex: 0,
                        originalFilename: 'exam_bob.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 2000,
                        pageCount: 1,
                        storageKey: `batches/${batchId}/0/bob.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 2000,
                totalPageCount: 1,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create({
                batchId,
                job: defaultJobId,
                fileId: 'file-bob',
                fileIndex: 0,
                pageNumber: 1,
                isCoverPage: true,
                candidateStudentId: enrolledStudent2.email.toUpperCase(),
                decodeOutcome: 'found',
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${batchId}/derived/1/page.png`
            });

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(1);
            expect(scripts[0].student?.toString()).toBe(enrolledStudent2._id.toString());
        });

        it('resolves enrolled student by anonymousId from StudentMapping', async () => {
            const batchId = `batch-anon-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-anon',
                        fileIndex: 0,
                        originalFilename: 'anon_script.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 3000,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/0/anon.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 3000,
                totalPageCount: 2,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-anon',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    candidateStudentId: 'ANON-ALICE-99',
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/1/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-anon',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/2/page.png`
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(1);
            expect(scripts[0].student?.toString()).toBe(enrolledStudent1._id.toString());
        });
    });

    describe('2. GROUPING: Contiguous Page Assembly from Cover Boundaries', () => {
        it('groups multiple covers across multiple files into separate AnswerScripts in canonical order', async () => {
            const batchId = `batch-multi-cover-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'f0',
                        fileIndex: 0,
                        originalFilename: 'file0.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 1000,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/0/file0.pdf`
                    },
                    {
                        fileId: 'f1',
                        fileIndex: 1,
                        originalFilename: 'file1.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 1000,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/1/file1.pdf`
                    }
                ],
                totalFiles: 2,
                totalSize: 2000,
                totalPageCount: 4,
                status: BatchStatus.PROCESSING
            });

            // File 0: Cover at page 1, followed by page 2
            // File 1: Cover at page 1, followed by page 2
            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    candidateStudentId: enrolledStudent1._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/0/1/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/0/2/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f1',
                    fileIndex: 1,
                    pageNumber: 1,
                    isCoverPage: true,
                    candidateStudentId: enrolledStudent2._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/1/1/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f1',
                    fileIndex: 1,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/1/2/page.png`
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(2);

            expect(scripts[0].fileIndex).toBe(0);
            expect(scripts[0].startPageNumber).toBe(1);
            expect(scripts[0].endPageNumber).toBe(2);
            expect(scripts[0].pageCount).toBe(2);
            expect(scripts[0].student?.toString()).toBe(enrolledStudent1._id.toString());

            expect(scripts[1].fileIndex).toBe(1);
            expect(scripts[1].startPageNumber).toBe(1);
            expect(scripts[1].endPageNumber).toBe(2);
            expect(scripts[1].pageCount).toBe(2);
            expect(scripts[1].student?.toString()).toBe(enrolledStudent2._id.toString());
        });

        it('returns empty array when no cover pages are detected in the batch', async () => {
            const batchId = `batch-no-cover-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'f-nocover',
                        fileIndex: 0,
                        originalFilename: 'nocover.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 500,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/0/nocover.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 500,
                totalPageCount: 2,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f-nocover',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/0/1/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f-nocover',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/0/2/page.png`
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(0);
        });
    });

    describe('3. ROSTER FAILURE: Unenrolled or Non-Existent Candidate IDs', () => {
        it('persists AnswerScript with student: null when candidate identifier does not exist in User collection', async () => {
            const batchId = `batch-unknown-id-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'f-unknown',
                        fileIndex: 0,
                        originalFilename: 'unknown.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 800,
                        pageCount: 1,
                        storageKey: `batches/${batchId}/0/unknown.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 800,
                totalPageCount: 1,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create({
                batchId,
                job: defaultJobId,
                fileId: 'f-unknown',
                fileIndex: 0,
                pageNumber: 1,
                isCoverPage: true,
                candidateStudentId: 'NON_EXISTENT_STU_9999',
                decodeOutcome: 'found',
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${batchId}/derived/0/1/page.png`
            });

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(1);
            expect(scripts[0].student).toBeNull();
            expect(scripts[0].candidateStudentId).toBe('NON_EXISTENT_STU_9999');
            expect(scripts[0].needsManualId).toBe(true);
            expect(scripts[0].manualIdReason).toBe('NOT_IN_ROSTER');
        });

        it('persists AnswerScript with student: null when user exists but is NOT enrolled in the exam', async () => {
            const batchId = `batch-not-enrolled-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'f-unenrolled',
                        fileIndex: 0,
                        originalFilename: 'unenrolled.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 800,
                        pageCount: 1,
                        storageKey: `batches/${batchId}/0/unenrolled.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 800,
                totalPageCount: 1,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create({
                batchId,
                job: defaultJobId,
                fileId: 'f-unenrolled',
                fileIndex: 0,
                pageNumber: 1,
                isCoverPage: true,
                candidateStudentId: unenrolledStudent._id.toString(),
                decodeOutcome: 'found',
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${batchId}/derived/0/1/page.png`
            });

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(1);
            expect(scripts[0].student).toBeNull();
            expect(scripts[0].candidateStudentId).toBe(unenrolledStudent._id.toString());
            expect(scripts[0].needsManualId).toBe(true);
            expect(scripts[0].manualIdReason).toBe('NOT_IN_ROSTER');
        });
    });

    describe('4. DUPLICATE: Preserving (exam, student) Uniqueness on Conflict', () => {
        it('does not overwrite existing script or violate unique index when student is already mapped', async () => {
            // Pre-create existing AnswerScript for Alice on this exam
            const existingScript = await AnswerScript.create({
                exam: exam._id,
                student: enrolledStudent1._id,
                batchId: 'old-batch-1',
                fileIndex: 0,
                startPageNumber: 1,
                endPageNumber: 2,
                pageCount: 2,
                filePath: '/old/path.pdf',
                filename: 'old.pdf'
            });

            const batchId = `batch-dup-alice-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'f-dup',
                        fileIndex: 0,
                        originalFilename: 'alice_duplicate.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 1200,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/0/dup.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 1200,
                totalPageCount: 2,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f-dup',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    candidateStudentId: enrolledStudent1._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/0/1/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f-dup',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/0/2/page.png`
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(1);
            const newScript = scripts[0];

            // New script must NOT overwrite existing script or have student assigned
            expect(newScript._id.toString()).not.toBe(existingScript._id.toString());
            expect(newScript.student).toBeNull();
            expect(newScript.candidateStudentId).toBe(enrolledStudent1._id.toString());
            expect(newScript.needsManualId).toBe(true);
            expect(newScript.manualIdReason).toBe('DUPLICATE_STUDENT');

            // Original script must remain untouched
            const originalInDb = await AnswerScript.findById(existingScript._id);
            expect(originalInDb?.student?.toString()).toBe(enrolledStudent1._id.toString());
        });
    });

    describe('5. IDEMPOTENCY: Deterministic Source Identity Replay', () => {
        it('resolves to the same AnswerScript when reprocessing the same batch', async () => {
            const batchId = `batch-idempotent-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'f-idem',
                        fileIndex: 0,
                        originalFilename: 'idempotent.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 900,
                        pageCount: 1,
                        storageKey: `batches/${batchId}/0/idem.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 900,
                totalPageCount: 1,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create({
                batchId,
                job: defaultJobId,
                fileId: 'f-idem',
                fileIndex: 0,
                pageNumber: 1,
                isCoverPage: true,
                candidateStudentId: enrolledStudent2._id.toString(),
                decodeOutcome: 'found',
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${batchId}/derived/0/1/page.png`
            });

            // First run
            const firstRun = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });
            expect(firstRun.length).toBe(1);
            const firstScriptId = firstRun[0]._id.toString();

            // Second run (reprocessing / retry)
            const secondRun = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });
            expect(secondRun.length).toBe(1);
            expect(secondRun[0]._id.toString()).toBe(firstScriptId);

            // Total documents in DB must be exactly 1 for this source identity
            const count = await AnswerScript.countDocuments({
                batchId,
                fileIndex: 0,
                startPageNumber: 1
            });
            expect(count).toBe(1);
        });
    });

    describe('6. OWNER SCOPING & AUTHORIZATION: Scoped Access Enforcement', () => {
        let scopingBatchId: string;

        beforeEach(async () => {
            scopingBatchId = `batch-scoping-${Date.now()}-${Math.random()}`;
            await Batch.create({
                batchId: scopingBatchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'f-scope',
                        fileIndex: 0,
                        originalFilename: 'scoping.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 1000,
                        pageCount: 1,
                        storageKey: `batches/${scopingBatchId}/0/scope.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 1000,
                totalPageCount: 1,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create({
                batchId: scopingBatchId,
                job: defaultJobId,
                fileId: 'f-scope',
                fileIndex: 0,
                pageNumber: 1,
                isCoverPage: true,
                candidateStudentId: enrolledStudent1._id.toString(),
                decodeOutcome: 'found',
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${scopingBatchId}/derived/0/1/page.png`
            });
        });

        it('A. Missing authorization context: rejects safely with 401 without performing unscoped lookup', async () => {
            const examFindOneSpy = vi.spyOn(Exam, 'findOne');

            // 1. Missing context (undefined)
            await expect(
                service.assembleAndMapAnswerScripts(scopingBatchId)
            ).rejects.toThrow('Authorization context required');

            // 2. Empty context object
            await expect(
                service.assembleAndMapAnswerScripts(scopingBatchId, {} as any)
            ).rejects.toThrow('Authorization context required');

            // Assert that Exam.findOne was never called in an unscoped manner
            expect(examFindOneSpy).not.toHaveBeenCalled();
            examFindOneSpy.mockRestore();
        });

        it('B. Partial context: rejects when actingUserId or actingUserRole is missing or blank', async () => {
            // actingUserId without actingUserRole
            await expect(
                service.assembleAndMapAnswerScripts(scopingBatchId, {
                    actingUserId: profUser._id.toString()
                } as any)
            ).rejects.toThrow('Authorization context required');

            // actingUserRole without actingUserId
            await expect(
                service.assembleAndMapAnswerScripts(scopingBatchId, {
                    actingUserRole: 'PROFESSOR'
                } as any)
            ).rejects.toThrow('Authorization context required');

            // Empty string values
            await expect(
                service.assembleAndMapAnswerScripts(scopingBatchId, {
                    actingUserId: '   ',
                    actingUserRole: 'PROFESSOR'
                })
            ).rejects.toThrow('Authorization context required');

            await expect(
                service.assembleAndMapAnswerScripts(scopingBatchId, {
                    actingUserId: profUser._id.toString(),
                    actingUserRole: '   '
                })
            ).rejects.toThrow('Authorization context required');
        });

        it('C. SYSTEM worker context: background assembly succeeds through repository authorization path', async () => {
            const getExamByIdSpy = vi.spyOn(ExamRepository, 'getExamById');

            const scripts = await service.assembleAndMapAnswerScripts(
                scopingBatchId,
                SYSTEM_AUDIT_CONTEXT
            );

            expect(scripts.length).toBe(1);
            expect(scripts[0].student?.toString()).toBe(enrolledStudent1._id.toString());
            expect(scripts[0].exam.toString()).toBe(exam._id.toString());
            expect(scripts[0].needsManualId).toBe(false);

            // Verified it went through ExamRepository.getExamById
            expect(getExamByIdSpy).toHaveBeenCalledWith(
                exam._id.toString(),
                SYSTEM_PRINCIPAL_ID,
                SYSTEM_ROLE
            );

            getExamByIdSpy.mockRestore();
        });

        it('D. Owner professor context: authorized professor succeeds', async () => {
            const scripts = await service.assembleAndMapAnswerScripts(scopingBatchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });
            expect(scripts.length).toBe(1);
            expect(scripts[0].student?.toString()).toBe(enrolledStudent1._id.toString());
        });

        it('E. Wrong professor: denied with 404', async () => {
            await expect(
                service.assembleAndMapAnswerScripts(scopingBatchId, {
                    actingUserId: otherProfUser._id.toString(),
                    actingUserRole: 'PROFESSOR'
                })
            ).rejects.toThrow(HttpError);

            try {
                await service.assembleAndMapAnswerScripts(scopingBatchId, {
                    actingUserId: otherProfUser._id.toString(),
                    actingUserRole: 'PROFESSOR'
                });
            } catch (err: any) {
                expect(err.statusCode).toBe(404);
            }
        });
    });

    describe('7. SCHEMA: Multiple Unidentified Scripts Persist Cleanly', () => {
        it('allows multiple unidentified scripts (student: null) for the same exam without unique key collision', async () => {
            const script1 = await AnswerScript.create({
                exam: exam._id,
                student: null,
                batchId: 'unidentified-b1',
                fileIndex: 0,
                startPageNumber: 1,
                endPageNumber: 2,
                pageCount: 2
            });

            const script2 = await AnswerScript.create({
                exam: exam._id,
                student: null,
                batchId: 'unidentified-b2',
                fileIndex: 0,
                startPageNumber: 1,
                endPageNumber: 2,
                pageCount: 2
            });

            expect(script1._id).toBeDefined();
            expect(script2._id).toBeDefined();
            expect(script1._id.toString()).not.toBe(script2._id.toString());
        });
    });

    describe('8. End-to-End Integration with IngestionWorker', () => {
        it('automatically triggers AnswerScript assembly when ingestion job reaches status DONE', async () => {
            const batchId = `batch-e2e-worker-${Date.now()}`;
            const batch = await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-e2e',
                        fileIndex: 0,
                        originalFilename: 'e2e.png',
                        fileType: 'image/png',
                        mimeType: 'image/png',
                        size: 2048,
                        pageCount: 1,
                        storageKey: `batches/${batchId}/0/file-e2e.png`
                    }
                ],
                totalFiles: 1,
                totalSize: 2048,
                totalPageCount: 1,
                status: BatchStatus.PROCESSING
            });

            const job = await IngestionJob.create({
                batchId,
                batch: batch._id,
                status: IngestionStatus.QUEUED,
                totalPages: 1,
                processedPages: 0,
                failedPages: 0,
                attempts: 0,
                maxRetries: 3,
                uploadedBy: profUser._id
            });

            // Mock page ingestion service to simulate page 1 processed with cover sheet
            const mockPageIngestionService = {
                getRenderer: () => ({
                    getPageCount: async () => 1
                }),
                processPage: async () => {
                    await IngestionPage.create({
                        batchId,
                        job: job._id,
                        fileId: 'file-e2e',
                        fileIndex: 0,
                        pageNumber: 1,
                        isCoverPage: true,
                        candidateStudentId: enrolledStudent1._id.toString(),
                        decodeOutcome: 'found',
                        status: PageProcessingStatus.PROCESSED,
                        storageKey: `batches/${batchId}/derived/0/1/page.png`
                    });
                    return { success: true, status: PageProcessingStatus.PROCESSED };
                }
            } as any;

            const worker = new IngestionWorker({
                workerId: 'test-worker-e2e',
                pageIngestionService: mockPageIngestionService,
                studentRosterMappingService: service
            });

            const res = await worker.processNextJob();
            expect(res.processed).toBe(true);
            expect(res.status).toBe(IngestionStatus.DONE);

            // Verify AnswerScript was assembled automatically
            const createdScripts = await AnswerScript.find({ batchId });
            expect(createdScripts.length).toBe(1);
            expect(createdScripts[0].student?.toString()).toBe(enrolledStudent1._id.toString());
            expect(createdScripts[0].exam.toString()).toBe(exam._id.toString());
            expect(createdScripts[0].candidateStudentId).toBe(enrolledStudent1._id.toString());
            expect(createdScripts[0].identificationSource).toBe(IdentificationSource.QR);
            expect(createdScripts[0].identificationStatus).toBe(IdentificationStatus.IDENTIFIED);
        });
    });

    describe('9. GitHub Issue #39 — Script-Level Identification Contract', () => {
        it('promotes QR candidate from IngestionPage to AnswerScript with identificationSource = "QR" and identificationStatus = "IDENTIFIED"', async () => {
            const batchId = `batch-issue39-identified-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-qr',
                        fileIndex: 0,
                        originalFilename: 'exam_qr.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 4000,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/0/exam_qr.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 4000,
                totalPageCount: 2,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-qr',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    candidateStudentId: enrolledStudent1._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/1/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-qr',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/2/page.png`
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(1);
            const script = scripts[0];
            expect(script.candidateStudentId).toBe(enrolledStudent1._id.toString());
            expect(script.identificationSource).toBe(IdentificationSource.QR);
            expect(script.identificationStatus).toBe(IdentificationStatus.IDENTIFIED);
            expect(script.student?.toString()).toBe(enrolledStudent1._id.toString());
            expect(script.needsManualId).toBe(false);
            expect(script.manualIdReason).toBeNull();

            // Verify persistence in DB
            const persisted = await AnswerScript.findById(script._id);
            expect(persisted).not.toBeNull();
            expect(persisted?.candidateStudentId).toBe(enrolledStudent1._id.toString());
            expect(persisted?.identificationSource).toBe('QR');
            expect(persisted?.identificationStatus).toBe('IDENTIFIED');
        });

        it('persists unidentified AnswerScript when no QR candidate is available', async () => {
            const batchId = `batch-issue39-no-candidate-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-nocode',
                        fileIndex: 0,
                        originalFilename: 'nocode.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 3000,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/0/nocode.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 3000,
                totalPageCount: 2,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-nocode',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    candidateStudentId: null,
                    decodeOutcome: 'not_found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/1/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-nocode',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/2/page.png`
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(1);
            const script = scripts[0];
            expect(script.candidateStudentId).toBeNull();
            expect(script.identificationSource).toBeNull();
            expect(script.identificationStatus).toBe(IdentificationStatus.UNIDENTIFIED);
            expect(script.student).toBeNull();
            expect(script.needsManualId).toBe(true);
            expect(script.manualIdReason).toBe(ManualIdReason.NO_CODE_FOUND);

            // Verify persistence in DB
            const persisted = await AnswerScript.findById(script._id);
            expect(persisted).not.toBeNull();
            expect(persisted?.candidateStudentId).toBeNull();
            expect(persisted?.identificationSource).toBeNull();
            expect(persisted?.identificationStatus).toBe('UNIDENTIFIED');
        });

        it('persists unidentified AnswerScript when multiple codes are detected', async () => {
            const batchId = `batch-issue39-multiple-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-multi',
                        fileIndex: 0,
                        originalFilename: 'multi.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 3000,
                        pageCount: 1,
                        storageKey: `batches/${batchId}/0/multi.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 3000,
                totalPageCount: 1,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create({
                batchId,
                job: defaultJobId,
                fileId: 'file-multi',
                fileIndex: 0,
                pageNumber: 1,
                isCoverPage: true,
                candidateStudentId: null,
                decodeOutcome: 'multiple',
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${batchId}/derived/1/page.png`
            });

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(1);
            const script = scripts[0];
            expect(script.candidateStudentId).toBeNull();
            expect(script.identificationSource).toBeNull();
            expect(script.identificationStatus).toBe(IdentificationStatus.UNIDENTIFIED);
            expect(script.student).toBeNull();
            expect(script.needsManualId).toBe(true);
            expect(script.manualIdReason).toBe(ManualIdReason.MULTIPLE_CODES);
        });

        it('preserves candidateStudentId and identificationSource = "QR" when roster matching fails (NOT_IN_ROSTER)', async () => {
            const batchId = `batch-issue39-notinroster-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-unregistered',
                        fileIndex: 0,
                        originalFilename: 'unregistered.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 2500,
                        pageCount: 1,
                        storageKey: `batches/${batchId}/0/unregistered.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 2500,
                totalPageCount: 1,
                status: BatchStatus.PROCESSING
            });

            const unregisteredCandidate = 'UNKNOWN_CANDIDATE_12345';
            await IngestionPage.create({
                batchId,
                job: defaultJobId,
                fileId: 'file-unregistered',
                fileIndex: 0,
                pageNumber: 1,
                isCoverPage: true,
                candidateStudentId: unregisteredCandidate,
                decodeOutcome: 'found',
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${batchId}/derived/1/page.png`
            });

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(1);
            const script = scripts[0];
            // candidate and source MUST be preserved
            expect(script.candidateStudentId).toBe(unregisteredCandidate);
            expect(script.identificationSource).toBe(IdentificationSource.QR);
            expect(script.identificationStatus).toBe(IdentificationStatus.UNIDENTIFIED);
            expect(script.student).toBeNull();
            expect(script.needsManualId).toBe(true);
            expect(script.manualIdReason).toBe(ManualIdReason.NOT_IN_ROSTER);

            // Verify in DB
            const persisted = await AnswerScript.findById(script._id);
            expect(persisted?.candidateStudentId).toBe(unregisteredCandidate);
            expect(persisted?.identificationSource).toBe('QR');
            expect(persisted?.identificationStatus).toBe('UNIDENTIFIED');
            expect(persisted?.student).toBeNull();
        });

        it('preserves candidateStudentId and identificationSource = "QR" on duplicate conflict (DUPLICATE_STUDENT)', async () => {
            // Pre-create existing AnswerScript for Alice
            await AnswerScript.create({
                exam: exam._id,
                student: enrolledStudent1._id,
                batchId: 'previous-batch',
                fileIndex: 0,
                startPageNumber: 1,
                endPageNumber: 2,
                pageCount: 2,
                candidateStudentId: enrolledStudent1._id.toString(),
                identificationSource: IdentificationSource.QR,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                filePath: '/prev/path.pdf',
                filename: 'alice_prev.pdf'
            });

            const batchId = `batch-issue39-duplicate-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-dup',
                        fileIndex: 0,
                        originalFilename: 'alice_second.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 2500,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/0/alice_second.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 2500,
                totalPageCount: 2,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-dup',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    candidateStudentId: enrolledStudent1._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/1/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-dup',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/2/page.png`
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(1);
            const script = scripts[0];
            // candidate and source preserved even though resolution became DUPLICATE_STUDENT
            expect(script.candidateStudentId).toBe(enrolledStudent1._id.toString());
            expect(script.identificationSource).toBe(IdentificationSource.QR);
            expect(script.identificationStatus).toBe(IdentificationStatus.UNIDENTIFIED);
            expect(script.student).toBeNull();
            expect(script.needsManualId).toBe(true);
            expect(script.manualIdReason).toBe(ManualIdReason.DUPLICATE_STUDENT);
        });

        it('repeated assembly remains idempotent and preserves identification contract fields', async () => {
            const batchId = `batch-issue39-idempotent-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-idemp',
                        fileIndex: 0,
                        originalFilename: 'exam_idemp.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 3500,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/0/exam_idemp.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 3500,
                totalPageCount: 2,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-idemp',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    candidateStudentId: enrolledStudent2._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/1/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-idemp',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/2/page.png`
                }
            ]);

            // Run 1
            const run1 = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            // Run 2
            const run2 = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(run1.length).toBe(1);
            expect(run2.length).toBe(1);
            expect(run1[0]._id.toString()).toBe(run2[0]._id.toString());
            expect(run2[0].candidateStudentId).toBe(enrolledStudent2._id.toString());
            expect(run2[0].identificationSource).toBe(IdentificationSource.QR);
            expect(run2[0].identificationStatus).toBe(IdentificationStatus.IDENTIFIED);
            expect(run2[0].student?.toString()).toBe(enrolledStudent2._id.toString());

            const totalDocs = await AnswerScript.countDocuments({ batchId });
            expect(totalDocs).toBe(1);
        });
    });

    describe('10. AE-055 — Fixed-Page Script Splitting Integration', () => {
        let fixedExam: any;

        beforeEach(async () => {
            fixedExam = await Exam.create({
                title: 'Fixed Midterm 2026',
                course: course._id,
                createdBy: profUser._id,
                examDate: new Date(),
                totalMarks: 100,
                status: ExamStatus.SCHEDULED,
                numberOfQuestions: 5,
                enrolledStudents: [enrolledStudent1._id, enrolledStudent2._id],
                splittingStrategy: SplittingStrategyType.FIXED_PAGE,
                fixedPageCount: 2,
                isActive: true
            });
        });

        it('splits pages into fixed sizes and identifies students correctly', async () => {
            const batchId = `batch-fixed-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: fixedExam._id,
                files: [
                    {
                        fileId: 'file-fixed',
                        fileIndex: 0,
                        originalFilename: 'fixed_exam.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 5000,
                        pageCount: 5,
                        storageKey: `batches/${batchId}/0/fixed.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 5000,
                totalPageCount: 5,
                status: BatchStatus.PROCESSING
            });

            // Create 5 pages.
            // Page 1: cover for script 1 (has student 1's ID)
            // Page 2: script 1 regular page
            // Page 3: cover for script 2 (has student 2's ID)
            // Page 4: script 2 regular page
            // Page 5: cover for script 3 (incomplete, size 1, has student 1's ID)
            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-fixed',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: false,
                    candidateStudentId: enrolledStudent1._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/1/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-fixed',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/2/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-fixed',
                    fileIndex: 0,
                    pageNumber: 3,
                    isCoverPage: false,
                    candidateStudentId: enrolledStudent2._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/3/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-fixed',
                    fileIndex: 0,
                    pageNumber: 4,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/4/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-fixed',
                    fileIndex: 0,
                    pageNumber: 5,
                    isCoverPage: false,
                    candidateStudentId: enrolledStudent1._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/5/page.png`
                }
            ]);

            const scripts = await service.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(scripts.length).toBe(3);

            // Script 1 (pages 1-2): Complete, student identified
            expect(scripts[0].startPageNumber).toBe(1);
            expect(scripts[0].endPageNumber).toBe(2);
            expect(scripts[0].pageCount).toBe(2);
            expect(scripts[0].student?.toString()).toBe(enrolledStudent1._id.toString());
            expect(scripts[0].needsManualId).toBe(false);

            // Script 2 (pages 3-4): Complete, student identified
            expect(scripts[1].startPageNumber).toBe(3);
            expect(scripts[1].endPageNumber).toBe(4);
            expect(scripts[1].pageCount).toBe(2);
            expect(scripts[1].student?.toString()).toBe(enrolledStudent2._id.toString());
            expect(scripts[1].needsManualId).toBe(false);

            // Script 3 (page 5): Incomplete (size 1 < N=2), marked for manual review
            expect(scripts[2].startPageNumber).toBe(5);
            expect(scripts[2].endPageNumber).toBe(5);
            expect(scripts[2].pageCount).toBe(1);
            expect(scripts[2].needsManualId).toBe(true);
            expect(scripts[2].manualIdReason).toBe(ManualIdReason.INCOMPLETE_SCRIPT);
            expect(scripts[2].student).toBeNull();
        });

        it('rejects processing if fixedPageCount configuration is invalid', async () => {
            // Set invalid fixedPageCount on the exam using direct update to bypass model validation if any
            await Exam.updateOne({ _id: fixedExam._id }, { $set: { fixedPageCount: 0 } });

            const batchId = `batch-fixed-invalid-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: fixedExam._id,
                files: [
                    {
                        fileId: 'file-fixed',
                        fileIndex: 0,
                        originalFilename: 'fixed_exam.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 1000,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/0/fixed.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 1000,
                totalPageCount: 2,
                status: BatchStatus.PROCESSING
            });

            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-fixed',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/1/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-fixed',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/2/page.png`
                }
            ]);

            await expect(
                service.assembleAndMapAnswerScripts(batchId, {
                    actingUserId: profUser._id.toString(),
                    actingUserRole: 'PROFESSOR'
                })
            ).rejects.toThrow(HttpError);
        });
    });
});

