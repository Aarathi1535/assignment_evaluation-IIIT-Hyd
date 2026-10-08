import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import User, { IUser } from '../models/User';
import Course, { ICourse } from '../models/Course';
import PersonalizedQuestion from '../models/PersonalizedQuestion';
import { bulkQuestionImportService } from '../services/BulkQuestionImportService';
import questionOrganizerService from '../services/QuestionOrganizerService';
import { GeminiAIService } from '../services/ai/GeminiAIService';
import { POST as organizeRoute } from '../app/api/personalized/questions/organize/route';
import { UserRole } from '../constants/permissions';

let mockSessionUser: { id: string; role: string } | null = null;

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

describe('Question Organizer Flow & Error Handling', () => {
    let testProfessor: IUser;
    let otherProfessor: IUser;
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
            name: 'Prof. C. V. Jawahar',
            email: 'jawahar@iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        otherProfessor = await User.create({
            name: 'Prof. Other',
            email: 'other@iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        testCourse = await Course.create({
            courseCode: 'CS3000',
            courseName: 'Operating Systems & Concurrency',
            semester: 5,
            academicYear: '2026-2027',
            professor: testProfessor._id,
            teachingAssistants: [],
            isActive: true
        });

        mockSessionUser = {
            id: testProfessor._id.toString(),
            role: 'PROFESSOR'
        };
    });

    // =========================================================================
    // 1. PENDING question -> organize -> metadata persisted
    // =========================================================================
    it('organizes a raw PENDING question and persists all AI-generated metadata', async () => {
        const rawJson = JSON.stringify([
            {
                title: 'LRU Page Replacement Algorithm',
                prompt: 'Explain the Least Recently Used (LRU) page replacement policy and compare its performance to FIFO under thrashing conditions.',
                topic: 'Virtual Memory',
                difficulty: 'MEDIUM',
                options: ['Tracks page access time or stack', 'Randomly evicts frames', 'Always evicts first frame', 'Uses CPU registers only'],
                correctAnswer: 0
            }
        ]);

        const parsed = bulkQuestionImportService.parseContent(rawJson, 'paging.json');
        const preview = await bulkQuestionImportService.validateQuestions(parsed, testCourse._id.toString());
        await bulkQuestionImportService.commitImport(
            testCourse._id.toString(),
            testProfessor._id.toString(),
            preview.items
        );

        const initialDoc = await PersonalizedQuestion.findOne({ course: testCourse._id });
        expect(initialDoc).toBeDefined();
        expect(initialDoc!.organizationStatus).toBe('PENDING');
        expect(initialDoc!.subtopic).toBeFalsy();
        expect(initialDoc!.skills).toEqual([]);
        expect(initialDoc!.learningObjectives).toEqual([]);
        expect(initialDoc!.prerequisites).toEqual([]);

        // Organize questions
        const result = await questionOrganizerService.organizeCourseQuestions(testCourse._id);
        expect(result.organizedCount).toBe(1);
        expect(result.totalProcessed).toBe(1);
        expect(result.failures).toHaveLength(0);

        // Verify persisted document in MongoDB
        const updatedDoc = await PersonalizedQuestion.findById(initialDoc!._id);
        expect(updatedDoc).toBeDefined();
        expect(updatedDoc!.organizationStatus).toBe('ORGANIZED');
        expect(updatedDoc!.topic).toBeDefined();
        expect(updatedDoc!.subtopic).toBeTruthy();
        expect(updatedDoc!.questionType).toBeDefined();
        expect(Array.isArray(updatedDoc!.skills)).toBe(true);
        expect(updatedDoc!.skills!.length).toBeGreaterThan(0);
        expect(Array.isArray(updatedDoc!.learningObjectives)).toBe(true);
        expect(updatedDoc!.learningObjectives!.length).toBeGreaterThan(0);
        expect(Array.isArray(updatedDoc!.prerequisites)).toBe(true);
        expect(updatedDoc!.prerequisites!.length).toBeGreaterThan(0);
        expect(Array.isArray(updatedDoc!.relatedConcepts)).toBe(true);
        expect(typeof updatedDoc!.estimatedMinutes).toBe('number');
        expect(updatedDoc!.estimatedMinutes).toBeGreaterThan(0);
    });

    // =========================================================================
    // 2. Multiple questions can be organized
    // =========================================================================
    it('successfully organizes multiple questions in a single course batch', async () => {
        const rawJson = JSON.stringify([
            {
                title: 'Deadlock Detection in Operating Systems',
                prompt: 'Discuss the Banker algorithm for deadlock avoidance and describe safety state determination.',
                topic: 'Deadlocks',
                difficulty: 'HARD',
                options: ['Matrix resource-allocation state', 'Greedy thread termination', 'Spinlock pooling', 'Paging table walk'],
                correctAnswer: 0
            },
            {
                title: 'Binary Search Tree Rotations',
                prompt: 'Describe how AVL left and right rotations restore height balance after an unbalanced insertion.',
                topic: 'Data Structures',
                difficulty: 'MEDIUM',
                options: ['Single and double tree rotations', 'Heapify down', 'Hash rehash', 'Radix split'],
                correctAnswer: 0
            },
            {
                title: 'Dijkstra Shortest Path Complexity',
                prompt: 'Analyze the running time of Dijkstra algorithm on a graph with V vertices and E edges with a binary heap.',
                topic: 'Graph Algorithms',
                difficulty: 'MEDIUM',
                options: ['O((V + E) log V)', 'O(V^2)', 'O(E^2)', 'O(V log E)'],
                correctAnswer: 0
            }
        ]);

        const parsed = bulkQuestionImportService.parseContent(rawJson, 'batch.json');
        const preview = await bulkQuestionImportService.validateQuestions(parsed, testCourse._id.toString());
        await bulkQuestionImportService.commitImport(
            testCourse._id.toString(),
            testProfessor._id.toString(),
            preview.items
        );

        const beforeDocs = await PersonalizedQuestion.find({ course: testCourse._id });
        expect(beforeDocs).toHaveLength(3);
        beforeDocs.forEach((d) => expect(d.organizationStatus).toBe('PENDING'));

        const result = await questionOrganizerService.organizeCourseQuestions(testCourse._id);
        expect(result.totalProcessed).toBe(3);
        expect(result.organizedCount).toBe(3);
        expect(result.failures).toHaveLength(0);

        const afterDocs = await PersonalizedQuestion.find({ course: testCourse._id });
        expect(afterDocs).toHaveLength(3);
        for (const doc of afterDocs) {
            expect(doc.organizationStatus).toBe('ORGANIZED');
            expect(doc.subtopic).toBeTruthy();
            expect(doc.skills!.length).toBeGreaterThan(0);
            expect(doc.learningObjectives!.length).toBeGreaterThan(0);
            expect(doc.prerequisites!.length).toBeGreaterThan(0);
        }
    });

    // =========================================================================
    // 3. AI failure -> fallback organization produces rich metadata
    // =========================================================================
    it('uses heuristic fallback to produce and persist rich metadata when Gemini fails', async () => {
        // Mock Gemini to throw an API error (e.g. 503 Overloaded or network outage)
        vi.spyOn(GeminiAIService.getInstance(), 'generateContent').mockRejectedValue(
            new Error('Gemini API 503: Service temporarily overloaded')
        );

        const question = await PersonalizedQuestion.create({
            course: testCourse._id,
            questionIndex: 1,
            title: 'Neural Network Backpropagation & Gradient Descent',
            questionPrompt: 'Explain how backpropagation computes gradients of the loss function with respect to weights using the chain rule.',
            topic: 'Machine Learning',
            difficulty: 'HARD',
            organizationStatus: 'PENDING',
            createdBy: testProfessor._id
        });

        // Organize the question
        const organized = await questionOrganizerService.organizeQuestion(question._id);

        expect(organized.organizationStatus).toBe('ORGANIZED');
        expect(organized.subtopic).toBe('Backpropagation & Gradient Optimization');
        expect(organized.skills).toContain('Gradient Descent Optimization');
        expect(organized.learningObjectives!.length).toBeGreaterThan(0);
        expect(organized.prerequisites).toContain('Calculus & Partial Derivatives');
        expect(organized.questionType).toBe('NUMERICAL');

        // Verify persisted document
        const persisted = await PersonalizedQuestion.findById(question._id);
        expect(persisted!.organizationStatus).toBe('ORGANIZED');
        expect(persisted!.subtopic).toBe('Backpropagation & Gradient Optimization');
    });

    // =========================================================================
    // 4. Failed organization is surfaced rather than silently ignored
    // =========================================================================
    it('surfaces failed questions in the result failures list when an individual item fails', async () => {
        // Create a valid question
        const qValid = await PersonalizedQuestion.create({
            course: testCourse._id,
            questionIndex: 1,
            title: 'Valid Question',
            questionPrompt: 'Explain process synchronization using semaphores.',
            topic: 'Operating Systems',
            difficulty: 'MEDIUM',
            organizationStatus: 'PENDING',
            createdBy: testProfessor._id
        });

        // Spy on organizeQuestion to fail on a specific question
        const originalOrganizeQuestion = questionOrganizerService.organizeQuestion.bind(questionOrganizerService);
        vi.spyOn(questionOrganizerService, 'organizeQuestion').mockImplementation(async (qid, syllabus) => {
            if (qid.toString() === qValid._id.toString()) {
                throw new Error('Simulated database write lock failure');
            }
            return originalOrganizeQuestion(qid, syllabus);
        });

        const result = await questionOrganizerService.organizeCourseQuestions(testCourse._id);
        expect(result.totalProcessed).toBe(1);
        expect(result.organizedCount).toBe(0);
        expect(result.failures).toHaveLength(1);
        expect(result.failures[0].questionId).toBe(qValid._id.toString());
        expect(result.failures[0].error).toContain('Simulated database write lock failure');
    });

    // =========================================================================
    // 5. UI/API response correctly reports success/failure
    // =========================================================================
    it('returns 200 with complete organized payload on successful API call', async () => {
        await PersonalizedQuestion.create({
            course: testCourse._id,
            questionIndex: 1,
            title: 'TCP 3-Way Handshake',
            questionPrompt: 'Explain the sequence of SYN, SYN-ACK, and ACK packets during TCP connection establishment.',
            topic: 'Computer Networks',
            difficulty: 'EASY',
            organizationStatus: 'PENDING',
            createdBy: testProfessor._id
        });

        const req = new NextRequest('http://localhost:3000/api/personalized/questions/organize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseId: testCourse._id.toString() })
        });

        const res = await organizeRoute(req);
        expect(res.status).toBe(200);

        const json = await res.json();
        expect(json.success).toBe(true);
        expect(json.data.totalProcessed).toBe(1);
        expect(json.data.organizedCount).toBe(1);
        expect(json.data.failures).toEqual([]);
        expect(json.data.questions).toHaveLength(1);
        expect(json.data.questions[0].organizationStatus).toBe('ORGANIZED');
        expect(json.data.questions[0].subtopic).toBeTruthy();
    });

    it('returns 400 when courseId is missing from API request', async () => {
        const req = new NextRequest('http://localhost:3000/api/personalized/questions/organize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        const res = await organizeRoute(req);
        expect(res.status).toBe(400);

        const json = await res.json();
        expect(json.success).toBe(false);
        expect(json.message).toContain('courseId is required');
    });

    it('returns 404 when courseId does not exist', async () => {
        const fakeId = new mongoose.Types.ObjectId().toString();
        const req = new NextRequest('http://localhost:3000/api/personalized/questions/organize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseId: fakeId })
        });

        const res = await organizeRoute(req);
        expect(res.status).toBe(404);

        const json = await res.json();
        expect(json.success).toBe(false);
        expect(json.message).toContain('Course not found');
    });

    it('returns 403 when user is not the course professor', async () => {
        mockSessionUser = {
            id: otherProfessor._id.toString(),
            role: 'PROFESSOR'
        };

        const req = new NextRequest('http://localhost:3000/api/personalized/questions/organize', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseId: testCourse._id.toString() })
        });

        const res = await organizeRoute(req);
        expect(res.status).toBe(403);

        const json = await res.json();
        expect(json.success).toBe(false);
        expect(json.message).toContain('Forbidden');
    });
});
