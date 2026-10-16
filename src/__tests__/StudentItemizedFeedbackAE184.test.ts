/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import Allocation, { AllocationStatus } from '../models/Allocation';
import Rubric from '../models/Rubric';
import { NextRequest } from 'next/server';
import mongoose from 'mongoose';

let mockSessionUser: any = null;

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

describe('AE-184: Itemized Scores + Per-Question Feedback View', () => {
    let resultGET: any;

    let studentA: any;
    let studentB: any;
    let prof: any;
    let ta: any;
    let course: any;
    let exam: any;
    let rubricV1: any;
    let rubricV2: any;
    let scriptA: any;
    let scriptB: any;

    beforeAll(async () => {
        resultGET = (await import('../app/api/student/results/[scriptId]/route')).GET;
    });

    beforeEach(async () => {
        process.env.STUDENT_RESULTS_ENABLED = 'true';

        studentA = await User.create({
            name: 'Student Alice',
            email: 'alice.184@iiit.ac.in',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        studentB = await User.create({
            name: 'Student Bob',
            email: 'bob.184@iiit.ac.in',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        prof = await User.create({
            name: 'Professor Snape',
            email: 'snape.184@iiit.ac.in',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true,
        });

        ta = await User.create({
            name: 'TA Granger',
            email: 'granger.184@iiit.ac.in',
            password: 'password123',
            role: UserRole.TA,
            isActive: true,
        });

        course = await Course.create({
            courseCode: 'CS184',
            courseName: 'Advanced Compilers',
            academicYear: '2026-2027',
            semester: 1,
            professor: prof._id,
            enrolledStudents: [studentA._id, studentB._id],
            teachingAssistants: [ta._id],
            isActive: true,
        });

        exam = await Exam.create({
            title: 'Compilers Final Exam',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date('2026-11-15'),
            totalMarks: 75,
            numberOfQuestions: 3,
            status: ExamStatus.PUBLISHED,
            isActive: true,
            enrolledStudents: [studentA._id, studentB._id],
        });

        rubricV1 = await Rubric.create({
            exam: exam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            version: 1,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 25,
                    criteria: [
                        {
                            criterionName: 'Lexical Analysis',
                            description: 'Secret internal description 1',
                            points: 25,
                        },
                    ],
                },
                {
                    questionNumber: 2,
                    maxMarks: 25,
                    criteria: [
                        {
                            criterionName: 'Syntax Analysis',
                            description: 'Secret internal description 2',
                            points: 25,
                        },
                    ],
                },
                {
                    questionNumber: 3,
                    maxMarks: 25,
                    criteria: [
                        {
                            criterionName: 'Code Generation',
                            description: 'Secret internal description 3',
                            points: 25,
                        },
                    ],
                },
            ],
            isActive: true,
        });

        rubricV2 = await Rubric.create({
            exam: exam._id,
            createdBy: prof._id,
            scoreStep: 1,
            version: 2,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 50,
                    criteria: [
                        {
                            criterionName: 'Lexical Analysis',
                            description: 'Updated description v2',
                            points: 50,
                        },
                    ],
                },
            ],
            isActive: true,
        });

        await Exam.findByIdAndUpdate(exam._id, { rubric: rubricV1._id });

        scriptA = await AnswerScript.create({
            exam: exam._id,
            student: studentA._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false,
        });

        scriptB = await AnswerScript.create({
            exam: exam._id,
            student: studentB._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            isActive: true,
            needsManualId: false,
            hasIdentificationConflict: false,
        });

        mockSessionUser = {
            id: studentA._id.toString(),
            email: studentA.email,
            name: studentA.name,
            role: UserRole.STUDENT,
        };
    });

    // 1. Three question-wise grades, including a question without feedback
    it('1. correctly returns three question-wise grades, including a question without feedback', async () => {
        // Grade Q3 (intentionally create out of order to verify sorting by questionNumber)
        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 3,
            marksAwarded: [{ criterionName: 'Code Generation', score: 22 }],
            totalScore: 22,
            feedback: 'Solid register allocation strategy.',
            isFinal: true,
        });

        // Grade Q1 (with feedback)
        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Lexical Analysis', score: 24 }],
            totalScore: 24,
            feedback: 'Excellent regex definitions.',
            isFinal: true,
        });

        // Grade Q2 (WITHOUT feedback)
        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 2,
            marksAwarded: [{ criterionName: 'Syntax Analysis', score: 20 }],
            totalScore: 20,
            isFinal: true,
        });

        // Completed allocations for all 3 questions
        for (const qNum of [1, 2, 3]) {
            await Allocation.create({
                exam: exam._id,
                answerScript: scriptA._id,
                ta: ta._id,
                question: qNum,
                allocatedBy: prof._id,
                status: AllocationStatus.COMPLETED,
            });
        }

        const req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`);
        const res = await resultGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('Cache-Control')).toBe('private, no-store');
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');

        const body = await res.json();
        expect(body.mode).toBe('QUESTION');
        expect(body.exam.title).toBe('Compilers Final Exam');
        expect(body.exam.totalMarks).toBe(75);
        expect(body.total).toBe(66); // 24 + 20 + 22
        expect(body.maxTotal).toBe(75);

        expect(body.questions).toHaveLength(3);

        // Verify sorted by questionNumber
        expect(body.questions[0].questionNumber).toBe(1);
        expect(body.questions[0].awarded).toBe(24);
        expect(body.questions[0].maxMarks).toBe(25);
        expect(body.questions[0].feedback).toBe('Excellent regex definitions.');
        expect(body.questions[0].criteria[0].name).toBe('Lexical Analysis');
        expect(body.questions[0].criteria[0].score).toBe(24);
        expect(body.questions[0].criteria[0].points).toBe(25);

        // Q2 has NO feedback
        expect(body.questions[1].questionNumber).toBe(2);
        expect(body.questions[1].awarded).toBe(20);
        expect(body.questions[1].maxMarks).toBe(25);
        expect(body.questions[1].feedback).toBeUndefined();

        // Q3
        expect(body.questions[2].questionNumber).toBe(3);
        expect(body.questions[2].awarded).toBe(22);
        expect(body.questions[2].maxMarks).toBe(25);
        expect(body.questions[2].feedback).toBe('Solid register allocation strategy.');
    });

    // 2. Whole-script grading and criterion-level feedback
    it('2. supports whole-script grading with criterion-level feedback', async () => {
        const wholeRubric = await Rubric.create({
            exam: exam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            version: 1,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 75,
                    criteria: [
                        { criterionName: 'Correctness', points: 40 },
                        { criterionName: 'Code Quality', points: 20 },
                        { criterionName: 'Performance', points: 15 },
                    ],
                },
            ],
            isActive: true,
        });

        await Grade.create({
            answerScript: scriptA._id,
            rubric: wholeRubric._id,
            gradedBy: ta._id,
            // question is null for whole-script grading
            marksAwarded: [
                { criterionName: 'Correctness', score: 38, feedback: 'Almost flawless edge case handling.' },
                { criterionName: 'Code Quality', score: 18, feedback: 'Clean modular structure.' },
                { criterionName: 'Performance', score: 14 },
            ],
            totalScore: 70,
            feedback: 'Exceptional overall submission.',
            isFinal: true,
        });

        await Allocation.create({
            exam: exam._id,
            answerScript: scriptA._id,
            ta: ta._id,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED,
        });

        const req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`);
        const res = await resultGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.mode).toBe('WHOLE');
        expect(body.total).toBe(70);
        expect(body.maxTotal).toBe(75);
        expect(body.questions).toHaveLength(1);

        const wholeQ = body.questions[0];
        expect(wholeQ.questionNumber).toBeNull();
        expect(wholeQ.awarded).toBe(70);
        expect(wholeQ.maxMarks).toBe(75);
        expect(wholeQ.feedback).toBe('Exceptional overall submission.');

        expect(wholeQ.criteria).toHaveLength(3);
        expect(wholeQ.criteria[0]).toEqual({
            name: 'Correctness',
            score: 38,
            points: 40,
            feedback: 'Almost flawless edge case handling.',
        });
        expect(wholeQ.criteria[1]).toEqual({
            name: 'Code Quality',
            score: 18,
            points: 20,
            feedback: 'Clean modular structure.',
        });
        expect(wholeQ.criteria[2]).toEqual({
            name: 'Performance',
            score: 14,
            points: 15,
        });
    });

    // 3. Historical rubric values remain unchanged after current rubric is edited
    it('3. preserves historical rubric values even when exam rubric is updated to a new version', async () => {
        // All 3 questions finalized referencing rubricV1 (where Q1 maxMarks = 25, points = 25)
        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Lexical Analysis', score: 23 }],
            totalScore: 23,
            isFinal: true,
        });

        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 2,
            marksAwarded: [{ criterionName: 'Syntax Analysis', score: 21 }],
            totalScore: 21,
            isFinal: true,
        });

        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 3,
            marksAwarded: [{ criterionName: 'Code Generation', score: 22 }],
            totalScore: 22,
            isFinal: true,
        });

        // Now simulate instructor updating the exam rubric to rubricV2 (where Q1 maxMarks = 50, points = 50)
        await Exam.findByIdAndUpdate(exam._id, { rubric: rubricV2._id });

        const req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`);
        const res = await resultGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();

        // Must still reflect rubricV1 values
        expect(body.questions[0].maxMarks).toBe(25); // not 50
        expect(body.questions[0].criteria[0].points).toBe(25); // not 50
        expect(body.questions[0].awarded).toBe(23);
    });

    // 4. Non-final grade rejection (causes 404)
    it('4. returns 404 if any grade has isFinal: false', async () => {
        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Lexical Analysis', score: 20 }],
            totalScore: 20,
            isFinal: false, // Non-final!
        });

        const req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`);
        const res = await resultGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });

        expect(res.status).toBe(404);
    });

    // 5. Cross-student access rejection (causes 404)
    it('5. returns generic 404 when a student attempts to view another student itemized result', async () => {
        await Grade.create({
            answerScript: scriptB._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Lexical Analysis', score: 25 }],
            totalScore: 25,
            isFinal: true,
        });

        // Alice tries to access Bob's scriptB
        const req = new NextRequest(`http://localhost:3000/api/student/results/${scriptB._id}`);
        const res = await resultGET(req, {
            params: Promise.resolve({ scriptId: scriptB._id.toString() }),
        });

        expect(res.status).toBe(404);
    });

    // 6. Response serialization strictly excludes prohibited fields
    it('6. response serialization strictly excludes prohibited internal fields', async () => {
        const dummyTagId = new mongoose.Types.ObjectId();
        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Lexical Analysis', score: 25 }],
            totalScore: 25,
            tagIds: [dummyTagId],
            isFinal: true,
        });

        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 2,
            marksAwarded: [{ criterionName: 'Syntax Analysis', score: 25 }],
            totalScore: 25,
            isFinal: true,
        });

        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 3,
            marksAwarded: [{ criterionName: 'Code Generation', score: 25 }],
            totalScore: 25,
            isFinal: true,
        });

        const req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`);
        const res = await resultGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });

        expect(res.status).toBe(200);
        const jsonText = await res.text();

        // Prohibited fields must never appear anywhere in the serialized response
        expect(jsonText).not.toContain(ta._id.toString());
        expect(jsonText).not.toContain(dummyTagId.toString());
        expect(jsonText).not.toContain('gradedBy');
        expect(jsonText).not.toContain('isFinal');
        expect(jsonText).not.toContain('tagIds');
        expect(jsonText).not.toContain('Secret internal description 1');
        expect(jsonText).not.toContain('ScriptFlag');
        expect(jsonText).not.toContain('AuditLog');
        expect(jsonText).not.toContain('Allocation');
    });

    // 7. Read-only marks and feedback panel verification
    it('7. verifies ItemizedFeedbackPanel is strictly read-only without mutations or input controls', () => {
        const panelPath = path.join(
            process.cwd(),
            'src',
            'components',
            'student',
            'ItemizedFeedbackPanel.tsx'
        );
        expect(fs.existsSync(panelPath)).toBe(true);

        const sourceCode = fs.readFileSync(panelPath, 'utf-8');

        // Strictly verify no form input elements or mutation APIs
        expect(sourceCode).not.toContain('<input');
        expect(sourceCode).not.toContain('<textarea');
        expect(sourceCode).not.toContain('<select');
        expect(sourceCode).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i);
    });

    // 8. Regression: exam.totalMarks is 100 but graded rubric sums to 10
    it('8. derives maximum marks from graded rubric (10) when exam.totalMarks is 100', async () => {
        await Exam.findByIdAndUpdate(exam._id, { totalMarks: 100 });

        const smallRubric = await Rubric.create({
            exam: exam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            version: 3,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 10,
                    criteria: [
                        { criterionName: 'Basic Correctness', points: 10 },
                    ],
                },
            ],
            isActive: true,
        });

        await Grade.create({
            answerScript: scriptA._id,
            rubric: smallRubric._id,
            gradedBy: ta._id,
            marksAwarded: [
                { criterionName: 'Basic Correctness', score: 8 },
            ],
            totalScore: 8,
            isFinal: true,
        });

        await Allocation.create({
            exam: exam._id,
            answerScript: scriptA._id,
            ta: ta._id,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED,
        });

        const req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`);
        const res = await resultGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.mode).toBe('WHOLE');
        expect(body.exam.totalMarks).toBe(100);
        expect(body.total).toBe(8);
        expect(body.maxTotal).toBe(10); // Strictly derived from rubric sum (10), not exam.totalMarks (100)
        expect(body.questions).toHaveLength(1);
        expect(body.questions[0].maxMarks).toBe(10); // Strictly derived from rubric (10), not exam.totalMarks (100)
        expect(body.questions[0].awarded).toBe(8);
        expect(body.questions[0].criteria[0].points).toBe(10);
    });

    // 9. Regression: missing criterion in referenced rubric cannot appear to have full marks
    it('9. missing rubric criterion returns generic 404 and cannot appear to have full marks', async () => {
        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [
                // 'Lexical Analysis' is in rubricV1, but 'NonExistentCriterion' is NOT in rubricV1
                { criterionName: 'NonExistentCriterion', score: 25 },
            ],
            totalScore: 25,
            isFinal: true,
        });

        await Allocation.create({
            exam: exam._id,
            answerScript: scriptA._id,
            ta: ta._id,
            question: 1,
            allocatedBy: prof._id,
            status: AllocationStatus.COMPLETED,
        });

        const req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`);
        const res = await resultGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });

        // Must reject with generic 404
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.message).toBe('Not found');
        // Must never leak internal details
        expect(JSON.stringify(body)).not.toContain('NonExistentCriterion');
        expect(JSON.stringify(body)).not.toContain('rubric');
    });

    // 10. Regression: mixed-mode results remain unavailable with generic 404
    it('10. returns generic 404 for mixed-mode results (both whole-script and question-wise grades)', async () => {
        // Grade 1: Whole-script grade (question undefined)
        await Grade.create({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            marksAwarded: [{ criterionName: 'Lexical Analysis', score: 20 }],
            totalScore: 20,
            isFinal: true,
        });

        // Grade 2: Insert question-wise grade directly to simulate legacy/inconsistent DB state
        await Grade.collection.insertOne({
            answerScript: scriptA._id,
            rubric: rubricV1._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Lexical Analysis', score: 20 }],
            totalScore: 20,
            isFinal: true,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        const req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`);
        const res = await resultGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });

        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.message).toBe('Not found');
    });

    // 11. Regression: question-wise grading derives maximum marks from rubric (10) when exam.totalMarks is 100
    it('11. question-wise grading derives maxTotal and per-question maxMarks from rubric when exam.totalMarks is 100', async () => {
        await Exam.findByIdAndUpdate(exam._id, { totalMarks: 100, numberOfQuestions: 2 });

        const questionRubric = await Rubric.create({
            exam: exam._id,
            createdBy: prof._id,
            scoreStep: 0.5,
            version: 4,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 6,
                    criteria: [
                        { criterionName: 'Part A', points: 6 },
                    ],
                },
                {
                    questionNumber: 2,
                    maxMarks: 4,
                    criteria: [
                        { criterionName: 'Part B', points: 4 },
                    ],
                },
            ],
            isActive: true,
        });

        // Grade Q1
        await Grade.create({
            answerScript: scriptA._id,
            rubric: questionRubric._id,
            gradedBy: ta._id,
            question: 1,
            marksAwarded: [{ criterionName: 'Part A', score: 5 }],
            totalScore: 5,
            isFinal: true,
        });

        // Grade Q2
        await Grade.create({
            answerScript: scriptA._id,
            rubric: questionRubric._id,
            gradedBy: ta._id,
            question: 2,
            marksAwarded: [{ criterionName: 'Part B', score: 3 }],
            totalScore: 3,
            isFinal: true,
        });

        // Completed allocations for both questions
        for (const qNum of [1, 2]) {
            await Allocation.create({
                exam: exam._id,
                answerScript: scriptA._id,
                ta: ta._id,
                question: qNum,
                allocatedBy: prof._id,
                status: AllocationStatus.COMPLETED,
            });
        }

        const req = new NextRequest(`http://localhost:3000/api/student/results/${scriptA._id}`);
        const res = await resultGET(req, {
            params: Promise.resolve({ scriptId: scriptA._id.toString() }),
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.mode).toBe('QUESTION');
        expect(body.exam.totalMarks).toBe(100);
        expect(body.total).toBe(8); // 5 + 3
        expect(body.maxTotal).toBe(10); // Strictly derived from rubric sum (6 + 4 = 10), not exam.totalMarks (100)

        expect(body.questions).toHaveLength(2);

        // Q1
        expect(body.questions[0].questionNumber).toBe(1);
        expect(body.questions[0].maxMarks).toBe(6);
        expect(body.questions[0].awarded).toBe(5);
        expect(body.questions[0].criteria[0].name).toBe('Part A');
        expect(body.questions[0].criteria[0].points).toBe(6);

        // Q2
        expect(body.questions[1].questionNumber).toBe(2);
        expect(body.questions[1].maxMarks).toBe(4);
        expect(body.questions[1].awarded).toBe(3);
        expect(body.questions[1].criteria[0].name).toBe('Part B');
        expect(body.questions[1].criteria[0].points).toBe(4);
    });
});
