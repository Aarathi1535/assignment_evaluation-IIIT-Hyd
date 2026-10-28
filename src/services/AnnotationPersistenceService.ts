/**
 * Annotation Persistence Service (AE-135)
 *
 * Handles atomic saving and deterministic replacement of page-level vector annotations
 * for answer scripts. Ensures strict validation using AE-134 rules, exam access scoping,
 * script-page relationship verification, and source image immutability.
 */

import mongoose from 'mongoose';
import AnswerScript from '../models/AnswerScript';
import Page from '../models/Page';
import IngestionPage from '../models/IngestionPage';
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

export class ConflictHttpError extends HttpError {
  serverData: unknown;
  serverUpdatedAt?: string | null;
  isLocked?: boolean;

  constructor(
    message: string,
    serverData?: unknown,
    serverUpdatedAt?: string | null,
    isLocked = false
  ) {
    super(message, 409);
    this.name = 'ConflictHttpError';
    this.serverData = serverData;
    this.serverUpdatedAt = serverUpdatedAt;
    this.isLocked = isLocked;
    Object.setPrototypeOf(this, ConflictHttpError.prototype);
  }
}

export interface SavePageAnnotationsOptions {
  scriptId: string;
  pageIdentifier: string;
  payload: unknown;
  userId: string;
  userRole: string;
  question?: number | null;
  ipAddress?: string;
  baseUpdatedAt?: string | number | Date | null;
  requireBaseUpdatedAt?: boolean;
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
  naturalWidth?: number;
  naturalHeight?: number;
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
  naturalWidth?: number;
  naturalHeight?: number;
}

export class AnnotationPersistenceService {
  private static lastAuditLogTimestamps = new Map<string, number>();

  /**
   * Resets the autosave audit throttle map. Helpful for unit testing.
   */
  public static resetAuditThrottle(): void {
    AnnotationPersistenceService.lastAuditLogTimestamps.clear();
  }

  /**
   * Safely prunes stale throttle keys older than the 60-second window.
   */
  public static pruneStaleThrottleKeys(now: number = Date.now()): void {
    const cutoff = now - 60000;
    for (const [key, timestamp] of AnnotationPersistenceService.lastAuditLogTimestamps.entries()) {
      if (timestamp <= cutoff) {
        AnnotationPersistenceService.lastAuditLogTimestamps.delete(key);
      }
    }
  }

  /**
   * Returns the count of throttle entries currently tracked. Helpful for unit testing.
   */
  public static getThrottleKeyCount(): number {
    return AnnotationPersistenceService.lastAuditLogTimestamps.size;
  }
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

    let authoritativeWidth: number | undefined;
    let authoritativeHeight: number | undefined;

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
        if (typeof pageDoc.width === 'number' && typeof pageDoc.height === 'number') {
          authoritativeWidth = pageDoc.width;
          authoritativeHeight = pageDoc.height;
        } else {
          const matchingIngestion = await IngestionPage.findOne({
            answerScript: script._id,
            pageNumber: targetPageNumber,
          })
            .select('width height metadata')
            .lean();
          if (matchingIngestion) {
            authoritativeWidth = matchingIngestion.width || (matchingIngestion.metadata as Record<string, unknown>)?.width as number | undefined;
            authoritativeHeight = matchingIngestion.height || (matchingIngestion.metadata as Record<string, unknown>)?.height as number | undefined;
          }
        }
      } else {
        const ingestionDoc = await IngestionPage.findById(pageIdObj)
          .select('_id answerScript pageNumber updatedAt width height metadata')
          .lean();
        if (ingestionDoc) {
          if (
            !ingestionDoc.answerScript ||
            ingestionDoc.answerScript.toString() !== script._id.toString()
          ) {
            throw new HttpError('Page does not belong to the requested answer script', 400);
          }
          targetPageId = ingestionDoc._id;
          targetPageNumber = ingestionDoc.pageNumber;
          rawAnnotations = (ingestionDoc.metadata?.annotations as SerializedPageAnnotations) || null;
          annotatedBy = (ingestionDoc.metadata?.annotatedBy as string) || null;
          updatedAt = ingestionDoc.updatedAt?.toISOString();
          authoritativeWidth = ingestionDoc.width || (ingestionDoc.metadata as Record<string, unknown>)?.width as number | undefined;
          authoritativeHeight = ingestionDoc.height || (ingestionDoc.metadata as Record<string, unknown>)?.height as number | undefined;
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
        if (typeof pageDoc.width === 'number' && typeof pageDoc.height === 'number') {
          authoritativeWidth = pageDoc.width;
          authoritativeHeight = pageDoc.height;
        } else {
          const matchingIngestion = await IngestionPage.findOne({
            answerScript: script._id,
            pageNumber: targetPageNumber,
          })
            .select('width height metadata')
            .lean();
          if (matchingIngestion) {
            authoritativeWidth = matchingIngestion.width || (matchingIngestion.metadata as Record<string, unknown>)?.width as number | undefined;
            authoritativeHeight = matchingIngestion.height || (matchingIngestion.metadata as Record<string, unknown>)?.height as number | undefined;
          }
        }
      } else {
        const ingestionDoc = await IngestionPage.findOne({
          answerScript: script._id,
          pageNumber: pageNum,
        })
          .select('_id answerScript pageNumber updatedAt width height metadata')
          .lean();

        if (ingestionDoc) {
          targetPageId = ingestionDoc._id;
          targetPageNumber = ingestionDoc.pageNumber;
          rawAnnotations = (ingestionDoc.metadata?.annotations as SerializedPageAnnotations) || null;
          annotatedBy = (ingestionDoc.metadata?.annotatedBy as string) || null;
          updatedAt = ingestionDoc.updatedAt?.toISOString();
          authoritativeWidth = ingestionDoc.width || (ingestionDoc.metadata as Record<string, unknown>)?.width as number | undefined;
          authoritativeHeight = ingestionDoc.height || (ingestionDoc.metadata as Record<string, unknown>)?.height as number | undefined;
        } else {
          throw new HttpError(`Page ${pageNum} not found for this answer script`, 404);
        }
      }
    }

    const authoritativeDimensions =
      typeof authoritativeWidth === 'number' && typeof authoritativeHeight === 'number'
        ? { width: authoritativeWidth, height: authoritativeHeight }
        : undefined;

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
        naturalWidth: authoritativeDimensions?.width,
        naturalHeight: authoritativeDimensions?.height,
      };
    }

    // 7. Validate and normalize stored payload safely (fail-safe on corrupt data)
    try {
      const normalized = this.validateAndNormalizePayload(
        rawAnnotations,
        targetPageId.toString(),
        authoritativeDimensions
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
        naturalWidth: normalized.naturalWidth,
        naturalHeight: normalized.naturalHeight,
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
        throw new ConflictHttpError(
          'Cannot save annotations: This script allocation has already been submitted and locked.',
          null,
          null,
          true
        );
      }
    }

    // 6. Resolve target Page and verify it belongs to this AnswerScript
    let targetPageId: mongoose.Types.ObjectId;
    let targetPageNumber: number;
    let pageDoc: { _id: mongoose.Types.ObjectId; answerScript: mongoose.Types.ObjectId; pageNumber: number; updatedAt?: Date; width?: number; height?: number } | null = null;
    let ingestionDoc: { _id: mongoose.Types.ObjectId; answerScript?: mongoose.Types.ObjectId | null; pageNumber: number; updatedAt?: Date; width?: number; height?: number; metadata?: Record<string, unknown> } | null = null;

    if (isObjectId) {
      const pageIdObj = new mongoose.Types.ObjectId(pageIdentifier);

      const foundPage = await Page.findOne({ _id: pageIdObj, isActive: true })
        .select('_id answerScript pageNumber updatedAt width height')
        .lean();

      if (foundPage) {
        if (foundPage.answerScript.toString() !== script._id.toString()) {
          throw new HttpError('Page does not belong to the requested answer script', 400);
        }
        pageDoc = foundPage;
        targetPageId = foundPage._id;
        targetPageNumber = foundPage.pageNumber;
      } else {
        const foundIngestion = await IngestionPage.findById(pageIdObj)
          .select('_id answerScript pageNumber updatedAt width height metadata')
          .lean();

        if (foundIngestion) {
          if (
            !foundIngestion.answerScript ||
            foundIngestion.answerScript.toString() !== script._id.toString()
          ) {
            throw new HttpError('Page does not belong to the requested answer script', 400);
          }
          ingestionDoc = foundIngestion;
          targetPageId = foundIngestion._id;
          targetPageNumber = foundIngestion.pageNumber;
        } else {
          throw new HttpError('Page not found', 404);
        }
      }
    } else {
      const pageNum = Number(pageIdentifier);

      const foundPage = await Page.findOne({
        answerScript: script._id,
        pageNumber: pageNum,
        isActive: true,
      })
        .select('_id answerScript pageNumber updatedAt width height')
        .lean();

      if (foundPage) {
        pageDoc = foundPage;
        targetPageId = foundPage._id;
        targetPageNumber = foundPage.pageNumber;
      } else {
        const foundIngestion = await IngestionPage.findOne({
          answerScript: script._id,
          pageNumber: pageNum,
        })
          .select('_id answerScript pageNumber updatedAt width height metadata')
          .lean();

        if (foundIngestion) {
          ingestionDoc = foundIngestion;
          targetPageId = foundIngestion._id;
          targetPageNumber = foundIngestion.pageNumber;
        } else {
          throw new HttpError(`Page ${pageNum} not found for this answer script`, 404);
        }
      }
    }

    let authoritativeWidth: number | undefined;
    let authoritativeHeight: number | undefined;

    if (pageDoc) {
      if (typeof pageDoc.width === 'number' && typeof pageDoc.height === 'number') {
        authoritativeWidth = pageDoc.width;
        authoritativeHeight = pageDoc.height;
      } else {
        const matchingIngestion = await IngestionPage.findOne({
          answerScript: script._id,
          pageNumber: targetPageNumber,
        })
          .select('width height metadata')
          .lean();
        if (matchingIngestion) {
          authoritativeWidth = matchingIngestion.width || (matchingIngestion.metadata as Record<string, unknown>)?.width as number | undefined;
          authoritativeHeight = matchingIngestion.height || (matchingIngestion.metadata as Record<string, unknown>)?.height as number | undefined;
        }
      }
    } else if (ingestionDoc) {
      authoritativeWidth = ingestionDoc.width || (ingestionDoc.metadata as Record<string, unknown>)?.width as number | undefined;
      authoritativeHeight = ingestionDoc.height || (ingestionDoc.metadata as Record<string, unknown>)?.height as number | undefined;
    }

    const authoritativeDimensions =
      typeof authoritativeWidth === 'number' && typeof authoritativeHeight === 'number'
        ? { width: authoritativeWidth, height: authoritativeHeight }
        : undefined;

    // 7. Validate and normalize the vector annotation payload
    const normalizedPageData = this.validateAndNormalizePayload(
      payload,
      targetPageId.toString(),
      authoritativeDimensions
    );

    // 8. Validate baseUpdatedAt for optimistic concurrency
    let baseDate: Date;
    if (options.baseUpdatedAt) {
      baseDate = new Date(options.baseUpdatedAt);
      if (isNaN(baseDate.getTime())) {
        throw new HttpError('Invalid baseUpdatedAt timestamp format', 400);
      }
    } else if (!options.requireBaseUpdatedAt && (pageDoc?.updatedAt || ingestionDoc?.updatedAt)) {
      baseDate = pageDoc?.updatedAt || ingestionDoc?.updatedAt || new Date();
    } else {
      throw new HttpError(
        'baseUpdatedAt is required on every save to ensure conflict detection',
        400
      );
    }

    // 9. Throttle check and read previous annotations only when write will occur (AE-248)
    const throttleKey = `${userId}:${targetPageId.toString()}`;
    const now = Date.now();
    AnnotationPersistenceService.pruneStaleThrottleKeys(now);
    const lastAudit = AnnotationPersistenceService.lastAuditLogTimestamps.get(throttleKey);
    const shouldAudit = !lastAudit || now - lastAudit >= 60000;

    let previousAnnotationsSnapshot: SerializedPageAnnotations = { annotations: [], strokes: [] };
    if (shouldAudit) {
      let prevRawAnnotations: SerializedPageAnnotations | null | undefined = null;
      if (pageDoc) {
        const prevDoc = await Page.findById(targetPageId).select('annotations').lean();
        prevRawAnnotations = prevDoc?.annotations;
      } else if (ingestionDoc) {
        const prevDoc = await IngestionPage.findById(targetPageId).select('metadata.annotations').lean();
        prevRawAnnotations = (prevDoc?.metadata as { annotations?: SerializedPageAnnotations })?.annotations;
      }
      previousAnnotationsSnapshot = {
        annotations: (prevRawAnnotations?.annotations || []).map(cloneMarkAnnotation),
        strokes: (prevRawAnnotations?.strokes || []).map(cloneFreehandStroke),
      };
    }

    // 10. Atomic findOneAndUpdate
    let matchedCount = 0;
    let updatedDocTimestamp = new Date();

    if (pageDoc) {
      const updatedDoc = await Page.findOneAndUpdate(
        { _id: targetPageId, updatedAt: baseDate },
        {
          $set: {
            annotations: normalizedPageData,
            annotatedBy: new mongoose.Types.ObjectId(userId),
          },
        },
        { returnDocument: 'after', select: 'updatedAt' }
      );

      if (updatedDoc) {
        matchedCount = 1;
        if (updatedDoc.updatedAt) {
          updatedDocTimestamp = updatedDoc.updatedAt;
        }
      }
    } else if (ingestionDoc) {
      const updatedDoc = await IngestionPage.findOneAndUpdate(
        { _id: targetPageId, updatedAt: baseDate },
        {
          $set: {
            'metadata.annotations': normalizedPageData,
            'metadata.annotatedBy': userId,
          },
        },
        { returnDocument: 'after', select: 'updatedAt' }
      );

      if (updatedDoc) {
        matchedCount = 1;
        if (updatedDoc.updatedAt) {
          updatedDocTimestamp = updatedDoc.updatedAt;
        }
      }
    }

    if (matchedCount === 0) {
      let currentServerAnnotations: SerializedPageAnnotations | null = null;
      let currentServerUpdatedAt: string | null = null;

      if (pageDoc) {
        const latestDoc = await Page.findById(targetPageId);
        if (latestDoc) {
          currentServerAnnotations = latestDoc.annotations || null;
          currentServerUpdatedAt = latestDoc.updatedAt ? latestDoc.updatedAt.toISOString() : null;
        }
      } else if (ingestionDoc) {
        const latestDoc = await IngestionPage.findById(targetPageId);
        if (latestDoc) {
          currentServerAnnotations = (latestDoc.metadata?.annotations as SerializedPageAnnotations) || null;
          currentServerUpdatedAt = latestDoc.updatedAt ? latestDoc.updatedAt.toISOString() : null;
        }
      }

      throw new ConflictHttpError(
        'Conflict: Annotations have been modified on the server since your draft was loaded.',
        currentServerAnnotations || { annotations: [], strokes: [] },
        currentServerUpdatedAt
      );
    }

    // 11. Record audit log with 60-second window throttling per actor and page (AE-179/AE-248)
    if (shouldAudit) {
      // Preserve meaningful information about annotations added and removed using pre-mutation snapshot:
      const prevAnnList = previousAnnotationsSnapshot.annotations;
      const newAnnList = normalizedPageData.annotations;

      const prevAnnSet = new Set(prevAnnList.map((a: { id?: string }) => a.id).filter((id: string | undefined): id is string => Boolean(id)));
      const newAnnSet = new Set(newAnnList.map((a: { id?: string }) => a.id).filter((id: string | undefined): id is string => Boolean(id)));

      let annotationsAdded = 0;
      let annotationsRemoved = 0;
      if (prevAnnSet.size > 0 || newAnnSet.size > 0) {
        annotationsAdded = newAnnList.filter((a: { id?: string }) => a.id && !prevAnnSet.has(a.id)).length;
        annotationsRemoved = prevAnnList.filter((a: { id?: string }) => a.id && !newAnnSet.has(a.id)).length;
      } else {
        const diff = newAnnList.length - prevAnnList.length;
        if (diff > 0) annotationsAdded = diff;
        else annotationsRemoved = -diff;
      }

      let auditWritten = false;
      try {
        auditWritten = await writeAuditLog({
          user: userId,
          action: 'PAGE_ANNOTATIONS_SAVED',
          outcome: 'SUCCESS',
          entityId: targetPageId,
          entityType: pageDoc ? 'Page' : 'IngestionPage',
          details: {
            scriptId: script._id.toString(),
            pageNumber: targetPageNumber,
            totalAnnotations: normalizedPageData.annotations.length,
            totalStrokes: normalizedPageData.strokes.length,
            annotationsAdded,
            annotationsRemoved,
            previousAnnotationsCount: prevAnnList.length,
            previousStrokesCount: previousAnnotationsSnapshot.strokes.length,
          },
          ipAddress,
        });
      } catch (err) {
        console.error('Failed to write page annotation audit log:', err);
      }

      // Advance throttle timestamp only after writeAuditLog succeeds (AE-248)
      if (auditWritten) {
        AnnotationPersistenceService.lastAuditLogTimestamps.set(throttleKey, now);
      }
    }

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
      naturalWidth: normalizedPageData.naturalWidth,
      naturalHeight: normalizedPageData.naturalHeight,
    };
  }

  /**
   * Validates and normalizes unknown payload into a valid SerializedPageAnnotations structure.
   * If authoritative natural page dimensions are provided, enforces that client payload dimensions
   * match or derives them when omitted. Unvalidated client dimensions or viewport dimensions
   * that conflict with authoritative page dimensions are strictly rejected.
   */
  private validateAndNormalizePayload(
    payload: unknown,
    pageKey: string,
    authoritativeDimensions?: { width?: number; height?: number }
  ): SerializedPageAnnotations {
    if (!payload || typeof payload !== 'object') {
      throw new HttpError('Invalid annotation payload: Payload must be an object', 400);
    }

    const raw = payload as Record<string, unknown>;

    const resolveDimensions = (payloadW?: unknown, payloadH?: unknown) => {
      const numPayloadW =
        typeof payloadW === 'number' && Number.isFinite(payloadW) && payloadW > 0
          ? payloadW
          : undefined;
      const numPayloadH =
        typeof payloadH === 'number' && Number.isFinite(payloadH) && payloadH > 0
          ? payloadH
          : undefined;

      const authW = authoritativeDimensions?.width;
      const authH = authoritativeDimensions?.height;

      if (typeof authW === 'number' && authW > 0 && typeof authH === 'number' && authH > 0) {
        if (
          numPayloadW !== undefined &&
          numPayloadH !== undefined &&
          (numPayloadW !== authW || numPayloadH !== authH)
        ) {
          throw new HttpError(
            `Payload natural dimensions (${numPayloadW}x${numPayloadH}) do not match authoritative page dimensions (${authW}x${authH})`,
            400
          );
        }
        return { naturalWidth: authW, naturalHeight: authH };
      }

      if (numPayloadW !== undefined && numPayloadH !== undefined) {
        return { naturalWidth: numPayloadW, naturalHeight: numPayloadH };
      }

      return {};
    };

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

      const dims = resolveDimensions(pageData.naturalWidth, pageData.naturalHeight);

      const result: SerializedPageAnnotations = {
        annotations: (pageData.annotations || []).map(cloneMarkAnnotation),
        strokes: (pageData.strokes || []).map(cloneFreehandStroke),
      };
      if (dims.naturalWidth !== undefined) result.naturalWidth = dims.naturalWidth;
      if (dims.naturalHeight !== undefined) result.naturalHeight = dims.naturalHeight;
      return result;
    }

    // Case B: Single-page payload `{ annotations?: [...], strokes?: [...], naturalWidth?: ..., naturalHeight?: ... }`
    const singlePageWrapper: SerializedAnnotationDocument = {
      version: 1,
      pages: {
        [pageKey]: {
          annotations: (Array.isArray(raw.annotations) ? raw.annotations : []) as MarkAnnotation[],
          strokes: (Array.isArray(raw.strokes) ? raw.strokes : []) as FreehandStroke[],
        },
      },
    };
    if (typeof raw.naturalWidth === 'number') {
      singlePageWrapper.pages[pageKey].naturalWidth = raw.naturalWidth;
    }
    if (typeof raw.naturalHeight === 'number') {
      singlePageWrapper.pages[pageKey].naturalHeight = raw.naturalHeight;
    }

    const validation = validateAnnotationDocument(singlePageWrapper);
    if (!validation.valid) {
      throw new HttpError(`Invalid annotation payload: ${validation.errors.join('; ')}`, 400);
    }

    const pageObj = singlePageWrapper.pages[pageKey];
    const dims = resolveDimensions(pageObj.naturalWidth, pageObj.naturalHeight);

    const result: SerializedPageAnnotations = {
      annotations: (pageObj.annotations || []).map(cloneMarkAnnotation),
      strokes: (pageObj.strokes || []).map(cloneFreehandStroke),
    };
    if (dims.naturalWidth !== undefined) result.naturalWidth = dims.naturalWidth;
    if (dims.naturalHeight !== undefined) result.naturalHeight = dims.naturalHeight;
    return result;
  }
}

export const annotationPersistenceService = new AnnotationPersistenceService();
export default annotationPersistenceService;
