/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import AnswerScript, { ManualIdReason } from '../../models/AnswerScript';
import IngestionPage, { PageProcessingStatus } from '../../models/IngestionPage';
import Batch, { BatchStatus } from '../../models/Batch';
import Exam, { ExamStatus, SplittingStrategyType } from '../../models/Exam';
import Course from '../../models/Course';
import StudentMapping from '../../models/StudentMapping';
import User, { UserRole } from '../../models/User';
import { StudentRosterMappingService } from '../../services/StudentRosterMappingService';

describe('AE-057 — Integration test: batch -> N scripts mapped', () => {
    let service: StudentRosterMappingService;
    let profUser: any;
    let studentUser1: any;
    let studentUser2: any;
    let course: any;
    let coverExam: any;
    let fixedExam: any;
    const defaultJobId = new mongoose.Types.ObjectId();

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

        profUser = await User.create({
            name: 'Prof Alpha',
            email: `prof-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        studentUser1 = await User.create({
            name: 'Alice Student',
            email: `alice-${Date.now()}@university.edu`,
            password: 'hashed-password',
            role: UserRole.STUDENT,
            isActive: true
        });

        studentUser2 = await User.create({
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
            enrolledStudents: [studentUser1._id, studentUser2._id],
            isActive: true
        });

        coverExam = await Exam.create({
            title: 'Cover Exam Midterm',
            course: course._id,
            createdBy: profUser._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 5,
            enrolledStudents: [studentUser1._id, studentUser2._id],
            splittingStrategy: SplittingStrategyType.COVER_PAGE,
            isActive: true
        });

        fixedExam = await Exam.create({
            title: 'Fixed Exam Midterm',
            course: course._id,
            createdBy: profUser._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 5,
            enrolledStudents: [studentUser1._id, studentUser2._id],
            splittingStrategy: SplittingStrategyType.FIXED_PAGE,
            fixedPageCount: 3,
            isActive: true
        });
    });

    describe('Cover-page Scenario', () => {
        it('should correctly assemble, order, link and persist AnswerScripts and handle boundary updates and idempotency', async () => {
            const batchId = `batch-cover-e2e-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: coverExam._id,
                files: [
                    {
                        fileId: 'f0',
                        fileIndex: 0,
                        originalFilename: 'file0.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 1000,
                        pageCount: 4,
                        storageKey: `batches/${batchId}/0/file0.pdf`
                    },
                    {
                        fileId: 'f1',
                        fileIndex: 1,
                        originalFilename: 'file1.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 1000,
                        pageCount: 3,
                        storageKey: `batches/${batchId}/1/file1.pdf`
                    }
                ],
                totalFiles: 2,
                totalSize: 2000,
                totalPageCount: 7,
                status: BatchStatus.PROCESSING
            });

            // Pages in File 0:
            // Page 1: Cover (Alice)
            // Page 2: Normal
            // Page 3: Cover (Bob)
            // Page 4: Normal
            // Pages in File 1:
            // Page 1: Cover (Alice) -> Duplicate student Alice, but must still split & persist
            // Page 2: Normal
            // Page 3: Normal
            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: true,
                    candidateStudentId: studentUser1._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f0_1.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f0_2.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 3,
                    isCoverPage: true,
                    candidateStudentId: studentUser2._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f0_3.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 4,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f0_4.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f1',
                    fileIndex: 1,
                    pageNumber: 1,
                    isCoverPage: true,
                    candidateStudentId: studentUser1._id.toString(),
                    decodeOutcome: 'found',
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f1_1.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f1',
                    fileIndex: 1,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f1_2.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f1',
                    fileIndex: 1,
                    pageNumber: 3,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f1_3.png`
                }
            ]);

            const auditCtx = {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            };

            // Run 1
            const firstRun = await service.assembleAndMapAnswerScripts(batchId, auditCtx);

            // Assert number of scripts
            expect(firstRun.length).toBe(3);

            // Assert canonical ordering of returned scripts
            // Script 1: File 0, Start 1, Page count 2
            expect(firstRun[0].fileIndex).toBe(0);
            expect(firstRun[0].startPageNumber).toBe(1);
            expect(firstRun[0].endPageNumber).toBe(2);
            expect(firstRun[0].pageCount).toBe(2);

            // Script 2: File 0, Start 3, Page count 2
            expect(firstRun[1].fileIndex).toBe(0);
            expect(firstRun[1].startPageNumber).toBe(3);
            expect(firstRun[1].endPageNumber).toBe(4);
            expect(firstRun[1].pageCount).toBe(2);

            // Script 3: File 1, Start 1, Page count 3
            expect(firstRun[2].fileIndex).toBe(1);
            expect(firstRun[2].startPageNumber).toBe(1);
            expect(firstRun[2].endPageNumber).toBe(3);
            expect(firstRun[2].pageCount).toBe(3);

            // Verify script persistence in MongoDB
            for (const script of firstRun) {
                const persisted = await AnswerScript.findById(script._id);
                expect(persisted).not.toBeNull();
                expect(persisted?.batchId).toBe(batchId);
            }

            // Verify page-to-script mappings and ensure pages inside each script remain in canonical order
            const pages = await IngestionPage.find({ batchId }).sort({ fileIndex: 1, pageNumber: 1 });
            expect(pages.length).toBe(7);

            // Check script references on pages
            const s1Id = firstRun[0]._id.toString();
            const s2Id = firstRun[1]._id.toString();
            const s3Id = firstRun[2]._id.toString();

            expect(pages[0].answerScript?.toString()).toBe(s1Id); // File 0, Page 1
            expect(pages[1].answerScript?.toString()).toBe(s1Id); // File 0, Page 2
            expect(pages[2].answerScript?.toString()).toBe(s2Id); // File 0, Page 3
            expect(pages[3].answerScript?.toString()).toBe(s2Id); // File 0, Page 4
            expect(pages[4].answerScript?.toString()).toBe(s3Id); // File 1, Page 1
            expect(pages[5].answerScript?.toString()).toBe(s3Id); // File 1, Page 2
            expect(pages[6].answerScript?.toString()).toBe(s3Id); // File 1, Page 3

            // Assert pages are not cross-linked
            expect(pages[0].answerScript?.toString()).not.toBe(s2Id);
            expect(pages[0].answerScript?.toString()).not.toBe(s3Id);
            expect(pages[2].answerScript?.toString()).not.toBe(s1Id);
            expect(pages[4].answerScript?.toString()).not.toBe(s1Id);

            // Run 2: Idempotency (run again)
            const secondRun = await service.assembleAndMapAnswerScripts(batchId, auditCtx);
            expect(secondRun.length).toBe(3);
            
            // Check that AnswerScript IDs remain identical (no duplicates created)
            expect(secondRun[0]._id.toString()).toBe(s1Id);
            expect(secondRun[1]._id.toString()).toBe(s2Id);
            expect(secondRun[2]._id.toString()).toBe(s3Id);

            // Check total document count of AnswerScripts in DB for this batch is still 3
            const scriptCount = await AnswerScript.countDocuments({ batchId });
            expect(scriptCount).toBe(3);

            // Run 3: Boundary change (make File 0, Page 2 ALSO a cover page)
            await IngestionPage.updateOne(
                { batchId, fileIndex: 0, pageNumber: 2 },
                { $set: { isCoverPage: true, candidateStudentId: studentUser1._id.toString(), decodeOutcome: 'found' } }
            );

            const thirdRun = await service.assembleAndMapAnswerScripts(batchId, auditCtx);
            // File 0:
            // Page 1: Cover (Alice) -> Script A (pages: [1])
            // Page 2: Cover (Alice) -> Script B (pages: [2])
            // Page 3: Cover (Bob) -> Script C (pages: [3, 4])
            // File 1:
            // Page 1: Cover (Alice) -> Script D (pages: [1, 2, 3])
            expect(thirdRun.length).toBe(4);

            // Assert that stale page links are replaced correctly
            const updatedPages = await IngestionPage.find({ batchId }).sort({ fileIndex: 1, pageNumber: 1 });
            const finalScriptIds = thirdRun.map(s => s._id.toString());

            expect(updatedPages[0].answerScript?.toString()).toBe(finalScriptIds[0]); // File 0, Page 1
            expect(updatedPages[1].answerScript?.toString()).toBe(finalScriptIds[1]); // File 0, Page 2
            expect(updatedPages[2].answerScript?.toString()).toBe(finalScriptIds[2]); // File 0, Page 3
            expect(updatedPages[3].answerScript?.toString()).toBe(finalScriptIds[2]); // File 0, Page 4
            expect(updatedPages[4].answerScript?.toString()).toBe(finalScriptIds[3]); // File 1, Page 1

            // Ensure Page 2 does not link to the original script (finalScriptIds[0]) anymore
            expect(updatedPages[1].answerScript?.toString()).not.toBe(finalScriptIds[0]);
        });
    });

    describe('Fixed-page Scenario', () => {
        it('should correctly split, map, order and handle boundary updates and idempotency', async () => {
            const batchId = `batch-fixed-e2e-${Date.now()}`;
            await Batch.create({
                batchId,
                uploadedBy: profUser._id,
                exam: fixedExam._id, // fixedPageCount: 3
                files: [
                    {
                        fileId: 'f0',
                        fileIndex: 0,
                        originalFilename: 'file0.pdf',
                        fileType: 'pdf',
                        mimeType: 'application/pdf',
                        size: 1000,
                        pageCount: 5,
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
                totalPageCount: 7,
                status: BatchStatus.PROCESSING
            });

            // Create pages for File 0 (5 pages) and File 1 (2 pages)
            await IngestionPage.create([
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 1,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f0_1.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f0_2.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 3,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f0_3.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 4,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f0_4.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f0',
                    fileIndex: 0,
                    pageNumber: 5,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f0_5.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f1',
                    fileIndex: 1,
                    pageNumber: 1,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f1_1.png`
                },
                {
                    batchId,
                    job: defaultJobId,
                    fileId: 'f1',
                    fileIndex: 1,
                    pageNumber: 2,
                    isCoverPage: false,
                    status: PageProcessingStatus.PROCESSED,
                    storageKey: `batches/${batchId}/derived/f1_2.png`
                }
            ]);

            const auditCtx = {
                actingUserId: profUser._id.toString(),
                actingUserRole: 'PROFESSOR'
            };

            // Run 1
            const firstRun = await service.assembleAndMapAnswerScripts(batchId, auditCtx);

            // fixedPageCount = 3.
            // File 0: 5 pages -> Script 1 (pages 1-3, complete), Script 2 (pages 4-5, incomplete)
            // File 1: 2 pages -> Script 3 (pages 1-2, incomplete)
            expect(firstRun.length).toBe(3);

            // Script 1 assertions
            expect(firstRun[0].fileIndex).toBe(0);
            expect(firstRun[0].startPageNumber).toBe(1);
            expect(firstRun[0].endPageNumber).toBe(3);
            expect(firstRun[0].pageCount).toBe(3);
            expect(firstRun[0].needsManualId).toBe(true);
            expect(firstRun[0].manualIdReason).toBe(ManualIdReason.NO_CODE_FOUND);

            // Script 2 assertions (incomplete script)
            expect(firstRun[1].fileIndex).toBe(0);
            expect(firstRun[1].startPageNumber).toBe(4);
            expect(firstRun[1].endPageNumber).toBe(5);
            expect(firstRun[1].pageCount).toBe(2);
            expect(firstRun[1].needsManualId).toBe(true);
            expect(firstRun[1].manualIdReason).toBe(ManualIdReason.INCOMPLETE_SCRIPT);

            // Script 3 assertions (incomplete script)
            expect(firstRun[2].fileIndex).toBe(1);
            expect(firstRun[2].startPageNumber).toBe(1);
            expect(firstRun[2].endPageNumber).toBe(2);
            expect(firstRun[2].pageCount).toBe(2);
            expect(firstRun[2].needsManualId).toBe(true);
            expect(firstRun[2].manualIdReason).toBe(ManualIdReason.INCOMPLETE_SCRIPT);

            // Verify persistence in MongoDB
            for (const script of firstRun) {
                const persisted = await AnswerScript.findById(script._id);
                expect(persisted).not.toBeNull();
                expect(persisted?.pageCount).toBe(script.pageCount);
            }

            // Verify page-to-script mappings
            const pages = await IngestionPage.find({ batchId }).sort({ fileIndex: 1, pageNumber: 1 });
            expect(pages.length).toBe(7);

            const s1Id = firstRun[0]._id.toString();
            const s2Id = firstRun[1]._id.toString();
            const s3Id = firstRun[2]._id.toString();

            expect(pages[0].answerScript?.toString()).toBe(s1Id); // File 0, Page 1
            expect(pages[1].answerScript?.toString()).toBe(s1Id); // File 0, Page 2
            expect(pages[2].answerScript?.toString()).toBe(s1Id); // File 0, Page 3
            expect(pages[3].answerScript?.toString()).toBe(s2Id); // File 0, Page 4
            expect(pages[4].answerScript?.toString()).toBe(s2Id); // File 0, Page 5
            expect(pages[5].answerScript?.toString()).toBe(s3Id); // File 1, Page 1
            expect(pages[6].answerScript?.toString()).toBe(s3Id); // File 1, Page 2

            // Run 2: Idempotency (run again)
            const secondRun = await service.assembleAndMapAnswerScripts(batchId, auditCtx);
            expect(secondRun.length).toBe(3);
            expect(secondRun[0]._id.toString()).toBe(s1Id);
            expect(secondRun[1]._id.toString()).toBe(s2Id);
            expect(secondRun[2]._id.toString()).toBe(s3Id);

            // Run 3: Change fixed page configuration to 2
            await Exam.updateOne({ _id: fixedExam._id }, { $set: { fixedPageCount: 2 } });

            const thirdRun = await service.assembleAndMapAnswerScripts(batchId, auditCtx);
            // fixedPageCount = 2
            // File 0: 5 pages -> Script A (pages 1-2), Script B (pages 3-4), Script C (pages 5)
            // File 1: 2 pages -> Script D (pages 1-2)
            expect(thirdRun.length).toBe(4);

            const updatedPages = await IngestionPage.find({ batchId }).sort({ fileIndex: 1, pageNumber: 1 });
            const finalScriptIds = thirdRun.map(s => s._id.toString());

            expect(updatedPages[0].answerScript?.toString()).toBe(finalScriptIds[0]); // File 0, Page 1
            expect(updatedPages[1].answerScript?.toString()).toBe(finalScriptIds[0]); // File 0, Page 2
            expect(updatedPages[2].answerScript?.toString()).toBe(finalScriptIds[1]); // File 0, Page 3
            expect(updatedPages[3].answerScript?.toString()).toBe(finalScriptIds[1]); // File 0, Page 4
            expect(updatedPages[4].answerScript?.toString()).toBe(finalScriptIds[2]); // File 0, Page 5
            expect(updatedPages[5].answerScript?.toString()).toBe(finalScriptIds[3]); // File 1, Page 1
            expect(updatedPages[6].answerScript?.toString()).toBe(finalScriptIds[3]); // File 1, Page 2

            // Ensure Page 3 does not link to the original script 1 anymore
            expect(updatedPages[2].answerScript?.toString()).not.toBe(s1Id);
        });
    });
});
