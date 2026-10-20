/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import { UserRole } from '../constants/permissions';

const mockSessionUser: any = {
    id: new mongoose.Types.ObjectId().toString(),
    role: UserRole.PROFESSOR,
    name: 'Test Professor',
    email: 'professor@example.com'
};

vi.mock('next-auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('next-auth')>();
    return {
        ...original,
        getServerSession: vi.fn().mockImplementation(() => {
            if (!mockSessionUser) return Promise.resolve(null);
            return Promise.resolve({ user: mockSessionUser });
        }),
    };
});
import { GeminiAIService, geminiAIService } from '../services/ai/GeminiAIService';
import {
    GeminiAIQuestionGenerationProvider,
    parseGeneratedQuestions,
    MockAIQuestionGenerationProvider,
    ExtractedSyllabusUnit
} from '../services/ai/AIQuestionGenerationProvider';
import { PersonalizedQuestionGenerationService } from '../services/PersonalizedQuestionGenerationService';
import CourseSyllabus from '../models/CourseSyllabus';
import Course from '../models/Course';
import User from '../models/User';
import PersonalizedQuestion from '../models/PersonalizedQuestion';
import { GET as getTaxonomyRoute } from '../app/api/personalized/taxonomy/route';
import { HttpError } from '../lib/errors';

describe('Personalized Assessment End-to-End Suite & Fixes', () => {
    const origEnv = { ...process.env };
    const sampleUnits: ExtractedSyllabusUnit[] = [
        {
            unitNumber: 1,
            unitTitle: 'Unit 1: Foundations & Asymptotics',
            topics: ['Big-O Notation', 'Master Theorem', 'Divide and Conquer']
        },
        {
            unitNumber: 2,
            unitTitle: 'Unit 2: Dynamic Programming',
            topics: ['Optimal Substructure', '0/1 Knapsack', 'Matrix Chain Multiplication']
        }
    ];

    beforeEach(async () => {
        process.env = { ...origEnv };
        process.env.FEATURE_PERSONALIZED_ASSESSMENT = 'true';
        process.env.NEXT_PUBLIC_FEATURE_PERSONALIZED_ASSESSMENT = 'true';
        geminiAIService.setCustomCaller(null);
        geminiAIService.setClient(null);

        await PersonalizedQuestion.deleteMany({});
        await CourseSyllabus.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});
    });

    afterEach(async () => {
        process.env = { ...origEnv };
        geminiAIService.setCustomCaller(null);
        geminiAIService.setClient(null);
        vi.restoreAllMocks();
    });

    // =========================================================================
    // 1. GEMINI MODEL CONFIGURATION & RESOLUTION
    // =========================================================================
    describe('1. Supported Gemini Model Configuration & Secret Handling', () => {
        it('resolves model dynamically defaulting to currently supported gemini-2.5-flash', () => {
            delete process.env.GEMINI_PERSONALIZED_MODEL;
            delete process.env.GEMINI_CLASSROOM_MODEL;
            delete process.env.GEMINI_MODEL;
            delete process.env.AI_MODEL;

            const service = new GeminiAIService();
            expect(service.getModelName()).toBe('gemini-2.5-flash');

            const provider = new GeminiAIQuestionGenerationProvider(service);
            expect(provider.getModelName()).toBe('gemini-2.5-flash');
        });

        it('supports GEMINI_PERSONALIZED_MODEL override for personalized assessment', () => {
            process.env.GEMINI_PERSONALIZED_MODEL = 'gemini-2.5-pro';
            const service = new GeminiAIService();
            expect(service.getModelName()).toBe('gemini-2.5-pro');

            const provider = new GeminiAIQuestionGenerationProvider(service);
            expect(provider.getModelName()).toBe('gemini-2.5-pro');
        });

        it('supports GEMINI_CLASSROOM_MODEL fallback when personalized model is unset', () => {
            delete process.env.GEMINI_PERSONALIZED_MODEL;
            process.env.GEMINI_CLASSROOM_MODEL = 'gemini-2.5-flash';

            const service = new GeminiAIService();
            expect(service.getModelName()).toBe('gemini-2.5-flash');
        });

        it('never hardcodes secrets and retrieves keys from env without leaking them', () => {
            process.env['assignment-eval-gemini-api-key'] = 'super-secret-key-xyz';
            const service = new GeminiAIService();
            expect(service.getApiKey()).toBe('super-secret-key-xyz');

            const config = service.getConfig();
            expect(config.secretName).toBe('assignment-eval-gemini-api-key');
            expect(config.isConfigured).toBe(true);
            expect(JSON.stringify(config)).not.toContain('super-secret-key-xyz');
        });
    });

    // =========================================================================
    // 2. PARSER RESILIENCE & SCHEMA VALIDATION REGRESSION TESTS
    // =========================================================================
    describe('2. Resilient AI Output Parsing & Schema Validation', () => {
        it('1. parses valid raw JSON directly conforming to schema', () => {
            const rawOutput = JSON.stringify({
                questions: [
                    {
                        title: 'Master Theorem Analysis',
                        topic: 'Master Theorem',
                        unit: 'Unit 1: Foundations & Asymptotics',
                        difficulty: 'MEDIUM',
                        questionPrompt: 'Apply the Master Theorem to T(n) = 2T(n/2) + O(n).',
                        maxMarks: 10,
                        expectedConcepts: ['Master Theorem', 'Divide and Conquer'],
                        hints: ['Compare log_b(a) with the exponent of f(n).'],
                        referenceAnswer: 'Case 2 applies since log_2(2) = 1. Therefore T(n) is Theta(n log n).'
                    }
                ]
            });

            const parsed = parseGeneratedQuestions(rawOutput, sampleUnits);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].title).toBe('Master Theorem Analysis');
            expect(parsed[0].difficulty).toBe('MEDIUM');
            expect(parsed[0].maxMarks).toBe(10);
        });

        it('2. parses JSON wrapped in Markdown code fences (```json ... ```)', () => {
            const rawOutput = `
\`\`\`json
{
  "questions": [
    {
      "title": "Divide and Conquer Recurrence",
      "topic": "Divide and Conquer",
      "unit": "Unit 1: Foundations & Asymptotics",
      "difficulty": "medium",
      "questionType": "ANALYTICAL",
      "questionPrompt": "Prove the upper bound using Master Theorem.",
      "maxMarks": 10,
      "hints": ["Check case 2."]
    }
  ]
}
\`\`\`
            `;

            const parsed = parseGeneratedQuestions(rawOutput, sampleUnits);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].topic).toBe('Divide and Conquer');
            expect(parsed[0].difficulty).toBe('MEDIUM');
        });

        it('3. extracts JSON when surrounded by extra conversational prose and preambles', () => {
            const rawOutput = `
Certainly! Here is the academic question bank generated from your course syllabus:

{
  "questions": [
    {
      "title": "0/1 Knapsack Recurrence",
      "topic": "0/1 Knapsack",
      "unit": "Unit 2: Dynamic Programming",
      "difficulty": "HARD",
      "questionPrompt": "Formulate the 0/1 Knapsack dynamic programming recurrence and write its transition equation.",
      "maxMarks": 10
    }
  ]
}

Please let me know if you would like me to adjust the difficulty or provide additional rubrics.
            `;

            const parsed = parseGeneratedQuestions(rawOutput, sampleUnits);
            expect(parsed).toHaveLength(1);
            expect(parsed[0].title).toBe('0/1 Knapsack Recurrence');
            expect(parsed[0].difficulty).toBe('HARD');
        });

        it('4. handles the exact "X X ..." malformed response with actionable error and diagnostic logging', () => {
            const malformedOutput = 'X X Unexpected non-json content produced by model without brackets';

            expect(() => parseGeneratedQuestions(malformedOutput, sampleUnits)).toThrowError(HttpError);
            try {
                parseGeneratedQuestions(malformedOutput, sampleUnits);
            } catch (err: any) {
                expect(err.statusCode).toBe(502);
                expect(err.message).toContain('malformed JSON');
                expect(err.message).toContain('X X');
            }
        });

        it('5. handles empty responses and truncated JSON (cut off midway) safely', () => {
            // Empty / whitespace strings
            expect(() => parseGeneratedQuestions('', sampleUnits)).toThrow(
                /Gemini question generation returned an empty response/
            );
            expect(() => parseGeneratedQuestions('   ', sampleUnits)).toThrow(
                /Gemini question generation returned an empty response/
            );

            // Incomplete / truncated JSON ending abruptly
            const truncatedOutput = '{"questions": [{"title": "Cut Off Question", "topic": "Big-O Notation", "difficulty": "EASY"';
            expect(() => parseGeneratedQuestions(truncatedOutput, sampleUnits)).toThrow(
                /truncated or incomplete/
            );
        });

        it('6. rejects responses with missing question fields or invalid schema', () => {
            // Missing questionPrompt and topic
            const invalidJson = JSON.stringify({
                questions: [
                    {
                        title: 'Question without prompt or topic'
                    }
                ]
            });

            expect(() => parseGeneratedQuestions(invalidJson, sampleUnits)).toThrow(
                /failed schema validation/
            );

            // Empty questions array
            expect(() => parseGeneratedQuestions(JSON.stringify({ questions: [] }), sampleUnits)).toThrow(
                /failed schema validation/
            );
        });
    });

    // =========================================================================
    // 3. TAXONOMY GROUNDING & QUESTION GENERATION WITH SELECTIONS
    // =========================================================================
    describe('3. Taxonomy Grounding & Targeted Question Generation', () => {
        it('incorporates selected topics, difficulty, and question type into question bank generation', async () => {
            const professor: any = await User.create({
                name: 'Professor Algorithm',
                email: 'algo_prof@iiit.ac.in',
                password: 'hash',
                role: UserRole.PROFESSOR,
                isActive: true
            });

            const course: any = await Course.create({
                courseCode: 'CS301',
                courseName: 'Algorithms & Complexity',
                semester: 4,
                academicYear: '2026-2027',
                professor: professor._id,
                isActive: true
            });

            await CourseSyllabus.create({
                course: course._id,
                title: 'CS301 Syllabus',
                rawText: 'Unit 1: Foundations\n- Big-O\nUnit 2: Dynamic Programming\n- Knapsack',
                units: sampleUnits,
                extractedTopics: ['Big-O Notation', 'Master Theorem', 'Divide and Conquer', '0/1 Knapsack'],
                learningObjectives: ['Master fundamental asymptotic and optimization techniques'],
                uploadedBy: professor._id
            });

            const mockProvider = new MockAIQuestionGenerationProvider(true);
            const service = new PersonalizedQuestionGenerationService(mockProvider);

            const result = await service.generateQuestionBank({
                courseId: course._id.toString(),
                targetCount: 15,
                selectedTopics: ['0/1 Knapsack'],
                difficulty: 'HARD',
                questionType: 'CODING',
                userId: professor._id.toString()
            });

            expect(result.totalGenerated).toBe(15);
            expect(result.questions).toHaveLength(15);
            expect(result.difficultyBreakdown.HARD).toBe(15);
            expect(result.questions[0].difficulty).toBe('HARD');
            expect(result.questions[0].questionType).toBe('CODING');
            expect(result.questions[0].topic).toBe('0/1 Knapsack');
            expect(result.questions[0].organizationStatus).toBe('ORGANIZED');
        });

        it('retains multiple selected topics across units without falling back to first topic', async () => {
            const professor: any = await User.create({
                name: 'Professor DP',
                email: 'dp_prof@iiit.ac.in',
                password: 'hash',
                role: UserRole.PROFESSOR,
                isActive: true
            });

            const course: any = await Course.create({
                courseCode: 'CS302',
                courseName: 'Advanced DP',
                semester: 5,
                academicYear: '2026-2027',
                professor: professor._id,
                isActive: true
            });

            await CourseSyllabus.create({
                course: course._id,
                title: 'CS302 Syllabus',
                rawText: 'Syllabus content',
                units: sampleUnits,
                extractedTopics: ['Big-O Notation', 'Master Theorem', '0/1 Knapsack', 'Matrix Chain Multiplication'],
                uploadedBy: professor._id
            });

            const mockProvider = new MockAIQuestionGenerationProvider(true);
            const service = new PersonalizedQuestionGenerationService(mockProvider);

            const result = await service.generateQuestionBank({
                courseId: course._id.toString(),
                targetCount: 10,
                selectedTopics: ['Master Theorem', 'Matrix Chain Multiplication'],
                difficulty: 'MEDIUM',
                questionType: 'THEORY',
                userId: professor._id.toString()
            });

            expect(result.totalGenerated).toBe(10);
            const generatedTopics = result.questions.map((q) => q.topic);
            expect(generatedTopics).toContain('Master Theorem');
            expect(generatedTopics).toContain('Matrix Chain Multiplication');
            // Must NOT have all collapsed into syllabus.extractedTopics[0] ('Big-O Notation')
            expect(generatedTopics.filter((t) => t === 'Big-O Notation')).toHaveLength(0);
        });
    });

    // =========================================================================
    // 4. TAXONOMY SUMMARY ENDPOINT & GRAPH AGGREGATION
    // =========================================================================
    describe('4. Taxonomy Graph Summary Route (/api/personalized/taxonomy)', () => {
        it('returns structured TaxonomySummary matching course syllabus and questions', async () => {
            const professor: any = await User.create({
                name: 'Prof Graph',
                email: 'graph_prof@iiit.ac.in',
                password: 'hash',
                role: UserRole.PROFESSOR,
                isActive: true
            });

            const course: any = await Course.create({
                courseCode: 'CS401',
                courseName: 'Algorithms',
                semester: 5,
                academicYear: '2026-2027',
                professor: professor._id,
                isActive: true
            });

            await CourseSyllabus.create({
                course: course._id,
                title: 'CS401 Syllabus',
                rawText: 'Syllabus raw text',
                units: sampleUnits,
                extractedTopics: ['Big-O Notation', 'Master Theorem', 'Divide and Conquer', '0/1 Knapsack'],
                uploadedBy: professor._id
            });

            // Insert questions with taxonomy metadata
            await PersonalizedQuestion.create([
                {
                    course: course._id,
                    questionIndex: 1,
                    title: 'Big-O Proof',
                    topic: 'Big-O Notation',
                    subtopic: 'Big-O Notation',
                    unit: 'Unit 1: Foundations & Asymptotics',
                    difficulty: 'EASY',
                    questionPrompt: 'Prove 3n+2 is O(n).',
                    maxMarks: 10,
                    prerequisites: ['Basic Algebra'],
                    relatedConcepts: ['Asymptotic Growth'],
                    organizationStatus: 'ORGANIZED',
                    createdBy: professor._id,
                    isActive: true
                },
                {
                    course: course._id,
                    questionIndex: 2,
                    title: 'Knapsack DP Formulation',
                    topic: '0/1 Knapsack',
                    subtopic: '0/1 Knapsack',
                    unit: 'Unit 2: Dynamic Programming',
                    difficulty: 'HARD',
                    questionPrompt: 'Derive knapsack recurrence.',
                    maxMarks: 10,
                    prerequisites: ['Memoization'],
                    relatedConcepts: ['Subset Sum'],
                    organizationStatus: 'ORGANIZED',
                    createdBy: professor._id,
                    isActive: true
                }
            ]);

            const req = new NextRequest(`http://localhost:3000/api/personalized/taxonomy?courseId=${course._id}`);
            const res = await getTaxonomyRoute(req);
            expect(res.status).toBe(200);

            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.topics).toHaveLength(2);

            const unit1 = body.data.topics.find((t: { name: string }) => t.name.includes('Foundations'));
            expect(unit1).toBeDefined();
            expect(unit1.totalQuestions).toBe(1);

            const bigOTopic = unit1.subtopics.find((s: { name: string }) => s.name === 'Big-O Notation');
            expect(bigOTopic).toBeDefined();
            expect(bigOTopic.questionCount).toBe(1);
            expect(bigOTopic.difficultyCounts.EASY).toBe(1);
            expect(bigOTopic.prerequisites).toContain('Basic Algebra');

            const unit2 = body.data.topics.find((t: { name: string }) => t.name.includes('Dynamic Programming'));
            expect(unit2.totalQuestions).toBe(1);
            const knapsackTopic = unit2.subtopics.find((s: { name: string }) => s.name === '0/1 Knapsack');
            expect(knapsackTopic.difficultyCounts.HARD).toBe(1);
            expect(knapsackTopic.relatedConcepts).toContain('Subset Sum');
        });

        it('returns 400 when courseId is missing or invalid format', async () => {
            const reqMissing = new NextRequest('http://localhost:3000/api/personalized/taxonomy');
            const resMissing = await getTaxonomyRoute(reqMissing);
            expect(resMissing.status).toBe(400);

            const reqInvalid = new NextRequest('http://localhost:3000/api/personalized/taxonomy?courseId=invalid-id');
            const resInvalid = await getTaxonomyRoute(reqInvalid);
            expect(resInvalid.status).toBe(400);
        });
    });

    // =========================================================================
    // 5. TRANSIENT VS PERMANENT ERROR HANDLING & NO PERMANENT RETRIES
    // =========================================================================
    describe('5. Error Handling & Non-Retried Permanent Failures', () => {
        it('throws immediately without retrying for permanent 400 or 503 config errors', async () => {
            const service = new GeminiAIService();
            let attempts = 0;

            service.setCustomCaller(async () => {
                attempts++;
                throw new HttpError('AI question generation is not configured', 503);
            });

            await expect(
                service.generateContent({
                    promptText: 'Test prompt'
                })
            ).rejects.toThrow('AI question generation is not configured');

            expect(attempts).toBe(1); // Permanent error was NOT retried
        });

        it('retries transient 429 errors and succeeds when transient issue resolves', async () => {
            const service = new GeminiAIService();
            let attempts = 0;

            const mockGenerateContent = vi.fn().mockImplementation(async () => {
                attempts++;
                if (attempts === 1) {
                    throw new Error('429 Resource Exhausted / Rate limit');
                }
                return {
                    text: JSON.stringify({ success: true, answer: 'Resolved after transient retry' })
                };
            });

            service.setClient({
                models: {
                    generateContent: mockGenerateContent
                }
            } as any);

            process.env['assignment-eval-gemini-api-key'] = 'mock-key';

            const result = await service.generateContent({
                promptText: 'Test transient retry'
            });

            expect(attempts).toBe(2);
            expect(result).toContain('Resolved after transient retry');
        });

        it('performs controlled single regeneration when Gemini returns malformed output on first attempt', async () => {
            const service = new GeminiAIService();
            let callCount = 0;

            service.setCustomCaller(async ({ systemInstruction }) => {
                callCount++;
                if (callCount === 1) {
                    // First call returns malformed non-JSON
                    return 'X X malformed raw text';
                }
                // Second call (regeneration with recovery instructions) returns valid JSON
                expect(systemInstruction).toContain('CRITICAL RECOVERY INSTRUCTION');
                return JSON.stringify({
                    questions: [
                        {
                            title: 'Binary Search Verification',
                            topic: 'Divide and Conquer',
                            unit: 'Unit 1: Foundations & Asymptotics',
                            difficulty: 'EASY',
                            questionPrompt: 'Show mid index calculation in binary search.',
                            maxMarks: 10
                        }
                    ]
                });
            });

            const provider = new GeminiAIQuestionGenerationProvider(service);
            const questions = await provider.generateQuestions({
                courseTitle: 'Algorithms',
                syllabusUnits: sampleUnits,
                targetCount: 1,
                difficulty: 'EASY'
            });

            expect(callCount).toBe(2); // Exactly 1 initial + 1 regeneration attempt
            expect(questions).toHaveLength(1);
            expect(questions[0].title).toBe('Binary Search Verification');
        });

        it('enforces bounded retries and fails cleanly if regeneration also returns malformed output', async () => {
            const service = new GeminiAIService();
            let callCount = 0;

            service.setCustomCaller(async () => {
                callCount++;
                return 'X X persistent malformed text';
            });

            const provider = new GeminiAIQuestionGenerationProvider(service);

            await expect(
                provider.generateQuestions({
                    courseTitle: 'Algorithms',
                    syllabusUnits: sampleUnits,
                    targetCount: 1,
                    difficulty: 'EASY'
                })
            ).rejects.toThrow(/malformed JSON/);

            expect(callCount).toBe(2); // Exactly 2 calls (1 initial + 1 regeneration), no infinite retry
        });
    });
});
