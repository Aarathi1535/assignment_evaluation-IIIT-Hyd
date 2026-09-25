import mongoose from 'mongoose';
import PersonalizedQuestion, {
    IPersonalizedQuestion,
    QuestionDifficulty
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
        const { courseId, targetCount = 100, difficultyDistribution, selectedTopics, userId } = options;

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

        // Filter syllabus units if selectedTopics is supplied
        const relevantUnits = selectedTopics && selectedTopics.length > 0
            ? syllabus.units
                  .map((u) => ({
                      ...u,
                      topics: u.topics.filter((t) => selectedTopics.includes(t))
                  }))
                  .filter((u) => u.topics.length > 0)
            : syllabus.units;

        if (relevantUnits.length === 0) {
            throw new HttpError('Selected topics do not match any units in the syllabus', 400);
        }

        // Invoke AI Question Generator
        const generatedItems: GeneratedQuestionItem[] = await provider.generateQuestions({
            courseTitle: course.courseCode || course.courseName,
            syllabusUnits: relevantUnits,
            targetCount,
            difficultyDistribution,
            selectedTopics,
            learningObjectives: syllabus.learningObjectives
        });

        if (!generatedItems || generatedItems.length === 0) {
            throw new HttpError('AI provider returned no questions. Please retry generation.', 502);
        }

        // Validate groundedness and remove duplicates
        const syllabusTopicSet = new Set(syllabus.extractedTopics.map((t) => t.toLowerCase()));
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

            // Verify topic is grounded in syllabus (fallback to first syllabus topic if loosely matched)
            const topicNormalized = item.topic?.toLowerCase().trim();
            const isGrounded = topicNormalized && syllabusTopicSet.has(topicNormalized);
            const groundedTopic = isGrounded ? item.topic : syllabus.extractedTopics[0];

            validQuestions.push({
                ...item,
                topic: groundedTopic
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
            unit: q.unit || 'General Module',
            difficulty: q.difficulty || 'MEDIUM',
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
            difficultyBreakdown[q.difficulty] = (difficultyBreakdown[q.difficulty] || 0) + 1;
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
