/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';
import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionJob, { IngestionStatus } from '../models/IngestionJob';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import BatchRepository from '../repositories/BatchRepository';
import DerivedStorageService from '../services/DerivedStorageService';
import {
  requireAnyPermission,
  requireGradingOrAnnotationAccess,
  GRADING_OR_CANVAS_PERMISSIONS,
} from '../lib/apiAuth';
import { Permission } from '../constants/permissions';

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

describe('AE-123: GET /api/ingest/[id]/pages/[pageId]/image (Answer Sheet Image Route)', () => {
  let imageGET: any;

  let profUser: any;
  let otherProfUser: any;
  let taUser: any;
  let unallocatedTaUser: any;
  let studentUser: any;
  let adminUser: any;

  let courseA: any;
  let examA: any;
  let answerScriptA: any;

  let courseB: any;
  let examB: any;
  let answerScriptB: any;
  let batchB: any;
  let jobB: any;
  let pageB: any;

  let testBatch: any;
  let testJob: any;
  let pagePng: any;
  let pageJpg: any;
  let pageWebp: any;
  let pageGif: any;
  let pageMissingStorageKey: any;

  beforeAll(async () => {
    const route = await import('../app/api/ingest/[id]/pages/[pageId]/image/route');
    imageGET = route.GET;
  });

  beforeEach(async () => {
    mockSessionUser = null;

    await Allocation.deleteMany({});
    await IngestionPage.deleteMany({});
    await IngestionJob.deleteMany({});
    await Batch.deleteMany({});
    await AnswerScript.deleteMany({});
    await Exam.deleteMany({});
    await Course.deleteMany({});
    await User.deleteMany({});

    // 1. Create Users
    profUser = await User.create({
      name: 'Professor Severus Snape',
      email: `snape-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true,
    });

    otherProfUser = await User.create({
      name: 'Professor Minerva McGonagall',
      email: `mcgonagall-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true,
    });

    taUser = await User.create({
      name: 'Hermione Granger (Allocated TA)',
      email: `hermione-ta-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.TA,
      isActive: true,
    });

    unallocatedTaUser = await User.create({
      name: 'Draco Malfoy (Unallocated TA)',
      email: `draco-ta-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.TA,
      isActive: true,
    });

    studentUser = await User.create({
      name: 'Harry Potter (Student)',
      email: `harry-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });

    adminUser = await User.create({
      name: 'Albus Dumbledore (Admin)',
      email: `dumbledore-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.ADMIN,
      isActive: true,
    });

    // 2. Create Course A and Exam A
    courseA = await Course.create({
      courseCode: `POTION-101-${Date.now()}`,
      courseName: 'Potions Masterclass',
      semester: 1,
      academicYear: '2025-2026',
      professor: profUser._id,
      teachingAssistants: [taUser._id, unallocatedTaUser._id],
      isActive: true,
    });

    examA = await Exam.create({
      title: 'Potions Midterm Exam',
      course: courseA._id,
      createdBy: profUser._id,
      totalMarks: 100,
      numberOfQuestions: 5,
      examDate: new Date(),
      status: ExamStatus.PUBLISHED,
      isActive: true,
    });

    // 3. Create Batch owned by profUser
    const batchId = crypto.randomUUID();
    testBatch = await BatchRepository.createBatch({
      batchId,
      uploadedBy: profUser._id as mongoose.Types.ObjectId,
      files: [
        {
          fileId: 'file-1',
          fileIndex: 0,
          originalFilename: 'potions_exam.pdf',
          fileType: 'pdf',
          mimeType: 'application/pdf',
          size: 4096,
          pageCount: 5,
          storageKey: `batches/${batchId}/potions_exam.pdf`,
        },
      ],
      totalFiles: 1,
      totalSize: 4096,
      totalPageCount: 5,
      status: BatchStatus.QUEUED,
      isActive: true,
    });

    testJob = await BatchRepository.createIngestionJob({
      batchId,
      batch: testBatch._id as mongoose.Types.ObjectId,
      uploadedBy: profUser._id as mongoose.Types.ObjectId,
      status: IngestionStatus.DONE,
      totalPages: 5,
      processedPages: 5,
      failedPages: 0,
    });

    // 4. Create AnswerScript A linked to Exam A and Student
    answerScriptA = await AnswerScript.create({
      exam: examA._id,
      student: studentUser._id,
      batchId,
      fileIndex: 0,
      pageCount: 5,
      identificationStatus: IdentificationStatus.IDENTIFIED,
      isActive: true,
    });

    // 5. Create Allocation for taUser on answerScriptA
    await Allocation.create({
      exam: examA._id,
      ta: taUser._id,
      answerScript: answerScriptA._id,
      allocatedBy: profUser._id,
      status: AllocationStatus.PENDING,
      rule: AllocationRule.EQUAL,
    });

    // 6. Create IngestionPages linked to answerScriptA
    pagePng = await IngestionPage.create({
      batchId,
      job: testJob._id as mongoose.Types.ObjectId,
      fileId: 'file-1',
      fileIndex: 0,
      storageKey: `batches/${batchId}/derived/file-1/1/page.png`,
      thumbnailKey: `batches/${batchId}/derived/file-1/1/thumb.jpg`,
      pageNumber: 1,
      status: PageProcessingStatus.PROCESSED,
      answerScript: answerScriptA._id,
    });

    pageJpg = await IngestionPage.create({
      batchId,
      job: testJob._id as mongoose.Types.ObjectId,
      fileId: 'file-1',
      fileIndex: 0,
      storageKey: `batches/${batchId}/derived/file-1/2/page.jpeg`,
      thumbnailKey: `batches/${batchId}/derived/file-1/2/thumb.jpg`,
      pageNumber: 2,
      status: PageProcessingStatus.PROCESSED,
      answerScript: answerScriptA._id,
    });

    pageWebp = await IngestionPage.create({
      batchId,
      job: testJob._id as mongoose.Types.ObjectId,
      fileId: 'file-1',
      fileIndex: 0,
      storageKey: `batches/${batchId}/derived/file-1/3/page.webp`,
      thumbnailKey: `batches/${batchId}/derived/file-1/3/thumb.jpg`,
      pageNumber: 3,
      status: PageProcessingStatus.PROCESSED,
      answerScript: answerScriptA._id,
    });

    pageGif = await IngestionPage.create({
      batchId,
      job: testJob._id as mongoose.Types.ObjectId,
      fileId: 'file-1',
      fileIndex: 0,
      storageKey: `batches/${batchId}/derived/file-1/4/page.gif`,
      thumbnailKey: `batches/${batchId}/derived/file-1/4/thumb.jpg`,
      pageNumber: 4,
      status: PageProcessingStatus.PROCESSED,
      answerScript: answerScriptA._id,
    });

    pageMissingStorageKey = await IngestionPage.create({
      batchId,
      job: testJob._id as mongoose.Types.ObjectId,
      fileId: 'file-1',
      fileIndex: 0,
      storageKey: `batches/${batchId}/derived/file-1/5/page.png`,
      thumbnailKey: `batches/${batchId}/derived/file-1/5/thumb.jpg`,
      pageNumber: 5,
      status: PageProcessingStatus.PENDING,
      answerScript: answerScriptA._id,
    });

    // 7. Create Course B, Exam B, Batch B, Script B, and Page B (Course B isolation)
    courseB = await Course.create({
      courseCode: `TRANSFIG-201-${Date.now()}`,
      courseName: 'Transfiguration Advanced',
      semester: 2,
      academicYear: '2025-2026',
      professor: otherProfUser._id,
      teachingAssistants: [unallocatedTaUser._id],
      isActive: true,
    });

    examB = await Exam.create({
      title: 'Transfiguration Final',
      course: courseB._id,
      createdBy: otherProfUser._id,
      totalMarks: 100,
      numberOfQuestions: 5,
      examDate: new Date(),
      status: ExamStatus.PUBLISHED,
      isActive: true,
    });

    const studentB = await User.create({
      name: 'Ron Weasley (Student B)',
      email: `ron-${Date.now()}@hogwarts.edu`,
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true,
    });

    const batchIdB = crypto.randomUUID();
    batchB = await BatchRepository.createBatch({
      batchId: batchIdB,
      uploadedBy: otherProfUser._id as mongoose.Types.ObjectId,
      files: [
        {
          fileId: 'file-b-1',
          fileIndex: 0,
          originalFilename: 'transfig_exam.pdf',
          fileType: 'pdf',
          mimeType: 'application/pdf',
          size: 2048,
          pageCount: 2,
          storageKey: `batches/${batchIdB}/transfig_exam.pdf`,
        },
      ],
      totalFiles: 1,
      totalSize: 2048,
      totalPageCount: 2,
      status: BatchStatus.QUEUED,
      isActive: true,
    });

    jobB = await BatchRepository.createIngestionJob({
      batchId: batchIdB,
      batch: batchB._id as mongoose.Types.ObjectId,
      uploadedBy: otherProfUser._id as mongoose.Types.ObjectId,
      status: IngestionStatus.DONE,
      totalPages: 2,
      processedPages: 2,
      failedPages: 0,
    });

    answerScriptB = await AnswerScript.create({
      exam: examB._id,
      student: studentB._id,
      batchId: batchIdB,
      fileIndex: 0,
      pageCount: 2,
      identificationStatus: IdentificationStatus.IDENTIFIED,
      isActive: true,
    });

    pageB = await IngestionPage.create({
      batchId: batchIdB,
      job: jobB._id as mongoose.Types.ObjectId,
      fileId: 'file-b-1',
      fileIndex: 0,
      storageKey: `batches/${batchIdB}/derived/file-b-1/1/page.png`,
      thumbnailKey: `batches/${batchIdB}/derived/file-b-1/1/thumb.jpg`,
      pageNumber: 1,
      status: PageProcessingStatus.PROCESSED,
      answerScript: answerScriptB._id,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. allows authenticated Professor with valid access to load the page image with proper Content-Type and Content-Length', async () => {
    mockSessionUser = {
      id: profUser._id.toString(),
      email: profUser.email,
      name: profUser.name,
      role: UserRole.PROFESSOR,
    };

    const mockBuffer = Buffer.from('mock-png-binary-stream-data');
    const spyRead = vi.spyOn(DerivedStorageService, 'readDerivedPage').mockResolvedValue(mockBuffer);

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${pagePng._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: pagePng._id.toString() }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Content-Length')).toBe(mockBuffer.length.toString());

    const returnedData = await res.arrayBuffer();
    expect(Buffer.from(returnedData).toString()).toBe('mock-png-binary-stream-data');
    expect(spyRead).toHaveBeenCalledWith(pagePng.storageKey);
  });

  it('2. allows authenticated TA WITH a valid allocation for page.answerScript to load the page image (P1 fix)', async () => {
    mockSessionUser = {
      id: taUser._id.toString(),
      email: taUser.email,
      name: taUser.name,
      role: UserRole.TA,
    };

    const mockBuffer = Buffer.from('mock-ta-image-data');
    const spyRead = vi.spyOn(DerivedStorageService, 'readDerivedPage').mockResolvedValue(mockBuffer);

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${pagePng._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: pagePng._id.toString() }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
    expect(res.headers.get('Content-Length')).toBe(mockBuffer.length.toString());

    const returnedData = await res.arrayBuffer();
    expect(Buffer.from(returnedData).toString()).toBe('mock-ta-image-data');
    expect(spyRead).toHaveBeenCalledWith(pagePng.storageKey);
  });

  it('3. allows authenticated Admin to load the page image', async () => {
    mockSessionUser = {
      id: adminUser._id.toString(),
      email: adminUser.email,
      name: adminUser.name,
      role: UserRole.ADMIN,
    };

    const mockBuffer = Buffer.from('mock-admin-image-data');
    vi.spyOn(DerivedStorageService, 'readDerivedPage').mockResolvedValue(mockBuffer);

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${pagePng._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: pagePng._id.toString() }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('4. correctly resolves MIME types for jpeg, webp, and gif files for allocated TA', async () => {
    mockSessionUser = {
      id: taUser._id.toString(),
      email: taUser.email,
      name: taUser.name,
      role: UserRole.TA,
    };

    const dummyBuf = Buffer.from('img-bytes');
    vi.spyOn(DerivedStorageService, 'readDerivedPage').mockResolvedValue(dummyBuf);

    // JPEG
    const reqJpg = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${pageJpg._id}/image`,
      { method: 'GET' }
    );
    const resJpg = await imageGET(reqJpg, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: pageJpg._id.toString() }),
    });
    expect(resJpg.status).toBe(200);
    expect(resJpg.headers.get('Content-Type')).toBe('image/jpeg');

    // WEBP
    const reqWebp = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${pageWebp._id}/image`,
      { method: 'GET' }
    );
    const resWebp = await imageGET(reqWebp, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: pageWebp._id.toString() }),
    });
    expect(resWebp.status).toBe(200);
    expect(resWebp.headers.get('Content-Type')).toBe('image/webp');

    // GIF
    const reqGif = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${pageGif._id}/image`,
      { method: 'GET' }
    );
    const resGif = await imageGET(reqGif, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: pageGif._id.toString() }),
    });
    expect(resGif.status).toBe(200);
    expect(resGif.headers.get('Content-Type')).toBe('image/gif');
  });

  it('5. rejects unauthenticated requests with 401 Unauthorized', async () => {
    mockSessionUser = null;

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${pagePng._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: pagePng._id.toString() }),
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('Unauthorized');
  });

  it('6. rejects unauthorized student requests with 403 Forbidden', async () => {
    mockSessionUser = {
      id: studentUser._id.toString(),
      email: studentUser.email,
      name: studentUser.name,
      role: UserRole.STUDENT,
    };

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${pagePng._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: pagePng._id.toString() }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('Forbidden');
  });

  it('7. returns 404 for invalid pageId format (non-ObjectId)', async () => {
    mockSessionUser = {
      id: profUser._id.toString(),
      email: profUser.email,
      name: profUser.name,
      role: UserRole.PROFESSOR,
    };

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/invalid-page-id/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: 'invalid-page-id' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe('Invalid page ID format');
  });

  it('8. returns 404 if IngestionPage does not exist', async () => {
    mockSessionUser = {
      id: profUser._id.toString(),
      email: profUser.email,
      name: profUser.name,
      role: UserRole.PROFESSOR,
    };

    const fakePageId = new mongoose.Types.ObjectId().toString();
    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${fakePageId}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: fakePageId }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe('Page not found');
  });

  it('9. returns 404 if IngestionPage does not belong to requested batch', async () => {
    mockSessionUser = {
      id: profUser._id.toString(),
      email: profUser.email,
      name: profUser.name,
      role: UserRole.PROFESSOR,
    };

    const unrelatedBatchId = crypto.randomUUID();
    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${unrelatedBatchId}/pages/${pagePng._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: unrelatedBatchId, pageId: pagePng._id.toString() }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe('Page does not belong to the requested batch');
  });

  it('10. returns 404 for Professor accessing a batch uploaded by another professor (ownership isolation)', async () => {
    mockSessionUser = {
      id: otherProfUser._id.toString(),
      email: otherProfUser.email,
      name: otherProfUser.name,
      role: UserRole.PROFESSOR,
    };

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${pagePng._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: pagePng._id.toString() }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe('Batch not found or access denied');
  });

  it('11. returns 404 when storageKey is missing on the IngestionPage', async () => {
    // Force storageKey to empty string
    await IngestionPage.collection.updateOne(
      { _id: pageMissingStorageKey._id },
      { $set: { storageKey: '' } }
    );

    mockSessionUser = {
      id: profUser._id.toString(),
      email: profUser.email,
      name: profUser.name,
      role: UserRole.PROFESSOR,
    };

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${pageMissingStorageKey._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: pageMissingStorageKey._id.toString() }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe('Page image key is missing or not processed yet');
  });

  it('12. returns 404 when DerivedStorageService fails to read the file on disk', async () => {
    mockSessionUser = {
      id: taUser._id.toString(),
      email: taUser.email,
      name: taUser.name,
      role: UserRole.TA,
    };

    vi.spyOn(DerivedStorageService, 'readDerivedPage').mockRejectedValue(new Error('ENOENT: no such file'));

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${pagePng._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: pagePng._id.toString() }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.message).toBe('Page image file not found on disk');
  });

  it('13. verifies shared helper requireGradingOrAnnotationAccess and requireAnyPermission contract', async () => {
    expect(GRADING_OR_CANVAS_PERMISSIONS).toEqual([
      Permission.GRADE_SCRIPT,
      Permission.SAVE_MARKS_FEEDBACK,
      Permission.EDIT_EXAM,
      Permission.VIEW_ALL_SUBMISSIONS,
    ]);

    // Unauthenticated
    mockSessionUser = null;
    const unauthResult = await requireGradingOrAnnotationAccess();
    expect(unauthResult.authorized).toBe(false);
    expect(unauthResult.response?.status).toBe(401);

    // TA (has GRADE_SCRIPT & SAVE_MARKS_FEEDBACK)
    mockSessionUser = { id: taUser._id.toString(), email: taUser.email, role: UserRole.TA };
    const taResult = await requireGradingOrAnnotationAccess();
    expect(taResult.authorized).toBe(true);

    // Professor (has SAVE_MARKS_FEEDBACK, EDIT_EXAM, VIEW_ALL_SUBMISSIONS)
    mockSessionUser = { id: profUser._id.toString(), email: profUser.email, role: UserRole.PROFESSOR };
    const profResult = await requireGradingOrAnnotationAccess();
    expect(profResult.authorized).toBe(true);

    // Student (has neither)
    mockSessionUser = { id: studentUser._id.toString(), email: studentUser.email, role: UserRole.STUDENT };
    const studentResult = await requireGradingOrAnnotationAccess();
    expect(studentResult.authorized).toBe(false);
    expect(studentResult.response?.status).toBe(403);

    // Custom requireAnyPermission with arbitrary permission list
    mockSessionUser = { id: taUser._id.toString(), email: taUser.email, role: UserRole.TA };
    const customMatch = await requireAnyPermission([Permission.MANAGE_USERS, Permission.GRADE_SCRIPT]);
    expect(customMatch.authorized).toBe(true);

    const customMismatch = await requireAnyPermission([Permission.MANAGE_USERS, Permission.DELETE_COURSE]);
    expect(customMismatch.authorized).toBe(false);
    expect(customMismatch.response?.status).toBe(403);
  });

  it('14. returns 404 when TA has NO allocation for the requested page answerScript', async () => {
    mockSessionUser = {
      id: unallocatedTaUser._id.toString(),
      email: unallocatedTaUser.email,
      name: unallocatedTaUser.name,
      role: UserRole.TA,
    };

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${pagePng._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: pagePng._id.toString() }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('Page not found');
  });

  it('15. returns 404 when TA allocated to Course A script attempts to request a page from Course B', async () => {
    // taUser is allocated to answerScriptA (Course A), but NOT to answerScriptB (Course B)
    mockSessionUser = {
      id: taUser._id.toString(),
      email: taUser.email,
      name: taUser.name,
      role: UserRole.TA,
    };

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${batchB.batchId}/pages/${pageB._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: batchB.batchId, pageId: pageB._id.toString() }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('Page not found');
  });

  it('16. returns 404 when TA requests an IngestionPage that is not linked to any answerScript', async () => {
    const unlinkedPage = await IngestionPage.create({
      batchId: testBatch.batchId,
      job: testJob._id as mongoose.Types.ObjectId,
      fileId: 'file-1',
      fileIndex: 0,
      storageKey: `batches/${testBatch.batchId}/derived/file-1/99/page.png`,
      thumbnailKey: `batches/${testBatch.batchId}/derived/file-1/99/thumb.jpg`,
      pageNumber: 99,
      status: PageProcessingStatus.PROCESSED,
      answerScript: null,
    });

    mockSessionUser = {
      id: taUser._id.toString(),
      email: taUser.email,
      name: taUser.name,
      role: UserRole.TA,
    };

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${testBatch.batchId}/pages/${unlinkedPage._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: testBatch.batchId, pageId: unlinkedPage._id.toString() }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('Page not found');
  });

  it('17. allows Professor who created the Exam to load page image when batch was uploaded by another user', async () => {
    // examA was created by profUser
    // Create a batch on examA uploaded by adminUser
    const batchIdAdmin = crypto.randomUUID();
    const batchAdmin = await Batch.create({
      batchId: batchIdAdmin,
      uploadedBy: adminUser._id as mongoose.Types.ObjectId,
      exam: examA._id,
      files: [
        {
          fileId: 'file-admin-1',
          fileIndex: 0,
          originalFilename: 'admin_upload.pdf',
          fileType: 'pdf',
          mimeType: 'application/pdf',
          size: 1024,
          pageCount: 1,
          storageKey: `batches/${batchIdAdmin}/admin_upload.pdf`,
        },
      ],
      totalFiles: 1,
      totalSize: 1024,
      totalPageCount: 1,
      status: BatchStatus.DONE,
      isActive: true,
    });

    const jobAdmin = await BatchRepository.createIngestionJob({
      batchId: batchIdAdmin,
      batch: batchAdmin._id as mongoose.Types.ObjectId,
      uploadedBy: adminUser._id as mongoose.Types.ObjectId,
      status: IngestionStatus.DONE,
      totalPages: 1,
      processedPages: 1,
      failedPages: 0,
    });

    const pageAdmin = await IngestionPage.create({
      batchId: batchIdAdmin,
      job: jobAdmin._id as mongoose.Types.ObjectId,
      fileId: 'file-admin-1',
      fileIndex: 0,
      storageKey: `batches/${batchIdAdmin}/derived/file-admin-1/1/page.png`,
      thumbnailKey: `batches/${batchIdAdmin}/derived/file-admin-1/1/thumb.jpg`,
      pageNumber: 1,
      status: PageProcessingStatus.PROCESSED,
      answerScript: answerScriptA._id,
    });

    // profUser is the creator of examA
    mockSessionUser = {
      id: profUser._id.toString(),
      email: profUser.email,
      name: profUser.name,
      role: UserRole.PROFESSOR,
    };

    const mockBuffer = Buffer.from('mock-exam-owner-image-bytes');
    vi.spyOn(DerivedStorageService, 'readDerivedPage').mockResolvedValue(mockBuffer);

    const req = new NextRequest(
      `http://localhost:3000/api/ingest/${batchIdAdmin}/pages/${pageAdmin._id}/image`,
      { method: 'GET' }
    );
    const res = await imageGET(req, {
      params: Promise.resolve({ id: batchIdAdmin, pageId: pageAdmin._id.toString() }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });
});
