/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import AnswerScript from '../../models/AnswerScript';
import IngestionPage, { PageProcessingStatus } from '../../models/IngestionPage';
import Batch, { BatchStatus } from '../../models/Batch';
import Exam, { ExamStatus, SplittingStrategyType } from '../../models/Exam';
import Course from '../../models/Course';
import User, { UserRole } from '../../models/User';
import { StudentRosterMappingService } from '../../services/StudentRosterMappingService';

describe('Script-Page Persistence Integration', () => {
    let service: StudentRosterMappingService;
    let profUser: any;
    let studentUser1: any;
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

        course = await Course.create({
            courseCode: `CS-${Date.now()}`,
            courseName: 'Data Structures',
            semester: 1,
            academicYear: '2026-2027',
            professor: profUser._id,
            enrolledStudents: [studentUser1._id],
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
            enrolledStudents: [studentUser1._id],
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
            enrolledStudents: [studentUser1._id],
            splittingStrategy: SplittingStrategyType.FIXED_PAGE,
            fixedPageCount: 2,
            isActive: true
        });
    });

    it('should link ingestion pages to the correct AnswerScript during cover-page assembly', async () => {
        const batchId = `batch-cover-persist-${Date.now()}`;
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
                    pageCount: 3,
                    storageKey: `batches/${batchId}/0/file0.pdf`
                }
            ],
            totalFiles: 1,
            totalSize: 1000,
            totalPageCount: 3,
            status: BatchStatus.PROCESSING
        });

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
                storageKey: `batches/${batchId}/derived/1/page.png`
            },
            {
                batchId,
                job: defaultJobId,
                fileId: 'f0',
                fileIndex: 0,
                pageNumber: 2,
                isCoverPage: false,
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${batchId}/derived/2/page.png`
            },
            {
                batchId,
                job: defaultJobId,
                fileId: 'f0',
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
        const scriptId = scripts[0]._id;

        // Verify pages are linked
        const updatedPages = await IngestionPage.find({ batchId }).sort({ pageNumber: 1 });
        expect(updatedPages.length).toBe(3);
        expect(updatedPages[0].answerScript?.toString()).toBe(scriptId.toString());
        expect(updatedPages[1].answerScript?.toString()).toBe(scriptId.toString());
        expect(updatedPages[2].answerScript?.toString()).toBe(scriptId.toString());
    });

    it('should link pages to different scripts when multiple covers exist and prevent cross-linking', async () => {
        const batchId = `batch-multi-persist-${Date.now()}`;
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
                    pageCount: 3,
                    storageKey: `batches/${batchId}/0/file0.pdf`
                }
            ],
            totalFiles: 1,
            totalSize: 1000,
            totalPageCount: 3,
            status: BatchStatus.PROCESSING
        });

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
                storageKey: `batches/${batchId}/derived/1/page.png`
            },
            {
                batchId,
                job: defaultJobId,
                fileId: 'f0',
                fileIndex: 0,
                pageNumber: 2,
                isCoverPage: true,
                candidateStudentId: studentUser1._id.toString(),
                decodeOutcome: 'found',
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${batchId}/derived/2/page.png`
            },
            {
                batchId,
                job: defaultJobId,
                fileId: 'f0',
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

        expect(scripts.length).toBe(2);
        const scriptId1 = scripts[0]._id;
        const scriptId2 = scripts[1]._id;

        const updatedPages = await IngestionPage.find({ batchId }).sort({ pageNumber: 1 });
        // Page 1 -> Script 1
        expect(updatedPages[0].answerScript?.toString()).toBe(scriptId1.toString());
        // Page 2 -> Script 2
        expect(updatedPages[1].answerScript?.toString()).toBe(scriptId2.toString());
        // Page 3 -> Script 2
        expect(updatedPages[2].answerScript?.toString()).toBe(scriptId2.toString());

        // Ensure page 1 is not linked to script 2
        expect(updatedPages[0].answerScript?.toString()).not.toBe(scriptId2.toString());
    });

    it('should link pages to scripts cleanly in fixed-page splitting strategy', async () => {
        const batchId = `batch-fixed-persist-${Date.now()}`;
        await Batch.create({
            batchId,
            uploadedBy: profUser._id,
            exam: fixedExam._id,
            files: [
                {
                    fileId: 'f0',
                    fileIndex: 0,
                    originalFilename: 'file0.pdf',
                    fileType: 'pdf',
                    mimeType: 'application/pdf',
                    size: 1000,
                    pageCount: 3,
                    storageKey: `batches/${batchId}/0/file0.pdf`
                }
            ],
            totalFiles: 1,
            totalSize: 1000,
            totalPageCount: 3,
            status: BatchStatus.PROCESSING
        });

        await IngestionPage.create([
            {
                batchId,
                job: defaultJobId,
                fileId: 'f0',
                fileIndex: 0,
                pageNumber: 1,
                isCoverPage: false,
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${batchId}/derived/1/page.png`
            },
            {
                batchId,
                job: defaultJobId,
                fileId: 'f0',
                fileIndex: 0,
                pageNumber: 2,
                isCoverPage: false,
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${batchId}/derived/2/page.png`
            },
            {
                batchId,
                job: defaultJobId,
                fileId: 'f0',
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

        // N=2, total pages = 3. Expected: script 1 (pages 1-2), script 2 (page 3)
        expect(scripts.length).toBe(2);
        const scriptId1 = scripts[0]._id;
        const scriptId2 = scripts[1]._id;

        const updatedPages = await IngestionPage.find({ batchId }).sort({ pageNumber: 1 });
        expect(updatedPages[0].answerScript?.toString()).toBe(scriptId1.toString());
        expect(updatedPages[1].answerScript?.toString()).toBe(scriptId1.toString());
        expect(updatedPages[2].answerScript?.toString()).toBe(scriptId2.toString());
    });

    it('should reset and correctly update links during idempotent reprocessing', async () => {
        const batchId = `batch-reprocess-${Date.now()}`;
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
                    pageCount: 3,
                    storageKey: `batches/${batchId}/0/file0.pdf`
                }
            ],
            totalFiles: 1,
            totalSize: 1000,
            totalPageCount: 3,
            status: BatchStatus.PROCESSING
        });

        // Run 1: page 1 is a cover page, page 2 & 3 are normal pages.
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
                storageKey: `batches/${batchId}/derived/1/page.png`
            },
            {
                batchId,
                job: defaultJobId,
                fileId: 'f0',
                fileIndex: 0,
                pageNumber: 2,
                isCoverPage: false,
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${batchId}/derived/2/page.png`
            },
            {
                batchId,
                job: defaultJobId,
                fileId: 'f0',
                fileIndex: 0,
                pageNumber: 3,
                isCoverPage: false,
                status: PageProcessingStatus.PROCESSED,
                storageKey: `batches/${batchId}/derived/3/page.png`
            }
        ]);

        const firstScripts = await service.assembleAndMapAnswerScripts(batchId, {
            actingUserId: profUser._id.toString(),
            actingUserRole: 'PROFESSOR'
        });

        expect(firstScripts.length).toBe(1);
        const scriptId1 = firstScripts[0]._id;

        const firstPages = await IngestionPage.find({ batchId }).sort({ pageNumber: 1 });
        expect(firstPages[0].answerScript?.toString()).toBe(scriptId1.toString());
        expect(firstPages[1].answerScript?.toString()).toBe(scriptId1.toString());
        expect(firstPages[2].answerScript?.toString()).toBe(scriptId1.toString());

        // Run 2: Reprocess, but now page 2 is ALSO a cover page.
        await IngestionPage.updateOne({ batchId, pageNumber: 2 }, { $set: { isCoverPage: true, candidateStudentId: studentUser1._id.toString(), decodeOutcome: 'found' } });

        const secondScripts = await service.assembleAndMapAnswerScripts(batchId, {
            actingUserId: profUser._id.toString(),
            actingUserRole: 'PROFESSOR'
        });

        // Splitting should now produce 2 scripts
        expect(secondScripts.length).toBe(2);
        const newScriptId1 = secondScripts[0]._id;
        const newScriptId2 = secondScripts[1]._id;

        const secondPages = await IngestionPage.find({ batchId }).sort({ pageNumber: 1 });
        // Page 1 should still belong to script 1
        expect(secondPages[0].answerScript?.toString()).toBe(newScriptId1.toString());
        // Page 2 & 3 should now belong to script 2
        expect(secondPages[1].answerScript?.toString()).toBe(newScriptId2.toString());
        expect(secondPages[2].answerScript?.toString()).toBe(newScriptId2.toString());

        // Ensure old script 1 reference is not on page 2 or 3 anymore
        expect(secondPages[1].answerScript?.toString()).not.toBe(newScriptId1.toString());
    });
});
