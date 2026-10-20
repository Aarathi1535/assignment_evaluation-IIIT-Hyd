import { z } from 'zod';
import { HttpError } from '../../lib/errors';
import { QuestionDifficulty } from '../../models/PersonalizedQuestion';
import { geminiAIService, GeminiAIService } from './GeminiAIService';
import type { GeminiAICaller } from './types';

export const generatedRubricCriterionSchema = z
    .object({
        criterionName: z.string().trim().min(1, 'Criterion name is required'),
        points: z.coerce.number().positive('Points must be positive'),
        description: z.string().trim().optional()
    })
    .passthrough();

export const generatedQuestionItemSchema = z
    .object({
        title: z
            .string()
            .refine((title) => title.trim().length > 0, 'Title is required')
            .refine((title) => title.trim().length <= 200, 'Title too long')
            .optional(),
        topic: z.string().trim().min(1, 'Topic is required').max(100, 'Topic too long'),
        subtopic: z.string().trim().max(100).optional(),
        unit: z.string().trim().optional(),
        difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).or(
            z.string().transform((d) => {
                const upper = d.toUpperCase().trim();
                return upper === 'EASY' ? 'EASY' : upper === 'HARD' ? 'HARD' : 'MEDIUM';
            })
        ),
        questionType: z.string().trim().optional(),
        category: z.string().trim().optional(),
        questionPrompt: z.string().trim().min(1, 'Question prompt is required'),
        expectedConcepts: z.array(z.string().trim()).optional().default([]),
        maxMarks: z.coerce.number().positive('Max marks must be positive').default(10),
        hints: z.array(z.string().trim()).optional().default([]),
        referenceAnswer: z.string().trim().optional(),
        rubricCriteria: z.array(generatedRubricCriterionSchema).optional().default([])
    })
    .passthrough();

export const generatedQuestionsResponseSchema = z.preprocess(
    (value) => (Array.isArray(value) ? { questions: value } : value),
    z
        .object({
            questions: z.array(generatedQuestionItemSchema).min(1, 'Response must contain at least one question')
        })
        .passthrough()
);

/**
 * Strict OpenAPI / Gemini-compliant schema for constrained structured generation.
 */
export const GEMINI_QUESTIONS_RESPONSE_SCHEMA = {
    type: 'OBJECT',
    properties: {
        questions: {
            type: 'ARRAY',
            items: {
                type: 'OBJECT',
                properties: {
                    title: {
                        type: 'STRING',
                        description: 'Concise, academic title for the question'
                    },
                    topic: {
                        type: 'STRING',
                        description: 'Exact topic from the syllabus units'
                    },
                    unit: {
                        type: 'STRING',
                        description: 'Title of the syllabus unit containing this topic'
                    },
                    difficulty: {
                        type: 'STRING',
                        enum: ['EASY', 'MEDIUM', 'HARD'],
                        description: 'Difficulty tier: EASY, MEDIUM, or HARD'
                    },
                    questionPrompt: {
                        type: 'STRING',
                        description: 'Complete, clear question statement with problem specification'
                    },
                    expectedConcepts: {
                        type: 'ARRAY',
                        items: { type: 'STRING' },
                        description: 'Core concepts and keywords tested'
                    },
                    maxMarks: {
                        type: 'NUMBER',
                        description: 'Maximum marks for the question (default 10)'
                    },
                    hints: {
                        type: 'ARRAY',
                        items: { type: 'STRING' },
                        description: 'Progressive hints for students'
                    },
                    referenceAnswer: {
                        type: 'STRING',
                        description: 'Reference solution outline or formal answer derivation'
                    },
                    rubricCriteria: {
                        type: 'ARRAY',
                        items: {
                            type: 'OBJECT',
                            properties: {
                                criterionName: { type: 'STRING' },
                                points: { type: 'NUMBER' },
                                description: { type: 'STRING' }
                            },
                            required: ['criterionName', 'points']
                        },
                        description: 'Rubric criteria points breakdown summing up to maxMarks'
                    }
                },
                required: ['title', 'topic', 'difficulty', 'questionPrompt', 'maxMarks']
            }
        }
    },
    required: ['questions']
};

export interface GeneratedQuestionItem {
    title: string;
    topic: string;
    subtopic?: string;
    unit?: string;
    difficulty: QuestionDifficulty;
    questionType?: string;
    category?: string;
    questionPrompt: string;
    expectedConcepts?: string[];
    maxMarks: number;
    hints?: string[];
    referenceAnswer?: string;
    rubricCriteria?: Array<{
        criterionName: string;
        points: number;
        description?: string;
    }>;
    sourceSyllabusTopic?: string;
}

export interface ExtractedSyllabusUnit {
    unitNumber: number;
    unitTitle: string;
    topics: string[];
    description?: string;
}

export interface ExtractedSyllabusData {
    courseTitle?: string;
    units: ExtractedSyllabusUnit[];
    extractedTopics: string[];
    learningObjectives?: string[];
}

export interface GenerateQuestionsParams {
    courseTitle: string;
    syllabusUnits: ExtractedSyllabusUnit[];
    targetCount: number;
    difficultyDistribution?: {
        EASY: number;
        MEDIUM: number;
        HARD: number;
    };
    selectedTopics?: string[];
    difficulty?: 'ALL' | 'EASY' | 'MEDIUM' | 'HARD';
    questionType?: string;
    learningObjectives?: string[];
}

export interface IAIQuestionGenerationProvider {
    readonly providerName: string;
    isConfigured(): boolean;
    extractSyllabus(rawText: string, courseCode?: string): Promise<ExtractedSyllabusData>;
    generateQuestions(params: GenerateQuestionsParams): Promise<GeneratedQuestionItem[]>;
}

/**
 * Deterministic text parser for structured syllabus documents (Units, Modules, Topics).
 */
export class DeterministicSyllabusParser {
    static parse(rawText: string, defaultCourseCode = 'Course'): ExtractedSyllabusData {
        if (!rawText || rawText.trim().length === 0) {
            throw new HttpError('Syllabus content is empty or invalid', 400);
        }

        const lines = rawText
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0);

        const units: ExtractedSyllabusUnit[] = [];
        let currentUnit: ExtractedSyllabusUnit | null = null;
        const allTopics: Set<string> = new Set();
        const learningObjectives: string[] = [];

        const unitRegex = /^(?:unit|module|chapter|part|section)\s*([0-9ivxlcdm]+)[:.\-\s]*(.*)$/i;
        const objectiveRegex = /^(?:course\s*objective|learning\s*objective|objective|outcome)s?[:.\-\s]*(.*)$/i;

        for (const line of lines) {
            // Check for learning objectives
            const objMatch = line.match(objectiveRegex);
            if (objMatch && objMatch[1]) {
                learningObjectives.push(objMatch[1].trim());
                continue;
            }

            // Check for new unit header
            const unitMatch = line.match(unitRegex);
            if (unitMatch) {
                if (currentUnit && currentUnit.topics.length > 0) {
                    units.push(currentUnit);
                }
                const unitNumber = units.length + 1;
                const unitTitle = unitMatch[2]?.trim() || `Unit ${unitNumber}`;
                currentUnit = {
                    unitNumber,
                    unitTitle,
                    topics: []
                };
                continue;
            }

            // If inside a unit, collect bullet points or topic lines
            if (currentUnit) {
                const cleanLine = line.replace(/^[-*•\d.)\s]+/, '').trim();
                if (cleanLine.length > 2) {
                    // Split comma-separated topics or handle individual lines
                    const subTopics = cleanLine.includes(',') && cleanLine.length > 40
                        ? cleanLine.split(',').map((t) => t.trim()).filter((t) => t.length > 2)
                        : [cleanLine];

                    for (const t of subTopics) {
                        if (!currentUnit.topics.includes(t)) {
                            currentUnit.topics.push(t);
                            allTopics.add(t);
                        }
                    }
                }
            } else {
                // If not in a unit yet, create a default first unit
                const cleanLine = line.replace(/^[-*•\d.)\s]+/, '').trim();
                if (cleanLine.length > 3) {
                    currentUnit = {
                        unitNumber: 1,
                        unitTitle: `${defaultCourseCode} Core Concepts`,
                        topics: [cleanLine]
                    };
                    allTopics.add(cleanLine);
                }
            }
        }

        if (currentUnit && currentUnit.topics.length > 0 && !units.includes(currentUnit)) {
            units.push(currentUnit);
        }

        // If no units were detected, synthesize structured units from raw lines
        if (units.length === 0) {
            const rawTopics = lines
                .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
                .filter((l) => l.length > 3);

            const chunkSize = Math.max(1, Math.ceil(rawTopics.length / 4));
            for (let i = 0; i < rawTopics.length; i += chunkSize) {
                const chunk = rawTopics.slice(i, i + chunkSize);
                const unitNumber = units.length + 1;
                units.push({
                    unitNumber,
                    unitTitle: `Module ${unitNumber}: Foundation & Methods`,
                    topics: chunk
                });
                chunk.forEach((t) => allTopics.add(t));
            }
        }

        if (allTopics.size === 0) {
            throw new HttpError(
                'Could not extract any meaningful topics from the syllabus. Please provide detailed units and topics.',
                400
            );
        }

        return {
            courseTitle: defaultCourseCode,
            units,
            extractedTopics: Array.from(allTopics),
            learningObjectives
        };
    }
}

export type GeminiQuestionCaller = (payload: {
    model: string;
    apiKey: string;
    systemInstruction: string;
    promptText: string;
    responseSchema?: unknown;
}) => Promise<string>;

/**
 * Parses and validates model text into syllabus-grounded GeneratedQuestionItem[].
 * Validates strictly against generatedQuestionsResponseSchema without blind regex slicing.
 */
export function parseGeneratedQuestions(
    rawText: string,
    syllabusUnits: ExtractedSyllabusUnit[]
): GeneratedQuestionItem[] {
    if (!rawText || typeof rawText !== 'string' || rawText.trim().length === 0) {
        throw new HttpError(
            'Gemini question generation returned an empty response. Please retry generation.',
            502
        );
    }

    let cleaned = rawText.trim();
    // Safe sanitized excerpt for diagnostic messages (no secrets, no sensitive data)
    const sanitizedExcerpt = cleaned.slice(0, 80).replace(/[\r\n\t]+/g, ' ').trim();

    // Check code fences first: ```json ... ``` or ``` ... ```
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch && fenceMatch[1]) {
        cleaned = fenceMatch[1].trim();
    } else {
        // Find outermost JSON object or array bounds
        const firstBrace = cleaned.indexOf('{');
        const firstBracket = cleaned.indexOf('[');

        // If no JSON object or array delimiter exists at all (e.g. "X X ..." or conversational text)
        if (firstBrace === -1 && firstBracket === -1) {
            console.warn(
                `[AIQuestionGenerationProvider] Non-JSON output received from Gemini (length ${rawText.length}): "${sanitizedExcerpt}..."`
            );
            throw new HttpError(
                `Gemini question generation returned malformed JSON: Model output does not contain a JSON object or array (excerpt: "${sanitizedExcerpt}..."). Please retry question generation.`,
                502
            );
        }

        const start = firstBrace !== -1 && firstBracket !== -1
            ? Math.min(firstBrace, firstBracket)
            : firstBrace !== -1 ? firstBrace : firstBracket;
        const lastBrace = cleaned.lastIndexOf('}');
        const lastBracket = cleaned.lastIndexOf(']');
        const end = Math.max(lastBrace, lastBracket);

        if (end === -1 || end < start) {
            console.warn(
                `[AIQuestionGenerationProvider] Truncated/incomplete JSON response (length: ${rawText.length}): "${sanitizedExcerpt}..."`
            );
            throw new HttpError(
                `Gemini question generation response was truncated or incomplete (missing closing bracket/brace). Please retry with a smaller question count.`,
                502
            );
        }

        cleaned = cleaned.slice(start, end + 1).trim();
    }

    // Direct JSON parse of the structured output
    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Invalid JSON';
        const isTruncated =
            errMsg.includes('Unexpected end') ||
            errMsg.includes('Unterminated') ||
            errMsg.includes('end of data');
        if (isTruncated) {
            throw new HttpError(
                `Gemini question generation response was truncated or cut off prematurely. Please retry with a smaller question count.`,
                502
            );
        }
        throw new HttpError(
            `Gemini question generation returned malformed JSON: ${errMsg} (excerpt: "${sanitizedExcerpt}...")`,
            502
        );
    }

    // Strict schema validation using Zod
    const validation = generatedQuestionsResponseSchema.safeParse(parsed);
    if (!validation.success) {
        const errorDetails = validation.error.issues
            .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
            .join('; ');
        throw new HttpError(
            `Gemini question generation response failed schema validation: ${errorDetails}`,
            502
        );
    }

    const { questions } = validation.data;

    // Grounding verification against syllabus units & topics
    const allTopics = syllabusUnits.flatMap((u) => u.topics);
    const unitMap = new Map<string, string>(); // topicLower -> unitTitle
    const topicLookup = new Map<string, string>(); // topicLower -> original topic
    for (const u of syllabusUnits) {
        unitMap.set(u.unitTitle.toLowerCase().trim(), u.unitTitle);
        topicLookup.set(u.unitTitle.toLowerCase().trim(), u.unitTitle);
        for (const t of u.topics) {
            const key = t.toLowerCase().trim();
            unitMap.set(key, u.unitTitle);
            topicLookup.set(key, t);
        }
    }

    const result: GeneratedQuestionItem[] = [];

    for (const q of questions) {
        const topicKey = q.topic.toLowerCase().trim();
        let matchedTopic = topicLookup.get(topicKey);
        let matchedUnit = unitMap.get(topicKey);

        if (!matchedTopic) {
            for (const [key, orig] of topicLookup.entries()) {
                if (topicKey.includes(key) || key.includes(topicKey)) {
                    matchedTopic = orig;
                    matchedUnit = unitMap.get(key);
                    break;
                }
            }
        }

        if (!matchedTopic) {
            // Keep the AI's topic if it's descriptive, otherwise use round-robin unit topic
            if (q.topic && q.topic.trim().length > 2) {
                matchedTopic = q.topic.trim();
                matchedUnit = q.unit || syllabusUnits[result.length % syllabusUnits.length]?.unitTitle || 'Module 1';
            } else {
                const fallbackUnit = syllabusUnits[result.length % syllabusUnits.length];
                matchedUnit = fallbackUnit.unitTitle;
                matchedTopic = fallbackUnit.topics[result.length % fallbackUnit.topics.length] || allTopics[0] || 'General';
            }
        }

        result.push({
            title: q.title ?? q.topic,
            topic: matchedTopic,
            subtopic: q.subtopic || matchedTopic,
            unit: matchedUnit || q.unit || syllabusUnits[0]?.unitTitle || 'Module 1',
            difficulty: q.difficulty as QuestionDifficulty,
            questionType: q.questionType,
            category: q.category,
            questionPrompt: q.questionPrompt,
            expectedConcepts: q.expectedConcepts,
            maxMarks: q.maxMarks,
            hints: q.hints,
            referenceAnswer: q.referenceAnswer,
            rubricCriteria: q.rubricCriteria && q.rubricCriteria.length > 0 ? q.rubricCriteria : undefined,
            sourceSyllabusTopic: matchedTopic
        });
    }

    return result;
}

/**
 * Standard production Gemini / AI Provider.
 * Connects to Google Generative Language API with retry, fallback, and strict syllabus grounding.
 */
export class GeminiAIQuestionGenerationProvider implements IAIQuestionGenerationProvider {
    readonly providerName: string = 'GeminiAI';
    private customGeminiCaller: GeminiQuestionCaller | null = null;
    private sharedGeminiService: GeminiAIService;

    constructor(aiService: GeminiAIService = geminiAIService) {
        this.sharedGeminiService = aiService;
    }

    /**
     * Dependency injection hook for deterministic unit testing without live network calls.
     */
    setGeminiCaller(caller: GeminiQuestionCaller | null): void {
        this.customGeminiCaller = caller;
    }

    getApiKey(): string {
        return (
            this.sharedGeminiService.getApiKey() ||
            process.env.GEMINI_API_KEY ||
            process.env.GOOGLE_API_KEY ||
            process.env.GOOGLE_GENAI_API_KEY ||
            ''
        ).trim();
    }

    getModelName(): string {
        const customModel =
            process.env.GEMINI_PERSONALIZED_MODEL ||
            process.env.GEMINI_CLASSROOM_MODEL ||
            process.env.GEMINI_MODEL ||
            process.env.AI_MODEL;
        if (customModel && customModel.trim()) {
            return customModel.trim();
        }
        if (typeof this.sharedGeminiService?.getModelName === 'function') {
            return this.sharedGeminiService.getModelName();
        }
        return 'gemini-2.5-flash';
    }

    isConfigured(): boolean {
        if (this.customGeminiCaller !== null) {
            return true;
        }
        return this.sharedGeminiService.isConfigured();
    }

    async extractSyllabus(rawText: string, courseCode = 'Course'): Promise<ExtractedSyllabusData> {
        return DeterministicSyllabusParser.parse(rawText, courseCode);
    }

    buildSystemInstruction(): string {
        return [
            'You are an expert university professor and examination designer in Computer Science and Engineering.',
            'Your task is to generate rigorous, high-quality, syllabus-grounded academic assessment questions for university students.',
            '',
            'CRITICAL RULES:',
            '1. Every question MUST be strictly grounded in one of the provided syllabus units and topics. Do NOT invent unrelated topics.',
            '2. The "topic" field of each question MUST match one of the syllabus topics provided.',
            '3. The "unit" field MUST match the unit title containing that topic.',
            '4. Adhere strictly to the requested difficulty level ("EASY", "MEDIUM", "HARD"):',
            '   - EASY: Conceptual understanding, basic definitions, direct application of algorithms or formulas.',
            '   - MEDIUM: Detailed problem solving, algorithmic derivations, multi-step tracing, analytical proofs.',
            '   - HARD: Complex design problems, edge cases, advanced optimization, deep formal proofs, comprehensive syntheses.',
            '5. Provide a clear, unambiguous "questionPrompt" with complete problem specifications.',
            '6. Provide "expectedConcepts" (array of 2-5 core concepts/keywords tested).',
            '7. Provide realistic "maxMarks" (default: 10 marks per question).',
            '8. Provide "hints" (array of 1-3 progressive hints).',
            '9. Provide a comprehensive "referenceAnswer" or solution outline showing the derivation or key steps.',
            '10. Provide 2-4 "rubricCriteria" where each item has "criterionName", "points" (summing to maxMarks), and "description".',
            '',
            'JSON OUTPUT FORMAT REQUIREMENT:',
            'You must output ONLY valid, raw JSON with this exact schema: {"questions": [{"title":"...","topic":"...","unit":"...","difficulty":"EASY|MEDIUM|HARD","questionPrompt":"...","expectedConcepts":["..."],"maxMarks":10,"hints":["..."],"referenceAnswer":"...","rubricCriteria":[{"criterionName":"...","points":10,"description":"..."}]}]}',
            'Do NOT output any markdown fences, Roman numerals, conversational text, or surrounding prose.'
        ].join('\n');
    }

    buildUserPrompt(input: {
        courseTitle: string;
        syllabusUnits: ExtractedSyllabusUnit[];
        targetCount: number;
        difficultyDistribution?: { EASY: number; MEDIUM: number; HARD: number };
        selectedTopics?: string[];
        difficulty?: 'ALL' | 'EASY' | 'MEDIUM' | 'HARD';
        questionType?: string;
        learningObjectives?: string[];
        batchIndex?: number;
        totalBatches?: number;
    }): string {
        const {
            courseTitle,
            syllabusUnits,
            targetCount,
            difficultyDistribution,
            selectedTopics,
            difficulty,
            questionType,
            learningObjectives,
            batchIndex,
            totalBatches
        } = input;

        const unitsListing = syllabusUnits
            .map((u) => {
                const topicList = u.topics.join(', ');
                return `Unit ${u.unitNumber}: ${u.unitTitle}\nTopics: ${topicList}`;
            })
            .join('\n\n');

        const difficultySpec =
            difficulty && difficulty !== 'ALL'
                ? `Target Difficulty: Exactly ${difficulty} difficulty level for all ${targetCount} questions.`
                : difficultyDistribution
                ? `Target Difficulty: ${difficultyDistribution.EASY} EASY, ${difficultyDistribution.MEDIUM} MEDIUM, ${difficultyDistribution.HARD} HARD.`
                : 'Target Difficulty: Balanced mix of EASY (30%), MEDIUM (50%), and HARD (20%).';

        const typeSpec =
            questionType && questionType !== 'ALL'
                ? `Target Question Type: All questions must be of format "${questionType}".`
                : '';

        const objectivesText =
            learningObjectives && learningObjectives.length > 0
                ? `\nLearning Objectives:\n${learningObjectives.map((o) => `- ${o}`).join('\n')}`
                : '';

        const filterText =
            selectedTopics && selectedTopics.length > 0
                ? `\nCRITICAL FOCUS TOPICS:\nYou MUST strictly generate questions exclusively from these selected topics and units:\n${selectedTopics.map((t) => `- ${t}`).join('\n')}`
                : '';

        const batchText =
            batchIndex && totalBatches
                ? `\n(Generation Batch ${batchIndex} of ${totalBatches})`
                : '';

        return [
            `Course: ${courseTitle}`,
            `Number of Questions to Generate: ${targetCount}`,
            difficultySpec,
            typeSpec,
            batchText,
            objectivesText,
            filterText,
            '',
            '=== COURSE SYLLABUS UNITS & TOPICS ===',
            unitsListing,
            '',
            `Please generate exactly ${targetCount} syllabus-grounded academic assessment questions. Output ONLY valid JSON matching the schema with no extra commentary or Roman numerals.`
        ]
            .filter(Boolean)
            .join('\n');
    }

    async callGeminiApi(payload: {
        model?: string;
        apiKey?: string;
        systemInstruction: string;
        promptText: string;
        responseSchema?: unknown;
    }): Promise<string> {
        const { model, apiKey, systemInstruction, promptText, responseSchema } = payload;

        if (!apiKey && !this.isConfigured()) {
            throw new HttpError(
                'AI question generation is not configured. Please configure an AI provider with GEMINI_API_KEY in the environment.',
                503
            );
        }

        const preferredModel = (model || this.getModelName()).trim();
        const modelsToTry: string[] = [];
        if (preferredModel) {
            modelsToTry.push(preferredModel);
        }

        let lastError: Error | null = null;

        for (const currentModel of modelsToTry) {
            try {
                const rawText = await this.sharedGeminiService.generateContent({
                    systemInstruction,
                    promptText,
                    model: currentModel,
                    responseMimeType: 'application/json',
                    responseSchema,
                    temperature: 0.2
                });

                if (!rawText || rawText.trim().length === 0) {
                    lastError = new Error(`Empty content returned by model ${currentModel}`);
                    continue;
                }

                return rawText;
            } catch (err: unknown) {
                lastError = err instanceof Error ? err : new Error(String(err));
                continue;
            }
        }

        throw new HttpError(
            `Gemini AI question generation failed across all available models. Last error: ${lastError?.message || 'Unknown error'}`,
            502
        );
    }

    async generateQuestions(params: GenerateQuestionsParams): Promise<GeneratedQuestionItem[]> {
        if (!this.isConfigured()) {
            throw new HttpError(
                'AI question generation is not configured. Please configure an AI provider with GEMINI_API_KEY in the environment.',
                503
            );
        }

        const {
            courseTitle,
            syllabusUnits,
            targetCount,
            difficultyDistribution,
            selectedTopics,
            difficulty,
            questionType,
            learningObjectives
        } = params;

        if (!syllabusUnits || syllabusUnits.length === 0) {
            throw new HttpError('Syllabus contains no units to generate questions from', 400);
        }

        const allTopics = syllabusUnits.flatMap((u) => u.topics);
        if (allTopics.length === 0) {
            throw new HttpError('Syllabus contains no topics to generate questions from', 400);
        }

        const systemInstruction = this.buildSystemInstruction();

        // If custom caller is set (for testing / mocking live calls deterministically)
        if (this.customGeminiCaller) {
            const promptText = this.buildUserPrompt({
                courseTitle,
                syllabusUnits,
                targetCount,
                difficultyDistribution,
                selectedTopics,
                difficulty,
                questionType,
                learningObjectives
            });
            const rawOutput = await this.customGeminiCaller({
                model: this.getModelName(),
                apiKey: this.getApiKey(),
                systemInstruction,
                promptText
            });
            return parseGeneratedQuestions(rawOutput, syllabusUnits);
        }

        // Live generation with chunked batching for reliability and quality
        const BATCH_SIZE = 10;
        const allGenerated: GeneratedQuestionItem[] = [];
        const seenPrompts = new Set<string>();
        const totalBatches = Math.max(1, Math.ceil(targetCount / BATCH_SIZE));

        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
            const remaining = targetCount - allGenerated.length;
            if (remaining <= 0) break;

            const currentBatchTarget = Math.min(BATCH_SIZE, remaining);

            let batchEasy: number;
            let batchMed: number;
            let batchHard: number;

            if (difficulty === 'EASY') {
                batchEasy = currentBatchTarget;
                batchMed = 0;
                batchHard = 0;
            } else if (difficulty === 'MEDIUM') {
                batchEasy = 0;
                batchMed = currentBatchTarget;
                batchHard = 0;
            } else if (difficulty === 'HARD') {
                batchEasy = 0;
                batchMed = 0;
                batchHard = currentBatchTarget;
            } else {
                const easyRatio = (difficultyDistribution?.EASY ?? 30) / (targetCount || 100);
                const medRatio = (difficultyDistribution?.MEDIUM ?? 50) / (targetCount || 100);
                batchEasy = Math.max(0, Math.round(currentBatchTarget * easyRatio));
                batchMed = Math.max(0, Math.round(currentBatchTarget * medRatio));
                batchHard = Math.max(0, currentBatchTarget - batchEasy - batchMed);
            }

            const promptText = this.buildUserPrompt({
                courseTitle,
                syllabusUnits,
                targetCount: currentBatchTarget,
                difficultyDistribution: { EASY: batchEasy, MEDIUM: batchMed, HARD: batchHard },
                selectedTopics,
                difficulty,
                questionType,
                learningObjectives,
                batchIndex: batchIdx + 1,
                totalBatches
            });

            let items: GeneratedQuestionItem[] | null = null;
            let parseError: unknown = null;

            // Attempt 1: Primary generation with schema-constrained decoding
            try {
                let rawText: string;
                if (this.sharedGeminiService.isConfigured()) {
                    rawText = await this.sharedGeminiService.generateContent({
                        systemInstruction,
                        promptText,
                        model: this.getModelName(),
                        responseMimeType: 'application/json',
                        responseSchema: GEMINI_QUESTIONS_RESPONSE_SCHEMA,
                        temperature: 0.2
                    });
                } else {
                    rawText = await this.callGeminiApi({
                        model: this.getModelName(),
                        apiKey: this.getApiKey(),
                        systemInstruction,
                        promptText,
                        responseSchema: GEMINI_QUESTIONS_RESPONSE_SCHEMA
                    });
                }
                items = parseGeneratedQuestions(rawText, syllabusUnits);
            } catch (err: unknown) {
                parseError = err;
                if (err instanceof HttpError && (err.statusCode === 400 || err.statusCode === 403 || err.statusCode === 503)) {
                    throw err;
                }
                console.warn(
                    `[AIQuestionGenerationProvider] Batch ${batchIdx + 1} initial generation attempt failed: ${err instanceof Error ? err.message : String(err)}. Attempting one controlled regeneration with reinforced instructions...`
                );
            }

            // Attempt 2: Exactly one controlled regeneration attempt on malformed response
            if (!items) {
                const reinforcedSystem = [
                    systemInstruction,
                    '',
                    'CRITICAL RECOVERY INSTRUCTION:',
                    'Your previous output was malformed or not valid JSON.',
                    'You MUST output ONLY a valid JSON object starting with {"questions": [ ... ]}.',
                    'Do NOT output any markdown fences, Roman numerals, conversational text, or surrounding prose.'
                ].join('\n');

                try {
                    let retryText: string;
                    if (this.sharedGeminiService.isConfigured()) {
                        retryText = await this.sharedGeminiService.generateContent({
                            systemInstruction: reinforcedSystem,
                            promptText,
                            model: this.getModelName(),
                            responseMimeType: 'application/json',
                            responseSchema: GEMINI_QUESTIONS_RESPONSE_SCHEMA,
                            temperature: 0.1
                        });
                    } else {
                        retryText = await this.callGeminiApi({
                            model: this.getModelName(),
                            apiKey: this.getApiKey(),
                            systemInstruction: reinforcedSystem,
                            promptText,
                            responseSchema: GEMINI_QUESTIONS_RESPONSE_SCHEMA
                        });
                    }
                    items = parseGeneratedQuestions(retryText, syllabusUnits);
                } catch (retryErr: unknown) {
                    throw retryErr instanceof HttpError
                        ? retryErr
                        : (parseError instanceof HttpError
                        ? parseError
                        : new HttpError(`Gemini AI question generation failed: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`, 502));
                }
            }

            for (const it of items) {
                const normalized = it.questionPrompt.toLowerCase().trim();
                if (!seenPrompts.has(normalized)) {
                    seenPrompts.add(normalized);
                    allGenerated.push(it);
                }
                if (allGenerated.length >= targetCount) {
                    break;
                }
            }
        }

        if (allGenerated.length === 0) {
            throw new HttpError('Gemini AI returned no valid questions. Please retry generation.', 502);
        }

        return allGenerated;
    }
}

/**
 * In-memory Mock Provider for vitest unit tests and deterministic simulation.
 */
export class MockAIQuestionGenerationProvider implements IAIQuestionGenerationProvider {
    readonly providerName = 'MockAI';
    private configured = true;

    constructor(configured = true) {
        this.configured = configured;
    }

    setConfigured(val: boolean) {
        this.configured = val;
    }

    isConfigured(): boolean {
        return this.configured;
    }

    async extractSyllabus(rawText: string, courseCode = 'Course'): Promise<ExtractedSyllabusData> {
        if (!this.isConfigured()) {
            throw new HttpError('AI question generation is not configured. Please configure an AI provider.', 503);
        }
        return DeterministicSyllabusParser.parse(rawText, courseCode);
    }

    async generateQuestions(params: GenerateQuestionsParams): Promise<GeneratedQuestionItem[]> {
        if (!this.isConfigured()) {
            throw new HttpError('AI question generation is not configured. Please configure an AI provider.', 503);
        }

        const { targetCount, syllabusUnits, difficultyDistribution, selectedTopics, difficulty, questionType } = params;
        const allTopics = syllabusUnits.flatMap((u) => u.topics);
        if (allTopics.length === 0) {
            throw new HttpError('Syllabus contains no topics to generate questions from', 400);
        }

        const questions: GeneratedQuestionItem[] = [];

        // Compute distribution counts
        const easyTarget = difficulty === 'EASY'
            ? targetCount
            : difficulty === 'MEDIUM' || difficulty === 'HARD'
            ? 0
            : difficultyDistribution?.EASY ?? Math.floor(targetCount * 0.3);
        const medTarget = difficulty === 'MEDIUM'
            ? targetCount
            : difficulty === 'EASY' || difficulty === 'HARD'
            ? 0
            : difficultyDistribution?.MEDIUM ?? Math.floor(targetCount * 0.5);

        // Effective topic source: selected topics if specified, otherwise syllabus topics
        const effectiveTopics = selectedTopics && selectedTopics.length > 0 ? selectedTopics : allTopics;

        for (let i = 0; i < targetCount; i++) {
            const unit = syllabusUnits[i % syllabusUnits.length];
            const topic = effectiveTopics[i % effectiveTopics.length];

            let qDifficulty: QuestionDifficulty = 'MEDIUM';
            if (difficulty && difficulty !== 'ALL') {
                qDifficulty = difficulty;
            } else if (i < easyTarget) {
                qDifficulty = 'EASY';
            } else if (i < easyTarget + medTarget) {
                qDifficulty = 'MEDIUM';
            } else {
                qDifficulty = 'HARD';
            }

            questions.push({
                title: `${topic} - Exercise ${i + 1}`,
                topic,
                subtopic: topic,
                unit: unit.unitTitle,
                difficulty: qDifficulty,
                questionType: questionType && questionType !== 'ALL' ? questionType : 'THEORY',
                category: 'CONCEPTUAL',
                questionPrompt: `Given the core principles of ${topic} (${unit.unitTitle}), derive and formulate the complete step-by-step solution for scenario ${i + 1}.`,
                expectedConcepts: [topic, unit.unitTitle, 'Analytical Proof', 'Complexity Analysis'],
                maxMarks: 10,
                hints: [`Review the definition of ${topic}.`, 'Check edge cases and constraints.'],
                referenceAnswer: `The formal solution for ${topic} involves verifying initial conditions, applying theorem steps, and proving asymptotic bounds.`,
                rubricCriteria: [
                    { criterionName: 'Concept Understanding & Formulation', points: 4, description: 'Correct identification of properties' },
                    { criterionName: 'Execution & Algorithm Proof', points: 6, description: 'Rigorous derivation and steps' }
                ],
                sourceSyllabusTopic: topic
            });
        }

        return questions;
    }
}

/**
 * Shared Vertex AI question generation provider for Personalized Assessment.
 * Delegates all live AI calls to the centralized VertexAIService.
 * Does NOT require or read GEMINI_API_KEY.
 */
export class VertexAIQuestionGenerationProvider extends GeminiAIQuestionGenerationProvider {
    override readonly providerName = 'VertexAI';
    private sharedVertexService: GeminiAIService;

    constructor(aiService: GeminiAIService = geminiAIService) {
        super();
        this.sharedVertexService = aiService;
    }

    override isConfigured(): boolean {
        return this.sharedVertexService.isConfigured();
    }

    override getModelName(): string {
        return this.sharedVertexService.getModelName();
    }

    getRegion(): string {
        return this.sharedVertexService.getRegion();
    }

    setCustomCaller(caller: GeminiAICaller | null): void {
        this.sharedVertexService.setCustomCaller(caller);
    }

    override async generateQuestions(params: GenerateQuestionsParams): Promise<GeneratedQuestionItem[]> {
        if (!this.isConfigured()) {
            throw new HttpError(
                'AI question generation is not configured. Please configure credentials via GEMINI_API_KEY.',
                503
            );
        }

        const { syllabusUnits, targetCount } = params;
        if (!syllabusUnits || syllabusUnits.length === 0) {
            throw new HttpError('Syllabus contains no units to generate questions from', 400);
        }

        const systemInstruction = this.buildSystemInstruction();
        const promptText = this.buildUserPrompt(params);

        const rawText = await this.sharedVertexService.generateContent({
            systemInstruction,
            promptText,
            model: this.getModelName(),
            responseMimeType: 'application/json',
            temperature: 0.2
        });

        const questions = parseGeneratedQuestions(rawText, syllabusUnits);
        return questions.slice(0, targetCount);
    }
}

export const AIQuestionGenerationProvider = GeminiAIQuestionGenerationProvider;
export const GeminiQuestionGenerationProvider = GeminiAIQuestionGenerationProvider;
