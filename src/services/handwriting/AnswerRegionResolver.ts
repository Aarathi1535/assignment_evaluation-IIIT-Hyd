import { IBoundingBox } from '../../models/HandwritingConsistency';
import { IResolvedAnswerSheetPage } from './AnswerSheetSourceAdapter';

export interface RawAnswerRegion {
    regionId: string;
    questionNumber?: number;
    subQuestion?: string;
    pageNumber: number;
    boundingBox?: IBoundingBox;
    confidence?: number;
    metadata?: Record<string, unknown>;
}

export interface IResolvedAnswerRegion {
    regionId: string;
    answerScriptId: string;
    studentId: string;
    questionNumber?: number;
    subQuestion?: string;
    pageNumber: number;
    boundingBox: IBoundingBox;
    sourceReference: string;
    imageBuffer: Buffer;
    metadata?: Record<string, unknown>;
}

export interface RegionResolutionResult {
    resolved: boolean;
    unresolvedReason?: string;
    regions: IResolvedAnswerRegion[];
}

export interface Direction3AnswerSegmentLike {
    segmentId: string;
    pageNumber: number;
    box?: IBoundingBox;
    segmentType?: string;
    sequenceIndex?: number;
    confidence?: number;
}

export interface Direction3ReconstructedAnswerLike {
    answerScript: string | { toString(): string };
    questionNumber: number;
    subQuestion?: string;
    segments: Direction3AnswerSegmentLike[];
}

/**
 * Validates whether a bounding box has valid normalized dimensions in [0, 1].
 */
export function isValidBoundingBox(box?: IBoundingBox): box is IBoundingBox {
    if (!box) return false;
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y) || !Number.isFinite(box.width) || !Number.isFinite(box.height)) {
        return false;
    }
    if (box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0) {
        return false;
    }
    // Allow slight float margin of error up to 1.01
    if (box.x > 1 || box.y > 1 || (box.x + box.width) > 1.02 || (box.y + box.height) > 1.02) {
        return false;
    }
    return true;
}

/**
 * Research-only resolver for isolating answer regions from answer-sheet pages.
 * Supports single regions, multiple distinct regions per page, and non-consecutive
 * multi-page continuation answers from Direction 3.
 *
 * NOTE: If a region cannot be confidently resolved, returns an explicit unresolved
 * state instead of silently falling back to the entire page.
 */
export class AnswerRegionResolver {
    /**
     * Resolves an array of candidate answer regions for an answer script using rendered page images.
     */
    public resolveRegions(
        answerScriptId: string,
        studentId: string,
        regions: RawAnswerRegion[],
        pages: IResolvedAnswerSheetPage[]
    ): RegionResolutionResult {
        if (!regions || regions.length === 0) {
            return {
                resolved: false,
                unresolvedReason: 'No answer regions provided for resolution',
                regions: []
            };
        }

        const pageMap = new Map<number, IResolvedAnswerSheetPage>();
        for (const p of pages) {
            pageMap.set(p.pageNumber, p);
        }

        const resolvedRegions: IResolvedAnswerRegion[] = [];

        for (const reg of regions) {
            // 1. Strict validation: Bounding box must be valid and non-zero
            if (!isValidBoundingBox(reg.boundingBox)) {
                return {
                    resolved: false,
                    unresolvedReason: `Region ${reg.regionId} has invalid or missing bounding box. Silent full-page fallback is disallowed.`,
                    regions: []
                };
            }

            // 2. Confidence check: low or zero confidence cannot be confidently resolved
            if (reg.confidence !== undefined && reg.confidence <= 0) {
                return {
                    resolved: false,
                    unresolvedReason: `Region ${reg.regionId} has non-positive confidence score (${reg.confidence}).`,
                    regions: []
                };
            }

            // 3. Page match check
            const matchedPage = pageMap.get(reg.pageNumber);
            if (!matchedPage) {
                return {
                    resolved: false,
                    unresolvedReason: `Page ${reg.pageNumber} referenced by region ${reg.regionId} could not be resolved from answer sheet images.`,
                    regions: []
                };
            }

            // Deterministic source reference: script_<id>_p<page>_q<q>_box_<x>_<y>_<w>_<h>
            const qPart = reg.questionNumber !== undefined ? `_q${reg.questionNumber}${reg.subQuestion ? `_${reg.subQuestion}` : ''}` : '';
            const boxPart = `_b${reg.boundingBox.x.toFixed(3)}_${reg.boundingBox.y.toFixed(3)}_${reg.boundingBox.width.toFixed(3)}_${reg.boundingBox.height.toFixed(3)}`;
            const sourceReference = `script_${answerScriptId}_p${reg.pageNumber}${qPart}_r${reg.regionId}${boxPart}`;

            resolvedRegions.push({
                regionId: reg.regionId,
                answerScriptId,
                studentId,
                questionNumber: reg.questionNumber,
                subQuestion: reg.subQuestion,
                pageNumber: reg.pageNumber,
                boundingBox: reg.boundingBox,
                sourceReference,
                imageBuffer: matchedPage.imageBuffer,
                metadata: {
                    ...reg.metadata,
                    confidence: reg.confidence
                }
            });
        }

        return {
            resolved: true,
            regions: resolvedRegions
        };
    }

    /**
     * Resolves regions from a Direction 3 ReconstructedAnswer document or segment structure.
     * Preserves question identity and handles non-consecutive multi-page continuation segments.
     */
    public resolveFromDirection3ReconstructedAnswer(
        reconstructedAnswer: Direction3ReconstructedAnswerLike,
        studentId: string,
        pages: IResolvedAnswerSheetPage[]
    ): RegionResolutionResult {
        const answerScriptId = typeof reconstructedAnswer.answerScript === 'object'
            ? reconstructedAnswer.answerScript.toString()
            : reconstructedAnswer.answerScript;

        if (!reconstructedAnswer.segments || reconstructedAnswer.segments.length === 0) {
            return {
                resolved: false,
                unresolvedReason: `ReconstructedAnswer for Question ${reconstructedAnswer.questionNumber} contains zero segments.`,
                regions: []
            };
        }

        const rawRegions: RawAnswerRegion[] = reconstructedAnswer.segments.map((seg, idx) => ({
            regionId: seg.segmentId || `seg_${idx + 1}`,
            questionNumber: reconstructedAnswer.questionNumber,
            subQuestion: reconstructedAnswer.subQuestion,
            pageNumber: seg.pageNumber,
            boundingBox: seg.box,
            confidence: seg.confidence ?? 1.0,
            metadata: {
                segmentType: seg.segmentType,
                sequenceIndex: seg.sequenceIndex
            }
        }));

        return this.resolveRegions(answerScriptId, studentId, rawRegions, pages);
    }
}

export const answerRegionResolver = new AnswerRegionResolver();
export default answerRegionResolver;
