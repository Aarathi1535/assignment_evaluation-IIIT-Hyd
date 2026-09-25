/**
 * SegmentHeadingDetector
 * 
 * Deterministic lexical and regex parser that identifies question start headers,
 * sub-question hierarchies, continuation markers, transition footers (PTO),
 * and scratch-work indicators from line text or page tokens.
 */

export interface DetectedHeadingResult {
    isQuestionStart: boolean;
    isContinuation: boolean;
    isTransitionFooter: boolean;
    isScratchWork: boolean;
    questionNumber?: number;
    subQuestion?: string;
    targetPageHint?: number; // e.g. "continued on page 7" => 7, "from page 1" => 1
    rawMatchedText: string;
    confidence: number; // 0.0 - 1.0 heuristic score
    evidence: string[];
}

export class SegmentHeadingDetector {
    // -------------------------------------------------------------------------
    // Regex Patterns
    // -------------------------------------------------------------------------

    // 1. Explicit Continuation: "Q1 continued", "Q1 contd.", "Q. 1 (cont.)", "Ans 1 contd"
    private static readonly CONTD_WITH_Q_REGEX =
        /^\s*(?:Q(?:uestion)?|Ans(?:wer)?)\.?\s*(\d+)(?:\s*\(([a-zA-Z0-9]+)\))?\s*[-:–]?\s*(?:\(?\s*(?:cont(?:inued|d|\.)?)\s*\)?)/i;

    // 2. Explicit Continuation Phrase: "continued from page 1", "cont. from p.1"
    private static readonly CONTD_FROM_PAGE_REGEX =
        /(?:cont(?:inued|d|\.)?)\s+from\s+(?:page|p\.?)\s*(\d+)/i;

    // 3. Forward Continuation Target: "continued on page 7", "contd. on p. 7", "see page 7"
    private static readonly CONTD_ON_PAGE_REGEX =
        /(?:cont(?:inued|d|\.)?\s+(?:on|in)|see)\s+(?:page|p\.?)\s*(\d+)/i;

    // 4. Standalone transition footer: "PTO", "Please Turn Over", "Turn Over"
    private static readonly PTO_REGEX =
        /^\s*(?:P\.?T\.?O\.?|Please\s+Turn\s+Over|Turn\s+Over)\s*$/i;

    // 5. Standard Question Start Headers:
    // e.g. "Q1", "Q.1", "Q 1", "Question 1", "Question 1(a)", "Ans 1", "Answer 1", "Ans: 1"
    private static readonly QUESTION_HEADER_REGEX =
        /^\s*(?:Q(?:uestion)?|Ans(?:wer)?)\.?\s*(\d+)(?:\s*\(([a-zA-Z0-9]+)\))?(?:\s*[:.)\-–]\s*|\s+|$)/i;

    // 6. Standalone Numbered Header at line start: e.g. "1.", "1(a)", "1 (b)", "2:"
    // Must be preceded by start of line and not look like a regular text sentence.
    private static readonly STANDALONE_NUMBER_REGEX =
        /^\s*(\d+)(?:\s*\(([a-zA-Z0-9]+)\))?\s*[.:)\-–]\s*(?:$|\b)/;

    // 7. Scratch / Rough Work:
    private static readonly SCRATCH_WORK_REGEX =
        /\b(?:rough\s*(?:work|sheet|page|space)|scratch\s*(?:work|pad)?)\b/i;

    /**
     * Inspects a text snippet or heading line to detect question anchors and continuation signals.
     */
    static detect(text: string, options?: { maxExamQuestions?: number }): DetectedHeadingResult {
        const trimmed = (text || '').trim();
        const evidence: string[] = [];

        // Check for scratch / rough work
        if (this.SCRATCH_WORK_REGEX.test(trimmed)) {
            evidence.push('SCRATCH_WORK_MARKER');
            return {
                isQuestionStart: false,
                isContinuation: false,
                isTransitionFooter: false,
                isScratchWork: true,
                rawMatchedText: trimmed,
                confidence: 0.95,
                evidence
            };
        }

        // Check for transition footer (PTO)
        if (this.PTO_REGEX.test(trimmed)) {
            evidence.push('TRANSITION_FOOTER:PTO');
            return {
                isQuestionStart: false,
                isContinuation: true,
                isTransitionFooter: true,
                isScratchWork: false,
                rawMatchedText: trimmed,
                confidence: 0.90,
                evidence
            };
        }

        // Check for forward continuation target ("continued on page 7")
        const onPageMatch = trimmed.match(this.CONTD_ON_PAGE_REGEX);
        if (onPageMatch) {
            const targetPage = parseInt(onPageMatch[1], 10);
            evidence.push(`FORWARD_CONTINUATION_TARGET:page_${targetPage}`);
            return {
                isQuestionStart: false,
                isContinuation: true,
                isTransitionFooter: true,
                isScratchWork: false,
                targetPageHint: targetPage,
                rawMatchedText: onPageMatch[0],
                confidence: 0.92,
                evidence
            };
        }

        // Check for explicit continuation with question ("Q1 continued", "Q1 contd")
        const contdQMatch = trimmed.match(this.CONTD_WITH_Q_REGEX);
        if (contdQMatch) {
            const qNum = parseInt(contdQMatch[1], 10);
            const subQ = contdQMatch[2] ? contdQMatch[2].toLowerCase() : undefined;
            evidence.push(`EXPLICIT_CONTD_WITH_QUESTION:Q${qNum}`);
            if (subQ) evidence.push(`SUB_QUESTION:${subQ}`);

            return {
                isQuestionStart: false,
                isContinuation: true,
                isTransitionFooter: false,
                isScratchWork: false,
                questionNumber: qNum,
                subQuestion: subQ,
                rawMatchedText: contdQMatch[0],
                confidence: 0.98,
                evidence
            };
        }

        // Check for "continued from page X"
        const fromPageMatch = trimmed.match(this.CONTD_FROM_PAGE_REGEX);
        if (fromPageMatch) {
            const sourcePage = parseInt(fromPageMatch[1], 10);
            evidence.push(`CONTINUATION_FROM_PAGE:${sourcePage}`);

            return {
                isQuestionStart: false,
                isContinuation: true,
                isTransitionFooter: false,
                isScratchWork: false,
                targetPageHint: sourcePage,
                rawMatchedText: fromPageMatch[0],
                confidence: 0.90,
                evidence
            };
        }

        // Check for explicit question header ("Q1", "Question 1", "Ans 1", "Question 1(a)")
        const qHeaderMatch = trimmed.match(this.QUESTION_HEADER_REGEX);
        if (qHeaderMatch) {
            const qNum = parseInt(qHeaderMatch[1], 10);
            const subQ = qHeaderMatch[2] ? qHeaderMatch[2].toLowerCase() : undefined;

            // Context validation against exam question bounds if supplied
            if (options?.maxExamQuestions && qNum > options.maxExamQuestions) {
                // Out of range (e.g. Q99 when exam only has 5 questions)
                return this.noMatch(trimmed);
            }

            evidence.push(`EXPLICIT_QUESTION_HEADER:Q${qNum}`);
            if (subQ) evidence.push(`SUB_QUESTION:${subQ}`);

            return {
                isQuestionStart: true,
                isContinuation: false,
                isTransitionFooter: false,
                isScratchWork: false,
                questionNumber: qNum,
                subQuestion: subQ,
                rawMatchedText: qHeaderMatch[0],
                confidence: 0.95,
                evidence
            };
        }

        // Check for standalone numeric header ("1.", "1(a)")
        // Guard against false positives like "1. Introduction" or decimal numbers "1.5" or dates
        const numMatch = trimmed.match(this.STANDALONE_NUMBER_REGEX);
        if (numMatch) {
            const qNum = parseInt(numMatch[1], 10);
            const subQ = numMatch[2] ? numMatch[2].toLowerCase() : undefined;

            // Filter out decimal numbers (e.g. 1.5)
            if (/^\d+\.\d+/.test(trimmed)) {
                return this.noMatch(trimmed);
            }

            // If exam has max questions, verify bounds
            if (options?.maxExamQuestions && qNum > options.maxExamQuestions) {
                return this.noMatch(trimmed);
            }

            evidence.push(`STANDALONE_NUMERIC_HEADER:${qNum}`);
            if (subQ) evidence.push(`SUB_QUESTION:${subQ}`);

            return {
                isQuestionStart: true,
                isContinuation: false,
                isTransitionFooter: false,
                isScratchWork: false,
                questionNumber: qNum,
                subQuestion: subQ,
                rawMatchedText: numMatch[0],
                confidence: 0.85, // Slightly lower than explicit "Q1"
                evidence
            };
        }

        return this.noMatch(trimmed);
    }

    private static noMatch(trimmed: string): DetectedHeadingResult {
        return {
            isQuestionStart: false,
            isContinuation: false,
            isTransitionFooter: false,
            isScratchWork: false,
            rawMatchedText: trimmed,
            confidence: 0.0,
            evidence: []
        };
    }
}
