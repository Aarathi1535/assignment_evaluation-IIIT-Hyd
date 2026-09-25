import mongoose from 'mongoose';
import {
    IBoundingBox,
    IAnswerSegment,
    IReconstructedAnswer,
    ICandidateAssociation,
    ReconstructionStatus
} from '../../models/AnswerSegmentation';
import { SegmentHeadingDetector } from './SegmentHeadingDetector';

/**
 * Raw input region for a page.
 * Can represent a whole page or a sub-page bounding box with text.
 */
export interface RawPageRegionInput {
    pageNumber: number;
    pageId?: mongoose.Types.ObjectId | string;
    box?: IBoundingBox;
    text: string;
    nearBlank?: boolean;
    isCoverPage?: boolean;
    isDiagram?: boolean;
}

export interface ScriptSegmentationInput {
    answerScriptId: string | mongoose.Types.ObjectId;
    examId: string | mongoose.Types.ObjectId;
    regions: RawPageRegionInput[];
    expectedQuestions?: number[]; // e.g. [1, 2, 3, 4, 5] from exam rubric
}

export class ContinuationReconstructionEngine {
    // Transparent heuristic scoring weights
    static readonly CONFIDENCE_EXPLICIT_HEADER = 0.95;
    static readonly CONFIDENCE_EXPLICIT_CONTD_Q = 0.98;
    static readonly CONFIDENCE_TARGET_PAGE_MATCH = 0.92;
    static readonly CONFIDENCE_PTO_CONTINUITY = 0.85;
    static readonly CONFIDENCE_SYNTACTIC_CONTINUITY = 0.82;
    static readonly CONFIDENCE_AMBIGUOUS_THRESHOLD = 0.85;

    /**
     * Executes multi-signal segmentation and answer reconstruction.
     */
    static reconstruct(input: ScriptSegmentationInput): IReconstructedAnswer[] {
        const { answerScriptId, examId, regions, expectedQuestions = [] } = input;

        // 1. Filter out cover sheets and blank pages (store blank metadata)
        const validRegions = regions.filter((r) => !r.isCoverPage && !r.nearBlank);

        // Sort regions primarily by pageNumber, secondarily by vertical position y
        validRegions.sort((a, b) => {
            if (a.pageNumber !== b.pageNumber) {
                return a.pageNumber - b.pageNumber;
            }
            const yA = a.box?.y ?? 0;
            const yB = b.box?.y ?? 0;
            return yA - yB;
        });

        // 2. Map of questionNumber -> list of associated segments
        const questionBuckets = new Map<number, IAnswerSegment[]>();
        const questionAmbiguities = new Map<number, { isAmbiguous: boolean; reason?: string }>();

        // Registry of forward pointers: targetPageNumber -> { questionNumber, subQuestion, sourcePage }
        const forwardPointers = new Map<number, { questionNumber: number; subQuestion?: string; sourcePage: number }>();

        let currentActiveQuestion: number | null = null;
        let currentActiveSubQuestion: string | undefined = undefined;
        let lastRegionEndedWithPTO = false;
        let lastRegionText = '';
        let lastProcessedPage = 0;

        let segmentCounter = 1;

        // Process each region sequentially
        for (const reg of validRegions) {
            const detected = SegmentHeadingDetector.detect(reg.text, {
                maxExamQuestions: expectedQuestions.length > 0 ? Math.max(...expectedQuestions) : undefined
            });

            // Handle Scratch / Rough Work pages: Never attach to exam questions
            if (detected.isScratchWork) {
                // Preserved as isolated scratch record, not merged into question
                continue;
            }

            // Record forward pointers if text says "continued on page 7"
            if (detected.targetPageHint && detected.targetPageHint > reg.pageNumber) {
                if (currentActiveQuestion !== null) {
                    forwardPointers.set(detected.targetPageHint, {
                        questionNumber: currentActiveQuestion,
                        subQuestion: currentActiveSubQuestion,
                        sourcePage: reg.pageNumber
                    });
                }
            }

            // Case A: Explicit Continuation with Question (e.g. "Q1 continued", "Q1 contd.")
            if (detected.isContinuation && detected.questionNumber !== undefined) {
                const qNum = detected.questionNumber;
                currentActiveQuestion = qNum;
                currentActiveSubQuestion = detected.subQuestion;

                const existingSegments = questionBuckets.get(qNum) || [];
                const sequenceIndex = existingSegments.length + 1;

                const segment: IAnswerSegment = {
                    segmentId: `seg_${segmentCounter++}`,
                    pageNumber: reg.pageNumber,
                    pageId: reg.pageId,
                    box: reg.box,
                    segmentType: 'CONTINUATION',
                    sequenceIndex,
                    extractedText: reg.text,
                    detectedHeader: detected.rawMatchedText,
                    subQuestion: detected.subQuestion,
                    continuationMarker: detected.rawMatchedText,
                    confidence: this.CONFIDENCE_EXPLICIT_CONTD_Q,
                    evidence: [...detected.evidence]
                };

                existingSegments.push(segment);
                questionBuckets.set(qNum, existingSegments);

                lastRegionEndedWithPTO = detected.isTransitionFooter;
                lastRegionText = reg.text;
                lastProcessedPage = reg.pageNumber;
                continue;
            }

            // Case B: Explicit Question Start Header (e.g. "Q1", "Question 1", "Ans 1", "1.")
            if (detected.isQuestionStart && detected.questionNumber !== undefined) {
                const qNum = detected.questionNumber;
                currentActiveQuestion = qNum;
                currentActiveSubQuestion = detected.subQuestion;

                const existingSegments = questionBuckets.get(qNum) || [];
                // If question was already encountered earlier, this is a return to an earlier question!
                const isReturn = existingSegments.length > 0;
                const sequenceIndex = existingSegments.length + 1;

                const segment: IAnswerSegment = {
                    segmentId: `seg_${segmentCounter++}`,
                    pageNumber: reg.pageNumber,
                    pageId: reg.pageId,
                    box: reg.box,
                    segmentType: isReturn ? 'CONTINUATION' : 'START',
                    sequenceIndex,
                    extractedText: reg.text,
                    detectedHeader: detected.rawMatchedText,
                    subQuestion: detected.subQuestion,
                    confidence: detected.confidence,
                    evidence: isReturn
                        ? [...detected.evidence, 'RETURNED_TO_EARLIER_QUESTION']
                        : [...detected.evidence]
                };

                existingSegments.push(segment);
                questionBuckets.set(qNum, existingSegments);

                lastRegionEndedWithPTO = detected.isTransitionFooter;
                lastRegionText = reg.text;
                lastProcessedPage = reg.pageNumber;
                continue;
            }

            // Case C: Transition Footer on its own (PTO line at page bottom)
            if (detected.isTransitionFooter) {
                lastRegionEndedWithPTO = true;
                continue;
            }

            // Case D: Target Page Pointer Match (e.g. Page 7 arrived, matching a pointer registered earlier)
            if (forwardPointers.has(reg.pageNumber)) {
                const ptr = forwardPointers.get(reg.pageNumber)!;
                currentActiveQuestion = ptr.questionNumber;
                currentActiveSubQuestion = ptr.subQuestion;

                const existingSegments = questionBuckets.get(ptr.questionNumber) || [];
                const sequenceIndex = existingSegments.length + 1;

                const segment: IAnswerSegment = {
                    segmentId: `seg_${segmentCounter++}`,
                    pageNumber: reg.pageNumber,
                    pageId: reg.pageId,
                    box: reg.box,
                    segmentType: 'CONTINUATION',
                    sequenceIndex,
                    extractedText: reg.text,
                    subQuestion: ptr.subQuestion,
                    continuationMarker: `Target of forward pointer from page ${ptr.sourcePage}`,
                    confidence: this.CONFIDENCE_TARGET_PAGE_MATCH,
                    evidence: [`FORWARD_POINTER_MATCH:from_page_${ptr.sourcePage}`]
                };

                existingSegments.push(segment);
                questionBuckets.set(ptr.questionNumber, existingSegments);
                forwardPointers.delete(reg.pageNumber); // Consumed

                lastRegionEndedWithPTO = false;
                lastRegionText = reg.text;
                lastProcessedPage = reg.pageNumber;
                continue;
            }

            // Case E: Backward Pointer match ("continued from page 1")
            if (detected.targetPageHint && detected.targetPageHint < reg.pageNumber) {
                // Find which question was active or on that source page
                let matchedQ: number | null = null;
                for (const [qNum, segs] of questionBuckets.entries()) {
                    if (segs.some((s) => s.pageNumber === detected.targetPageHint)) {
                        matchedQ = qNum;
                        break;
                    }
                }

                if (matchedQ !== null) {
                    currentActiveQuestion = matchedQ;
                    const existingSegments = questionBuckets.get(matchedQ) || [];
                    const sequenceIndex = existingSegments.length + 1;

                    const segment: IAnswerSegment = {
                        segmentId: `seg_${segmentCounter++}`,
                        pageNumber: reg.pageNumber,
                        pageId: reg.pageId,
                        box: reg.box,
                        segmentType: 'CONTINUATION',
                        sequenceIndex,
                        extractedText: reg.text,
                        continuationMarker: detected.rawMatchedText,
                        confidence: 0.90,
                        evidence: [`BACKWARD_POINTER_MATCH:from_page_${detected.targetPageHint}`]
                    };

                    existingSegments.push(segment);
                    questionBuckets.set(matchedQ, existingSegments);

                    lastRegionEndedWithPTO = false;
                    lastRegionText = reg.text;
                    lastProcessedPage = reg.pageNumber;
                    continue;
                }
            }

            // Case F: Unlabelled Segment (No question header, no explicit marker)
            // Check syntactic continuity, PTO continuity, or direct page adjacency with active question
            const isDirectlyConsecutive = currentActiveQuestion !== null && (reg.pageNumber === lastProcessedPage || reg.pageNumber === lastProcessedPage + 1);
            const isSyntacticallyContinuous = this.checkSyntacticContinuity(lastRegionText, reg.text);

            if (currentActiveQuestion !== null && (lastRegionEndedWithPTO || isSyntacticallyContinuous || isDirectlyConsecutive)) {
                // Continues the preceding question with high confidence on consecutive page or syntactic match
                const existingSegments = questionBuckets.get(currentActiveQuestion) || [];
                const sequenceIndex = existingSegments.length + 1;

                const evidence: string[] = [];
                if (lastRegionEndedWithPTO) evidence.push('PTO_PAGE_TRANSITION');
                if (isSyntacticallyContinuous) evidence.push('SYNTACTIC_SENTENCE_CONTINUITY');
                if (isDirectlyConsecutive && !lastRegionEndedWithPTO && !isSyntacticallyContinuous) {
                    evidence.push('CONSECUTIVE_PAGE_CONTINUATION');
                }

                let conf = this.CONFIDENCE_SYNTACTIC_CONTINUITY;
                if (lastRegionEndedWithPTO) conf = this.CONFIDENCE_PTO_CONTINUITY;
                else if (isDirectlyConsecutive) conf = 0.88;

                const segment: IAnswerSegment = {
                    segmentId: `seg_${segmentCounter++}`,
                    pageNumber: reg.pageNumber,
                    pageId: reg.pageId,
                    box: reg.box,
                    segmentType: 'CONTINUATION',
                    sequenceIndex,
                    extractedText: reg.text,
                    subQuestion: currentActiveSubQuestion,
                    confidence: conf,
                    evidence
                };

                existingSegments.push(segment);
                questionBuckets.set(currentActiveQuestion, existingSegments);

                lastRegionEndedWithPTO = false;
                lastRegionText = reg.text;
                lastProcessedPage = reg.pageNumber;
                continue;
            }

            // Case G: Ambiguous Unlabelled Segment
            // When an unlabelled segment appears, and multiple questions are open/plausible:
            // NEVER silently discard it! Mark UNCERTAIN, assign candidate probabilities, and flag NEEDS_REVIEW.
            const candidates: ICandidateAssociation[] = [];
            if (currentActiveQuestion !== null) {
                candidates.push({
                    questionNumber: currentActiveQuestion,
                    score: 0.60,
                    rationale: `Preceding active question Q${currentActiveQuestion}`
                });
            }

            // Also check if next unstarted rubric question could be candidate
            const unstarted = expectedQuestions.filter((q) => !questionBuckets.has(q));
            if (unstarted.length > 0) {
                candidates.push({
                    questionNumber: unstarted[0],
                    score: 0.40,
                    rationale: `Next unstarted exam question Q${unstarted[0]}`
                });
            }

            const targetQ = currentActiveQuestion !== null ? currentActiveQuestion : (unstarted[0] ?? 1);
            const existingSegments = questionBuckets.get(targetQ) || [];
            const sequenceIndex = existingSegments.length + 1;

            const uncertainSegment: IAnswerSegment = {
                segmentId: `seg_${segmentCounter++}`,
                pageNumber: reg.pageNumber,
                pageId: reg.pageId,
                box: reg.box,
                segmentType: 'UNCERTAIN',
                sequenceIndex,
                extractedText: reg.text,
                confidence: 0.60, // Below 0.85 auto-reconstruction threshold
                evidence: ['UNLABELLED_NO_EXPLICIT_HEADER', 'MULTIPLE_CANDIDATE_QUESTIONS'],
                candidateAssociations: candidates
            };

            existingSegments.push(uncertainSegment);
            questionBuckets.set(targetQ, existingSegments);
            questionAmbiguities.set(targetQ, {
                isAmbiguous: true,
                reason: `Ambiguous content on page ${reg.pageNumber}: multiple candidate questions (${candidates.map((c) => `Q${c.questionNumber}: ${Math.round(c.score * 100)}%`).join(', ')})`
            });

            lastRegionEndedWithPTO = false;
            lastRegionText = reg.text;
            lastProcessedPage = reg.pageNumber;
        }

        // 3. Assemble ReconstructedAnswer entities
        const allQuestionsToProcess = new Set<number>([
            ...expectedQuestions,
            ...Array.from(questionBuckets.keys())
        ]);

        const reconstructedAnswers: IReconstructedAnswer[] = [];

        for (const qNum of Array.from(allQuestionsToProcess).sort((a, b) => a - b)) {
            const rawSegments = questionBuckets.get(qNum) || [];

            // Sort segments by sequence index
            const segments = [...rawSegments].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

            // Compute involved pages in order
            const pagesInvolved = Array.from(new Set(segments.map((s) => s.pageNumber))).sort((a, b) => a - b);

            // Determine if non-consecutive
            let isNonConsecutive = false;
            if (pagesInvolved.length > 1) {
                for (let i = 0; i < pagesInvolved.length - 1; i++) {
                    if (pagesInvolved[i + 1] - pagesInvolved[i] > 1) {
                        isNonConsecutive = true;
                        break;
                    }
                }
            }

            const ambiguityInfo = questionAmbiguities.get(qNum);
            const hasUncertainSegment = segments.some((s) => s.segmentType === 'UNCERTAIN');
            const isAmbiguous = (ambiguityInfo?.isAmbiguous || hasUncertainSegment);
            const ambiguityReason = ambiguityInfo?.reason || (hasUncertainSegment ? 'Contains unverified or uncertain segment' : undefined);

            // Calculate aggregate heuristic confidence score
            const reconstructionConfidence = segments.length > 0
                ? Number((segments.reduce((acc, s) => acc + s.confidence, 0) / segments.length).toFixed(3))
                : 1.0;

            let status: ReconstructionStatus = 'AUTO_RECONSTRUCTED';
            if (isAmbiguous || reconstructionConfidence < this.CONFIDENCE_AMBIGUOUS_THRESHOLD) {
                status = 'NEEDS_REVIEW';
            }

            const reconstructedDoc = {
                answerScript: new mongoose.Types.ObjectId(answerScriptId.toString()),
                exam: new mongoose.Types.ObjectId(examId.toString()),
                questionNumber: qNum,
                segments,
                totalSegments: segments.length,
                pagesInvolved,
                isNonConsecutive,
                isAmbiguous: !!isAmbiguous,
                ambiguityReason,
                reconstructionConfidence,
                status
            } as unknown as IReconstructedAnswer;

            reconstructedAnswers.push(reconstructedDoc);
        }

        return reconstructedAnswers;
    }

    /**
     * Heuristic lexical check for whether region 1 ends with an incomplete sentence / clause
     * and region 2 begins with continuation words (e.g. "and", "therefore", mathematical symbols).
     */
    private static checkSyntacticContinuity(prevText: string, currentText: string): boolean {
        if (!prevText || !currentText) return false;

        const trimmedPrev = prevText.trim();
        const trimmedCurr = currentText.trim();

        if (trimmedPrev.length === 0 || trimmedCurr.length === 0) return false;

        // If previous text does NOT end with sentence-ending punctuation (. ? !)
        const endsWithoutPeriod = !/[.?!:]\s*$/.test(trimmedPrev);

        // If current text starts with lowercase letter or continuation conjunction or math symbol
        const startsWithContinuation =
            /^[a-z]/.test(trimmedCurr) ||
            /^(?:and|therefore|where|such\s+that|hence|which|thus|so)\b/i.test(trimmedCurr) ||
            /^[=+\-*/∑∫√]/.test(trimmedCurr);

        return endsWithoutPeriod && startsWithContinuation;
    }
}
