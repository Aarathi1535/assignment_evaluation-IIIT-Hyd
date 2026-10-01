import { HttpError } from '../lib/errors';
import { IClassroomCriterion } from '../models/ClassroomQuestion';
import { IClassroomCriterionScore } from '../models/ClassroomSubmission';
import { isValidScoreStep, DEFAULT_SCORE_STEP } from './GradingService';
import { vertexAIService, VertexAIService } from './ai/VertexAIService';

export interface EvaluateClassroomAnswerInput {
    questionPrompt: string;
    maxMarks: number;
    rubricCriteria?: IClassroomCriterion[];
    sampleSolution?: string;
    imageBuffer: Buffer;
    mimeType: string;
    isRealStudentData?: boolean;
}

export interface RawGeminiCriterionEvaluation {
    criterion: string;
    maxMarks: number;
    awardedMarks: number;
    evidence?: string;
    feedback?: string;
}

export interface RawGeminiEvaluationResponse {
    criteria: RawGeminiCriterionEvaluation[];
    totalMarks?: number;
    maxMarks?: number;
    overallFeedback: string;
    confidence?: number;
}

export interface ValidatedEvaluationOutcome {
    score: number;
    maxMarks: number;
    feedback: string;
    confidence?: number;
    criterionScores: IClassroomCriterionScore[];
}

export type GeminiCaller = (payload: {
    model: string;
    apiKey: string;
    systemInstruction: string;
    promptText: string;
    imageBase64: string;
    mimeType: string;
}) => Promise<string>;

export class ClassroomEvaluationService {
    private customGeminiCaller: GeminiCaller | null = null;
    private aiService: VertexAIService;

    constructor(aiService: VertexAIService = vertexAIService) {
        this.aiService = aiService;
    }

    /**
     * Dependency injection hook for testing without live Vertex AI network requests.
     */
    setGeminiCaller(caller: GeminiCaller | null): void {
        this.customGeminiCaller = caller;
    }

    getModelName(): string {
        return this.aiService.getModelName();
    }

    getRegion(): string {
        return this.aiService.getRegion();
    }

    /**
     * Build the strict evaluation system prompt for Gemini VLM.
     */
    buildSystemInstruction(): string {
        return [
            'You are an expert, rigorous academic evaluator for handwritten university assessments.',
            'Your job is to inspect the submitted image of a handwritten student answer and evaluate it against the given question and rubric criteria.',
            '',
            'CRITICAL EVALUATION RULES:',
            '1. Inspect the handwritten answer image carefully and thoroughly.',
            '2. Do NOT assume the answer is correct.',
            '3. Do NOT award full marks by default.',
            '4. Award marks ONLY for content, steps, formulas, and reasoning actually visible in the submitted handwritten image.',
            '5. Do NOT infer or imagine missing reasoning, intermediate calculations, definitions, diagrams, or steps.',
            '6. Evaluate every rubric criterion independently against what is handwritten in the image.',
            '7. Award partial marks when only part of a criterion is satisfied.',
            '8. Award 0 marks for any criterion that is not satisfied or absent.',
            '9. If the answer is blank, irrelevant, nonsensical, or does not address the question, award 0 or the appropriate low score.',
            '10. If handwriting is partially unreadable, explicitly state that in the evidence and reduce confidence and marks appropriately.',
            '11. Feedback and evidence MUST cite specific content from the actual submitted image, avoiding generic praise (e.g. do not say "Good job" or "Excellent work" unless the answer demonstrates that level of correctness).',
            '12. Never award marks exceeding a criterion maximum, and never exceed the question maximum marks.',
            '13. Quantize scores to steps of 0.5 marks.',
            '',
            'You must return ONLY a strict JSON object with this structure:',
            '{',
            '  "criteria": [',
            '    {',
            '      "criterion": "<exact criterion name>",',
            '      "maxMarks": <number>,',
            '      "awardedMarks": <number>,',
            '      "evidence": "<specific citation of what was seen or missing in the handwritten answer>"',
            '    }',
            '  ],',
            '  "totalMarks": <number>,',
            '  "maxMarks": <number>,',
            '  "overallFeedback": "<specific, grounded feedback explaining the grading decisions>",',
            '  "confidence": <number between 0.0 and 1.0 representing legibility and assessment confidence>',
            '}'
        ].join('\n');
    }

    /**
     * Build the user prompt context detailing question, max marks, rubric, and sample solution.
     */
    buildUserPrompt(input: EvaluateClassroomAnswerInput): string {
        const { questionPrompt, maxMarks, rubricCriteria = [], sampleSolution } = input;

        const criteriaList =
            rubricCriteria.length > 0
                ? rubricCriteria
                      .map(
                          (c, idx) =>
                              `${idx + 1}. "${c.criterionName}" (Max Marks: ${c.points}${
                                  c.description ? ` - Description: ${c.description}` : ''
                              })`
                      )
                      .join('\n')
                : `1. "Overall Correctness & Methodology" (Max Marks: ${maxMarks})`;

        return [
            '=== ASSESSMENT QUESTION ===',
            questionPrompt,
            '',
            `=== MAXIMUM MARKS ===: ${maxMarks}`,
            '',
            '=== RUBRIC CRITERIA ===',
            criteriaList,
            sampleSolution ? `\n=== REFERENCE / SAMPLE SOLUTION ===\n${sampleSolution}` : '',
            '',
            'Please inspect the attached handwritten answer image and evaluate it according to the strict evaluation rules.'
        ].join('\n');
    }

    /**
     * Extracts and parses JSON from raw Gemini output, reliably handling
     * markdown code fences (```json ... ``` or ``` ... ```) and surrounding commentary.
     */
    extractJsonPayload(rawText: string): unknown {
        if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
            throw new HttpError('Automated evaluation failed: Model returned empty response.', 502);
        }

        const trimmed = rawText.trim();

        // 1. Direct JSON parse
        try {
            return JSON.parse(trimmed);
        } catch {
            // Proceed to robust extraction
        }

        // 2. Strip markdown code fences (```json ... ``` or ``` ... ```)
        const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
        if (codeBlockMatch && codeBlockMatch[1]) {
            try {
                return JSON.parse(codeBlockMatch[1].trim());
            } catch {
                // Fall through to boundary extraction inside or around block
            }
        }

        // 3. Search for outermost JSON object { ... } or array [ ... ]
        const firstCurly = trimmed.indexOf('{');
        const lastCurly = trimmed.lastIndexOf('}');
        if (firstCurly !== -1 && lastCurly > firstCurly) {
            try {
                return JSON.parse(trimmed.slice(firstCurly, lastCurly + 1));
            } catch {
                // Fall through
            }
        }

        const firstBracket = trimmed.indexOf('[');
        const lastBracket = trimmed.lastIndexOf(']');
        if (firstBracket !== -1 && lastBracket > firstBracket) {
            try {
                return JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
            } catch {
                // Fall through
            }
        }

        throw new HttpError(
            'Automated evaluation failed: Gemini response is not valid JSON.',
            502
        );
    }

    /**
     * Validates Gemini structured output against question rubric constraints and computes
     * deterministic, clamp-bounded server-side totals.
     */
    validateAndHarmonizeOutput(
        rawText: string,
        input: EvaluateClassroomAnswerInput
    ): ValidatedEvaluationOutcome {
        const rawParsed = this.extractJsonPayload(rawText);

        if (!rawParsed || typeof rawParsed !== 'object') {
            throw new HttpError('Automated evaluation failed: Response payload is not an object.', 502);
        }
        const parsed = rawParsed as Record<string, unknown>;

        // Locate criteria list across possible schema variations returned by Gemini
        const criteriaRaw =
            Array.isArray(parsed)
                ? (parsed as unknown[])
                : Array.isArray(parsed.criteria)
                ? (parsed.criteria as unknown[])
                : Array.isArray(parsed.rubricCriteria)
                ? (parsed.rubricCriteria as unknown[])
                : Array.isArray(parsed.rubric_criteria)
                ? (parsed.rubric_criteria as unknown[])
                : Array.isArray(parsed.criterionScores)
                ? (parsed.criterionScores as unknown[])
                : Array.isArray(parsed.criterion_scores)
                ? (parsed.criterion_scores as unknown[])
                : Array.isArray(parsed.evaluations)
                ? (parsed.evaluations as unknown[])
                : Array.isArray(parsed.criteriaEvaluations)
                ? (parsed.criteriaEvaluations as unknown[])
                : null;

        if (!criteriaRaw || criteriaRaw.length === 0) {
            throw new HttpError('Automated evaluation failed: Missing or empty criteria list.', 502);
        }

        const normalizeStr = (s: string) =>
            s
                .toLowerCase()
                .replace(/^criterion\s*\d+\s*[:.-]?\s*/i, '')
                .replace(/^\d+[\s.)-]+\s*/, '')
                .replace(/[^a-z0-9]/g, ' ')
                .trim();

        const targetCriteria =
            input.rubricCriteria && input.rubricCriteria.length > 0
                ? input.rubricCriteria
                : [{ criterionName: 'Overall Correctness & Methodology', points: input.maxMarks }];

        const validatedScores: IClassroomCriterionScore[] = [];
        let computedTotal = 0;

        // Map every required target criterion to model response
        for (let idx = 0; idx < targetCriteria.length; idx++) {
            const target = targetCriteria[idx];
            const targetNorm = normalizeStr(target.criterionName);

            // Find corresponding model evaluation by matching criterion name or aligned index
            const matched = (criteriaRaw as Record<string, unknown>[]).find((c) => {
                if (!c || typeof c !== 'object') return false;
                const name = c.criterion || c.criterionName || c.name || c.criterion_name || c.title;
                if (typeof name !== 'string') return false;
                const norm = normalizeStr(name);
                return norm === targetNorm || norm.includes(targetNorm) || targetNorm.includes(norm);
            }) || (criteriaRaw.length === targetCriteria.length ? (criteriaRaw[idx] as Record<string, unknown>) : undefined);

            if (!matched || typeof matched !== 'object') {
                throw new HttpError(
                    `Automated evaluation failed: Model response missing required criterion "${target.criterionName}".`,
                    502
                );
            }

            // Extract numeric awarded marks across possible property variations
            const markCandidates = [
                matched.awardedMarks,
                matched.marksAwarded,
                matched.awarded_marks,
                matched.score,
                matched.marks,
                matched.pointsAwarded,
                matched.points
            ];

            let rawAwarded: number | undefined;
            for (const cand of markCandidates) {
                if (typeof cand === 'number' && Number.isFinite(cand)) {
                    rawAwarded = cand;
                    break;
                }
                if (typeof cand === 'string' && cand.trim() !== '') {
                    const parsedNum = parseFloat(cand.trim());
                    if (Number.isFinite(parsedNum)) {
                        rawAwarded = parsedNum;
                        break;
                    }
                }
            }

            if (rawAwarded === undefined) {
                throw new HttpError(
                    `Automated evaluation failed: Missing or non-numeric marks for criterion "${target.criterionName}".`,
                    502
                );
            }

            // Server-side boundary clamp: 0 <= awardedMarks <= target.points
            if (rawAwarded < 0) rawAwarded = 0;
            if (rawAwarded > target.points) rawAwarded = target.points;

            // Score step quantizing (0.5 step default)
            let quantizedScore = Math.round(rawAwarded * 2) / 2;
            if (quantizedScore > target.points) quantizedScore = target.points;
            if (quantizedScore < 0) quantizedScore = 0;

            if (!isValidScoreStep(quantizedScore, DEFAULT_SCORE_STEP)) {
                quantizedScore = Math.round(quantizedScore * 2) / 2;
            }

            computedTotal += quantizedScore;

            // Extract evidence without fabricating
            const rawEvidence =
                (typeof matched.evidence === 'string' && matched.evidence.trim()) ||
                (typeof matched.observation === 'string' && matched.observation.trim()) ||
                (typeof matched.citation === 'string' && matched.citation.trim()) ||
                (typeof matched.justification === 'string' && matched.justification.trim()) ||
                (typeof matched.reasoning === 'string' && matched.reasoning.trim()) ||
                '';

            // Extract feedback
            const rawFeedback =
                (typeof matched.feedback === 'string' && matched.feedback.trim()) ||
                (typeof matched.comments === 'string' && matched.comments.trim()) ||
                (typeof matched.notes === 'string' && matched.notes.trim()) ||
                rawEvidence;

            const feedbackText = rawFeedback.length > 0
                ? rawFeedback
                : quantizedScore === target.points
                ? `Criteria satisfied (${quantizedScore}/${target.points} marks).`
                : quantizedScore > 0
                ? `Partially satisfied (${quantizedScore}/${target.points} marks).`
                : `Criterion not satisfied (0/${target.points} marks).`;

            validatedScores.push({
                criterionName: target.criterionName,
                marksAwarded: quantizedScore,
                maxMarks: target.points,
                feedback: feedbackText,
                evidence: rawEvidence.length > 0 ? rawEvidence : undefined
            });
        }

        // Clamp computedTotal to question maxMarks
        if (computedTotal > input.maxMarks) {
            computedTotal = input.maxMarks;
        }

        // Validate overall feedback
        let overallFeedback =
            (typeof parsed.overallFeedback === 'string' && parsed.overallFeedback.trim()) ||
            (typeof parsed.overall_feedback === 'string' && parsed.overall_feedback.trim()) ||
            (typeof parsed.feedback === 'string' && parsed.feedback.trim()) ||
            (typeof parsed.summary === 'string' && parsed.summary.trim()) ||
            (typeof parsed.comments === 'string' && parsed.comments.trim()) ||
            (typeof parsed.overallComments === 'string' && parsed.overallComments.trim()) ||
            '';

        if (!overallFeedback) {
            const percentage = Math.round((computedTotal / input.maxMarks) * 100);
            overallFeedback = `Automated evaluation score: ${computedTotal}/${input.maxMarks} (${percentage}%).`;
        }

        // Validate confidence (only when actually returned by model)
        const rawConfidence =
            typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
                ? parsed.confidence
                : typeof parsed.confidenceScore === 'number' && Number.isFinite(parsed.confidenceScore)
                ? parsed.confidenceScore
                : typeof parsed.confidence_score === 'number' && Number.isFinite(parsed.confidence_score)
                ? parsed.confidence_score
                : undefined;

        let confidence: number | undefined = undefined;
        if (rawConfidence !== undefined) {
            confidence = Math.min(1, Math.max(0, rawConfidence));
        }

        return {
            score: computedTotal,
            maxMarks: input.maxMarks,
            feedback: overallFeedback,
            confidence,
            criterionScores: validatedScores
        };
    }

    /**
     * Executes end-to-end multimodal evaluation on a handwritten answer image.
     */
    async evaluateHandwrittenAnswer(
        input: EvaluateClassroomAnswerInput
    ): Promise<ValidatedEvaluationOutcome> {
        if (!input.imageBuffer || input.imageBuffer.length === 0) {
            throw new HttpError('Invalid upload: Image buffer is empty', 400);
        }

        if (!input.questionPrompt || !input.questionPrompt.trim()) {
            throw new HttpError('Question prompt is required for evaluation', 400);
        }

        if (!input.maxMarks || input.maxMarks <= 0) {
            throw new HttpError('Question max marks must be greater than 0', 400);
        }

        const systemInstruction = this.buildSystemInstruction();
        const promptText = this.buildUserPrompt(input);
        const imageBase64 = input.imageBuffer.toString('base64');
        const mimeType = input.mimeType || 'image/png';
        const model = this.getModelName();

        let rawModelOutputText: string;

        try {
            if (this.customGeminiCaller) {
                rawModelOutputText = await this.customGeminiCaller({
                    model,
                    apiKey: '',
                    systemInstruction,
                    promptText,
                    imageBase64,
                    mimeType
                });
            } else {
                rawModelOutputText = await this.aiService.generateMultimodalContent({
                    model,
                    systemInstruction,
                    promptText,
                    imageBase64,
                    mimeType,
                    isRealStudentData: input.isRealStudentData
                });
            }
        } catch (apiErr) {
            if (apiErr instanceof HttpError) {
                throw apiErr;
            }
            throw new HttpError(
                `Multimodal evaluation failed: ${apiErr instanceof Error ? apiErr.message : 'Unknown model error'}`,
                502
            );
        }

        return this.validateAndHarmonizeOutput(rawModelOutputText, input);
    }
}

const classroomEvaluationService = new ClassroomEvaluationService();
export default classroomEvaluationService;
