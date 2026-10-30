import mongoose from 'mongoose';
import IngestionPage from '../models/IngestionPage';
import Page from '../models/Page';
import {
    cloneMarkAnnotation,
    cloneFreehandStroke,
    type SerializedPageAnnotations,
} from './annotationSerialization';
import type { MarkAnnotation } from './stampTool';
import type { FreehandStroke } from './penTool';

/**
 * Shared helper to resolve and project sanitized page annotations for student read-only view
 * and watermarked PDF export (AE-183 / AE-187).
 *
 * Requirements:
 * 1. Checks IngestionPage by physical `_id` and `answerScript` (skipping duplicates).
 *    Uses `IngestionPage.metadata.annotations` exclusively for ingestion pages.
 * 2. Falls back to standard `Page` by `_id` and `answerScript` (active pages only).
 * 3. Never falls back across pages by `pageNumber` to avoid cross-file mark collisions
 *    when scripts contain multiple uploaded files with overlapping page indices.
 * 4. Strictly sanitizes mark annotations and pen strokes:
 *    - Strips grader identity (`annotatedBy`, `graderEmail`) and internal metadata.
 *    - Restricts mark annotations to allowlisted types: `check`, `cross`, `highlight`, `text`.
 *    - Validates stroke points array (>= 2 valid numeric coordinate points).
 *    - Sets `pageKey` to the physical page ID.
 */
export async function getStudentPageAnnotations(
    scriptId: mongoose.Types.ObjectId | string,
    pageId: mongoose.Types.ObjectId | string
): Promise<SerializedPageAnnotations | null> {
    const scriptIdObj =
        typeof scriptId === 'string' ? new mongoose.Types.ObjectId(scriptId) : scriptId;
    const pageIdObj =
        typeof pageId === 'string' ? new mongoose.Types.ObjectId(pageId) : pageId;

    let rawAnnotations: SerializedPageAnnotations | null = null;
    let foundPage = false;

    // 1. IngestionPage lookup by physical page ID and answerScript
    const ingestionPage = await IngestionPage.findOne({
        _id: pageIdObj,
        answerScript: scriptIdObj,
        isDuplicate: { $ne: true },
    }).select('metadata.annotations');

    if (ingestionPage) {
        foundPage = true;
        rawAnnotations = (ingestionPage.metadata?.annotations as SerializedPageAnnotations) || null;
    } else {
        // 2. Standard Page fallback by physical page ID and answerScript
        const standardPage = await Page.findOne({
            _id: pageIdObj,
            answerScript: scriptIdObj,
            isActive: true,
        }).select('annotations');

        if (standardPage) {
            foundPage = true;
            rawAnnotations = (standardPage.annotations as SerializedPageAnnotations) || null;
        }
    }

    if (!foundPage) {
        return null;
    }

    const pageIdStr = pageIdObj.toString();

    // 3. Strict allowlist projection for mark annotations
    const rawAnnotationList = Array.isArray(rawAnnotations?.annotations)
        ? rawAnnotations.annotations
        : [];
    const annotations = rawAnnotationList
        .map((a: unknown) => {
            const raw =
                a && typeof (a as { toObject?: () => Record<string, unknown> }).toObject === 'function'
                    ? (a as { toObject: () => Record<string, unknown> }).toObject()
                    : ((a as Record<string, unknown>) || {});
            const type = (raw.type as string) || (raw.tool as string);
            const normalized = {
                ...raw,
                type,
                pageKey: raw.pageKey ?? pageIdStr,
            };
            return cloneMarkAnnotation(normalized as MarkAnnotation);
        })
        .filter((a) => a && ['check', 'cross', 'highlight', 'text'].includes(a.type));

    // 4. Strict allowlist projection for freehand strokes
    const rawStrokeList = Array.isArray(rawAnnotations?.strokes) ? rawAnnotations.strokes : [];
    const strokes = rawStrokeList
        .map((s: unknown) => {
            const raw =
                s && typeof (s as { toObject?: () => Record<string, unknown> }).toObject === 'function'
                    ? (s as { toObject: () => Record<string, unknown> }).toObject()
                    : ((s as Record<string, unknown>) || {});
            const normalized = {
                ...raw,
                pageKey: raw.pageKey ?? pageIdStr,
            };
            return cloneFreehandStroke(normalized as FreehandStroke);
        })
        .filter(
            (s): s is FreehandStroke =>
                Boolean(s) &&
                Array.isArray(s?.points) &&
                s.points.length >= 2 &&
                s.points.every((pt) => typeof pt === 'number' && !Number.isNaN(pt))
        );

    const result: SerializedPageAnnotations = { annotations, strokes };

    if (
        typeof rawAnnotations?.naturalWidth === 'number' &&
        Number.isFinite(rawAnnotations.naturalWidth) &&
        rawAnnotations.naturalWidth > 0
    ) {
        result.naturalWidth = rawAnnotations.naturalWidth;
    }

    if (
        typeof rawAnnotations?.naturalHeight === 'number' &&
        Number.isFinite(rawAnnotations.naturalHeight) &&
        rawAnnotations.naturalHeight > 0
    ) {
        result.naturalHeight = rawAnnotations.naturalHeight;
    }

    return result;
}
