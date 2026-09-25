import { HttpError } from '../lib/errors';
import { IClassroomCriterion } from '../models/ClassroomQuestion';
import { IClassroomCriterionScore } from '../models/ClassroomSubmission';
import { isValidScoreStep, DEFAULT_SCORE_STEP } from './GradingService';

export interface EvaluateClassroomAnswerInput {
    questionPrompt: string;
    maxMarks: number;
    rubricCriteria?: IClassroomCriterion[];
    sampleSolution?: string;
    imageBuffer: Buffer;
    mimeType: string;
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
    confidence: number;
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

    /**
     * Dependency injection hook for testing without live Gemini network requests.
     */
    setGeminiCaller(caller: GeminiCaller | null): void {
        this.customGeminiCaller = caller;
    }

    getApiKey(): string {
        return (
            process.env.GEMINI_API_KEY ||
            process.env.GOOGLE_API_KEY ||
            process.env.GOOGLE_GENAI_API_KEY ||
            ''
        );
    }

    getModelName(): string {
        return process.env.GEMINI_MODEL || 'gemini-1.5-flash';
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
     * Default live Gemini multimodal API caller using Google Generative Language REST endpoint.
     */
    async callGeminiApi(payload: {
        model: string;
        apiKey: string;
        systemInstruction: string;
        promptText: string;
        imageBase64: string;
        mimeType: string;
    }): Promise<string> {
        const { model, apiKey, systemInstruction, promptText, imageBase64, mimeType } = payload;

        if (!apiKey) {
            throw new HttpError(
                'Gemini API key is not configured. Please set GEMINI_API_KEY or GOOGLE_API_KEY environment variable.',
                503
            );
        }

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
            model
        )}:generateContent?key=${encodeURIComponent(apiKey)}`;

        const requestBody = {
            systemInstruction: {
                parts: [{ text: systemInstruction }]
            },
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: promptText },
                        {
                            inlineData: {
                                mimeType,
                                data: imageBase64
                            }
                        }
                    ]
                }
            ],
            generationConfig: {
                responseMimeType: 'application/json',
                temperature: 0.1
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            let errorDetails = '';
            try {
                const errJson = await response.json();
                errorDetails = JSON.stringify(errJson);
            } catch {
                errorDetails = await response.text();
            }
            throw new HttpError(
                `Gemini API returned error HTTP ${response.status}: ${errorDetails}`,
                response.status === 401 || response.status === 403 ? 502 : 500
            );
        }

        const data = await response.json();
        const candidateText =
            data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

        if (!candidateText) {
            throw new HttpError('Gemini API returned an empty or invalid candidate response', 502);
        }

        return candidateText;
    }

    /**
     * Validates Gemini structured output against question rubric constraints and computes
     * deterministic, clamp-bounded server-side totals.
     */
    validateAndHarmonizeOutput(
        rawText: string,
        input: EvaluateClassroomAnswerInput
    ): ValidatedEvaluationOutcome {
        let parsed: RawGeminiEvaluationResponse;
        try {
            parsed = JSON.parse(rawText);
        } catch {
            throw new HttpError(
                'Automated evaluation failed: Gemini response is not valid JSON.',
                502
            );
        }

        if (!parsed || typeof parsed !== 'object') {
            throw new HttpError('Automated evaluation failed: Response payload is not an object.', 502);
        }

        if (!Array.isArray(parsed.criteria) || parsed.criteria.length === 0) {
            throw new HttpError('Automated evaluation failed: Missing or empty criteria list.', 502);
        }

        const targetCriteria = input.rubricCriteria && input.rubricCriteria.length > 0
            ? input.rubricCriteria
            : [{ criterionName: 'Overall Correctness & Methodology', points: input.maxMarks }];

        const validatedScores: IClassroomCriterionScore[] = [];
        let computedTotal = 0;

        // Map every required target criterion to model response
        for (const target of targetCriteria) {
            // Find corresponding model evaluation by matching criterion name (case-insensitive fallback)
            const matched = parsed.criteria.find(
                (c) =>
                    c &&
                    typeof c.criterion === 'string' &&
                    c.criterion.trim().toLowerCase() === target.criterionName.trim().toLowerCase()
            ) || parsed.criteria.find(
                (c) =>
                    c &&
                    typeof c.criterion === 'string' &&
                    (c.criterion.toLowerCase().includes(target.criterionName.toLowerCase()) ||
                     target.criterionName.toLowerCase().includes(c.criterion.toLowerCase()))
            );

            let rawAwarded = matched && typeof matched.awardedMarks === 'number' && Number.isFinite(matched.awardedMarks)
                ? matched.awardedMarks
                : 0;

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

            const evidenceText = matched?.evidence?.trim() || matched?.feedback?.trim() || '';
            const feedbackText = evidenceText.length > 0
                ? evidenceText
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
                evidence: evidenceText || undefined
            });
        }

        // Clamp computedTotal to question maxMarks
        if (computedTotal > input.maxMarks) {
            computedTotal = input.maxMarks;
        }

        // Validate overall feedback
        let overallFeedback = typeof parsed.overallFeedback === 'string' && parsed.overallFeedback.trim()
            ? parsed.overallFeedback.trim()
            : '';

        if (!overallFeedback) {
            const percentage = Math.round((computedTotal / input.maxMarks) * 100);
            overallFeedback = `Automated evaluation score: ${computedTotal}/${input.maxMarks} (${percentage}%).`;
        }

        // Validate confidence
        let confidence = typeof parsed.confidence === 'number' && Number.isFinite(parsed.confidence)
            ? parsed.confidence
            : 0.85;

        if (confidence < 0) confidence = 0;
        if (confidence > 1) confidence = 1;

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
        const apiKey = this.getApiKey();
        const model = this.getModelName();

        let rawModelOutputText: string;

        try {
            if (this.customGeminiCaller) {
                rawModelOutputText = await this.customGeminiCaller({
                    model,
                    apiKey,
                    systemInstruction,
                    promptText,
                    imageBase64,
                    mimeType
                });
            } else {
                rawModelOutputText = await this.callGeminiApi({
                    model,
                    apiKey,
                    systemInstruction,
                    promptText,
                    imageBase64,
                    mimeType
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
