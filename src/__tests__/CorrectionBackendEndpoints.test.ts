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
        await replSet.stop();

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
});
