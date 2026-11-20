import { describe, it, expect, beforeEach, vi, beforeAll, afterAll } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import mongoose from 'mongoose';
import User, { IUser } from '../models/User';
import Course, { ICourse } from '../models/Course';
import PersonalizedQuestion, { IPersonalizedQuestion } from '../models/PersonalizedQuestion';
import questionOrganizerService from '../services/QuestionOrganizerService';
import { GeminiAIService } from '../services/ai/GeminiAIService';
import { UserRole } from '../constants/permissions';
import { ProfessorTaxonomyInspector } from '../components/personalized/ProfessorTaxonomyInspector';

describe('Question Bank Workflows & AI Organization Suite', () => {
    let testProfessor: IUser;
    let testCourse: ICourse;
    const originalFeatureFlag = process.env.FEATURE_PERSONALIZED_ASSESSMENT;

    beforeAll(() => {
        process.env.FEATURE_PERSONALIZED_ASSESSMENT = 'true';
        process.env.NEXT_PUBLIC_FEATURE_PERSONALIZED_ASSESSMENT = 'true';
    });

    afterAll(() => {
        if (originalFeatureFlag !== undefined) {
            process.env.FEATURE_PERSONALIZED_ASSESSMENT = originalFeatureFlag;
        } else {
            delete process.env.FEATURE_PERSONALIZED_ASSESSMENT;
        }
    });

    beforeEach(async () => {
        vi.restoreAllMocks();
        await PersonalizedQuestion.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});

        testProfessor = await User.create({
            name: 'Prof. Machine Learning',
            email: 'ml_prof@iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        testCourse = await Course.create({
            courseCode: 'CS7000',
            courseName: 'Advanced Machine Learning & System Design',
            semester: 6,
            academicYear: '2026-2027',
            professor: testProfessor._id,
            teachingAssistants: [],
            isActive: true
        });
    });

    // =========================================================================
    // SECTION 1: UI & WORKFLOW SEPARATION TESTS
    // =========================================================================
    describe('1. UI & Workflow Separation in ProfessorTaxonomyInspector', () => {
        it('renders Workflow A ("Generate Questions via AI") and Workflow B ("Upload Question Bank") distinctly', () => {
            const html = renderToStaticMarkup(
                <ProfessorTaxonomyInspector
                    courseId={testCourse._id.toString()}
                    initialQuestions={[]}
                    onOpenGenerateModal={() => {}}
                />
            );

            // Workflow A verification
            expect(html).toContain('Generate Questions via AI');
            expect(html).toContain('Generate new syllabus-grounded questions');

            // Workflow B verification
            expect(html).toContain('Upload Question Bank');
            expect(html).toContain('Upload a CSV or JSON containing raw professor questions');

            // Primary upload button styling & text
            expect(html).toContain('Upload Question Bank');
            expect(html).not.toContain('Bulk Add Questions');
        });

        it('displays "Organize with AI" action when PENDING questions exist', () => {
            const mockQuestions = [
                {
                    _id: new mongoose.Types.ObjectId().toString(),
                    course: testCourse._id.toString(),
                    title: 'Data Leakage in Grouped K-Fold',
                    prompt: 'Explain why standard random K-Fold CV creates data leakage in patient recordings.',
                    topic: 'Machine Learning',
                    difficulty: 'MEDIUM',
                    organizationStatus: 'PENDING',
                    questionType: 'CONCEPTUAL'
                } as unknown as IPersonalizedQuestion
            ];

            const html = renderToStaticMarkup(
                <ProfessorTaxonomyInspector
                    courseId={testCourse._id.toString()}
                    initialQuestions={mockQuestions as unknown as import('../components/personalized/ProfessorTaxonomyInspector').TaxonomyQuestion[]}
                />
            );

            expect(html).toContain('Organize with AI (1)');
            expect(html).toContain('Pending AI Review');
            expect(html).toContain('Needs Organization');
        });
    });

    // =========================================================================
    // SECTION 2: AI CATEGORIZATION & DIFFICULTY CALIBRATION
    // =========================================================================
    describe('2. AI Organization & Difficulty Calibration', () => {
        it('calibrates difficulty: differentiates EASY, MEDIUM, and HARD questions instead of defaulting to MEDIUM', async () => {
            // Mock Gemini to trigger the calibrated heuristic fallback (simulates quota exhausted or offline mode)
            vi.spyOn(GeminiAIService.getInstance(), 'generateContent').mockRejectedValue(
                new Error('Quota exceeded / Fallback mode')
            );

            // 1. Easy question: Simple definition / recall
            const easyQuestion = await PersonalizedQuestion.create({
                course: testCourse._id,
                questionIndex: 1,
                title: 'What is Accuracy in Binary Classification?',
                questionPrompt: 'State the formal definition of classification accuracy and recall the ratio formula.',
                topic: 'Machine Learning',
                difficulty: 'MEDIUM', // Raw CSV defaulted to MEDIUM
                organizationStatus: 'PENDING',
                createdBy: testProfessor._id
            });

            // 2. Hard question: Complex ML System Design & Data Leakage
            const hardLeakageQuestion = await PersonalizedQuestion.create({
                course: testCourse._id,
                questionIndex: 2,
                title: 'Data Leakage in Time-Series Financial Modeling',
                questionPrompt: 'Debug an end-to-end financial forecasting pipeline where future feature scaling leaked into historical folds. Design a walk-forward cross-validation solution and analyze lookahead bias tradeoffs.',
                topic: 'General ML',
                difficulty: 'MEDIUM', // Raw CSV defaulted to MEDIUM
                organizationStatus: 'PENDING',
                createdBy: testProfessor._id
            });

            // 3. Hard question: Dying ReLU debugging & non-convex dynamics
            const hardReluQuestion = await PersonalizedQuestion.create({
                course: testCourse._id,
                questionIndex: 3,
                title: 'Dead ReLU Neurons in Deep Architectures',
                questionPrompt: 'Debug a 20-layer MLP suffering from dead ReLU collapse where 70% of hidden units output zero. Prove mathematically why zero gradients permanently disable updates and propose He initialization or Leaky ReLU alternatives.',
                topic: 'Neural Networks',
                difficulty: 'MEDIUM', // Raw CSV defaulted to MEDIUM
                organizationStatus: 'PENDING',
                createdBy: testProfessor._id
            });

            // 4. Hard question: Clinical rare disease ML system design with extreme class imbalance
            const hardSystemDesignQuestion = await PersonalizedQuestion.create({
                course: testCourse._id,
                questionIndex: 4,
                title: 'Clinical ML Rare Disease Early Detection System Design',
                questionPrompt: 'Design an end-to-end clinical machine learning system for screening rare autoimmune diseases (prevalence 0.05%). Optimize asymmetric false negative costs, calibrate focal loss vs threshold tuning, address electronic health record concept drift, and specify production monitoring architecture.',
                topic: 'AI Systems',
                difficulty: 'MEDIUM', // Raw CSV defaulted to MEDIUM
                organizationStatus: 'PENDING',
                createdBy: testProfessor._id
            });

            // Organize each question
            const organizedEasy = await questionOrganizerService.organizeQuestion(easyQuestion._id);
            const organizedLeakage = await questionOrganizerService.organizeQuestion(hardLeakageQuestion._id);
            const organizedRelu = await questionOrganizerService.organizeQuestion(hardReluQuestion._id);
            const organizedDesign = await questionOrganizerService.organizeQuestion(hardSystemDesignQuestion._id);

            // Verify Easy question difficulty was inferred as EASY
            expect(organizedEasy.difficulty).toBe('EASY');
            expect(organizedEasy.organizationStatus).toBe('ORGANIZED');
            expect(organizedEasy.skills!.length).toBeGreaterThan(0);

            // Verify Challenging questions were inferred as HARD
            expect(organizedLeakage.difficulty).toBe('HARD');
            expect(organizedLeakage.organizationStatus).toBe('ORGANIZED');
            expect(organizedLeakage.subtopic).toBe('Data Leakage & Cross-Validation Strategy');

            expect(organizedRelu.difficulty).toBe('HARD');
            expect(organizedRelu.organizationStatus).toBe('ORGANIZED');
            expect(organizedRelu.subtopic).toBe('Dying ReLU Problem & Gradient Flow');

            expect(organizedDesign.difficulty).toBe('HARD');
            expect(organizedDesign.organizationStatus).toBe('ORGANIZED');
            expect(organizedDesign.subtopic).toBe('Clinical ML System Design & Imbalanced Learning');

            // Verify database persistence
            const persistedLeakage = await PersonalizedQuestion.findById(hardLeakageQuestion._id);
            expect(persistedLeakage!.difficulty).toBe('HARD');
            expect(persistedLeakage!.organizationStatus).toBe('ORGANIZED');
            expect(persistedLeakage!.subtopic).toBe('Data Leakage & Cross-Validation Strategy');
            expect(persistedLeakage!.combinesConcepts).toContain('Model Evaluation');
        });

        it('infers accurate specialized topic and subtopic instead of naive substring collisions', async () => {
            vi.spyOn(GeminiAIService.getInstance(), 'generateContent').mockRejectedValue(
                new Error('Quota exceeded / Fallback mode')
            );

            // Question mentions "pipeline" and "demographics" which previously caused naive collisions with "cache pipeline" and "graph algorithms"
            const mlPipelineQuestion = await PersonalizedQuestion.create({
                course: testCourse._id,
                questionIndex: 5,
                title: 'Customer Churn Preprocessing Leakage',
                questionPrompt: 'Critique a machine learning pipeline where target encoding was computed across user demographic cohorts before train-test split, leading to overly optimistic cross-validation AUC.',
                topic: 'Uncategorized',
                difficulty: 'MEDIUM',
                organizationStatus: 'PENDING',
                createdBy: testProfessor._id
            });

            const organized = await questionOrganizerService.organizeQuestion(mlPipelineQuestion._id);

            // Must NOT be classified as "Graph Algorithms" or "Computer Architecture"
            expect(organized.topic).not.toBe('Graph Algorithms');
            expect(organized.topic).not.toBe('Computer Systems & Architecture');
            expect(organized.topic).toBe('Machine Learning');
            expect(organized.subtopic).toBe('Data Leakage & Cross-Validation Strategy');
            expect(organized.difficulty).toBe('HARD');
        });
    });

    // =========================================================================
    // SECTION 3: FAILED ORGANIZATION & PARTIAL BATCH HANDLING
    // =========================================================================
    describe('3. Organization Status Lifecycle & Failure Handling', () => {
        it('marks question as FAILED when database update or organizer encounters an unrecoverable failure', async () => {
            const question = await PersonalizedQuestion.create({
                course: testCourse._id,
                questionIndex: 6,
                title: 'Failing Question',
                questionPrompt: 'Test prompt for unrecoverable failure.',
                topic: 'Machine Learning',
                difficulty: 'MEDIUM',
                organizationStatus: 'PENDING',
                createdBy: testProfessor._id
            });

            // Mock organizeQuestion to throw an error for this question
            vi.spyOn(questionOrganizerService, 'organizeQuestion').mockRejectedValueOnce(
                new Error('Simulated write conflict / disk failure')
            );

            const result = await questionOrganizerService.organizeCourseQuestions(testCourse._id);

            expect(result.totalProcessed).toBe(1);
            expect(result.organizedCount).toBe(0);
            expect(result.failures).toHaveLength(1);
            expect(result.failures[0].questionId).toBe(question._id.toString());
            expect(result.failures[0].error).toContain('Simulated write conflict');

            // Verify question was marked as FAILED in MongoDB
            const failedDoc = await PersonalizedQuestion.findById(question._id);
            expect(failedDoc!.organizationStatus).toBe('FAILED');
        });

        it('supports organizing a specific subset of questionIds', async () => {
            const q1 = await PersonalizedQuestion.create({
                course: testCourse._id,
                questionIndex: 7,
                title: 'Question 1',
                questionPrompt: 'State the definition of eigenvalues and eigenvectors.',
                topic: 'Linear Algebra',
                difficulty: 'EASY',
                organizationStatus: 'PENDING',
                createdBy: testProfessor._id
            });

            const q2 = await PersonalizedQuestion.create({
                course: testCourse._id,
                questionIndex: 8,
                title: 'Question 2',
                questionPrompt: 'Prove that the product of orthogonal matrices is orthogonal.',
                topic: 'Linear Algebra',
                difficulty: 'MEDIUM',
                organizationStatus: 'PENDING',
                createdBy: testProfessor._id
            });

            // Organize only q1
            const result = await questionOrganizerService.organizeCourseQuestions(
                testCourse._id,
                { questionIds: [q1._id.toString()] }
            );

            expect(result.totalProcessed).toBe(1);
            expect(result.organizedCount).toBe(1);

            const doc1 = await PersonalizedQuestion.findById(q1._id);
            const doc2 = await PersonalizedQuestion.findById(q2._id);

            expect(doc1!.organizationStatus).toBe('ORGANIZED');
            expect(doc2!.organizationStatus).toBe('PENDING'); // untouched
        });
    });
});
