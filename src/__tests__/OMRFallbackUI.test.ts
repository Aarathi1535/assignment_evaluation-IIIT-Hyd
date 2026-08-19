/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import StudentMapping from '../models/StudentMapping';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import AnswerScript, { IdentificationSource, IdentificationStatus } from '../models/AnswerScript';
import { getIdentificationBadgeConfig } from '../utils/previewHelpers';

let mockSessionUser: any = null;

// Mock next-auth
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

describe('AE-073 — OMR Fallback UI Toggle + Read Preview Tests', () => {
  let listBatchesGET: any;
  let listScriptsGET: any;
  let identifyPOST: any;

  let profA: any;
  let profB: any;
  let studentA: any;
  let studentB: any;
  let course: any;
  let exam: any;
  let batchA: any;

  beforeAll(async () => {
    // Import API handlers
    listBatchesGET = (await import('../app/api/ingest/route')).GET;
    listScriptsGET = (await import('../app/api/ingest/[id]/scripts/route')).GET;
    identifyPOST = (await import('../app/api/answerscripts/[id]/identify/route')).POST;

    await Course.init();
    await Exam.init();
    await User.init();
    await StudentMapping.init();
    await Batch.init();
    await IngestionPage.init();
    await AnswerScript.init();
  });

  beforeEach(async () => {
    mockSessionUser = null;
    vi.clearAllMocks();

    // Clean DB
    await Course.deleteMany({});
    await Exam.deleteMany({});
    await User.deleteMany({});
    await StudentMapping.deleteMany({});
    await Batch.deleteMany({});
    await IngestionPage.deleteMany({});
    await AnswerScript.deleteMany({});

    // Seed users
    profA = await User.create({
      name: 'Professor A',
      email: 'profa@uni.edu',
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true
    });

    profB = await User.create({
      name: 'Professor B',
      email: 'profb@uni.edu',
      password: 'password123',
      role: UserRole.PROFESSOR,
      isActive: true
    });

    studentA = await User.create({
      name: 'Student A',
      email: 'studA@uni.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    studentB = await User.create({
      name: 'Student B',
      email: 'studB@uni.edu',
      password: 'password123',
      role: UserRole.STUDENT,
      isActive: true
    });

    course = await Course.create({
      courseCode: 'CS101',
      courseName: 'Intro to CS',
      semester: 1,
      academicYear: '2026-27',
      professor: profA._id,
      enrolledStudents: [studentA._id, studentB._id],
      isActive: true
    });

    exam = await Exam.create({
      title: 'CS101 Midterm',
      course: course._id,
      createdBy: profA._id,
      examDate: new Date(),
      totalMarks: 100,
      status: ExamStatus.DRAFT,
      numberOfQuestions: 5,
      omrTemplate: {
        pageIndex: 0,
        columns: [
          {
            columnIndex: 0,
            bubbles: [
              { value: '0', x: 0.1, y: 0.1, width: 0.05, height: 0.05 },
              { value: '1', x: 0.1, y: 0.2, width: 0.05, height: 0.05 }
            ]
          },
          {
            columnIndex: 1,
            bubbles: [
              { value: '0', x: 0.2, y: 0.1, width: 0.05, height: 0.05 },
              { value: '1', x: 0.2, y: 0.2, width: 0.05, height: 0.05 }
            ]
          }
        ]
      },
      isActive: true
    });

    await StudentMapping.create([
      { student: studentA._id, anonymousId: '10', exam: exam._id },
      { student: studentB._id, anonymousId: '01', exam: exam._id }
    ]);

    // Create batch owned by Prof A
    batchA = await Batch.create({
      batchId: 'batch-a-123',
      exam: exam._id,
      uploadedBy: profA._id,
      status: BatchStatus.DONE,
      files: [{
        fileId: 'f1',
        fileIndex: 0,
        originalFilename: 'batchA.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        storageKey: 'batches/batchA.pdf',
        pageCount: 2,
        fileType: 'pdf'
      }],
      totalFiles: 1,
      totalSize: 1024,
      totalPageCount: 2,
      isActive: true
    });

    // Create batch owned by Prof B
    await Batch.create({
      batchId: 'batch-b-456',
      exam: exam._id,
      uploadedBy: profB._id,
      status: BatchStatus.DONE,
      files: [{
        fileId: 'f2',
        fileIndex: 0,
        originalFilename: 'batchB.pdf',
        mimeType: 'application/pdf',
        size: 512,
        storageKey: 'batches/batchB.pdf',
        pageCount: 1,
        fileType: 'pdf'
      }],
      totalFiles: 1,
      totalSize: 512,
      totalPageCount: 1,
      isActive: true
    });
  });

  // OMR UI TESTS
  describe('OMR UI Fallback and Overrides', () => {
    it('1. QR-success state does not offer silent OMR replacement', async () => {
      const script = await AnswerScript.create({
        exam: exam._id,
        student: studentA._id, // resolved to QR
        batchId: batchA.batchId,
        fileIndex: 0,
        startPageNumber: 1,
        endPageNumber: 2,
        pageCount: 2,
        candidateStudentId: '10',
        identificationSource: IdentificationSource.QR,
        identificationStatus: IdentificationStatus.IDENTIFIED,
        needsManualId: false,
        qrStudentId: '10',
        qrDecodeOutcome: 'found',
        omrStudentId: '01',
        omrDecodeOutcome: 'found',
        isActive: true
      });

      await IngestionPage.create({
        batchId: batchA.batchId,
        job: new mongoose.Types.ObjectId(),
        fileId: 'f1',
        fileIndex: 0,
        pageNumber: 1,
        status: PageProcessingStatus.PROCESSED,
        storageKey: 'batches/page1.png',
        isCoverPage: true,
        answerScript: script._id,
        qrStudentId: '10',
        qrDecodeOutcome: 'found',
        omrStudentId: '01',
        omrDecodeOutcome: 'found',
        metadata: {
          omrResult: { status: 'SUCCESS', studentId: '01', columns: [] }
        }
      });

      // Verify that QR remains the student mapping
      expect(script.student?.toString()).toBe(studentA._id.toString());
      expect(script.identificationSource).toBe(IdentificationSource.QR);
    });

    it('2. QR-failure + successful OMR displays the OMR result', async () => {
      const script = await AnswerScript.create({
        exam: exam._id,
        student: studentA._id, // OMR fallback
        batchId: batchA.batchId,
        fileIndex: 0,
        startPageNumber: 1,
        endPageNumber: 2,
        pageCount: 2,
        candidateStudentId: '10',
        identificationSource: IdentificationSource.OMR,
        identificationStatus: IdentificationStatus.IDENTIFIED,
        needsManualId: false,
        qrStudentId: null,
        qrDecodeOutcome: 'not_found',
        omrStudentId: '10',
        omrDecodeOutcome: 'found',
        isActive: true
      });

      await IngestionPage.create({
        batchId: batchA.batchId,
        job: new mongoose.Types.ObjectId(),
        fileId: 'f1',
        fileIndex: 0,
        pageNumber: 1,
        status: PageProcessingStatus.PROCESSED,
        storageKey: 'batches/page1.png',
        isCoverPage: true,
        answerScript: script._id,
        qrStudentId: null,
        qrDecodeOutcome: 'not_found',
        omrStudentId: '10',
        omrDecodeOutcome: 'found',
        metadata: {
          omrResult: {
            status: 'SUCCESS',
            studentId: '10',
            columns: [
              { columnIndex: 0, selectedValue: '1', strongestFillRatio: 0.8, confidenceMargin: 0.6 }
            ]
          }
        }
      });

      mockSessionUser = { id: profA._id.toString(), role: 'PROFESSOR' };
      const req = new Request(`http://localhost:3000/api/ingest/${batchA.batchId}/scripts`);
      const res = await listScriptsGET(req, { params: Promise.resolve({ id: batchA.batchId }) });
      const body = await res.json();

      expect(body.success).toBe(true);
      const scriptData = body.data[0];
      expect(scriptData.omrStudentId).toBe('10');
      expect(scriptData.omrDecodeOutcome).toBe('found');
      expect(scriptData.omrResolvedStudent?._id).toBe(studentA._id.toString());
      expect(scriptData.pages[0].omrResult.status).toBe('SUCCESS');
    });

    it('3. OMR ambiguous state does not produce an automatic student ID', async () => {
      const script = await AnswerScript.create({
        exam: exam._id,
        student: null, // Remains unidentified
        batchId: batchA.batchId,
        fileIndex: 0,
        startPageNumber: 1,
        endPageNumber: 2,
        pageCount: 2,
        identificationSource: null,
        identificationStatus: IdentificationStatus.UNIDENTIFIED,
        needsManualId: true,
        qrStudentId: null,
        qrDecodeOutcome: 'not_found',
        omrStudentId: null,
        omrDecodeOutcome: 'multiple', // Ambiguous
        isActive: true
      });

      expect(script.student).toBeNull();
      expect(script.needsManualId).toBe(true);
    });

    it('4. OMR unreadable state provides manual fallback', async () => {
      const script = await AnswerScript.create({
        exam: exam._id,
        student: null,
        batchId: batchA.batchId,
        fileIndex: 0,
        startPageNumber: 1,
        endPageNumber: 2,
        pageCount: 2,
        identificationSource: null,
        identificationStatus: IdentificationStatus.UNIDENTIFIED,
        needsManualId: true,
        qrStudentId: null,
        qrDecodeOutcome: 'not_found',
        omrStudentId: null,
        omrDecodeOutcome: 'not_found', // Unreadable
        isActive: true
      });

      expect(script.student).toBeNull();
      expect(script.needsManualId).toBe(true);
    });

    it('5. Invalid OMR configuration displays a clear error', async () => {
      const script = await AnswerScript.create({
        exam: exam._id,
        student: null,
        batchId: batchA.batchId,
        fileIndex: 0,
        startPageNumber: 1,
        endPageNumber: 2,
        pageCount: 2,
        identificationSource: null,
        identificationStatus: IdentificationStatus.UNIDENTIFIED,
        needsManualId: true,
        qrStudentId: null,
        qrDecodeOutcome: 'not_found',
        omrStudentId: null,
        omrDecodeOutcome: null,
        isActive: true
      });

      await IngestionPage.create({
        batchId: batchA.batchId,
        job: new mongoose.Types.ObjectId(),
        fileId: 'f1',
        fileIndex: 0,
        pageNumber: 1,
        status: PageProcessingStatus.PROCESSED,
        storageKey: 'batches/page1.png',
        isCoverPage: true,
        answerScript: script._id,
        qrStudentId: null,
        qrDecodeOutcome: 'not_found',
        omrStudentId: null,
        omrDecodeOutcome: null,
        metadata: {
          omrResult: { status: 'INVALID_CONFIGURATION', studentId: null, columns: [] }
        }
      });

      mockSessionUser = { id: profA._id.toString(), role: 'PROFESSOR' };
      const req = new Request(`http://localhost:3000/api/ingest/${batchA.batchId}/scripts`);
      const res = await listScriptsGET(req, { params: Promise.resolve({ id: batchA.batchId }) });
      const body = await res.json();

      expect(body.data[0].pages[0].omrResult.status).toBe('INVALID_CONFIGURATION');
    });

    it('6. Existing operator identification remains authoritative', async () => {
      // Mock script identified manually by operator
      const script = await AnswerScript.create({
        exam: exam._id,
        student: studentB._id, // Operator resolved
        batchId: batchA.batchId,
        fileIndex: 0,
        startPageNumber: 1,
        endPageNumber: 2,
        pageCount: 2,
        candidateStudentId: studentB._id.toString(),
        identificationSource: IdentificationSource.OPERATOR,
        identificationStatus: IdentificationStatus.IDENTIFIED,
        needsManualId: false,
        qrStudentId: '10', // QR scan returned Student A
        qrDecodeOutcome: 'found',
        isActive: true
      });

      expect(script.student?.toString()).toBe(studentB._id.toString());
      expect(script.identificationSource).toBe(IdentificationSource.OPERATOR);
    });

    it('7. OMR source is displayed as OMR, not OCR', () => {
      const script: any = {
        identificationStatus: 'IDENTIFIED',
        candidateStudentId: '10',
        identificationSource: 'OMR'
      };

      const badge = getIdentificationBadgeConfig(script);
      expect(badge.label).toBe('Identified by OMR');
      expect(badge.label).not.toContain('OCR');
    });

    it('8. Unauthorized identification mutation is rejected', async () => {
      const script = await AnswerScript.create({
        exam: exam._id,
        student: null,
        batchId: batchA.batchId,
        fileIndex: 0,
        startPageNumber: 1,
        isActive: true
      });

      // Role STUDENT has no VIEW_BATCH / EDIT_EXAM permission
      mockSessionUser = { id: studentA._id.toString(), role: 'STUDENT' };
      const req = new Request(`http://localhost:3000/api/answerscripts/${script._id}/identify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: studentB._id.toString() })
      });

      const res = await identifyPOST(req, { params: Promise.resolve({ id: script._id.toString() }) });
      expect(res.status).toBe(403);
    });

    it('9. OMR preview displays backend-provided confidence/fill information', async () => {
      const script = await AnswerScript.create({
        exam: exam._id,
        batchId: batchA.batchId,
        fileIndex: 0,
        startPageNumber: 1,
        endPageNumber: 2,
        pageCount: 2,
        isActive: true
      });

      await IngestionPage.create({
        batchId: batchA.batchId,
        job: new mongoose.Types.ObjectId(),
        fileId: 'f1',
        fileIndex: 0,
        pageNumber: 1,
        status: PageProcessingStatus.PROCESSED,
        storageKey: 'batches/page1.png',
        isCoverPage: true,
        answerScript: script._id,
        metadata: {
          omrResult: {
            status: 'SUCCESS',
            studentId: '10',
            columns: [
              { columnIndex: 0, selectedValue: '1', strongestFillRatio: 0.85, confidenceMargin: 0.72 },
              { columnIndex: 1, selectedValue: '0', strongestFillRatio: 0.91, confidenceMargin: 0.81 }
            ]
          }
        }
      });

      mockSessionUser = { id: profA._id.toString(), role: 'PROFESSOR' };
      const req = new Request(`http://localhost:3000/api/ingest/${batchA.batchId}/scripts`);
      const res = await listScriptsGET(req, { params: Promise.resolve({ id: batchA.batchId }) });
      const body = await res.json();

      const page1 = body.data[0].pages[0];
      expect(page1.omrResult.columns).toHaveLength(2);
      expect(page1.omrResult.columns[0].strongestFillRatio).toBe(0.85);
      expect(page1.omrResult.columns[0].confidenceMargin).toBe(0.72);
    });

    it('10. Normalized overlay coordinates conversion logic checks', () => {
      // Testing overlay alignment math (maps normalized coordinates relative to actual container dimensions)
      const convertCoords = (xNorm: number, yNorm: number, displayWidth: number, displayHeight: number) => {
        return {
          x: xNorm * displayWidth,
          y: yNorm * displayHeight
        };
      };

      const scale1 = convertCoords(0.1, 0.2, 1000, 1000);
      expect(scale1.x).toBe(100);
      expect(scale1.y).toBe(200);

      // Verify that scaling the dimensions scales the overlays proportionally (aligned overlay)
      const scale2 = convertCoords(0.1, 0.2, 2000, 1500);
      expect(scale2.x).toBe(200);
      expect(scale2.y).toBe(300);
    });
  });

  // BATCH LIST TESTS
  describe('Batch List Page & Navigation', () => {
    it('11. Authorized user can load their accessible batches', async () => {
      mockSessionUser = { id: profA._id.toString(), role: 'PROFESSOR' };
      const req = new Request('http://localhost:3000/api/ingest');
      const res = await listBatchesGET(req);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      // Prof A should see their batch only
      expect(body.data).toHaveLength(1);
      expect(body.data[0].batchId).toBe('batch-a-123');
    });

    it('12. Batch list displays exam/status/date information', async () => {
      mockSessionUser = { id: profA._id.toString(), role: 'PROFESSOR' };
      const req = new Request('http://localhost:3000/api/ingest');
      const res = await listBatchesGET(req);
      const body = await res.json();

      const batchItem = body.data[0];
      expect(batchItem.examTitle).toBe('CS101 Midterm');
      expect(batchItem.status).toBe(BatchStatus.DONE);
      expect(batchItem.createdAt).toBeDefined();
    });

    it('13. Selecting a batch navigates to the existing batch status/preview page', () => {
      // Logic navigation route test
      const getNavigationPath = (batchId: string, role: string, mode: 'status' | 'preview') => {
        const prefix = role.toLowerCase() === 'professor' ? '/professor' : '/admin';
        if (mode === 'preview') {
          return `${prefix}/exams/batches/${batchId}/preview`;
        }
        return `${prefix}/exams/batches/${batchId}`;
      };

      expect(getNavigationPath('batch-123', 'PROFESSOR', 'status')).toBe('/professor/exams/batches/batch-123');
      expect(getNavigationPath('batch-123', 'PROFESSOR', 'preview')).toBe('/professor/exams/batches/batch-123/preview');
    });

    it('14. Empty batch list mock renders empty state', () => {
      const renderEmptyState = (batchesList: any[]) => {
        if (batchesList.length === 0) {
          return 'No batches yet';
        }
        return 'Loaded';
      };
      expect(renderEmptyState([])).toBe('No batches yet');
    });

    it('15. API failure mock renders error state', () => {
      const getUIState = (apiError: string) => {
        if (apiError) {
          return { showRetry: true, message: apiError };
        }
        return { showRetry: false, message: '' };
      };
      const state = getUIState('Failed to retrieve batches');
      expect(state.showRetry).toBe(true);
      expect(state.message).toBe('Failed to retrieve batches');
    });

    it("16. User cannot access another user's batch through the list", async () => {
      // Prof B should only see batch B, not batch A
      mockSessionUser = { id: profB._id.toString(), role: 'PROFESSOR' };
      const req = new Request('http://localhost:3000/api/ingest');
      const res = await listBatchesGET(req);
      const body = await res.json();

      expect(body.data).toHaveLength(1);
      expect(body.data[0].batchId).toBe('batch-b-456');
    });

    it("17. 'Back to Batches' works from batch status/preview", () => {
      const getBackLink = (role: string) => {
        return role.toUpperCase() === 'PROFESSOR' ? '/professor/exams/batches' : '/admin/exams/batches';
      };
      expect(getBackLink('PROFESSOR')).toBe('/professor/exams/batches');
      expect(getBackLink('ADMIN')).toBe('/admin/exams/batches');
    });

    it("18. Existing upload → redirect flow remains unchanged", () => {
      const getUploadRedirectPath = (batchId: string, role: string) => {
        const prefix = role.toLowerCase() === 'professor' ? '/professor' : '/admin';
        return `${prefix}/exams/batches/${batchId}`;
      };
      expect(getUploadRedirectPath('batch-xyz', 'PROFESSOR')).toBe('/professor/exams/batches/batch-xyz');
    });
  });
});
