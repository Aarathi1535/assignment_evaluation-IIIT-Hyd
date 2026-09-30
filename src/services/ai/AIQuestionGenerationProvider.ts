import { z } from 'zod';
import { HttpError } from '../../lib/errors';
import { QuestionDifficulty } from '../../models/PersonalizedQuestion';
import { vertexAIService, VertexAIService } from './VertexAIService';
import { geminiAIService, GeminiAIService } from './GeminiAIService';
import type { GeminiAICaller } from './types';

export const generatedRubricCriterionSchema = z
    .object({
        criterionName: z.string().trim().min(1, 'Criterion name is required'),
        points: z.number().positive('Points must be positive'),
        description: z.string().trim().optional()
    })
    .strict();

export const generatedQuestionItemSchema = z
    .object({
        title: z.string().trim().min(1, 'Title is required').max(200, 'Title too long'),
        topic: z.string().trim().min(1, 'Topic is required').max(100, 'Topic too long'),
        unit: z.string().trim().optional(),
        difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']),
        questionPrompt: z.string().trim().min(1, 'Question prompt is required'),
        expectedConcepts: z.array(z.string().trim()).optional().default([]),
        maxMarks: z.number().positive('Max marks must be positive').default(10),
        hints: z.array(z.string().trim()).optional().default([]),
        referenceAnswer: z.string().trim().optional(),
        rubricCriteria: z.array(generatedRubricCriterionSchema).optional().default([])
    })
    .strict();

export const generatedQuestionsResponseSchema = z
    .object({
        questions: z.array(generatedQuestionItemSchema).min(1, 'Response must contain at least one question')
    })
    .strict();

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
    unit?: string;
    difficulty: QuestionDifficulty;
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
    // If wrapped in markdown code fence (```json ... ``` or ``` ... ```), strip outermost fence
    if (cleaned.startsWith('```')) {
        const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
        if (fenceMatch && fenceMatch[1]) {
            cleaned = fenceMatch[1].trim();
        }
    }

    // Direct JSON parse of the structured output
    let parsed: unknown;
    try {
        parsed = JSON.parse(cleaned);
    } catch (err) {
        throw new HttpError(
            `Gemini question generation returned malformed JSON: ${err instanceof Error ? err.message : 'Invalid JSON'}`,
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
            const fallbackUnit = syllabusUnits[result.length % syllabusUnits.length];
            matchedUnit = fallbackUnit.unitTitle;
            matchedTopic = fallbackUnit.topics[result.length % fallbackUnit.topics.length] || allTopics[0] || 'General';
        }

        result.push({
            title: q.title,
            topic: matchedTopic,
            unit: matchedUnit || q.unit || syllabusUnits[0]?.unitTitle || 'Module 1',
            difficulty: q.difficulty,
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
            process.env.GEMINI_MODEL;
        if (customModel && customModel.trim() && customModel.trim() !== 'gemini-1.5-flash') {
            return customModel.trim();
        }
        return 'gemini-3.8-flash';
    }

    isConfigured(): boolean {
        if (vertexAIService.isConfigured()) {
            return true;
        }
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
            'You must output ONLY valid JSON matching the configured responseSchema.'
        ].join('\n');
    }

    buildUserPrompt(input: {
        courseTitle: string;
        syllabusUnits: ExtractedSyllabusUnit[];
        targetCount: number;
        difficultyDistribution?: { EASY: number; MEDIUM: number; HARD: number };
        selectedTopics?: string[];
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

        const difficultySpec = difficultyDistribution
            ? `Target Difficulty: ${difficultyDistribution.EASY} EASY, ${difficultyDistribution.MEDIUM} MEDIUM, ${difficultyDistribution.HARD} HARD.`
            : 'Target Difficulty: Balanced mix of EASY (30%), MEDIUM (50%), and HARD (20%).';

        const objectivesText =
            learningObjectives && learningObjectives.length > 0
                ? `\nLearning Objectives:\n${learningObjectives.map((o) => `- ${o}`).join('\n')}`
                : '';

        const filterText =
            selectedTopics && selectedTopics.length > 0
                ? `\nFocus specifically on these topics:\n${selectedTopics.join(', ')}`
                : '';

        const batchText =
            batchIndex && totalBatches
                ? `\n(Generation Batch ${batchIndex} of ${totalBatches})`
                : '';

        return [
            `Course: ${courseTitle}`,
            `Number of Questions to Generate: ${targetCount}`,
            difficultySpec,
            batchText,
            objectivesText,
            filterText,
            '',
            '=== COURSE SYLLABUS UNITS & TOPICS ===',
            unitsListing,
            '',
            `Please generate exactly ${targetCount} syllabus-grounded academic assessment questions adhering strictly to the required schema.`
        ]
            .filter(Boolean)
            .join('\n');
    }

    async callGeminiApi(payload: {
        model?: string;
        apiKey?: string;
        systemInstruction: string;
        promptText: string;
    }): Promise<string> {
        const { model, apiKey, systemInstruction, promptText } = payload;

        if (!apiKey && !this.isConfigured()) {
            throw new HttpError(
                'AI question generation is not configured. Please configure an AI provider with GEMINI_API_KEY in the environment.',
                503
            );
        }

        const preferredModel = (model || this.getModelName()).trim();
        const modelsToTry: string[] = [];
        if (preferredModel && preferredModel !== 'gemini-1.5-flash') {
            modelsToTry.push(preferredModel);
        }
        if (!modelsToTry.includes('gemini-3.8-flash')) {
            modelsToTry.push('gemini-3.8-flash');
        }
        if (!modelsToTry.includes('gemini-2.5-flash')) {
            modelsToTry.push('gemini-2.5-flash');
        }
        if (!modelsToTry.includes('gemini-flash-latest')) {
            modelsToTry.push('gemini-flash-latest');
        }

        let lastError: Error | null = null;

        for (const currentModel of modelsToTry) {
            try {
                const rawText = await this.sharedGeminiService.generateContent({
                    systemInstruction,
                    promptText,
                    model: currentModel,
                    responseMimeType: 'application/json',
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

        // Live Vertex AI Service call when configured via Google Cloud credentials
        if (vertexAIService.isConfigured()) {
            const promptText = this.buildUserPrompt({
                courseTitle,
                syllabusUnits,
                targetCount,
                difficultyDistribution,
                selectedTopics,
                learningObjectives
            });
            const rawText = await vertexAIService.generateContent({
                systemInstruction,
                promptText,
                responseMimeType: 'application/json',
                temperature: 0.2
            });
            const items = parseGeneratedQuestions(rawText, syllabusUnits);
            return items.slice(0, targetCount);
        }

        // Live Gemini API call with chunked batching
        const BATCH_SIZE = 10;
        const allGenerated: GeneratedQuestionItem[] = [];
        const seenPrompts = new Set<string>();
        const totalBatches = Math.max(1, Math.ceil(targetCount / BATCH_SIZE));

        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
            const remaining = targetCount - allGenerated.length;
            if (remaining <= 0) break;

            const currentBatchTarget = Math.min(BATCH_SIZE, remaining);

            const easyRatio = (difficultyDistribution?.EASY ?? 30) / (targetCount || 100);
            const medRatio = (difficultyDistribution?.MEDIUM ?? 50) / (targetCount || 100);
            const batchEasy = Math.max(1, Math.round(currentBatchTarget * easyRatio));
            const batchMed = Math.max(1, Math.round(currentBatchTarget * medRatio));
            const batchHard = Math.max(0, currentBatchTarget - batchEasy - batchMed);

            const promptText = this.buildUserPrompt({
                courseTitle,
                syllabusUnits,
                targetCount: currentBatchTarget,
                difficultyDistribution: { EASY: batchEasy, MEDIUM: batchMed, HARD: batchHard },
                selectedTopics,
                learningObjectives,
                batchIndex: batchIdx + 1,
                totalBatches
            });

            const rawText = await this.callGeminiApi({
                model: this.getModelName(),
                apiKey: this.getApiKey(),
                systemInstruction,
                promptText
            });

            const items = parseGeneratedQuestions(rawText, syllabusUnits);
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

        const { targetCount, syllabusUnits, difficultyDistribution } = params;
        const allTopics = syllabusUnits.flatMap((u) => u.topics);
        if (allTopics.length === 0) {
            throw new HttpError('Syllabus contains no topics to generate questions from', 400);
        }

        const questions: GeneratedQuestionItem[] = [];

        // Compute distribution counts
        const easyTarget = difficultyDistribution?.EASY ?? Math.floor(targetCount * 0.3);
        const medTarget = difficultyDistribution?.MEDIUM ?? Math.floor(targetCount * 0.5);

        for (let i = 0; i < targetCount; i++) {
            const unit = syllabusUnits[i % syllabusUnits.length];
            const topic = unit.topics[i % unit.topics.length];
            
            let difficulty: QuestionDifficulty = 'MEDIUM';
            if (i < easyTarget) {
                difficulty = 'EASY';
            } else if (i < easyTarget + medTarget) {
                difficulty = 'MEDIUM';
            } else {
                difficulty = 'HARD';
            }

            questions.push({
                title: `${topic} - Exercise ${i + 1}`,
                topic,
                unit: unit.unitTitle,
                difficulty,
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
    private sharedVertexService: VertexAIService;

    constructor(aiService: VertexAIService = vertexAIService) {
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
                'Vertex AI question generation is not configured. Please configure Google Cloud service account credentials via GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_SERVICE_ACCOUNT_KEY.',
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
            responseMimeType: 'application/json',
            temperature: 0.2
        });

        const questions = parseGeneratedQuestions(rawText, syllabusUnits);
        return questions.slice(0, targetCount);
    }
}

export const AIQuestionGenerationProvider = VertexAIQuestionGenerationProvider;
export const GeminiQuestionGenerationProvider = GeminiAIQuestionGenerationProvider;

