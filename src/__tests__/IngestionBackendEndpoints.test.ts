/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import AnswerScript from '../models/AnswerScript';
import BatchRepository from '../repositories/BatchRepository';
import DerivedStorageService from '../services/DerivedStorageService';
import mongoose from 'mongoose';

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

describe('Ingestion Script Listing & Thumbnail APIs (AE-060 backend)', () => {
    let listScriptsGET: any;
    let serveThumbnailGET: any;
    const professorId = new mongoose.Types.ObjectId().toString();
    const otherProfessorId = new mongoose.Types.ObjectId().toString();
    const graderId = new mongoose.Types.ObjectId().toString();

    beforeAll(async () => {
        listScriptsGET = (await import('../app/api/ingest/[batchId]/scripts/route')).GET;
        serveThumbnailGET = (await import('../app/api/ingest/[batchId]/pages/[pageId]/thumbnail/route')).GET;
    });

    beforeEach(() => {
        mockSessionUser = null;
    });

    async function createTestIngestionSetup(ownerId: string) {
        const batchId = crypto.randomUUID();
        const batch = await BatchRepository.createBatch({
            batchId,
            uploadedBy: new mongoose.Types.ObjectId(ownerId),
            files: [
                {
                    fileId: 'file-1',
                    fileIndex: 0,
                    originalFilename: 'exam.pdf',
                    fileType: 'pdf',
                    mimeType: 'application/pdf',
                    size: 2048,
                    pageCount: 5,
                    storageKey: `batches/${batchId}/exam.pdf`
                }
            ],
            totalFiles: 1,
            totalSize: 2048,
            totalPageCount: 5,
            status: BatchStatus.QUEUED,
            isActive: true
        });

        const job = await BatchRepository.createIngestionJob({
            batchId,
            batch: batch._id as mongoose.Types.ObjectId,
            uploadedBy: new mongoose.Types.ObjectId(ownerId),
            status: IngestionStatus.DONE,
            totalPages: 5,
            processedPages: 5,
            failedPages: 0
        });

        const script1 = await AnswerScript.create({
            exam: new mongoose.Types.ObjectId(),
            batchId,
            fileIndex: 0,
            startPageNumber: 1,
            endPageNumber: 3,
            pageCount: 3,
            candidateStudentId: '2026-STUD-01',
            identificationSource: 'QR',
            identificationStatus: 'IDENTIFIED',
            needsManualId: false,
            isActive: true
        });

        const script2 = await AnswerScript.create({
            exam: new mongoose.Types.ObjectId(),
            batchId,
            fileIndex: 0,
            startPageNumber: 4,
            endPageNumber: 5,
            pageCount: 2,
            candidateStudentId: null,
            identificationSource: null,
            identificationStatus: 'UNIDENTIFIED',
            needsManualId: true,
            manualIdReason: 'NO_CODE_FOUND',
            isActive: true
        });

        const page1 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: `batches/${batchId}/derived/file-1/1/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-1/1/thumb.jpg`,
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script1._id as mongoose.Types.ObjectId
        });

        const page2 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: `batches/${batchId}/derived/file-1/2/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-1/2/thumb.jpg`,
            pageNumber: 2,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script1._id as mongoose.Types.ObjectId
        });

        const page3 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: `batches/${batchId}/derived/file-1/3/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-1/3/thumb.jpg`,
            pageNumber: 3,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script1._id as mongoose.Types.ObjectId
        });

        const page4 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: `batches/${batchId}/derived/file-1/4/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-1/4/thumb.jpg`,
            pageNumber: 4,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script2._id as mongoose.Types.ObjectId
        });

        const page5 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-1',
            fileIndex: 0,
            storageKey: `batches/${batchId}/derived/file-1/5/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-1/5/thumb.jpg`,
            pageNumber: 5,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script2._id as mongoose.Types.ObjectId
        });

        return { batchId, page1Id: page1._id.toString(), page4Id: page4._id.toString(), script1Id: script1._id.toString() };
    }

    describe('GET /api/ingest/[batchId]/scripts - Scripts Listing', () => {
        it('should allow authorized owner to list scripts and return ordered pages with thumbnail URLs', async () => {
            const { batchId, page1Id, page4Id } = await createTestIngestionSetup(professorId);

            mockSessionUser = {
                id: professorId,
                email: 'prof@uni.edu',
                name: 'Prof User',
                role: 'PROFESSOR'
            };

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts`);
            const res = await listScriptsGET(req as any, { params: Promise.resolve({ batchId }) });

            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data).toHaveLength(2);

            // Deterministic script ordering check (sorted by fileIndex, then startPageNumber)
            const s1 = body.data[0];
            const s2 = body.data[1];
            expect(s1.startPageNumber).toBe(1);
            expect(s1.endPageNumber).toBe(3);
            expect(s1.candidateStudentId).toBe('2026-STUD-01');

            expect(s2.startPageNumber).toBe(4);
            expect(s2.endPageNumber).toBe(5);
            expect(s2.candidateStudentId).toBeNull();
            expect(s2.manualIdReason).toBe('NO_CODE_FOUND');

            // Ordered pages check
            expect(s1.pages).toHaveLength(3);
            expect(s1.pages[0]._id.toString()).toBe(page1Id);
            expect(s1.pages[0].pageNumber).toBe(1);
            expect(s1.pages[0].thumbnailUrl).toContain(`/pages/${page1Id}/thumbnail`);

            expect(s2.pages).toHaveLength(2);
            expect(s2.pages[0]._id.toString()).toBe(page4Id);
            expect(s2.pages[0].pageNumber).toBe(4);
        });

        it('should return 404 for wrong-owner access attempt', async () => {
            const { batchId } = await createTestIngestionSetup(professorId);

            mockSessionUser = {
                id: otherProfessorId,
                email: 'other_prof@uni.edu',
                name: 'Other Prof User',
                role: 'PROFESSOR'
            };

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts`);
            const res = await listScriptsGET(req as any, { params: Promise.resolve({ batchId }) });

            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.message).toContain('access denied');
        });

        it('should return 403 for user without EDIT_EXAM permission (like a TA grader or Student)', async () => {
            const { batchId } = await createTestIngestionSetup(professorId);

            mockSessionUser = {
                id: graderId,
                email: 'grader@uni.edu',
                name: 'Grader TA',
                role: 'TA' // TA doesn't have EDIT_EXAM
            };

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts`);
            const res = await listScriptsGET(req as any, { params: Promise.resolve({ batchId }) });

            expect(res.status).toBe(403);
        });

        it('should return 404 for nonexistent batchId', async () => {
            mockSessionUser = {
                id: professorId,
                email: 'prof@uni.edu',
                name: 'Prof User',
                role: 'PROFESSOR'
            };

            const req = new Request('http://localhost:3000/api/ingest/nonexistent-batch/scripts');
            const res = await listScriptsGET(req as any, { params: Promise.resolve({ batchId: 'nonexistent-batch' }) });

            expect(res.status).toBe(404);
        });
    });

    describe('GET /api/ingest/[batchId]/pages/[pageId]/thumbnail - Serve Thumbnail', () => {
        it('should serve thumbnail to authorized owner with proper content-type', async () => {
            const { batchId, page1Id } = await createTestIngestionSetup(professorId);

            mockSessionUser = {
                id: professorId,
                email: 'prof@uni.edu',
                name: 'Prof User',
                role: 'PROFESSOR'
            };

            // Mock filesystem read in DerivedStorageService
            const mockBuffer = Buffer.from('mock-image-data-jpg');
            const spyRead = vi.spyOn(DerivedStorageService, 'readDerivedPage').mockResolvedValue(mockBuffer);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/pages/${page1Id}/thumbnail`);
            const res = await serveThumbnailGET(req as any, { params: Promise.resolve({ batchId, pageId: page1Id }) });

            expect(res.status).toBe(200);
            expect(res.headers.get('Content-Type')).toBe('image/jpeg');
            const buffer = await res.arrayBuffer();
            expect(Buffer.from(buffer).toString()).toBe('mock-image-data-jpg');

            spyRead.mockRestore();
        });

        it('should return 404 if the page does not belong to the batch', async () => {
            const { batchId, page1Id } = await createTestIngestionSetup(professorId);
            const otherBatchId = crypto.randomUUID(); // unrelated batch

            mockSessionUser = {
                id: professorId,
                email: 'prof@uni.edu',
                name: 'Prof User',
                role: 'PROFESSOR'
            };

            const req = new Request(`http://localhost:3000/api/ingest/${otherBatchId}/pages/${page1Id}/thumbnail`);
            const res = await serveThumbnailGET(req as any, { params: Promise.resolve({ batchId: otherBatchId, pageId: page1Id }) });

            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.message).toContain('belong to the requested batch');
        });

        it('should return 404 for unauthorized wrong-owner batch requests', async () => {
            const { batchId, page1Id } = await createTestIngestionSetup(professorId);

            mockSessionUser = {
                id: otherProfessorId,
                email: 'other_prof@uni.edu',
                name: 'Other Prof User',
                role: 'PROFESSOR'
            };

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/pages/${page1Id}/thumbnail`);
            const res = await serveThumbnailGET(req as any, { params: Promise.resolve({ batchId, pageId: page1Id }) });

            expect(res.status).toBe(404);
        });

        it('should return 404 for nonexistent pageId', async () => {
            const { batchId } = await createTestIngestionSetup(professorId);
            const nonexistentPageId = new mongoose.Types.ObjectId().toString();

            mockSessionUser = {
                id: professorId,
                email: 'prof@uni.edu',
                name: 'Prof User',
                role: 'PROFESSOR'
            };

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/pages/${nonexistentPageId}/thumbnail`);
            const res = await serveThumbnailGET(req as any, { params: Promise.resolve({ batchId, pageId: nonexistentPageId }) });

            expect(res.status).toBe(404);
        });
    });
});
