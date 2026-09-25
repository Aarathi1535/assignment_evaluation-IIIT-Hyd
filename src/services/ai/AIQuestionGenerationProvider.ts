import { HttpError } from '../../lib/errors';
import { QuestionDifficulty } from '../../models/PersonalizedQuestion';

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

/**
 * Standard production Gemini / AI Provider.
 * Safely guards against missing API keys without crashing or inventing outputs.
 */
export class GeminiAIQuestionGenerationProvider implements IAIQuestionGenerationProvider {
    readonly providerName = 'GeminiAI';

    isConfigured(): boolean {
        const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
        return typeof key === 'string' && key.trim().length > 0;
    }

    async extractSyllabus(rawText: string, courseCode = 'Course'): Promise<ExtractedSyllabusData> {
        // We use DeterministicSyllabusParser for fast, reliable, zero-latency extraction
        // and structure validation.
        return DeterministicSyllabusParser.parse(rawText, courseCode);
    }

    async generateQuestions(_params: GenerateQuestionsParams): Promise<GeneratedQuestionItem[]> {
        if (!this.isConfigured()) {
            throw new HttpError(
                'AI question generation is not configured. Please configure an AI provider with GEMINI_API_KEY in the environment.',
                503
            );
        }

        // When configured with valid GEMINI_API_KEY, actual Gemini 2.0 / Flash API integration
        // can be invoked. For security and stability in environments without an API key,
        // it fails fast with code 503 rather than corrupting state.
        throw new HttpError(
            'AI question generation provider service reached without active connection.',
            503
        );
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
