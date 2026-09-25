/**
 * Annotation Persistence Service (AE-135)
 *
 * Handles atomic saving and deterministic replacement of page-level vector annotations
 * for answer scripts. Ensures strict validation using AE-134 rules, exam access scoping,
 * script-page relationship verification, and source image immutability.
 */

import mongoose from 'mongoose';
import AnswerScript from '../models/AnswerScript';
import Page, { type IPage } from '../models/Page';
import IngestionPage, { type IIngestionPage } from '../models/IngestionPage';
import ExamRepository from '../repositories/ExamRepository';
import AllocationService from './AllocationService';
import { AllocationStatus } from '../models/Allocation';
import { UserRole } from '../constants/permissions';
import {
  validateAnnotationDocument,
  cloneMarkAnnotation,
  cloneFreehandStroke,
  type SerializedPageAnnotations,
  type SerializedAnnotationDocument,
} from '../lib/annotationSerialization';
import type { MarkAnnotation } from '../lib/stampTool';
import type { FreehandStroke } from '../lib/penTool';
import { HttpError } from '../lib/errors';
import { writeAuditLog } from '../lib/audit';

export interface SavePageAnnotationsOptions {
  scriptId: string;
  pageIdentifier: string;
  payload: unknown;
  userId: string;
  userRole: string;
  question?: number | null;
  ipAddress?: string;
  expectedUpdatedAt?: string | number | Date | null;
  baseUpdatedAt?: string | number | Date | null;
  force?: boolean;
}

export interface SavePageAnnotationsResult {
  scriptId: string;
  pageId: string;
  pageNumber: number;
  annotations: MarkAnnotation[];
  strokes: FreehandStroke[];
  totalAnnotations: number;
  totalStrokes: number;
  savedAt: string;
  updatedAt?: string;
}

export interface GetPageAnnotationsOptions {
  scriptId: string;
  pageIdentifier: string;
  userId: string;
  userRole: string;
  question?: number | null;
}

export interface GetPageAnnotationsResult {
  scriptId: string;
  pageId: string;
  pageNumber: number;
  annotations: MarkAnnotation[];
  strokes: FreehandStroke[];
  totalAnnotations: number;
  totalStrokes: number;
  annotatedBy?: string | null;
  updatedAt?: string;
}

export class AnnotationPersistenceService {
  /**
   * Retrieves vector annotations for a specific answer script page directly from Page.annotations (single source of truth).
   */
  async getPageAnnotations(
    options: GetPageAnnotationsOptions
  ): Promise<GetPageAnnotationsResult> {
    const { scriptId, pageIdentifier, userId, userRole } = options;

    // 1. Validate AnswerScript ID format
    if (!scriptId || !mongoose.Types.ObjectId.isValid(scriptId)) {
      throw new HttpError('Invalid AnswerScript ID format', 400);
    }

    // 2. Validate Page identifier format (must be valid ObjectId or positive integer)
    const isObjectId = mongoose.Types.ObjectId.isValid(pageIdentifier);
    const isNumericPage =
      !isNaN(Number(pageIdentifier)) &&
      Number.isInteger(Number(pageIdentifier)) &&
      Number(pageIdentifier) > 0;

    if (!isObjectId && !isNumericPage) {
      throw new HttpError('Invalid page identifier format', 400);
    }

    // 3. Retrieve AnswerScript and verify active status
    const script = await AnswerScript.findOne({ _id: scriptId, isActive: true });
    if (!script) {
      throw new HttpError('AnswerScript not found', 404);
    }

    // 4. Verify user has authorized access to the exam
    const exam = await ExamRepository.getExamById(script.exam.toString(), userId, userRole);
    if (!exam) {
      throw new HttpError('Forbidden: Access denied to the exam for this answer script', 403);
    }

    // 5. Enforce allocation-scoped authorization for TA callers (AE-135/AE-136 P2)
    const isProfessorOrAdmin =
      userRole?.toUpperCase() === UserRole.PROFESSOR ||
      userRole?.toUpperCase() === UserRole.ADMIN;

    if (!isProfessorOrAdmin) {
      const allocation = await AllocationService.verifyTaAllocation(
        script._id,
        userId,
        options.question
      );
      if (!allocation) {
        throw new HttpError('Forbidden: You are not allocated to grade this answer script', 403);
      }
    }

    // 5. Resolve target Page and verify it belongs to this AnswerScript
    let targetPageId: mongoose.Types.ObjectId;
    let targetPageNumber: number;
    let rawAnnotations: SerializedPageAnnotations | null | undefined = null;
    let annotatedBy: string | null = null;
    let updatedAt: string | undefined = undefined;

    if (isObjectId) {
      const pageIdObj = new mongoose.Types.ObjectId(pageIdentifier);

      const pageDoc = await Page.findOne({ _id: pageIdObj, isActive: true });
      if (pageDoc) {
        if (pageDoc.answerScript.toString() !== script._id.toString()) {
          throw new HttpError('Page does not belong to the requested answer script', 400);
        }
        targetPageId = pageDoc._id;
        targetPageNumber = pageDoc.pageNumber;
        rawAnnotations = pageDoc.annotations;
        annotatedBy = pageDoc.annotatedBy?.toString() || null;
        updatedAt = pageDoc.updatedAt?.toISOString();
      } else {
        const ingestionDoc = await IngestionPage.findById(pageIdObj);
        if (ingestionDoc) {
          if (
            !ingestionDoc.answerScript ||
            ingestionDoc.answerScript.toString() !== script._id.toString()
          ) {
            throw new HttpError('Page does not belong to the requested answer script', 400);
          }
          targetPageId = ingestionDoc._id;
          targetPageNumber = ingestionDoc.pageNumber;
          rawAnnotations = ingestionDoc.metadata?.annotations as SerializedPageAnnotations;
          annotatedBy = (ingestionDoc.metadata?.annotatedBy as string) || null;
          updatedAt = ingestionDoc.updatedAt?.toISOString();
        } else {
          throw new HttpError('Page not found', 404);
        }
      }
    } else {
      const pageNum = Number(pageIdentifier);

      const pageDoc = await Page.findOne({
        answerScript: script._id,
        pageNumber: pageNum,
        isActive: true,
      });

      if (pageDoc) {
        targetPageId = pageDoc._id;
        targetPageNumber = pageDoc.pageNumber;
        rawAnnotations = pageDoc.annotations;
        annotatedBy = pageDoc.annotatedBy?.toString() || null;
        updatedAt = pageDoc.updatedAt?.toISOString();
      } else {
        const ingestionDoc = await IngestionPage.findOne({
          answerScript: script._id,
          pageNumber: pageNum,
        });

        if (ingestionDoc) {
          targetPageId = ingestionDoc._id;
          targetPageNumber = ingestionDoc.pageNumber;
          rawAnnotations = ingestionDoc.metadata?.annotations as SerializedPageAnnotations;
          annotatedBy = (ingestionDoc.metadata?.annotatedBy as string) || null;
          updatedAt = ingestionDoc.updatedAt?.toISOString();
        } else {
          throw new HttpError(`Page ${pageNum} not found for this answer script`, 404);
        }
      }
    }

    // 6. If no annotations exist on the Page document, return clean empty collection
    if (!rawAnnotations) {
      return {
        scriptId: script._id.toString(),
        pageId: targetPageId.toString(),
        pageNumber: targetPageNumber,
        annotations: [],
        strokes: [],
        totalAnnotations: 0,
        totalStrokes: 0,
        annotatedBy: null,
        updatedAt,
      };
    }

    // 7. Validate and normalize stored payload safely (fail-safe on corrupt data)
    try {
      const normalized = this.validateAndNormalizePayload(
        rawAnnotations,
        targetPageId.toString()
      );

      return {
        scriptId: script._id.toString(),
        pageId: targetPageId.toString(),
        pageNumber: targetPageNumber,
        annotations: normalized.annotations,
        strokes: normalized.strokes,
        totalAnnotations: normalized.annotations.length,
        totalStrokes: normalized.strokes.length,
        annotatedBy,
        updatedAt,
      };
    } catch {
      // Corrupt or malformed payload in database falls back safely to empty state
      return {
        scriptId: script._id.toString(),
        pageId: targetPageId.toString(),
        pageNumber: targetPageNumber,
        annotations: [],
        strokes: [],
        totalAnnotations: 0,
        totalStrokes: 0,
        annotatedBy,
        updatedAt,
      };
    }
  }

  /**
   * Saves and deterministically replaces vector annotations for a specific answer script page.
   * Persists directly to Page.annotations as the single source of truth.
   */
  async savePageAnnotations(
    options: SavePageAnnotationsOptions
  ): Promise<SavePageAnnotationsResult> {
    const { scriptId, pageIdentifier, payload, userId, userRole, ipAddress } = options;

    // 1. Validate AnswerScript ID format
    if (!scriptId || !mongoose.Types.ObjectId.isValid(scriptId)) {
      throw new HttpError('Invalid AnswerScript ID format', 400);
    }

    // 2. Validate Page identifier format (must be valid ObjectId or positive integer)
    const isObjectId = mongoose.Types.ObjectId.isValid(pageIdentifier);
    const isNumericPage =
      !isNaN(Number(pageIdentifier)) &&
      Number.isInteger(Number(pageIdentifier)) &&
      Number(pageIdentifier) > 0;

    if (!isObjectId && !isNumericPage) {
      throw new HttpError('Invalid page identifier format', 400);
    }

    // 3. Retrieve AnswerScript and verify active status
    const script = await AnswerScript.findOne({ _id: scriptId, isActive: true });
    if (!script) {
      throw new HttpError('AnswerScript not found', 404);
    }

    // 4. Verify user has authorized access to the exam
    const exam = await ExamRepository.getExamById(script.exam.toString(), userId, userRole);
    if (!exam) {
      throw new HttpError('Forbidden: Access denied to the exam for this answer script', 403);
    }

    // 5. Enforce allocation-scoped authorization for TA callers (AE-135/AE-136 P2)
    const isProfessorOrAdmin =
      userRole?.toUpperCase() === UserRole.PROFESSOR ||
      userRole?.toUpperCase() === UserRole.ADMIN;

    if (!isProfessorOrAdmin) {
      const allocation = await AllocationService.verifyTaAllocation(
        script._id,
        userId,
        options.question
      );
      if (!allocation) {
        throw new HttpError('Forbidden: You are not allocated to grade this answer script', 403);
      }

      if (allocation.status === AllocationStatus.COMPLETED) {
        throw new HttpError(
          'Cannot save annotations: This script allocation has already been submitted and locked.',
          409
        );
      }
    }

    // 6. Resolve the target Page and verify it belongs to this AnswerScript
    let targetPageId: mongoose.Types.ObjectId;
    let targetPageNumber: number;
    let pageDoc: IPage | null = null;
    let ingestionDoc: IIngestionPage | null = null;

    if (isObjectId) {
      const pageIdObj = new mongoose.Types.ObjectId(pageIdentifier);

      // Check standard Page collection
      pageDoc = await Page.findOne({ _id: pageIdObj, isActive: true });
      if (pageDoc) {
        if (pageDoc.answerScript.toString() !== script._id.toString()) {
          throw new HttpError('Page does not belong to the requested answer script', 400);
        }
        targetPageId = pageDoc._id;
        targetPageNumber = pageDoc.pageNumber;
      } else {
        // Fallback to IngestionPage collection
        ingestionDoc = await IngestionPage.findById(pageIdObj);
        if (ingestionDoc) {
          if (
            !ingestionDoc.answerScript ||
            ingestionDoc.answerScript.toString() !== script._id.toString()
          ) {
            throw new HttpError('Page does not belong to the requested answer script', 400);
          }
          targetPageId = ingestionDoc._id;
          targetPageNumber = ingestionDoc.pageNumber;
        } else {
          throw new HttpError('Page not found', 404);
        }
      }
    } else {
      // Numeric pageNumber lookup
      const pageNum = Number(pageIdentifier);

      pageDoc = await Page.findOne({
        answerScript: script._id,
        pageNumber: pageNum,
        isActive: true,
      });

      if (pageDoc) {
        targetPageId = pageDoc._id;
        targetPageNumber = pageDoc.pageNumber;
      } else {
        ingestionDoc = await IngestionPage.findOne({
          answerScript: script._id,
          pageNumber: pageNum,
        });

        if (ingestionDoc) {
          targetPageId = ingestionDoc._id;
          targetPageNumber = ingestionDoc.pageNumber;
        } else {
          throw new HttpError(`Page ${pageNum} not found for this answer script`, 404);
        }
      }
    }

    // 6. Validate and normalize the vector annotation payload using AE-134 utilities
    const normalizedPageData = this.validateAndNormalizePayload(
      payload,
      targetPageId.toString()
    );

    // AE-171: Detect concurrency conflict if expectedUpdatedAt/baseUpdatedAt is provided
    const baseUpdated = options.expectedUpdatedAt ?? options.baseUpdatedAt;
    if (baseUpdated && !options.force) {
      const baseTime = new Date(baseUpdated).getTime();
      const currentDocTime = pageDoc?.updatedAt
        ? new Date(pageDoc.updatedAt).getTime()
        : ingestionDoc?.updatedAt
        ? new Date(ingestionDoc.updatedAt).getTime()
        : null;

      if (currentDocTime !== null && !isNaN(baseTime) && !isNaN(currentDocTime) && currentDocTime > baseTime) {
        throw new HttpError(
          'Conflict: Annotations have been modified on the server since your draft was loaded.',
          409
        );
      }
    }

    // 7. Persist vector data directly onto Page (single source of truth) without altering image storage
    let updatedDocTimestamp: Date = new Date();
    if (pageDoc) {
      pageDoc.annotations = normalizedPageData;
      pageDoc.annotatedBy = new mongoose.Types.ObjectId(userId);
      await pageDoc.save();
      updatedDocTimestamp = pageDoc.updatedAt || new Date();
    } else if (ingestionDoc) {
      ingestionDoc.metadata = {
        ...(ingestionDoc.metadata || {}),
        annotations: normalizedPageData,
        annotatedBy: userId,
      };
      await ingestionDoc.save();
      updatedDocTimestamp = ingestionDoc.updatedAt || new Date();
    }

    // 8. Record audit log
    await writeAuditLog({
      user: userId,
      action: 'PAGE_ANNOTATIONS_SAVED',
      outcome: 'SUCCESS',
      entityId: targetPageId,
      entityType: 'Page',
      details: {
        scriptId: script._id.toString(),
        pageNumber: targetPageNumber,
        totalAnnotations: normalizedPageData.annotations.length,
        totalStrokes: normalizedPageData.strokes.length,
      },
      ipAddress,
    });

    return {
      scriptId: script._id.toString(),
      pageId: targetPageId.toString(),
      pageNumber: targetPageNumber,
      annotations: normalizedPageData.annotations,
      strokes: normalizedPageData.strokes,
      totalAnnotations: normalizedPageData.annotations.length,
      totalStrokes: normalizedPageData.strokes.length,
      savedAt: new Date().toISOString(),
      updatedAt: updatedDocTimestamp.toISOString(),
    };
  }

  /**
   * Validates and normalizes unknown payload into a valid SerializedPageAnnotations structure.
   */
  private validateAndNormalizePayload(
    payload: unknown,
    pageKey: string
  ): SerializedPageAnnotations {
    if (!payload || typeof payload !== 'object') {
      throw new HttpError('Invalid annotation payload: Payload must be an object', 400);
    }

    const raw = payload as Record<string, unknown>;

    // Case A: Full SerializedAnnotationDocument with `version` and `pages`
    if (typeof raw.version === 'number' && raw.pages && typeof raw.pages === 'object') {
      const validation = validateAnnotationDocument(raw);
      if (!validation.valid) {
        throw new HttpError(`Invalid annotation payload: ${validation.errors.join('; ')}`, 400);
      }

      const doc = raw as unknown as SerializedAnnotationDocument;
      // Extract from the matching pageKey or first available page
      const pageData = doc.pages[pageKey] || Object.values(doc.pages)[0] || {
        annotations: [],
        strokes: [],
      };

      return {
        annotations: (pageData.annotations || []).map(cloneMarkAnnotation),
        strokes: (pageData.strokes || []).map(cloneFreehandStroke),
      };
    }

    // Case B: Single-page payload `{ annotations?: [...], strokes?: [...] }`
    const singlePageWrapper: SerializedAnnotationDocument = {
      version: 1,
      pages: {
        [pageKey]: {
          annotations: (Array.isArray(raw.annotations) ? raw.annotations : []) as MarkAnnotation[],
          strokes: (Array.isArray(raw.strokes) ? raw.strokes : []) as FreehandStroke[],
        },
      },
    };

    const validation = validateAnnotationDocument(singlePageWrapper);
    if (!validation.valid) {
      throw new HttpError(`Invalid annotation payload: ${validation.errors.join('; ')}`, 400);
    }

    return {
      annotations: (singlePageWrapper.pages[pageKey].annotations || []).map(cloneMarkAnnotation),
      strokes: (singlePageWrapper.pages[pageKey].strokes || []).map(cloneFreehandStroke),
    };
  }
}

export const annotationPersistenceService = new AnnotationPersistenceService();
export default annotationPersistenceService;
