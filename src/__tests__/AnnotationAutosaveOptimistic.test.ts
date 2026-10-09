/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { connectDB } from '../lib/db';
import AnswerScript from '../models/AnswerScript';
import Page from '../models/Page';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import * as audit from '../lib/audit';
import annotationPersistenceService from '../services/AnnotationPersistenceService';

vi.mock('../lib/audit', () => ({
  writeAuditLog: vi.fn(),
}));

vi.mock('../repositories/ExamRepository', () => ({
  default: {
    getExamById: vi.fn().mockResolvedValue({ _id: 'exam123' }),
  },
}));

vi.mock('../services/AllocationService', () => ({
  default: {
    verifyTaAllocation: vi.fn().mockResolvedValue({ status: 'IN_PROGRESS' }),
  },
}));

describe('Annotation Autosave Optimistic Update', () => {
  let scriptId: string;
  let pageId: string;
  let numericPageId: string;
  let ingestionPageId: string;

  beforeEach(async () => {
    await connectDB();
    await mongoose.connection.db?.dropDatabase();

    const script = await AnswerScript.create({
      exam: new mongoose.Types.ObjectId(),
      student: new mongoose.Types.ObjectId(),
      isActive: true,
    });
    scriptId = script._id.toString();

    const page = await Page.create({
      answerScript: script._id,
      pageNumber: 1,
      imagePath: 'test.jpg',
      isActive: true,
      annotations: { annotations: [], strokes: [] }
    });
    pageId = page._id.toString();

    const page2 = await Page.create({
      answerScript: script._id,
      pageNumber: 2,
      imagePath: 'test2.jpg',
      isActive: true,
      annotations: { annotations: [], strokes: [] }
    });
    numericPageId = page2._id.toString();

    const ingestionPage = await IngestionPage.create({
      answerScript: script._id,
      pageNumber: 3,
      batchId: new mongoose.Types.ObjectId().toString(),
      fileId: new mongoose.Types.ObjectId().toString(),
      fileIndex: 0,
      storageKey: 'test/path.pdf',
      status: PageProcessingStatus.PROCESSED,
      job: new mongoose.Types.ObjectId(),
      metadata: { annotations: { annotations: [], strokes: [] } }
    });
    ingestionPageId = ingestionPage._id.toString();
  });

  afterEach(async () => {
    await mongoose.connection.db?.dropDatabase();
    vi.clearAllMocks();
  });

  const payload = {
    version: 1,
    pages: {} as Record<string, any>
  };

  it('performs successful optimistic autosave on Page', async () => {
    const p = await Page.findById(pageId);
    const baseUpdatedAt = p!.updatedAt;

    payload.pages = { [pageId]: { annotations: [], strokes: [] } };
    const res = await annotationPersistenceService.savePageAnnotations({
      scriptId,
      pageIdentifier: pageId,
      payload,
      userId: new mongoose.Types.ObjectId().toString(),
      userRole: 'TA',
      baseUpdatedAt
    });

    expect(res.pageId).toBe(pageId);
    expect(audit.writeAuditLog).toHaveBeenCalled();
  });

  it('fails with ConflictHttpError on optimistic concurrency conflict', async () => {
    const p = await Page.findById(pageId);
    const baseUpdatedAt = p!.updatedAt;

    // Simulate an intervening update
    await Page.updateOne({ _id: pageId }, { $set: { updatedAt: new Date(Date.now() + 10000) } });

    payload.pages = { [pageId]: { annotations: [], strokes: [] } };
    await expect(
      annotationPersistenceService.savePageAnnotations({
        scriptId,
        pageIdentifier: pageId,
        payload,
        userId: new mongoose.Types.ObjectId().toString(),
        userRole: 'TA',
        baseUpdatedAt
      })
    ).rejects.toThrow('Conflict: Annotations have been modified');
  });

  it('performs successful optimistic autosave on IngestionPage', async () => {
    const p = await IngestionPage.findById(ingestionPageId);
    const baseUpdatedAt = p!.updatedAt;

    const testPayload = {
      version: 1,
      pages: {
        [ingestionPageId]: { annotations: [], strokes: [] }
      }
    };

    const res = await annotationPersistenceService.savePageAnnotations({
      scriptId,
      pageIdentifier: ingestionPageId,
      payload: testPayload,
      userId: new mongoose.Types.ObjectId().toString(),
      userRole: 'TA',
      baseUpdatedAt
    });

    expect(res.pageId).toBe(ingestionPageId);
    expect(audit.writeAuditLog).toHaveBeenCalled();
  });

  it('uses legacy fallback for numeric pageIdentifier', async () => {
    const p = await Page.findOne({ answerScript: scriptId, pageNumber: 2 });
    const baseUpdatedAt = p!.updatedAt;

    const testPayload = {
      version: 1,
      pages: {
        [numericPageId]: { annotations: [], strokes: [] }
      }
    };

    const res = await annotationPersistenceService.savePageAnnotations({
      scriptId,
      pageIdentifier: '2',
      payload: testPayload,
      userId: new mongoose.Types.ObjectId().toString(),
      userRole: 'TA',
      baseUpdatedAt
    });

    expect(res.pageId).toBe(numericPageId);
    expect(res.pageNumber).toBe(2);
  });

  it('throws when baseUpdatedAt is stale and requireBaseUpdatedAt is true', async () => {
    const testPayload = {
      version: 1,
      pages: { [pageId]: { annotations: [], strokes: [] } }
    };

    await expect(
      annotationPersistenceService.savePageAnnotations({
        scriptId,
        pageIdentifier: pageId,
        payload: testPayload,
        userId: new mongoose.Types.ObjectId().toString(),
        userRole: 'TA',
        requireBaseUpdatedAt: true
      })
    ).rejects.toThrow('baseUpdatedAt is required on every save to ensure conflict detection');
  });
});
