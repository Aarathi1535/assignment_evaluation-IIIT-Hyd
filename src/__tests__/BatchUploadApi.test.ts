/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import Batch from '../models/Batch';
import IngestionJob from '../models/IngestionJob';
import AuditLog from '../models/AuditLog';
import BatchRepository from '../repositories/BatchRepository';
import BatchService from '../services/BatchService';
import mongoose from 'mongoose';

let mockSessionUser: any = null;

// Mock next-auth to allow dynamic control of session users in testing
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

// Helpers to construct realistic test binary payloads
function createValidPdfBuffer(pageCount = 1): Buffer {
    let pageObjs = '';
    const kidsArr: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
        const objId = 2 + i;
        kidsArr.push(`${objId} 0 R`);
        pageObjs += `${objId} 0 obj\n<< /Type /Page /Parent 2 0 R >>\nendobj\n`;
    }

    const pdfContent = [
        '%PDF-1.4',
        '1 0 obj',
        '<< /Type /Catalog /Pages 2 0 R >>',
        'endobj',
        '2 0 obj',
        `<< /Type /Pages /Kids [${kidsArr.join(' ')}] /Count ${pageCount} >>`,
        'endobj',
        pageObjs,
        'xref',
        `0 ${3 + pageCount}`,
        'trailer',
        '<< /Size 10 /Root 1 0 R >>',
        'startxref',
        '500',
        '%%EOF'
    ].join('\n');

    return Buffer.from(pdfContent, 'utf-8');
}

function createEncryptedPdfBuffer(): Buffer {
    const pdfContent = [
        '%PDF-1.4',
        '1 0 obj',
        '<< /Type /Catalog /Pages 2 0 R >>',
        'endobj',
        '2 0 obj',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        'endobj',
        '3 0 obj',
        '<< /Type /Page /Parent 2 0 R >>',
        'endobj',
        'trailer',
        '<< /Size 4 /Root 1 0 R /Encrypt 4 0 R >>',
        'startxref',
        '250',
        '%%EOF'
    ].join('\n');

    return Buffer.from(pdfContent, 'utf-8');
}

function createValidJpegBuffer(): Buffer {
    return Buffer.from([
        0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
        0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9
    ]);
}

function createValidPngBuffer(): Buffer {
    return Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89
    ]);
}

function toFile(buffer: Buffer | string, name: string, type: string): File {
    const data = typeof buffer === 'string' ? buffer : new Uint8Array(buffer);
    return new File([data], name, { type });
}

describe('Batch Upload Pipeline API Tests (AE-042)', () => {
    let ingestPOST: any;
    const professorId = new mongoose.Types.ObjectId().toString();
    const adminId = new mongoose.Types.ObjectId().toString();
    const otherProfessorId = new mongoose.Types.ObjectId().toString();

    beforeAll(async () => {
        ingestPOST = (await import('../app/api/ingest/route')).POST;
    });

    describe('1. Authentication & Permission Enforcement', () => {
        it('should return 401 Unauthorized when unauthenticated', async () => {
            mockSessionUser = null;
            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST'
            });
            const res = await ingestPOST(req as any);
            expect(res.status).toBe(401);
            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.message).toBe('Unauthorized');
        });

        it('should return 403 Forbidden for STUDENT role', async () => {
            mockSessionUser = {
                id: new mongoose.Types.ObjectId().toString(),
                email: 'student@university.edu',
                name: 'Student User',
                role: 'STUDENT'
            };
            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST'
            });
            const res = await ingestPOST(req as any);
            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.success).toBe(false);
            expect(body.message).toBe('Forbidden');
        });

        it('should return 403 Forbidden for TA role', async () => {
            mockSessionUser = {
                id: new mongoose.Types.ObjectId().toString(),
                email: 'ta@university.edu',
                name: 'TA User',
                role: 'TA'
            };
            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST'
            });
            const res = await ingestPOST(req as any);
            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.success).toBe(false);
        });

        it('should reject non-multipart request with 400 Bad Request', async () => {
            mockSessionUser = {
                id: professorId,
                email: 'prof@university.edu',
                name: 'Professor User',
                role: 'PROFESSOR'
            };
            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            const res = await ingestPOST(req as any);
            expect(res.status).toBe(400);
            const body = await res.json();
            expect(body.message).toContain('multipart/form-data');
        });
    });

    describe('2. Valid Batch Uploads', () => {
        beforeEach(() => {
            mockSessionUser = {
                id: professorId,
                email: 'prof@university.edu',
                name: 'Professor User',
                role: 'PROFESSOR'
            };
        });

        it('should successfully upload a valid single PDF and create an ingestion job', async () => {
            const pdfBuffer = createValidPdfBuffer(2);
            const formData = new FormData();
            const file = toFile(pdfBuffer, 'student_scan.pdf', 'application/pdf');
            formData.append('file', file);

            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST',
                body: formData
            });

            const res = await ingestPOST(req as any);
            expect(res.status).toBe(201);
            const resBody = await res.json();

            expect(resBody.success).toBe(true);
            expect(resBody.data.batchId).toBeDefined();
            expect(resBody.data.status).toBe('queued');
            expect(resBody.data.totalFiles).toBe(1);
            expect(resBody.data.totalPageCount).toBe(2);
            expect(resBody.data.job.status).toBe('queued');
            expect(resBody.data.job.totalPages).toBe(2);

            // Verify Batch persisted in DB
            const batchInDb = await Batch.findOne({ batchId: resBody.data.batchId });
            expect(batchInDb).not.toBeNull();
            expect(batchInDb!.uploadedBy.toString()).toBe(professorId);
            expect(batchInDb!.files.length).toBe(1);
            expect(batchInDb!.files[0].originalFilename).toBe('student_scan.pdf');
            expect(batchInDb!.files[0].storageKey).toContain(resBody.data.batchId);
            expect(batchInDb!.files[0].pageCount).toBe(2);

            // Verify IngestionJob persisted in DB
            const jobInDb = await IngestionJob.findOne({ batchId: resBody.data.batchId });
            expect(jobInDb).not.toBeNull();
            expect(['queued', 'processing']).toContain(jobInDb!.status);
            expect(jobInDb!.totalPages).toBe(2);
            expect(jobInDb!.uploadedBy.toString()).toBe(professorId);

            // Verify SUCCESS audit log
            const auditLog = await AuditLog.findOne({
                action: 'BATCH_CREATED',
                outcome: 'SUCCESS',
                user: new mongoose.Types.ObjectId(professorId)
            });
            expect(auditLog).not.toBeNull();
        });

        it('should successfully upload valid image files (JPEG and PNG)', async () => {
            const jpegBuffer = createValidJpegBuffer();
            const pngBuffer = createValidPngBuffer();

            const formData = new FormData();
            formData.append('file1', toFile(jpegBuffer, 'scan1.jpg', 'image/jpeg'));
            formData.append('file2', toFile(pngBuffer, 'scan2.png', 'image/png'));

            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST',
                body: formData
            });

            const res = await ingestPOST(req as any);
            expect(res.status).toBe(201);
            const resBody = await res.json();

            expect(resBody.success).toBe(true);
            expect(resBody.data.totalFiles).toBe(2);
            expect(resBody.data.totalPageCount).toBe(2); // 1 page per image
            expect(resBody.data.files[0].fileType).toBe('image');
            expect(resBody.data.files[1].fileType).toBe('image');
        });

        it('should calculate correct total page count for mixed PDF and image batch', async () => {
            const pdf3Pages = createValidPdfBuffer(3);
            const jpegBuffer = createValidJpegBuffer();

            const formData = new FormData();
            formData.append('file1', toFile(pdf3Pages, 'multi.pdf', 'application/pdf'));
            formData.append('file2', toFile(jpegBuffer, 'page.jpg', 'image/jpeg'));

            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST',
                body: formData
            });

            const res = await ingestPOST(req as any);
            expect(res.status).toBe(201);
            const resBody = await res.json();

            expect(resBody.data.totalFiles).toBe(2);
            expect(resBody.data.totalPageCount).toBe(4); // 3 (PDF) + 1 (JPEG) = 4
            expect(resBody.data.job.totalPages).toBe(4);
        });
    });

    describe('3. Limit Enforcement (HTTP 413)', () => {
        beforeEach(() => {
            mockSessionUser = {
                id: professorId,
                email: 'prof@university.edu',
                name: 'Professor User',
                role: 'PROFESSOR'
            };
        });

        it('should return 413 when files per batch exceeds 20', async () => {
            const formData = new FormData();
            const jpegBuffer = createValidJpegBuffer();

            for (let i = 0; i < 21; i++) {
                formData.append(`file_${i}`, toFile(jpegBuffer, `img_${i}.jpg`, 'image/jpeg'));
            }

            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST',
                body: formData
            });

            const res = await ingestPOST(req as any);
            expect(res.status).toBe(413);
            const resBody = await res.json();
            expect(resBody.success).toBe(false);
            expect(resBody.message).toContain('Maximum files per batch limit exceeded');

            // Verify FAILURE audit log written
            const auditLog = await AuditLog.findOne({
                action: 'BATCH_CREATED',
                outcome: 'FAILURE'
            });
            expect(auditLog).not.toBeNull();
        });

        it('should return 413 when single file size exceeds 50 MB in BatchService', async () => {
            const mockOversizedFile = {
                name: 'huge_scan.pdf',
                buffer: createValidPdfBuffer(1),
                size: 51 * 1024 * 1024 // 51 MB simulated size
            };

            await expect(
                BatchService.createBatch([mockOversizedFile], undefined, {
                    actingUserId: professorId,
                    actingUserRole: 'PROFESSOR'
                })
            ).rejects.toMatchObject({
                statusCode: 413,
                message: expect.stringContaining('Single-file size limit exceeded')
            });
        });

        it('should reject oversized single file (> 50 MB) at route level before arrayBuffer() is called', async () => {
            const file = toFile(createValidPdfBuffer(1), 'huge_scan.pdf', 'application/pdf');
            Object.defineProperty(file, 'size', { value: 51 * 1024 * 1024 });
            const arrayBufferSpy = vi.spyOn(file, 'arrayBuffer');

            const formData = new FormData();
            formData.append('file', file);

            const mockReq = {
                headers: {
                    get: (h: string) => (h.toLowerCase() === 'content-type' ? 'multipart/form-data' : null)
                },
                formData: async () => formData
            };

            const res = await ingestPOST(mockReq as any);
            expect(res.status).toBe(413);
            const resBody = await res.json();
            expect(resBody.success).toBe(false);
            expect(resBody.message).toContain('exceeds maximum single-file size limit');
            expect(arrayBufferSpy).not.toHaveBeenCalled();
        });

        it('should return 413 when total batch size exceeds 200 MB in BatchService', async () => {
            const files = [];
            for (let i = 0; i < 5; i++) {
                files.push({
                    name: `file_${i}.pdf`,
                    buffer: createValidPdfBuffer(1),
                    size: 45 * 1024 * 1024 // 5 * 45 MB = 225 MB > 200 MB
                });
            }

            await expect(
                BatchService.createBatch(files, undefined, {
                    actingUserId: professorId,
                    actingUserRole: 'PROFESSOR'
                })
            ).rejects.toMatchObject({
                statusCode: 413,
                message: expect.stringContaining('Total batch size limit exceeded')
            });
        });

        it('should reject batch when cumulative file size exceeds 200 MB at route level before buffering exceeding file', async () => {
            const file1 = toFile(createValidPdfBuffer(1), 'file1.pdf', 'application/pdf');
            Object.defineProperty(file1, 'size', { value: 45 * 1024 * 1024 });

            const file2 = toFile(createValidPdfBuffer(1), 'file2.pdf', 'application/pdf');
            Object.defineProperty(file2, 'size', { value: 45 * 1024 * 1024 });

            const file3 = toFile(createValidPdfBuffer(1), 'file3.pdf', 'application/pdf');
            Object.defineProperty(file3, 'size', { value: 45 * 1024 * 1024 });

            const file4 = toFile(createValidPdfBuffer(1), 'file4.pdf', 'application/pdf');
            Object.defineProperty(file4, 'size', { value: 45 * 1024 * 1024 });

            const file5 = toFile(createValidPdfBuffer(1), 'file5.pdf', 'application/pdf');
            Object.defineProperty(file5, 'size', { value: 45 * 1024 * 1024 });
            const file5ArrayBufferSpy = vi.spyOn(file5, 'arrayBuffer');

            const formData = new FormData();
            formData.append('file1', file1);
            formData.append('file2', file2);
            formData.append('file3', file3);
            formData.append('file4', file4);
            formData.append('file5', file5);

            const mockReq = {
                headers: {
                    get: (h: string) => (h.toLowerCase() === 'content-type' ? 'multipart/form-data' : null)
                },
                formData: async () => formData
            };

            const res = await ingestPOST(mockReq as any);
            expect(res.status).toBe(413);
            const resBody = await res.json();
            expect(resBody.success).toBe(false);
            expect(resBody.message).toContain('exceeds maximum allowed total request size limit');
            expect(file5ArrayBufferSpy).not.toHaveBeenCalled();
        });

        it('should return 413 when PDF page count exceeds 200 pages', async () => {
            const hugePdf = createValidPdfBuffer(205);
            const formData = new FormData();
            formData.append('file', toFile(hugePdf, 'huge_book.pdf', 'application/pdf'));

            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST',
                body: formData
            });

            const res = await ingestPOST(req as any);
            expect(res.status).toBe(413);
            const resBody = await res.json();
            expect(resBody.success).toBe(false);
            expect(resBody.message).toContain('PDF page count limit exceeded');
        });

        it('should accept multiple PDFs whose individual page counts are <= 200 even when combined page count exceeds 200', async () => {
            const pdf1 = createValidPdfBuffer(120);
            const pdf2 = createValidPdfBuffer(150);
            // Combined page count = 270 > 200, but each file <= 200
            const formData = new FormData();
            formData.append('file1', toFile(pdf1, 'exam_part1.pdf', 'application/pdf'));
            formData.append('file2', toFile(pdf2, 'exam_part2.pdf', 'application/pdf'));

            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST',
                body: formData
            });

            const res = await ingestPOST(req as any);
            expect(res.status).toBe(201);
            const resBody = await res.json();
            expect(resBody.success).toBe(true);
            expect(resBody.data.totalFiles).toBe(2);
            expect(resBody.data.totalPageCount).toBe(270);
            expect(resBody.data.job.totalPages).toBe(270);
        });
    });

    describe('4. Magic Byte Verification & Encryption Rejection', () => {
        beforeEach(() => {
            mockSessionUser = {
                id: professorId,
                email: 'prof@university.edu',
                name: 'Professor User',
                role: 'PROFESSOR'
            };
        });

        it('should reject file with forged PDF Content-Type and extension (e.g. text disguised as PDF)', async () => {
            const textContent = 'name,email,role\nAlice,alice@uni.edu,STUDENT';
            const formData = new FormData();
            // Client claims application/pdf and .pdf extension, but magic bytes are text
            formData.append('file', toFile(textContent, 'malicious.pdf', 'application/pdf'));

            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST',
                body: formData
            });

            const res = await ingestPOST(req as any);
            expect(res.status).toBe(400);
            const resBody = await res.json();
            expect(resBody.success).toBe(false);
            expect(resBody.message).toContain('Unsupported or invalid file content');
        });

        it('should reject encrypted/password-protected PDF with 400 Bad Request', async () => {
            const encryptedPdf = createEncryptedPdfBuffer();
            const formData = new FormData();
            formData.append('file', toFile(encryptedPdf, 'encrypted.pdf', 'application/pdf'));

            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST',
                body: formData
            });

            const res = await ingestPOST(req as any);
            expect(res.status).toBe(400);
            const resBody = await res.json();
            expect(resBody.success).toBe(false);
            expect(resBody.message).toContain('Encrypted or password-protected PDF');
        });
    });

    describe('5. Security, Ownership & Repository-Layer Scoping', () => {
        beforeEach(() => {
            mockSessionUser = {
                id: professorId,
                email: 'prof@university.edu',
                name: 'Professor User',
                role: 'PROFESSOR'
            };
        });

        it('should sanitize path traversal filenames and generate secure server-side storage paths', async () => {
            const pdfBuffer = createValidPdfBuffer(1);
            const formData = new FormData();
            formData.append('file', toFile(pdfBuffer, '../../../../etc/passwd', 'application/pdf'));

            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST',
                body: formData
            });

            const res = await ingestPOST(req as any);
            expect(res.status).toBe(201);
            const resBody = await res.json();

            const fileRecord = resBody.data.files[0];
            // Display filename must be sanitized (no path traversal ../)
            expect(fileRecord.originalFilename).not.toContain('..');
            expect(fileRecord.originalFilename).toBe('passwd');
            // Storage key must be server-generated with UUID
            expect(fileRecord.storageKey).toMatch(/^batches\/[0-9a-f-]+\/[0-9a-f-]+\.pdf$/);
        });

        it('should derive batch ownership strictly from session and ignore any spoofed uploadedBy field', async () => {
            const pdfBuffer = createValidPdfBuffer(1);
            const formData = new FormData();
            formData.append('file', toFile(pdfBuffer, 'test.pdf', 'application/pdf'));
            // Attempt to spoof ownership to other user
            formData.append('uploadedBy', otherProfessorId);

            const req = new Request('http://localhost:3000/api/ingest', {
                method: 'POST',
                body: formData
            });

            const res = await ingestPOST(req as any);
            expect(res.status).toBe(201);
            const resBody = await res.json();

            const batchInDb = await Batch.findOne({ batchId: resBody.data.batchId });
            expect(batchInDb!.uploadedBy.toString()).toBe(professorId);
            expect(batchInDb!.uploadedBy.toString()).not.toBe(otherProfessorId);
        });

        it('should enforce deny-by-default repository-level owner scoping', async () => {
            // Create a batch belonging to professorId
            const pdfBuffer = createValidPdfBuffer(1);
            const { batch } = await BatchService.createBatch(
                [{ name: 'exam_paper.pdf', buffer: pdfBuffer, size: pdfBuffer.length }],
                undefined,
                { actingUserId: professorId, actingUserRole: 'PROFESSOR' }
            );

            // 1. Owner professor can retrieve batch
            const ownerAccess = await BatchRepository.getBatchById(batch.batchId, professorId, 'PROFESSOR');
            expect(ownerAccess).not.toBeNull();
            expect(ownerAccess!.batchId).toBe(batch.batchId);

            // 2. Admin can retrieve batch
            const adminAccess = await BatchRepository.getBatchById(batch.batchId, adminId, 'ADMIN');
            expect(adminAccess).not.toBeNull();

            // 3. Different professor cannot access (returns null)
            const otherProfAccess = await BatchRepository.getBatchById(batch.batchId, otherProfessorId, 'PROFESSOR');
            expect(otherProfAccess).toBeNull();

            // 4. Student cannot access (returns null)
            const studentAccess = await BatchRepository.getBatchById(batch.batchId, 'some-student-id', 'STUDENT');
            expect(studentAccess).toBeNull();

            // 5. TA cannot access (returns null)
            const taAccess = await BatchRepository.getBatchById(batch.batchId, 'some-ta-id', 'TA');
            expect(taAccess).toBeNull();

            // 6. Missing context returns null (deny-by-default)
            const anonAccess = await BatchRepository.getBatchById(batch.batchId, undefined, undefined);
            expect(anonAccess).toBeNull();
        });
    });
});
