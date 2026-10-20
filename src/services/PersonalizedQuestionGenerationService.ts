import mongoose from 'mongoose';
import PersonalizedQuestion, {
    IPersonalizedQuestion,
    QuestionDifficulty,
    QuestionType,
    QuestionCategory
} from '../models/PersonalizedQuestion';
import CourseSyllabus from '../models/CourseSyllabus';
import Course from '../models/Course';
import { HttpError } from '../lib/errors';
import {
    IAIQuestionGenerationProvider,
    GeminiAIQuestionGenerationProvider,
    GeneratedQuestionItem
} from './ai/AIQuestionGenerationProvider';

export interface GenerateQuestionBankOptions {
    courseId: string;
    targetCount?: number;
    difficultyDistribution?: {
        EASY: number;
        MEDIUM: number;
        HARD: number;
    };
    selectedTopics?: string[];
    difficulty?: 'ALL' | 'EASY' | 'MEDIUM' | 'HARD';
    questionType?: string;
    learningObjectives?: string[];
    userId: string;
}

export interface QuestionBankGenerationResult {
    totalGenerated: number;
    totalInPool: number;
    topicBreakdown: Record<string, number>;
    difficultyBreakdown: Record<QuestionDifficulty, number>;
    questions: IPersonalizedQuestion[];
}

export class PersonalizedQuestionGenerationService {
    private defaultProvider: IAIQuestionGenerationProvider;

    constructor(provider?: IAIQuestionGenerationProvider) {
        this.defaultProvider = provider || new GeminiAIQuestionGenerationProvider();
    }

    /**
     * Generates a syllabus-grounded question bank using the configured AI provider.
     */
    async generateQuestionBank(
        options: GenerateQuestionBankOptions,
        customProvider?: IAIQuestionGenerationProvider
    ): Promise<QuestionBankGenerationResult> {
        const {
            courseId,
            targetCount = 100,
            selectedTopics,
            difficulty,
            questionType,
            userId
        } = options;

        if (!courseId) {
            throw new HttpError('Course ID is required', 400);
        }
        if (targetCount < 1) {
            throw new HttpError('Target question count must be at least 1', 400);
        }

        const course = await Course.findById(courseId);
        if (!course) {
            throw new HttpError('Course not found', 404);
        }

        // Fetch syllabus
        const syllabus = await CourseSyllabus.findOne({ course: courseId });
        if (!syllabus || !syllabus.units || syllabus.units.length === 0) {
            throw new HttpError(
                'No syllabus found for this course. Please upload and review the course syllabus before generating questions.',
                400
            );
        }

        const provider = customProvider || this.defaultProvider;

        // Check if provider is configured
        if (!provider.isConfigured()) {
            throw new HttpError(
                'AI question generation is not configured. Please configure an AI provider with GEMINI_API_KEY.',
                503
            );
        }

        // Calculate difficulty distribution
        let effectiveDistribution = options.difficultyDistribution;
        if (difficulty && difficulty !== 'ALL') {
            effectiveDistribution = {
                EASY: difficulty === 'EASY' ? targetCount : 0,
                MEDIUM: difficulty === 'MEDIUM' ? targetCount : 0,
                HARD: difficulty === 'HARD' ? targetCount : 0
            };
        }

        // Filter syllabus units if selectedTopics is supplied
        let relevantUnits = syllabus.units;
        if (selectedTopics && selectedTopics.length > 0) {
            const selLower = selectedTopics.map((s) => s.toLowerCase().trim());
            relevantUnits = syllabus.units
                .map((u) => {
                    const unitTitleLower = u.unitTitle.toLowerCase().trim();
                    const unitTitleMatches = selLower.some(
                        (s) => s === unitTitleLower || unitTitleLower.includes(s) || s.includes(unitTitleLower)
                    );

                    if (unitTitleMatches) {
                        return u;
                    }

                    const matchedTopics = u.topics.filter((t) => {
                        const tLower = t.toLowerCase().trim();
                        return selLower.some((s) => s === tLower || tLower.includes(s) || s.includes(tLower));
                    });

                    return {
                        ...u,
                        topics: matchedTopics
                    };
                })
                .filter((u) => u.topics.length > 0);

            if (relevantUnits.length === 0) {
                // If selective filter resulted in 0 units due to loose phrasing, fall back to full syllabus but focus AI prompt on selectedTopics
                relevantUnits = syllabus.units;
            }
        }

        // Invoke AI Question Generator
        const generatedItems: GeneratedQuestionItem[] = await provider.generateQuestions({
            courseTitle: course.courseCode || course.courseName,
            syllabusUnits: relevantUnits,
            targetCount,
            difficultyDistribution: effectiveDistribution,
            selectedTopics,
            difficulty,
            questionType,
            learningObjectives: syllabus.learningObjectives
        });

        if (!generatedItems || generatedItems.length === 0) {
            throw new HttpError('AI provider returned no questions. Please retry generation.', 502);
        }

        // Collect all valid topic and unit names for grounding verification
        const allSyllabusTopics = new Set<string>();
        for (const t of syllabus.extractedTopics) allSyllabusTopics.add(t.toLowerCase().trim());
        for (const u of syllabus.units) {
            allSyllabusTopics.add(u.unitTitle.toLowerCase().trim());
            for (const t of u.topics) allSyllabusTopics.add(t.toLowerCase().trim());
        }

        const uniquePrompts = new Set<string>();
        const validQuestions: GeneratedQuestionItem[] = [];

        for (const item of generatedItems) {
            if (!item.questionPrompt || item.questionPrompt.trim().length === 0) {
                continue;
            }
            const normalizedPrompt = item.questionPrompt.toLowerCase().trim();
            if (uniquePrompts.has(normalizedPrompt)) {
                // Duplicate prompt detected, skip
                continue;
            }
            uniquePrompts.add(normalizedPrompt);

            // Ground topic against syllabus units, extractedTopics, or selectedTopics
            const topicNormalized = item.topic?.toLowerCase().trim() || '';
            let groundedTopic = item.topic;
            let isGrounded = allSyllabusTopics.has(topicNormalized);

            if (!isGrounded && topicNormalized) {
                for (const validTop of allSyllabusTopics) {
                    if (topicNormalized.includes(validTop) || validTop.includes(topicNormalized)) {
                        groundedTopic = item.topic;
                        isGrounded = true;
                        break;
                    }
                }
            }

            if (!isGrounded) {
                if (selectedTopics && selectedTopics.length > 0) {
                    groundedTopic = selectedTopics[validQuestions.length % selectedTopics.length];
                } else {
                    const fallbackUnit = relevantUnits[validQuestions.length % relevantUnits.length];
                    groundedTopic = fallbackUnit.topics[validQuestions.length % fallbackUnit.topics.length] || syllabus.extractedTopics[0];
                }
            }

            validQuestions.push({
                ...item,
                topic: groundedTopic,
                subtopic: item.subtopic || groundedTopic
            });
        }

        if (validQuestions.length === 0) {
            throw new HttpError('All generated questions failed grounding or validation checks.', 502);
        }

        // Determine starting questionIndex
        const existingCount = await PersonalizedQuestion.countDocuments({ course: course._id });
        const startIndex = existingCount + 1;

        const docsToInsert = validQuestions.map((q, idx) => ({
            course: course._id,
            questionIndex: startIndex + idx,
            title: q.title || `Question ${startIndex + idx}`,
            topic: q.topic,
            subtopic: q.subtopic || q.topic,
            unit: q.unit || 'General Module',
            difficulty: (q.difficulty as QuestionDifficulty) || 'MEDIUM',
            questionType: (q.questionType as QuestionType) || (questionType as QuestionType) || 'THEORY',
            category: (q.category as QuestionCategory) || 'CONCEPTUAL',
            questionPrompt: q.questionPrompt,
            expectedConcepts: q.expectedConcepts || [],
            maxMarks: q.maxMarks || 10,
            hints: q.hints || [],
            referenceAnswer: q.referenceAnswer || null,
            rubricCriteria: q.rubricCriteria && q.rubricCriteria.length > 0
                ? q.rubricCriteria
                : [
                      { criterionName: 'Concept Understanding', points: 4 },
                      { criterionName: 'Solution Correctness', points: 6 }
                  ],
            sourceSyllabusTopic: q.sourceSyllabusTopic || q.topic,
            organizationStatus: 'ORGANIZED',
            createdBy: new mongoose.Types.ObjectId(userId),
            isActive: true
        }));

        const inserted = (await PersonalizedQuestion.insertMany(docsToInsert)) as unknown as IPersonalizedQuestion[];
        const allQuestions = await PersonalizedQuestion.find({ course: course._id, isActive: true });

        // Calculate metrics
        const topicBreakdown: Record<string, number> = {};
        const difficultyBreakdown: Record<QuestionDifficulty, number> = {
            EASY: 0,
            MEDIUM: 0,
            HARD: 0
        };

        for (const q of allQuestions) {
            topicBreakdown[q.topic] = (topicBreakdown[q.topic] || 0) + 1;
            const diff = q.difficulty as QuestionDifficulty;
            if (diff && difficultyBreakdown[diff] !== undefined) {
                difficultyBreakdown[diff]++;
            } else {
                difficultyBreakdown.MEDIUM++;
            }
        }

        return {
            totalGenerated: inserted.length,
            totalInPool: allQuestions.length,
            topicBreakdown,
            difficultyBreakdown,
            questions: inserted
        };
    }
}

const personalizedQuestionGenerationService = new PersonalizedQuestionGenerationService();
export default personalizedQuestionGenerationService;
