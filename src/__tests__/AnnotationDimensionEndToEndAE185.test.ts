import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { connectDB } from '../lib/db';
import AnswerScript from '../models/AnswerScript';
import Page from '../models/Page';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import annotationPersistenceService from '../services/AnnotationPersistenceService';
import { compositePageAnnotations } from '../services/AnnotationCompositor';
import { createCanvas } from '@napi-rs/canvas';
import { HttpError } from '../lib/errors';
import type { CheckAnnotation } from '../lib/stampTool';
import type { SerializedAnnotationDocument } from '../lib/annotationSerialization';

vi.mock('../lib/audit', () => ({
  writeAuditLog: vi.fn().mockResolvedValue(true),
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

describe('AE-185: End-to-End Annotation Dimension Metadata & Repair Protection', () => {
  let scriptId: string;
  let pageId: string;
  let ingestionPageId: string;
  const professorId = new mongoose.Types.ObjectId().toString();

  beforeEach(async () => {
    await connectDB();
    await mongoose.connection.db?.dropDatabase();

    const script = await AnswerScript.create({
      exam: new mongoose.Types.ObjectId(),
      student: new mongoose.Types.ObjectId(),
      isActive: true,
    });
    scriptId = script._id.toString();

    // Standard Page with authoritative natural dimensions (e.g., A4 portrait 1654x2339)
    const page = await Page.create({
      answerScript: script._id,
      pageNumber: 1,
      imagePath: 'pages/page-1.png',
      width: 1654,
      height: 2339,
      isActive: true,
      annotations: { annotations: [], strokes: [] },
    });
    pageId = page._id.toString();

    // IngestionPage with natural dimensions
    const ingestionPage = await IngestionPage.create({
      answerScript: script._id,
      pageNumber: 2,
      batchId: new mongoose.Types.ObjectId().toString(),
      fileId: new mongoose.Types.ObjectId().toString(),
      fileIndex: 0,
      storageKey: 'derived/page-2.png',
      status: PageProcessingStatus.PROCESSED,
      job: new mongoose.Types.ObjectId(),
      width: 2048,
      height: 1448,
      metadata: { annotations: { annotations: [], strokes: [] } },
    });
    ingestionPageId = ingestionPage._id.toString();
  });

  afterEach(async () => {
    await mongoose.connection.db?.dropDatabase();
    vi.clearAllMocks();
  });

  it('1. automatically derives and persists authoritative page dimensions when payload omits dimensions', async () => {
    const p = await Page.findById(pageId);
    const baseUpdatedAt = p!.updatedAt;

    // Ordinary autosave payload containing only annotations and strokes
    const check: CheckAnnotation = {
      id: 'c1',
      pageKey: pageId,
      type: 'check',
      x: 500,
      y: 600,
      size: 30,
      color: '#16a34a',
      createdAt: Date.now(),
    };

    const saveResult = await annotationPersistenceService.savePageAnnotations({
      scriptId,
      pageIdentifier: pageId,
      payload: { annotations: [check], strokes: [] },
      userId: professorId,
      userRole: 'PROFESSOR',
      baseUpdatedAt,
    });

    expect(saveResult.naturalWidth).toBe(1654);
    expect(saveResult.naturalHeight).toBe(2339);

    // Verify stored page annotations document in MongoDB
    const updatedPage = await Page.findById(pageId);
    expect(updatedPage?.annotations?.naturalWidth).toBe(1654);
    expect(updatedPage?.annotations?.naturalHeight).toBe(2339);

    // Verify retrieval preserves authoritative natural dimensions
    const getResult = await annotationPersistenceService.getPageAnnotations({
      scriptId,
      pageIdentifier: pageId,
      userId: professorId,
      userRole: 'PROFESSOR',
    });

    expect(getResult.naturalWidth).toBe(1654);
    expect(getResult.naturalHeight).toBe(2339);
    expect(getResult.annotations).toHaveLength(1);
  });

  it('2. preserves valid dimensions when normalizing full-document payload', async () => {
    const p = await Page.findById(pageId);
    const baseUpdatedAt = p!.updatedAt;

    const fullDocPayload: SerializedAnnotationDocument = {
      version: 1,
      pages: {
        [pageId]: {
          annotations: [],
          strokes: [],
          naturalWidth: 1654,
          naturalHeight: 2339,
        },
      },
    };

    const saveResult = await annotationPersistenceService.savePageAnnotations({
      scriptId,
      pageIdentifier: pageId,
      payload: fullDocPayload,
      userId: professorId,
      userRole: 'PROFESSOR',
      baseUpdatedAt,
    });

    expect(saveResult.naturalWidth).toBe(1654);
    expect(saveResult.naturalHeight).toBe(2339);

    const getResult = await annotationPersistenceService.getPageAnnotations({
      scriptId,
      pageIdentifier: pageId,
      userId: professorId,
      userRole: 'PROFESSOR',
    });

    expect(getResult.naturalWidth).toBe(1654);
    expect(getResult.naturalHeight).toBe(2339);
  });

  it('3. rejects unvalidated client dimensions (e.g. viewport / zoomed dimensions) that conflict with authoritative page dimensions', async () => {
    const p = await Page.findById(pageId);
    const baseUpdatedAt = p!.updatedAt;

    // Client passes viewport dimensions (e.g. 1024x768) instead of natural 1654x2339
    await expect(
      annotationPersistenceService.savePageAnnotations({
        scriptId,
        pageIdentifier: pageId,
        payload: {
          annotations: [],
          strokes: [],
          naturalWidth: 1024,
          naturalHeight: 768,
        },
        userId: professorId,
        userRole: 'PROFESSOR',
        baseUpdatedAt,
      })
    ).rejects.toThrow(HttpError);

    await expect(
      annotationPersistenceService.savePageAnnotations({
        scriptId,
        pageIdentifier: pageId,
        payload: {
          annotations: [],
          strokes: [],
          naturalWidth: 1024,
          naturalHeight: 768,
        },
        userId: professorId,
        userRole: 'PROFESSOR',
        baseUpdatedAt,
      })
    ).rejects.toThrow(/Payload natural dimensions \(1024x768\) do not match authoritative page dimensions \(1654x2339\)/);
  });

  it('4. maintains backward compatibility for legacy pages without dimensions', async () => {
    // Legacy Page without width/height in database
    const legacyPage = await Page.create({
      answerScript: new mongoose.Types.ObjectId(scriptId),
      pageNumber: 99,
      imagePath: 'legacy.png',
      isActive: true,
      annotations: {
        annotations: [
          {
            id: 'legacy-c1',
            pageKey: '99',
            type: 'check',
            x: 100,
            y: 100,
            size: 20,
            color: '#16a34a',
            createdAt: 1000,
          },
        ],
        strokes: [],
      },
    });

    const getResult = await annotationPersistenceService.getPageAnnotations({
      scriptId,
      pageIdentifier: legacyPage._id.toString(),
      userId: professorId,
      userRole: 'PROFESSOR',
    });

    // Succeeds without error; naturalWidth/naturalHeight are safely undefined
    expect(getResult.annotations).toHaveLength(1);
    expect(getResult.naturalWidth).toBeUndefined();
    expect(getResult.naturalHeight).toBeUndefined();
  });

  it('5. derives natural dimensions on IngestionPage targets and protects against repair dimension changes', async () => {
    const ingestion = await IngestionPage.findById(ingestionPageId);
    const baseUpdatedAt = ingestion!.updatedAt;

    // 1. Save annotations on page 2 (IngestionPage targets with width: 2048, height: 1448)
    const saveResult = await annotationPersistenceService.savePageAnnotations({
      scriptId,
      pageIdentifier: ingestionPageId,
      payload: {
        annotations: [
          {
            id: 'note-1',
            pageKey: ingestionPageId,
            type: 'text',
            x: 200,
            y: 300,
            text: 'Good job',
            fontSize: 14,
            createdAt: Date.now(),
          },
        ],
        strokes: [],
      },
      userId: professorId,
      userRole: 'PROFESSOR',
      baseUpdatedAt,
    });

    expect(saveResult.naturalWidth).toBe(2048);
    expect(saveResult.naturalHeight).toBe(1448);

    // 2. Fetch stored annotations as export caller would
    const getResult = await annotationPersistenceService.getPageAnnotations({
      scriptId,
      pageIdentifier: ingestionPageId,
      userId: professorId,
      userRole: 'PROFESSOR',
    });

    expect(getResult.naturalWidth).toBe(2048);
    expect(getResult.naturalHeight).toBe(1448);

    // 3. Now simulate DerivedPageRepairService repairing the page image to a different resolution
    // (e.g. 1024 x 724 or 3000 x 2000)
    const repairedWidth = 1024;
    const repairedHeight = 724;
    const repairedCanvas = createCanvas(repairedWidth, repairedHeight);
    const repairedCtx = repairedCanvas.getContext('2d');
    repairedCtx.fillStyle = '#ffffff';
    repairedCtx.fillRect(0, 0, repairedWidth, repairedHeight);
    const repairedImageBuffer = repairedCanvas.toBuffer('image/png');

    // 4. Pass the repaired image buffer and stored annotations to AnnotationCompositor
    // Proves that compositePageAnnotations detects the repair-induced mismatch and fails closed
    await expect(
      compositePageAnnotations(repairedImageBuffer, {
        annotations: getResult.annotations,
        strokes: getResult.strokes,
        naturalWidth: getResult.naturalWidth,
        naturalHeight: getResult.naturalHeight,
      })
    ).rejects.toThrow(
      /Composite dimension mismatch: annotation document was authored for 2048x1448, but image has natural dimensions 1024x724/
    );
  });
});
