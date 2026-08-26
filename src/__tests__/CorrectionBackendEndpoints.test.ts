/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import AnswerScript from '../models/AnswerScript';
import AuditLog from '../models/AuditLog';
import User from '../models/User';
import StudentMapping from '../models/StudentMapping';
import BatchRepository from '../repositories/BatchRepository';

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

describe('AE-064 Manual Correction Backend Endpoints', () => {
    let replSet: MongoMemoryReplSet;
    let remapPOST: any;
    let mergePOST: any;
    let splitPOST: any;
    let reorderPOST: any;

    const professorId = new mongoose.Types.ObjectId().toString();
    const otherProfessorId = new mongoose.Types.ObjectId().toString();
    const graderId = new mongoose.Types.ObjectId().toString();

    beforeAll(async () => {
        // Disconnect from global standalone MongoMemoryServer if connected
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }

        // Start replica set to support transactions
        replSet = await MongoMemoryReplSet.create({
            replSet: { storageEngine: 'wiredTiger' }
        });
        const uri = replSet.getUri();
        await mongoose.connect(uri);

        remapPOST = (await import('../app/api/ingest/[id]/scripts/remap/route')).POST;
        mergePOST = (await import('../app/api/ingest/[id]/scripts/merge/route')).POST;
        splitPOST = (await import('../app/api/ingest/[id]/scripts/split/route')).POST;
        reorderPOST = (await import('../app/api/ingest/[id]/scripts/reorder/route')).POST;
    });

    afterAll(async () => {
        await mongoose.disconnect();
        if (replSet) {
            await replSet.stop();
        }

        // Reconnect to global fallback db
        const fallbackUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test-placeholder-safety';
        try {
            await mongoose.connect(fallbackUri);
        } catch {
            // ignore
        }
    });

    beforeEach(async () => {
        mockSessionUser = null;
        await AnswerScript.deleteMany({});
        await IngestionPage.deleteMany({});
        await Batch.deleteMany({});
        await IngestionJob.deleteMany({});
        await AuditLog.deleteMany({});
        await User.deleteMany({});
        await StudentMapping.deleteMany({});
    });

    async function createTestSetup(ownerId: string) {
        const batchId = crypto.randomUUID();
        const examId = new mongoose.Types.ObjectId();

        const batch = await BatchRepository.createBatch({
            batchId,
            uploadedBy: new mongoose.Types.ObjectId(ownerId),
            exam: examId,
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
            exam: examId,
            batchId,
            fileIndex: 0,
            startPageNumber: 1,
            endPageNumber: 3,
            pageCount: 3,
            candidateStudentId: 'STUD-01',
            identificationSource: 'QR',
            identificationStatus: 'IDENTIFIED',
            needsManualId: false,
            isActive: true
        });

        const script2 = await AnswerScript.create({
            exam: examId,
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

        return {
            batchId,
            examId,
            script1Id: script1._id.toString(),
            script2Id: script2._id.toString(),
            page1Id: page1._id.toString(),
            page2Id: page2._id.toString(),
            page3Id: page3._id.toString(),
            page4Id: page4._id.toString(),
            page5Id: page5._id.toString()
        };
    }

    describe('Authorization Checks (AE-064)', () => {
        it('should reject unauthorized user (no EDIT_EXAM permission)', async () => {
            const { batchId } = await createTestSetup(professorId);
            mockSessionUser = { id: graderId, email: 'grader@uni.edu', role: 'TA' };

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId: 'dummy', targetScriptId: 'dummy' })
            });

            const res = await remapPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(403);
        });

        it('should return 404 for wrong owner accessing the batch (404-not-403 convention)', async () => {
            const { batchId } = await createTestSetup(professorId);
            mockSessionUser = { id: otherProfessorId, email: 'other@uni.edu', role: 'PROFESSOR' };

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pageId: 'dummy', targetScriptId: 'dummy' })
            });

            const res = await remapPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(404);
        });
    });

    describe('Remap Operation', () => {
        beforeEach(() => {
            mockSessionUser = { id: professorId, email: 'prof@uni.edu', role: 'PROFESSOR' };
        });

        it('should successfully remap a page from one script to another', async () => {
            const { batchId, script1Id, script2Id, page3Id } = await createTestSetup(professorId);

            const s1Before = await AnswerScript.findById(script1Id);
            const s2Before = await AnswerScript.findById(script2Id);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: page3Id,
                    targetScriptId: script2Id,
                    versions: {
                        [script1Id]: s1Before!.__v,
                        [script2Id]: s2Before!.__v
                    }
                })
            });

            const res = await remapPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(200);

            const page = await IngestionPage.findById(page3Id);
            expect(page?.answerScript?.toString()).toBe(script2Id);

            const s1 = await AnswerScript.findById(script1Id);
            expect(s1?.startPageNumber).toBe(1);
            expect(s1?.endPageNumber).toBe(2);
            expect(s1?.pageCount).toBe(2);
            expect(s1?.__v).toBe(s1Before!.__v + 1);

            const s2 = await AnswerScript.findById(script2Id);
            expect(s2?.startPageNumber).toBe(3);
            expect(s2?.endPageNumber).toBe(5);
            expect(s2?.pageCount).toBe(3);
            expect(s2?.__v).toBe(s2Before!.__v + 1);

            // Verify audit log entry
            const audit = await AuditLog.findOne({ action: 'SCRIPT_REMAP', outcome: 'SUCCESS' });
            expect(audit).not.toBeNull();
            expect(audit?.details?.pageId).toBe(page3Id);
            expect(audit?.details?.previousScriptId).toBe(script1Id);
            expect(audit?.details?.newScriptId).toBe(script2Id);
        });

        it('should delete the source script if its last page is remapped', async () => {
            const { batchId, script1Id, script2Id, page4Id, page5Id } = await createTestSetup(professorId);

            const s1 = await AnswerScript.findById(script1Id);
            const s2 = await AnswerScript.findById(script2Id);

            // Remap page 4 to script 1
            let req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: page4Id,
                    targetScriptId: script1Id,
                    versions: {
                        [script1Id]: s1!.__v,
                        [script2Id]: s2!.__v
                    }
                })
            });
            let res = await remapPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(200);

            const s1Updated = await AnswerScript.findById(script1Id);
            const s2Updated = await AnswerScript.findById(script2Id);

            // Remap page 5 to script 1 (the last remaining page of script 2)
            req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: page5Id,
                    targetScriptId: script1Id,
                    versions: {
                        [script1Id]: s1Updated!.__v,
                        [script2Id]: s2Updated!.__v
                    }
                })
            });
            res = await remapPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(200);

            // Verify source script is deleted
            const s2Final = await AnswerScript.findById(script2Id);
            expect(s2Final).toBeNull();

            // Verify target script contains all 5 pages
            const s1Final = await AnswerScript.findById(script1Id);
            expect(s1Final?.startPageNumber).toBe(1);
            expect(s1Final?.endPageNumber).toBe(5);
            expect(s1Final?.pageCount).toBe(5);
        });

        it('should reject remap with stale concurrency version', async () => {
            const { batchId, script1Id, script2Id, page3Id } = await createTestSetup(professorId);

            const s1 = await AnswerScript.findById(script1Id);
            const s2 = await AnswerScript.findById(script2Id);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: page3Id,
                    targetScriptId: script2Id,
                    versions: {
                        [script1Id]: s1!.__v - 1, // incorrect/stale version
                        [script2Id]: s2!.__v
                    }
                })
            });

            const res = await remapPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(409);
        });
    });

    describe('Merge Operation', () => {
        beforeEach(() => {
            mockSessionUser = { id: professorId, email: 'prof@uni.edu', role: 'PROFESSOR' };
        });

        it('should successfully merge two scripts', async () => {
            const { batchId, script1Id, script2Id, page4Id, page5Id } = await createTestSetup(professorId);

            const s1 = await AnswerScript.findById(script1Id);
            const s2 = await AnswerScript.findById(script2Id);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/merge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceScriptId: script2Id,
                    targetScriptId: script1Id,
                    versions: {
                        [script1Id]: s1!.__v,
                        [script2Id]: s2!.__v
                    }
                })
            });

            const res = await mergePOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(200);

            // Source script is deleted
            const source = await AnswerScript.findById(script2Id);
            expect(source).toBeNull();

            // Target script includes all pages
            const target = await AnswerScript.findById(script1Id);
            expect(target?.startPageNumber).toBe(1);
            expect(target?.endPageNumber).toBe(5);
            expect(target?.pageCount).toBe(5);

            // Pages updated to point to target script
            const p4 = await IngestionPage.findById(page4Id);
            const p5 = await IngestionPage.findById(page5Id);
            expect(p4?.answerScript?.toString()).toBe(script1Id);
            expect(p5?.answerScript?.toString()).toBe(script1Id);

            // Student identity is preserved
            expect(target?.candidateStudentId).toBe('STUD-01');
            expect(target?.identificationStatus).toBe('IDENTIFIED');

            // Audit logged
            const audit = await AuditLog.findOne({ action: 'SCRIPT_MERGE', outcome: 'SUCCESS' });
            expect(audit).not.toBeNull();
        });

        it('should reject merge if both scripts are identified with different students', async () => {
            const { batchId, script1Id, script2Id } = await createTestSetup(professorId);

            // Manually identify script2 with a different student
            await AnswerScript.updateOne(
                { _id: script2Id },
                {
                    $set: {
                        student: new mongoose.Types.ObjectId(),
                        candidateStudentId: 'STUD-02',
                        identificationStatus: 'IDENTIFIED'
                    }
                }
            );

            const s1 = await AnswerScript.findById(script1Id);
            const s2 = await AnswerScript.findById(script2Id);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/merge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceScriptId: script2Id,
                    targetScriptId: script1Id,
                    versions: {
                        [script1Id]: s1!.__v,
                        [script2Id]: s2!.__v
                    }
                })
            });

            const res = await mergePOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(400);

            const target = await AnswerScript.findById(script1Id);
            expect(target?.candidateStudentId).toBe('STUD-01');

            const source = await AnswerScript.findById(script2Id);
            expect(source).not.toBeNull();
        });
    });

    describe('Split Operation', () => {
        beforeEach(() => {
            mockSessionUser = { id: professorId, email: 'prof@uni.edu', role: 'PROFESSOR' };
        });

        it('should successfully split a script into multiple scripts', async () => {
            const { batchId, script1Id, page1Id, page2Id, page3Id } = await createTestSetup(professorId);

            const s1 = await AnswerScript.findById(script1Id);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/split`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scriptId: script1Id,
                    version: s1!.__v,
                    groups: [
                        [page1Id],
                        [page2Id, page3Id]
                    ]
                })
            });

            const res = await splitPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.success).toBe(true);

            // Re-read original script (should now contain page 1 only)
            const orig = await AnswerScript.findById(script1Id);
            expect(orig?.startPageNumber).toBe(1);
            expect(orig?.endPageNumber).toBe(1);
            expect(orig?.pageCount).toBe(1);
            expect(orig?.candidateStudentId).toBe('STUD-01');

            // Find new scripts created
            const scripts = await AnswerScript.find({ batchId, _id: { $ne: script1Id } });
            // Script2 already existed (startPageNumber 4), so there should be script 2 plus one new script from split
            expect(scripts).toHaveLength(2);

            const newScript = scripts.find(s => s.startPageNumber === 2);
            expect(newScript).toBeDefined();
            expect(newScript?.endPageNumber).toBe(3);
            expect(newScript?.pageCount).toBe(2);
            expect(newScript?.identificationStatus).toBe('UNIDENTIFIED');

            // Pages mapped correctly
            const p1 = await IngestionPage.findById(page1Id);
            const p2 = await IngestionPage.findById(page2Id);
            const p3 = await IngestionPage.findById(page3Id);

            expect(p1?.answerScript?.toString()).toBe(script1Id);
            expect(p2?.answerScript?.toString()).toBe(newScript!._id.toString());
            expect(p3?.answerScript?.toString()).toBe(newScript!._id.toString());
        });

        it('should reject split if unique startPageNumber constraint is violated', async () => {
            const { batchId, script1Id, page1Id, page2Id, page3Id } = await createTestSetup(professorId);

            // Let's create an existing script that starts at page 2
            await AnswerScript.create({
                exam: new mongoose.Types.ObjectId(),
                batchId,
                fileIndex: 0,
                startPageNumber: 2,
                endPageNumber: 2,
                pageCount: 1,
                isActive: true
            });

            const s1 = await AnswerScript.findById(script1Id);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/split`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scriptId: script1Id,
                    version: s1!.__v,
                    groups: [
                        [page1Id],
                        [page2Id, page3Id]
                    ]
                })
            });

            // Split should be rejected with 400 because a script starting at page 2 already exists
            const res = await splitPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(400);
        });
    });

    describe('Reorder Operation', () => {
        beforeEach(() => {
            mockSessionUser = { id: professorId, email: 'prof@uni.edu', role: 'PROFESSOR' };
        });

        it('should successfully reorder pages in a script', async () => {
            const { batchId, script1Id, page1Id, page2Id, page3Id } = await createTestSetup(professorId);

            const s1 = await AnswerScript.findById(script1Id);

            // New desired order: [page3, page1, page2]
            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/reorder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scriptId: script1Id,
                    version: s1!.__v,
                    orderedPageIds: [page3Id, page1Id, page2Id]
                })
            });

            const res = await reorderPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(200);

            // Read pages after reorder, they should be sorted by pageNumber asc
            // So they will be stored in database as: page3: 1, page1: 2, page2: 3
            const p1 = await IngestionPage.findById(page1Id);
            const p2 = await IngestionPage.findById(page2Id);
            const p3 = await IngestionPage.findById(page3Id);

            expect(p3?.pageNumber).toBe(1);
            expect(p1?.pageNumber).toBe(2);
            expect(p2?.pageNumber).toBe(3);

            // Script range summaries remain consistent
            const script = await AnswerScript.findById(script1Id);
            expect(script?.startPageNumber).toBe(1);
            expect(script?.endPageNumber).toBe(3);
            expect(script?.pageCount).toBe(3);
        });
    });

    describe('Atomicity & Rollback', () => {
        beforeEach(() => {
            mockSessionUser = { id: professorId, email: 'prof@uni.edu', role: 'PROFESSOR' };
        });

        it('should rollback all changes if any part of the operation fails', async () => {
            const { batchId, script1Id, script2Id, page3Id } = await createTestSetup(professorId);

            const s1 = await AnswerScript.findById(script1Id);
            const s2 = await AnswerScript.findById(script2Id);

            // We will force a database validation error by trying to save an invalid document in AuditLog,
            // or spy on AuditLog.create and make it throw, which will crash the transaction.
            const spyAudit = vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('Forced Audit Failure') as never);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: page3Id,
                    targetScriptId: script2Id,
                    versions: {
                        [script1Id]: s1!.__v,
                        [script2Id]: s2!.__v
                    }
                })
            });

            const res = await remapPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(500);

            // Verify that page is NOT remapped
            const page = await IngestionPage.findById(page3Id);
            expect(page?.answerScript?.toString()).toBe(script1Id);

            // Verify source script is unchanged
            const s1After = await AnswerScript.findById(script1Id);
            expect(s1After?.pageCount).toBe(3);
            expect(s1After?.__v).toBe(s1!.__v);

            // Verify target script is unchanged
            const s2After = await AnswerScript.findById(script2Id);
            expect(s2After?.pageCount).toBe(2);

            spyAudit.mockRestore();
        });
    });

    async function createMultiFileTestSetup(ownerId: string) {
        const batchId = crypto.randomUUID();
        const examId = new mongoose.Types.ObjectId();

        const batch = await BatchRepository.createBatch({
            batchId,
            uploadedBy: new mongoose.Types.ObjectId(ownerId),
            exam: examId,
            files: [
                {
                    fileId: 'file-a',
                    fileIndex: 0,
                    originalFilename: 'fileA.pdf',
                    fileType: 'pdf',
                    mimeType: 'application/pdf',
                    size: 1024,
                    pageCount: 3,
                    storageKey: `batches/${batchId}/fileA.pdf`
                },
                {
                    fileId: 'file-b',
                    fileIndex: 1,
                    originalFilename: 'fileB.pdf',
                    fileType: 'pdf',
                    mimeType: 'application/pdf',
                    size: 1024,
                    pageCount: 2,
                    storageKey: `batches/${batchId}/fileB.pdf`
                }
            ],
            totalFiles: 2,
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

        // Script 1 in File A (index 0) has pages 1, 2, 3
        const script1 = await AnswerScript.create({
            exam: examId,
            batchId,
            fileIndex: 0,
            filename: 'fileA.pdf',
            startPageNumber: 1,
            endPageNumber: 3,
            pageCount: 3,
            isActive: true
        });

        // Script 2 in File B (index 1) has pages 1, 2
        const script2 = await AnswerScript.create({
            exam: examId,
            batchId,
            fileIndex: 1,
            filename: 'fileB.pdf',
            startPageNumber: 1,
            endPageNumber: 2,
            pageCount: 2,
            isActive: true
        });

        const pageA1 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-a',
            fileIndex: 0,
            storageKey: `batches/${batchId}/derived/file-a/1/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-a/1/thumb.jpg`,
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script1._id as mongoose.Types.ObjectId
        });

        const pageA2 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-a',
            fileIndex: 0,
            storageKey: `batches/${batchId}/derived/file-a/2/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-a/2/thumb.jpg`,
            pageNumber: 2,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script1._id as mongoose.Types.ObjectId
        });

        const pageA3 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-a',
            fileIndex: 0,
            storageKey: `batches/${batchId}/derived/file-a/3/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-a/3/thumb.jpg`,
            pageNumber: 3,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script1._id as mongoose.Types.ObjectId
        });

        const pageB1 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-b',
            fileIndex: 1,
            storageKey: `batches/${batchId}/derived/file-b/1/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-b/1/thumb.jpg`,
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script2._id as mongoose.Types.ObjectId
        });

        const pageB2 = await IngestionPage.create({
            batchId,
            job: job._id as mongoose.Types.ObjectId,
            fileId: 'file-b',
            fileIndex: 1,
            storageKey: `batches/${batchId}/derived/file-b/2/page.png`,
            thumbnailKey: `batches/${batchId}/derived/file-b/2/thumb.jpg`,
            pageNumber: 2,
            status: PageProcessingStatus.PROCESSED,
            answerScript: script2._id as mongoose.Types.ObjectId
        });

        return {
            batchId,
            examId,
            script1Id: script1._id.toString(),
            script2Id: script2._id.toString(),
            pageA1Id: pageA1._id.toString(),
            pageA2Id: pageA2._id.toString(),
            pageA3Id: pageA3._id.toString(),
            pageB1Id: pageB1._id.toString(),
            pageB2Id: pageB2._id.toString()
        };
    }

    describe('Integration Regression Checks (AE-064 remap E11000 fixes)', () => {
        beforeEach(() => {
            mockSessionUser = { id: professorId, email: 'prof@uni.edu', role: 'PROFESSOR' };
        });

        // Case 1 — Move pageNumber 1 into another file
        it('Case 1: should successfully move pageNumber 1 into another file without unique index errors', async () => {
            const { batchId, script1Id, script2Id, pageA1Id } = await createMultiFileTestSetup(professorId);

            const s1 = await AnswerScript.findById(script1Id);
            const s2 = await AnswerScript.findById(script2Id);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: pageA1Id,
                    targetScriptId: script2Id,
                    versions: {
                        [script1Id]: s1!.__v,
                        [script2Id]: s2!.__v
                    }
                })
            });

            const res = await remapPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(200);

            // Assert page A1 is remapped, its fileIndex aligned to 1, fileId to file-b
            const pageA1 = await IngestionPage.findById(pageA1Id);
            expect(pageA1?.answerScript?.toString()).toBe(script2Id);
            expect(pageA1?.fileIndex).toBe(1);
            expect(pageA1?.fileId).toBe('file-b');

            // Assert destination script pages are sequentially numbered (1, 2, 3)
            const s2Pages = await IngestionPage.find({ answerScript: script2Id }).sort({ pageNumber: 1 });
            expect(s2Pages).toHaveLength(3);
            expect(s2Pages[0].pageNumber).toBe(1);
            expect(s2Pages[1].pageNumber).toBe(2);
            expect(s2Pages[2].pageNumber).toBe(3); // pageA1 appended at end

            // Assert source script pages are sequentially re-numbered (1, 2)
            const s1Pages = await IngestionPage.find({ answerScript: script1Id }).sort({ pageNumber: 1 });
            expect(s1Pages).toHaveLength(2);
            expect(s1Pages[0].pageNumber).toBe(1);
            expect(s1Pages[1].pageNumber).toBe(2);

            // Assert Script summaries are correct
            const s1Final = await AnswerScript.findById(script1Id);
            expect(s1Final?.startPageNumber).toBe(1);
            expect(s1Final?.endPageNumber).toBe(2);
            expect(s1Final?.pageCount).toBe(2);

            const s2Final = await AnswerScript.findById(script2Id);
            expect(s2Final?.startPageNumber).toBe(1);
            expect(s2Final?.endPageNumber).toBe(3);
            expect(s2Final?.pageCount).toBe(3);
        });

        // Case 2 — Move a non-cover page
        it('Case 2: should successfully move a non-cover page without E11000 unique index errors', async () => {
            const { batchId, script1Id, script2Id, pageA2Id } = await createMultiFileTestSetup(professorId);

            const s1 = await AnswerScript.findById(script1Id);
            const s2 = await AnswerScript.findById(script2Id);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: pageA2Id,
                    targetScriptId: script2Id,
                    versions: {
                        [script1Id]: s1!.__v,
                        [script2Id]: s2!.__v
                    }
                })
            });

            const res = await remapPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(200);

            const pageA2 = await IngestionPage.findById(pageA2Id);
            expect(pageA2?.answerScript?.toString()).toBe(script2Id);
            expect(pageA2?.fileIndex).toBe(1);

            const s2Pages = await IngestionPage.find({ answerScript: script2Id }).sort({ pageNumber: 1 });
            expect(s2Pages).toHaveLength(3);
            expect(s2Pages[0].pageNumber).toBe(1);
            expect(s2Pages[1].pageNumber).toBe(2);
            expect(s2Pages[2].pageNumber).toBe(3);
        });

        // Case 3 — Move between scripts in the SAME file
        it('Case 3: should successfully move page between scripts in the same file without reassignment errors', async () => {
            const { batchId, script1Id, script2Id, page3Id } = await createTestSetup(professorId);

            const s1 = await AnswerScript.findById(script1Id);
            const s2 = await AnswerScript.findById(script2Id);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: page3Id,
                    targetScriptId: script2Id,
                    versions: {
                        [script1Id]: s1!.__v,
                        [script2Id]: s2!.__v
                    }
                })
            });

            const res = await remapPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(200);

            const s1Final = await AnswerScript.findById(script1Id);
            expect(s1Final?.startPageNumber).toBe(1);
            expect(s1Final?.endPageNumber).toBe(2);
            expect(s1Final?.pageCount).toBe(2);

            const s2Final = await AnswerScript.findById(script2Id);
            expect(s2Final?.startPageNumber).toBe(3);
            expect(s2Final?.endPageNumber).toBe(5);
            expect(s2Final?.pageCount).toBe(3);
        });

        // Case 4 — Move then reorder
        it('Case 4: should successfully execute move followed by a reorder operation on destination script', async () => {
            const { batchId, script1Id, script2Id, pageA1Id, pageB1Id, pageB2Id } = await createMultiFileTestSetup(professorId);

            const s1 = await AnswerScript.findById(script1Id);
            const s2 = await AnswerScript.findById(script2Id);

            // Move A1 to script 2
            let req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: pageA1Id,
                    targetScriptId: script2Id,
                    versions: {
                        [script1Id]: s1!.__v,
                        [script2Id]: s2!.__v
                    }
                })
            });
            let res = await remapPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(200);

            const s2AfterRemap = await AnswerScript.findById(script2Id);

            // Now B has pages: B1, B2, A1
            // Reorder pages in B to: [pageB2Id, pageA1Id, pageB1Id]
            req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/reorder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scriptId: script2Id,
                    version: s2AfterRemap!.__v,
                    orderedPageIds: [pageB2Id, pageA1Id, pageB1Id]
                })
            });

            res = await reorderPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(200);

            const pB1 = await IngestionPage.findById(pageB1Id);
            const pB2 = await IngestionPage.findById(pageB2Id);
            const pA1 = await IngestionPage.findById(pageA1Id);

            // Sequence ordered as B2, A1, B1: B2 should be page 1, A1 should be page 2, B1 should be page 3
            expect(pB2?.pageNumber).toBe(1);
            expect(pA1?.pageNumber).toBe(2);
            expect(pB1?.pageNumber).toBe(3);

            const s2Final = await AnswerScript.findById(script2Id);
            expect(s2Final?.startPageNumber).toBe(1);
            expect(s2Final?.endPageNumber).toBe(3);
            expect(s2Final?.pageCount).toBe(3);
        });

        // Case 5 — Rollback
        it('Case 5: should rollback all changes to the database if a transaction fails after temporary numbering', async () => {
            const { batchId, script1Id, script2Id, pageA1Id } = await createMultiFileTestSetup(professorId);

            const s1 = await AnswerScript.findById(script1Id);
            const s2 = await AnswerScript.findById(script2Id);

            const pageA1Before = await IngestionPage.findById(pageA1Id);
            expect(pageA1Before?.pageNumber).toBe(1);
            expect(pageA1Before?.fileIndex).toBe(0);

            // Force Audit log write to fail during SCRIPT_REMAP log create
            const spyAudit = vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('Forced Audit Failure') as never);

            const req = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/remap`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pageId: pageA1Id,
                    targetScriptId: script2Id,
                    versions: {
                        [script1Id]: s1!.__v,
                        [script2Id]: s2!.__v
                    }
                })
            });

            const res = await remapPOST(req as any, { params: Promise.resolve({ id: batchId }) });
            expect(res.status).toBe(500);

            // Assert that page A1 database fields are restored exactly as they were
            const pageA1After = await IngestionPage.findById(pageA1Id);
            expect(pageA1After?.pageNumber).toBe(1);
            expect(pageA1After?.fileIndex).toBe(0);
            expect(pageA1After?.answerScript?.toString()).toBe(script1Id);

            // Assert source and destination script fields are restored
            const s1After = await AnswerScript.findById(script1Id);
            expect(s1After?.pageCount).toBe(3);
            expect(s1After?.__v).toBe(s1!.__v);

            const s2After = await AnswerScript.findById(script2Id);
            expect(s2After?.pageCount).toBe(2);
            expect(s2After?.__v).toBe(s2!.__v);

            spyAudit.mockRestore();
        });
    });

    describe('Integration Regression: Merge → Split → Reorder (E11000 on startPageNumber)', () => {
        beforeEach(() => {
            mockSessionUser = { id: professorId, email: 'prof@uni.edu', role: 'PROFESSOR' };
        });

        it('should merge two scripts, split the merged script, and reorder a result without E11000', async () => {
            const { batchId, script1Id, script2Id } = await createTestSetup(professorId);

            // Step 1: Merge Script 2 (pages 4,5) into Script 1 (pages 1,2,3)
            const s1 = await AnswerScript.findById(script1Id);
            const s2 = await AnswerScript.findById(script2Id);

            const mergeReq = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/merge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceScriptId: script2Id,
                    targetScriptId: script1Id,
                    versions: {
                        [script1Id]: s1!.__v,
                        [script2Id]: s2!.__v
                    }
                })
            });

            const mergeRes = await mergePOST(mergeReq as any, { params: Promise.resolve({ id: batchId }) });
            expect(mergeRes.status).toBe(200);

            // Source script2 should now be deleted
            const s2AfterMerge = await AnswerScript.findById(script2Id);
            expect(s2AfterMerge).toBeNull();

            // Target script1 should have 5 pages
            const s1AfterMerge = await AnswerScript.findById(script1Id);
            expect(s1AfterMerge?.pageCount).toBe(5);

            // All 5 pages should have unique pageNumbers
            const allPagesAfterMerge = await IngestionPage.find({ answerScript: script1Id }).sort({ pageNumber: 1 });
            expect(allPagesAfterMerge).toHaveLength(5);
            const pageNums = allPagesAfterMerge.map(p => p.pageNumber);
            const uniquePageNums = new Set(pageNums);
            expect(uniquePageNums.size).toBe(5); // no duplicates

            // Page numbers should be sequential 1..5
            expect(pageNums).toEqual([1, 2, 3, 4, 5]);

            // Step 2: Split the merged script into two groups
            // Group 1: pages 1,2 → Group 2: pages 3,4,5
            // We need to get the actual current page IDs from the merged script in order
            const [pg1, pg2, pg3, pg4, pg5] = allPagesAfterMerge;

            const splitReq = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/split`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scriptId: script1Id,
                    version: s1AfterMerge!.__v,
                    groups: [
                        [pg1._id.toString(), pg2._id.toString()],
                        [pg3._id.toString(), pg4._id.toString(), pg5._id.toString()]
                    ]
                })
            });

            // This must NOT throw E11000 on (batchId, fileIndex, startPageNumber)
            const splitRes = await splitPOST(splitReq as any, { params: Promise.resolve({ id: batchId }) });
            expect(splitRes.status).toBe(200);

            // Step 3: Verify every page belongs to exactly one script
            const allActiveScripts = await AnswerScript.find({ batchId, isActive: true }).sort({ startPageNumber: 1 });
            expect(allActiveScripts).toHaveLength(2);

            // Collect all pages across all scripts
            const pageToScript: Record<string, string> = {};
            for (const sc of allActiveScripts) {
                const scPages = await IngestionPage.find({ answerScript: sc._id });
                for (const p of scPages) {
                    expect(pageToScript[p._id.toString()]).toBeUndefined(); // no page in two scripts
                    pageToScript[p._id.toString()] = sc._id.toString();
                }
            }
            // All 5 pages must be assigned
            expect(Object.keys(pageToScript)).toHaveLength(5);

            // Step 4: Verify start/end/pageCount are correct
            const [sc1, sc2] = allActiveScripts;
            expect(sc1.startPageNumber).toBe(1);
            expect(sc1.endPageNumber).toBe(2);
            expect(sc1.pageCount).toBe(2);

            expect(sc2.startPageNumber).toBe(3);
            expect(sc2.endPageNumber).toBe(5);
            expect(sc2.pageCount).toBe(3);

            // Step 5: Verify unique index on startPageNumber is still valid
            const starts = allActiveScripts.map(s => s.startPageNumber);
            expect(new Set(starts).size).toBe(allActiveScripts.length);

            // Step 6: Reorder one resulting script and verify it still works
            // Reorder sc2 pages in reverse order
            const sc2Pages = await IngestionPage.find({ answerScript: sc2._id }).sort({ pageNumber: 1 });
            const reversedPageIds = [...sc2Pages].reverse().map(p => p._id.toString());

            const reorderReq = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/reorder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scriptId: sc2._id.toString(),
                    version: sc2.__v,
                    orderedPageIds: reversedPageIds
                })
            });

            const reorderRes = await reorderPOST(reorderReq as any, { params: Promise.resolve({ id: batchId }) });
            expect(reorderRes.status).toBe(200);

            // Verify persisted page numbers of sc2 after reorder
            const sc2PagesAfterReorder = await IngestionPage.find({ answerScript: sc2._id }).sort({ pageNumber: 1 });
            expect(sc2PagesAfterReorder).toHaveLength(3);

            // Page numbers should still be 3,4,5 (same range) but assigned to reversed page IDs
            expect(sc2PagesAfterReorder[0].pageNumber).toBe(3);
            expect(sc2PagesAfterReorder[1].pageNumber).toBe(4);
            expect(sc2PagesAfterReorder[2].pageNumber).toBe(5);

            // The order should be reversed: the page that was at 5 is now at 3, etc.
            expect(sc2PagesAfterReorder[0]._id.toString()).toBe(sc2Pages[2]._id.toString()); // originally page 5
            expect(sc2PagesAfterReorder[1]._id.toString()).toBe(sc2Pages[1]._id.toString()); // originally page 4
            expect(sc2PagesAfterReorder[2]._id.toString()).toBe(sc2Pages[0]._id.toString()); // originally page 3

            // Script summary still valid
            const sc2Final = await AnswerScript.findById(sc2._id);
            expect(sc2Final?.startPageNumber).toBe(3);
            expect(sc2Final?.endPageNumber).toBe(5);
            expect(sc2Final?.pageCount).toBe(3);
        });
    });

    // ─── CROSS-FILE: the exact scenario reported in the manual test failure ───────
    // Script A  : fileIndex=0 (file-a), pages 1,2,3
    // Script B  : fileIndex=1 (file-b), pages 1,2   ← both files start at pageNumber 1
    //
    // Bug trace (before fix):
    //   mergeScripts only renumbered pages in freshTarget.fileIndex (=0).
    //   Source pages (fileIndex=1, pageNumbers 1,2) were NEVER renumbered.
    //   After merge the merged script owned pages with duplicate pageNumbers:
    //     { fileIndex:0, pNum:1 }, { fileIndex:1, pNum:1 }, { fileIndex:0, pNum:2 }, …
    //   splitScript computed startPageNumber = groupPages[0].pageNumber.
    //   Group 0 contained a page with pNum:1 → freshOriginal.startPageNumber = 1  (saved)
    //   Group 1 also contained a page with pNum:1 → newScript.startPageNumber = 1 → E11000
    //
    // Fix:  during cross-file merge, migrate source pages into the target file's
    //       numbering space before writing any AnswerScript summary.
    describe('Integration Regression: Cross-file Merge → Split → Reorder (E11000 on startPageNumber)', () => {
        beforeEach(() => {
            mockSessionUser = { id: professorId, email: 'prof@uni.edu', role: 'PROFESSOR' };
        });

        it('cross-file merge then split must not produce E11000 on (batchId, fileIndex, startPageNumber)', async () => {
            // ── SETUP ────────────────────────────────────────────────────────────────
            // Script A  fileIndex:0 (file-a)  pages 1,2,3
            // Script B  fileIndex:1 (file-b)  pages 1,2   ← both start at pageNumber 1
            const {
                batchId,
                script1Id, // Script A (fileIndex:0)
                script2Id, // Script B (fileIndex:1)
                pageA1Id,
                pageA2Id,
                pageA3Id,
                pageB1Id,
                pageB2Id
            } = await createMultiFileTestSetup(professorId);

            // Verify initial state
            const sA = await AnswerScript.findById(script1Id);
            const sB = await AnswerScript.findById(script2Id);
            expect(sA?.fileIndex).toBe(0);
            expect(sA?.startPageNumber).toBe(1);
            expect(sB?.fileIndex).toBe(1);
            expect(sB?.startPageNumber).toBe(1); // ← same startPageNumber, different fileIndex

            // ── STEP 1: MERGE Script B into Script A ─────────────────────────────────
            const mergeReq = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/merge`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sourceScriptId: script2Id, // Script B → source
                    targetScriptId: script1Id, // Script A → target
                    versions: { [script1Id]: sA!.__v, [script2Id]: sB!.__v }
                })
            });

            const mergeRes = await mergePOST(mergeReq as any, { params: Promise.resolve({ id: batchId }) });
            expect(mergeRes.status).toBe(200);

            // Script B must be deleted
            expect(await AnswerScript.findById(script2Id)).toBeNull();

            // Script A must now own all 5 pages
            const sAMerged = await AnswerScript.findById(script1Id);
            expect(sAMerged?.pageCount).toBe(5);
            expect(sAMerged?.fileIndex).toBe(0); // still in file-a space

            // All 5 pages must now be in file-a's space (fileIndex:0)
            const mergedPages = await IngestionPage.find({ answerScript: script1Id }).sort({ pageNumber: 1 });
            expect(mergedPages).toHaveLength(5);
            for (const p of mergedPages) {
                expect(p.fileIndex).toBe(0);
                expect(p.fileId).toBe('file-a');
            }

            // All pageNumbers must be unique (no duplicates from the cross-file origin)
            const mergedNums = mergedPages.map(p => p.pageNumber);
            expect(new Set(mergedNums).size).toBe(5);

            // The three original file-a pages stay at 1,2,3.
            // The two file-b pages are appended as 4,5.
            expect(mergedNums).toEqual([1, 2, 3, 4, 5]);

            // ── STEP 2: SPLIT the merged script into two groups ──────────────────────
            // Split the five pages into group=[pA1,pA2] and group=[pA3,pB1-migrated,pB2-migrated]
            // (The operator placed one "original file-b" page in each group —
            //  this is the exact pattern that triggered E11000 before the fix.)
            const [mp1, mp2, mp3, mp4, mp5] = mergedPages;

            // Deliberately split so that group 1 contains the last page of the
            // original file-a range and both migrated file-b pages, while group 0
            // contains the first two pages.  Both groups start at different numbers.
            const splitReq = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/split`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scriptId: script1Id,
                    version: sAMerged!.__v,
                    groups: [
                        [mp1._id.toString(), mp2._id.toString()],         // pageNumbers 1,2
                        [mp3._id.toString(), mp4._id.toString(), mp5._id.toString()] // pageNumbers 3,4,5
                    ]
                })
            });

            // Must NOT throw E11000 on (batchId, fileIndex, startPageNumber)
            const splitRes = await splitPOST(splitReq as any, { params: Promise.resolve({ id: batchId }) });
            expect(splitRes.status).toBe(200);

            // ── STEP 3: ASSERT resulting AnswerScript metadata ───────────────────────
            const resultScripts = await AnswerScript.find({ batchId, isActive: true }).sort({ startPageNumber: 1 });
            expect(resultScripts).toHaveLength(2);

            const [rs1, rs2] = resultScripts;

            // rs1 inherits Script A identity; rs2 is newly created
            expect(rs1.fileIndex).toBe(0);
            expect(rs1.startPageNumber).toBe(1);
            expect(rs1.endPageNumber).toBe(2);
            expect(rs1.pageCount).toBe(2);

            expect(rs2.fileIndex).toBe(0);
            expect(rs2.startPageNumber).toBe(3);
            expect(rs2.endPageNumber).toBe(5);
            expect(rs2.pageCount).toBe(3);

            // startPageNumbers must be unique (validate unique index invariant)
            const starts = resultScripts.map(s => s.startPageNumber);
            expect(new Set(starts).size).toBe(2);

            // Every page must belong to exactly one script (no leaks, no orphans)
            const allPageIds = [pageA1Id, pageA2Id, pageA3Id, pageB1Id, pageB2Id];
            const pageToScript: Record<string, string> = {};
            for (const rs of resultScripts) {
                const rsPages = await IngestionPage.find({ answerScript: rs._id });
                for (const p of rsPages) {
                    expect(pageToScript[p._id.toString()]).toBeUndefined();
                    pageToScript[p._id.toString()] = rs._id.toString();
                }
            }
            // All 5 original page documents must be accounted for
            for (const pid of allPageIds) {
                expect(pageToScript[pid]).toBeDefined();
            }
            expect(Object.keys(pageToScript)).toHaveLength(5);

            // All pages must be in file-a space after cross-file migration
            const allRsPages = await IngestionPage.find({ batchId });
            for (const p of allRsPages) {
                expect(p.fileIndex).toBe(0);
                expect(p.fileId).toBe('file-a');
            }

            // ── STEP 4: REORDER one resulting script ─────────────────────────────────
            // Reorder rs2 (pages 3,4,5) in reverse → 5,4,3
            const rs2Pages = await IngestionPage.find({ answerScript: rs2._id }).sort({ pageNumber: 1 });
            const reversedIds = [...rs2Pages].reverse().map(p => p._id.toString());

            const reorderReq = new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/reorder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scriptId: rs2._id.toString(),
                    version: rs2.__v,
                    orderedPageIds: reversedIds
                })
            });

            const reorderRes = await reorderPOST(reorderReq as any, { params: Promise.resolve({ id: batchId }) });
            expect(reorderRes.status).toBe(200);

            // rs2's page range must stay {3,4,5}; page-number assignments change
            const rs2After = await IngestionPage.find({ answerScript: rs2._id }).sort({ pageNumber: 1 });
            expect(rs2After.map(p => p.pageNumber)).toEqual([3, 4, 5]);

            // The page that was originally at position 5 is now at position 3
            expect(rs2After[0]._id.toString()).toBe(rs2Pages[2]._id.toString());
            expect(rs2After[1]._id.toString()).toBe(rs2Pages[1]._id.toString());
            expect(rs2After[2]._id.toString()).toBe(rs2Pages[0]._id.toString());

            // Script A summary intact
            const rs2Final = await AnswerScript.findById(rs2._id);
            expect(rs2Final?.startPageNumber).toBe(3);
            expect(rs2Final?.endPageNumber).toBe(5);
            expect(rs2Final?.pageCount).toBe(3);
        });

        it('cross-file merge then split into groups that both start at pNum:1 must not produce E11000', async () => {
            // This is the sharpest possible reproduction of the original failure:
            // Group 0 = [pageA1 (pNum:1)] — inheriting group, startPageNumber would be 1
            // Group 1 = [pageB1-migrated, pageA2, pageA3, pageB2-migrated]
            //           After migration pageB1 is at pNum:4, pageB2 at pNum:5.
            //           startPageNumber for group 1 = 2 (pageA2).
            //
            // Before the fix, if we split before migration, group 0 starts at pNum:1 AND
            // group 1 also starts at pNum:1 (the un-migrated pageB1) → E11000.
            const { batchId, script1Id, script2Id } = await createMultiFileTestSetup(professorId);

            const sA = await AnswerScript.findById(script1Id);
            const sB = await AnswerScript.findById(script2Id);

            // Merge
            const mergeRes = await mergePOST(
                new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/merge`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sourceScriptId: script2Id,
                        targetScriptId: script1Id,
                        versions: { [script1Id]: sA!.__v, [script2Id]: sB!.__v }
                    })
                }) as any,
                { params: Promise.resolve({ id: batchId }) }
            );
            expect(mergeRes.status).toBe(200);

            const sAMerged = await AnswerScript.findById(script1Id);
            const mergedPages = await IngestionPage.find({ answerScript: script1Id }).sort({ pageNumber: 1 });

            // Split: put first page alone in group 0, remaining 4 pages in group 1
            // Group 0 startPageNumber = 1, Group 1 startPageNumber = 2 → no collision
            const splitRes = await splitPOST(
                new Request(`http://localhost:3000/api/ingest/${batchId}/scripts/split`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        scriptId: script1Id,
                        version: sAMerged!.__v,
                        groups: [
                            [mergedPages[0]._id.toString()],
                            mergedPages.slice(1).map(p => p._id.toString())
                        ]
                    })
                }) as any,
                { params: Promise.resolve({ id: batchId }) }
            );
            expect(splitRes.status).toBe(200);

            const finals = await AnswerScript.find({ batchId, isActive: true }).sort({ startPageNumber: 1 });
            expect(finals).toHaveLength(2);
            expect(new Set(finals.map(s => s.startPageNumber)).size).toBe(2);
            expect(finals[0].startPageNumber).toBe(1);
            expect(finals[1].startPageNumber).toBe(2);
        });
    });
});
