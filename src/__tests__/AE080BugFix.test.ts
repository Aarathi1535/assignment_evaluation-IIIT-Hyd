/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import AnswerScript, { IdentificationSource, IdentificationStatus } from '../models/AnswerScript';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import Batch, { BatchStatus } from '../models/Batch';
import Exam, { ExamStatus, SplittingStrategyType, IngestionApprovalStatus } from '../models/Exam';
import Course from '../models/Course';
import StudentMapping from '../models/StudentMapping';
import User, { UserRole } from '../models/User';
import defaultStudentRosterMappingService from '../services/StudentRosterMappingService';

describe('AE-080 — Ingestion Correctness & Robustness Bug Fixes', () => {
    let profUser: any;
    let studentAlice: any;
    let studentBob: any;
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
        defaultJobId = new mongoose.Types.ObjectId();

        // Create professor and students
        profUser = await User.create({
            name: 'Prof Snape',
            email: `prof-${Date.now()}@hogwarts.edu`,
            password: 'hashedpassword',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        studentAlice = await User.create({
            name: 'Alice Granger',
            email: `alice-${Date.now()}@hogwarts.edu`,
            password: 'hashedpassword',
            role: UserRole.STUDENT,
            isActive: true
        });

        studentBob = await User.create({
            name: 'Bob Potter',
            email: `bob-${Date.now()}@hogwarts.edu`,
            password: 'hashedpassword',
            role: UserRole.STUDENT,
            isActive: true
        });

        course = await Course.create({
            courseCode: `POTIONS-${Date.now()}`,
            courseName: 'Potions Masterclass',
            professor: profUser._id,
            semester: 1,
            academicYear: '2026-2027',
            enrolledStudents: [studentAlice._id, studentBob._id],
            isActive: true
        });

        exam = await Exam.create({
            title: 'Midterm Potions Exam',
            course: course._id,
            createdBy: profUser._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 5,
            splittingStrategy: SplittingStrategyType.COVER_PAGE,
            enrolledStudents: [studentAlice._id, studentBob._id],
            isActive: true
        });

        await StudentMapping.create([
            {
                exam: exam._id,
                student: studentAlice._id,
                rollNumber: 'ROLL-ALICE',
                anonymousId: 'ANON-ALICE',
                isVerified: true
            },
            {
                exam: exam._id,
                student: studentBob._id,
                rollNumber: 'ROLL-BOB',
                anonymousId: 'ANON-BOB',
                isVerified: true
            }
        ]);
    });

    describe('1. Dangling Obsolete AnswerScripts Cleanup', () => {
        it('should physically delete obsolete AnswerScript records when strategy or cover sheets change', async () => {
            const batchId = `batch-dangling-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-1',
                        fileIndex: 0,
                        originalFilename: 'exam_mixed.pdf',
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

            // Initial state: Page 1 and Page 3 are cover pages
            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-1',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    qrStudentId: 'ROLL-ALICE',
                    qrDecodeOutcome: 'found',
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
                    isCoverPage: true,
                    qrStudentId: 'ROLL-BOB',
                    qrDecodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/3/page.png`
                }
            ]);

            // Run assembly first time
            const firstResult = await defaultStudentRosterMappingService.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(firstResult.length).toBe(2);

            // Verify both scripts exist in database
            const dbScriptsBefore = await AnswerScript.find({ batchId, isActive: true });
            expect(dbScriptsBefore.length).toBe(2);

            // Modify Page 3: make it no longer a cover page
            await IngestionPage.updateOne(
                { batchId, pageNumber: 3 },
                { $set: { isCoverPage: false, qrStudentId: null, qrDecodeOutcome: null } }
            );

            // Run assembly second time
            const secondResult = await defaultStudentRosterMappingService.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(secondResult.length).toBe(1);

            // Verify database state: the obsolete script (starting at page 3) must NOT be active
            const dbScriptsActive = await AnswerScript.find({ batchId, isActive: true });
            expect(dbScriptsActive.length).toBe(1);
            expect(dbScriptsActive[0].startPageNumber).toBe(1);
            expect(dbScriptsActive[0].endPageNumber).toBe(3);

            // F2 Soft deletion verification:
            // Obsolete AnswerScript should still exist in database but with isActive === false and student === null
            const allDbScripts = await AnswerScript.find({ batchId });
            expect(allDbScripts.length).toBe(2);

            const deactivatedScript = allDbScripts.find(s => !s.isActive);
            expect(deactivatedScript).toBeDefined();
            expect(deactivatedScript?.startPageNumber).toBe(3);
            expect(deactivatedScript?.student).toBeNull();
        });
    });

    describe('2. Precedence Overwrite on Reprocessing', () => {
        it('should allow higher-precedence QR identification to overwrite stale automatic OMR identification on re-runs', async () => {
            const batchId = `batch-precedence-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-1',
                        fileIndex: 0,
                        originalFilename: 'exam_precedence.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 5000,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/0/file-1.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 5000,
                totalPageCount: 2,
                status: BatchStatus.PROCESSING
            });

            // Initial: Only OMR detected (Alice)
            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-1',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    omrStudentId: 'ROLL-ALICE',
                    omrDecodeOutcome: 'found',
                    qrStudentId: null,
                    qrDecodeOutcome: null,
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
                }
            ]);

            // Run assembly first time: should identify as Alice via OMR
            const firstResult = await defaultStudentRosterMappingService.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(firstResult.length).toBe(1);
            expect(firstResult[0].student?.toString()).toBe(studentAlice._id.toString());
            expect(firstResult[0].identificationSource).toBe(IdentificationSource.OMR);

            // Reprocess / retry with higher-precedence QR code found (Bob)
            await IngestionPage.updateOne(
                { batchId, pageNumber: 1 },
                {
                    $set: {
                        qrStudentId: 'ROLL-BOB',
                        qrDecodeOutcome: 'found'
                    }
                }
            );

            // Run assembly second time
            const secondResult = await defaultStudentRosterMappingService.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(secondResult.length).toBe(1);
            // QR should overwrite the stale automatic OMR identification
            expect(secondResult[0].student?.toString()).toBe(studentBob._id.toString());
            expect(secondResult[0].identificationSource).toBe(IdentificationSource.QR);
        });

        it('should NOT overwrite manual OPERATOR identification overrides with new QR/OMR scans', async () => {
            const batchId = `batch-manual-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-1',
                        fileIndex: 0,
                        originalFilename: 'exam_manual.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 5000,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/0/file-1.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 5000,
                totalPageCount: 2,
                status: BatchStatus.PROCESSING
            });

            // Initial: No codes found
            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-1',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
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
                }
            ]);

            // Run assembly first time: should remain unidentified
            const firstResult = await defaultStudentRosterMappingService.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(firstResult.length).toBe(1);
            expect(firstResult[0].student).toBeNull();
            expect(firstResult[0].needsManualId).toBe(true);

            // Manual override: operator assigns student Alice
            await AnswerScript.updateOne(
                { batchId, startPageNumber: 1 },
                {
                    $set: {
                        student: studentAlice._id,
                        identificationSource: IdentificationSource.OPERATOR,
                        identificationStatus: IdentificationStatus.IDENTIFIED,
                        needsManualId: false,
                        manualIdReason: null
                    }
                }
            );

            // Now a retry scans OMR and finds Bob
            await IngestionPage.updateOne(
                { batchId, pageNumber: 1 },
                {
                    $set: {
                        omrStudentId: 'ROLL-BOB',
                        omrDecodeOutcome: 'found'
                    }
                }
            );

            // Run assembly second time
            const secondResult = await defaultStudentRosterMappingService.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(secondResult.length).toBe(1);
            // Must preserve the manual operator override (Alice) and NOT overwrite with automatic Bob
            expect(secondResult[0].student?.toString()).toBe(studentAlice._id.toString());
            expect(secondResult[0].identificationSource).toBe(IdentificationSource.OPERATOR);
        });
    });

    describe('3. Regression Tests — AE-080 Review Feedback', () => {
        // F1 Regression Test
        it('F1: should overwrite existing student identity when a QR re-scan resolves to a different student at equal precedence', async () => {
            const batchId = `batch-f1-equal-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-1',
                        fileIndex: 0,
                        originalFilename: 'exam_f1.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 5000,
                        pageCount: 2,
                        storageKey: `batches/${batchId}/0/file-1.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 5000,
                totalPageCount: 2,
                status: BatchStatus.PROCESSING
            });

            // Step 1: Assemble/ingest a cover page whose QR resolves to ROLL-ALICE
            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-1',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    qrStudentId: 'ROLL-ALICE',
                    qrDecodeOutcome: 'found',
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
                }
            ]);

            // Run assembly first time
            const firstResult = await defaultStudentRosterMappingService.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            // Step 2: Verify the script is bound to Alice
            expect(firstResult.length).toBe(1);
            expect(firstResult[0].student?.toString()).toBe(studentAlice._id.toString());
            expect(firstResult[0].identificationSource).toBe(IdentificationSource.QR);

            // Step 3: Correct/re-scan the same cover page so the QR resolves to ROLL-BOB
            await IngestionPage.updateOne(
                { batchId, pageNumber: 1 },
                { $set: { qrStudentId: 'ROLL-BOB' } }
            );

            // Step 4: Re-run assembly/mapping
            const secondResult = await defaultStudentRosterMappingService.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            // Step 5: Verify the same script is now bound to Bob
            expect(secondResult.length).toBe(1);
            expect(secondResult[0].student?.toString()).toBe(studentBob._id.toString());
            expect(secondResult[0].identificationSource).toBe(IdentificationSource.QR);

            // Step 6: Verify the stale Alice binding is not retained
            const allScripts = await AnswerScript.find({ batchId });
            expect(allScripts.length).toBe(1);
            expect(allScripts[0].student?.toString()).not.toBe(studentAlice._id.toString());
        });

        // F2 Regression Test A & B & C
        it('F2: should soft-delete obsolete scripts, preserve related Grade/Allocation records, and keep active scripts active', async () => {
            const batchId = `batch-f2-soft-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [
                    {
                        fileId: 'file-1',
                        fileIndex: 0,
                        originalFilename: 'exam_f2.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 5000,
                        pageCount: 4,
                        storageKey: `batches/${batchId}/0/file-1.pdf`
                    }
                ],
                totalFiles: 1,
                totalSize: 5000,
                totalPageCount: 4,
                status: BatchStatus.PROCESSING
            });

            // Create initial cover pages at Page 1 (Alice) and Page 3 (Bob)
            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-1',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    qrStudentId: 'ROLL-ALICE',
                    qrDecodeOutcome: 'found',
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
                    isCoverPage: true,
                    qrStudentId: 'ROLL-BOB',
                    qrDecodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/3/page.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'file-1',
                    fileIndex: 0,
                    pageNumber: 4,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/4/page.png`
                }
            ]);

            // Run assembly first time: creates 2 scripts (Alice & Bob)
            const firstResult = await defaultStudentRosterMappingService.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(firstResult.length).toBe(2);
            const scriptAlice = firstResult.find(s => s.startPageNumber === 1)!;
            const scriptBob = firstResult.find(s => s.startPageNumber === 3)!;

            const { default: Grade } = await import('../models/Grade');
            const { default: Allocation } = await import('../models/Allocation');

            const mockTa = await User.create({
                name: 'TA Lupin',
                email: `ta-${Date.now()}@hogwarts.edu`,
                password: 'password',
                role: UserRole.TA,
                isActive: true
            });

            const allocation = await Allocation.create({
                exam: exam._id,
                ta: mockTa._id,
                answerScript: scriptBob._id,
                allocatedBy: profUser._id
            });

            const grade = await Grade.create({
                answerScript: scriptBob._id,
                rubric: new mongoose.Types.ObjectId(),
                gradedBy: mockTa._id,
                marksAwarded: [],
                totalScore: 80
            });

            // Modify Page 3: make it no longer a cover page, so scriptBob becomes obsolete
            await IngestionPage.updateOne(
                { batchId, pageNumber: 3 },
                { $set: { isCoverPage: false, qrStudentId: null, qrDecodeOutcome: null } }
            );

            // Run assembly second time: only 1 script should be returned (Alice)
            const secondResult = await defaultStudentRosterMappingService.assembleAndMapAnswerScripts(batchId, {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            });

            expect(secondResult.length).toBe(1);

            // Test C: Verify active scripts still present in processedScriptIds remain active
            const activeAlice = await AnswerScript.findById(scriptAlice._id);
            expect(activeAlice?.isActive).toBe(true);
            expect(activeAlice?.student?.toString()).toBe(studentAlice._id.toString());

            // Test A: Verify the obsolete script (Bob) still exists in the database but with isActive === false
            const obsoleteBob = await AnswerScript.findById(scriptBob._id);
            expect(obsoleteBob).not.toBeNull();
            expect(obsoleteBob?.isActive).toBe(false);
            expect(obsoleteBob?.student).toBeNull();

            // Test B: Verify related Grade/Allocation are preserved and NOT orphaned/deleted
            const persistedAllocation = await Allocation.findById(allocation._id);
            expect(persistedAllocation).not.toBeNull();
            expect(persistedAllocation?.answerScript.toString()).toBe(scriptBob._id.toString());

            const persistedGrade = await Grade.findById(grade._id);
            expect(persistedGrade).not.toBeNull();
            expect(persistedGrade?.answerScript.toString()).toBe(scriptBob._id.toString());
        });

        // Ingestion Approval protection test
        it('should throw 409 error when trying to run assembly on an approved exam', async () => {
            const batchId = `batch-approved-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: exam._id,
                files: [],
                totalFiles: 0,
                totalSize: 0,
                totalPageCount: 0,
                status: BatchStatus.PROCESSING
            });

            // Approve exam
            await Exam.findByIdAndUpdate(exam._id, {
                ingestionApprovalStatus: IngestionApprovalStatus.APPROVED
            });

            // Run assembly: should throw 409 HttpError
            await expect(
                defaultStudentRosterMappingService.assembleAndMapAnswerScripts(batchId, {
                    actingUserId: profUser._id.toString(),
                    actingUserRole: 'PROFESSOR'
                })
            ).rejects.toThrowError(/approved/i);
        });
    });
});
