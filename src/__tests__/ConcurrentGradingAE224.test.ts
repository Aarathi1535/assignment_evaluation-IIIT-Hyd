/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { AsyncLocalStorage } from 'node:async_hooks';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { NextRequest } from 'next/server';

import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Grade from '../models/Grade';
import allocationService from '../services/AllocationService';

interface MockSessionUser {
    id: string;
    role: string;
    email: string;
    name?: string;
}

const userContext = new AsyncLocalStorage<MockSessionUser>();
let fallbackSessionUser: MockSessionUser | null = null;

vi.mock('next-auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('next-auth')>();
    return {
        ...original,
        getServerSession: vi.fn().mockImplementation(() => {
            const user = userContext.getStore() || fallbackSessionUser;
            if (!user) return Promise.resolve(null);
            return Promise.resolve({ user });
        }),
    };
});

describe('AE-224: Concurrent TA Grading & Transaction Locking', () => {
    let replSet: MongoMemoryReplSet;
    let gradePOST: typeof import('../app/api/scripts/[id]/questions/[questionNumber]/grade/route').POST;

    let profUser: any;
    let ta1User: any;
    let ta2User: any;
    let studentUser: any;
    let course: any;
    let exam: any;

    beforeAll(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }

        replSet = await MongoMemoryReplSet.create({
            replSet: { count: 1, storageEngine: 'wiredTiger' }
        });
        process.env.MONGODB_URI = replSet.getUri();
        await mongoose.connect(replSet.getUri());

        gradePOST = (await import('../app/api/scripts/[id]/questions/[questionNumber]/grade/route')).POST;

        // Build composite unique indexes first
        await Grade.syncIndexes();
        await Allocation.syncIndexes();
    }, 60000);

    afterAll(async () => {
        await mongoose.disconnect();
        if (replSet) {
            await replSet.stop();
        }
    });

    beforeEach(async () => {
        fallbackSessionUser = null;

        await Promise.all([
            Grade.deleteMany({}),
            Allocation.deleteMany({}),
            AnswerScript.deleteMany({}),
            Exam.deleteMany({}),
            Rubric.deleteMany({}),
            Course.deleteMany({}),
            User.deleteMany({}),
        ]);

        // Ensure indexes are built cleanly
        await Grade.syncIndexes();
        await Allocation.syncIndexes();

        profUser = await User.create({
            name: 'Prof Minerva',
            email: 'minerva@hogwarts.edu',
            password: 'prof-secure-password',
            role: UserRole.PROFESSOR,
            isActive: true,
        });

        ta1User = await User.create({
            name: 'TA Hermione',
            email: 'hermione@hogwarts.edu',
            password: 'ta1-secure-password',
            role: UserRole.TA,
            isActive: true,
        });

        ta2User = await User.create({
            name: 'TA Ron',
            email: 'ron@hogwarts.edu',
            password: 'ta2-secure-password',
            role: UserRole.TA,
            isActive: true,
        });

        studentUser = await User.create({
            name: 'Student Harry',
            email: 'harry@hogwarts.edu',
            password: 'student-secure-password',
            role: UserRole.STUDENT,
            isActive: true,
        });

        course = await Course.create({
            courseCode: 'TRANS-101',
            courseName: 'Transfiguration',
            professor: profUser._id,
            semester: 1,
            academicYear: '2026-2027',
            enrolledStudents: [studentUser._id],
            teachingAssistants: [ta1User._id, ta2User._id],
            isActive: true,
        });

        exam = await Exam.create({
            title: 'Midterm Transfiguration Exam',
            course: course._id,
            createdBy: profUser._id,
            examDate: new Date(),
            numberOfQuestions: 2,
            totalMarks: 30,
            status: ExamStatus.EVALUATING,
            enrolledStudents: [studentUser._id],
            isActive: true,
        });

        await Rubric.create({
            exam: exam._id,
            createdBy: profUser._id,
            scoreStep: 0.5,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 15,
                    description: 'Question 1: Theory',
                    criteria: [
                        { criterionName: 'Accuracy', points: 10, description: 'Factual accuracy' },
                        { criterionName: 'Clarity', points: 5, description: 'Explanation clarity' },
                    ],
                },
                {
                    questionNumber: 2,
                    maxMarks: 15,
                    description: 'Question 2: Practical',
                    criteria: [
                        { criterionName: 'Technique', points: 10, description: 'Proper technique' },
                        { criterionName: 'Outcome', points: 5, description: 'Practical outcome' },
                    ],
                },
            ],
        });
    });

    it('allocates both TAs, fires requests through the route at once, asserting exactly one 200 and one 409 repeated 20 times', async () => {
        // Repeat the race 20 times across fresh scripts to ensure deterministic conflict handling
        for (let i = 1; i <= 20; i++) {
            const script = await AnswerScript.create({
                exam: exam._id,
                student: studentUser._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                batchId: `BATCH-CONCURRENCY-RACE-${i}`,
                isActive: true,
            });

            // Allocate BOTH TA1 and TA2 to Question 1 of the script
            await Allocation.create({
                exam: exam._id,
                ta: ta1User._id,
                allocatedBy: profUser._id,
                status: AllocationStatus.PENDING,
                rule: AllocationRule.QUESTION,
                answerScript: script._id,
                question: 1,
            });

            await Allocation.create({
                exam: exam._id,
                ta: ta2User._id,
                allocatedBy: profUser._id,
                status: AllocationStatus.PENDING,
                rule: AllocationRule.QUESTION,
                answerScript: script._id,
                question: 1,
            });

            const req1 = new NextRequest(`http://localhost:3000/api/scripts/${script._id.toString()}/questions/1/grade`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    marksAwarded: [
                        { criterionName: 'Accuracy', score: 10 },
                        { criterionName: 'Clarity', score: 5 },
                    ],
                    feedback: `Graded by TA1 in race ${i}`,
                    isFinal: true,
                }),
            });

            const req2 = new NextRequest(`http://localhost:3000/api/scripts/${script._id.toString()}/questions/1/grade`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    marksAwarded: [
                        { criterionName: 'Accuracy', score: 6 },
                        { criterionName: 'Clarity', score: 2 },
                    ],
                    feedback: `Graded by TA2 in race ${i}`,
                    isFinal: true,
                }),
            });

            // Fire both requests through the route at once
            const [res1, res2] = await Promise.all([
                userContext.run({ id: ta1User._id.toString(), email: ta1User.email, role: UserRole.TA }, () =>
                    gradePOST(req1, { params: Promise.resolve({ id: script._id.toString(), questionNumber: '1' }) })
                ),
                userContext.run({ id: ta2User._id.toString(), email: ta2User.email, role: UserRole.TA }, () =>
                    gradePOST(req2, { params: Promise.resolve({ id: script._id.toString(), questionNumber: '1' }) })
                ),
            ]);

            // Assert exactly one 200 and one 409
            const statuses = [res1.status, res2.status].sort();
            expect(statuses).toEqual([200, 409]);

            // Assert exactly one grade document exists in database
            const grades = await Grade.find({ answerScript: script._id, question: 1 });
            expect(grades).toHaveLength(1);
            expect(grades[0].isFinal).toBe(true);

            // Assert stored grade matches the winner's values
            if (res1.status === 200) {
                expect(res2.status).toBe(409);
                expect(grades[0].gradedBy.toString()).toBe(ta1User._id.toString());
                expect(grades[0].totalScore).toBe(15);
                expect(grades[0].feedback).toBe(`Graded by TA1 in race ${i}`);
            } else {
                expect(res1.status).toBe(409);
                expect(grades[0].gradedBy.toString()).toBe(ta2User._id.toString());
                expect(grades[0].totalScore).toBe(8);
                expect(grades[0].feedback).toBe(`Graded by TA2 in race ${i}`);
            }
        }
    }, 60000);

    it('handles rapid double-submission by the same TA with one 200 and one 409', async () => {
        const script = await AnswerScript.create({
            exam: exam._id,
            student: studentUser._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            batchId: 'BATCH-DOUBLE-SUBMIT',
            isActive: true,
        });

        await Allocation.create({
            exam: exam._id,
            ta: ta1User._id,
            allocatedBy: profUser._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.QUESTION,
            answerScript: script._id,
            question: 1,
        });

        const makeReq = () => new NextRequest(`http://localhost:3000/api/scripts/${script._id.toString()}/questions/1/grade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                marksAwarded: [
                    { criterionName: 'Accuracy', score: 9 },
                    { criterionName: 'Clarity', score: 4 },
                ],
                feedback: 'Double-submit by TA1',
                isFinal: true,
            }),
        });

        const [res1, res2] = await Promise.all([
            userContext.run({ id: ta1User._id.toString(), email: ta1User.email, role: UserRole.TA }, () =>
                gradePOST(makeReq(), { params: Promise.resolve({ id: script._id.toString(), questionNumber: '1' }) })
            ),
            userContext.run({ id: ta1User._id.toString(), email: ta1User.email, role: UserRole.TA }, () =>
                gradePOST(makeReq(), { params: Promise.resolve({ id: script._id.toString(), questionNumber: '1' }) })
            ),
        ]);

        const statuses = [res1.status, res2.status].sort();
        expect(statuses).toEqual([200, 409]);

        const grades = await Grade.find({ answerScript: script._id, question: 1 });
        expect(grades).toHaveLength(1);
        expect(grades[0].isFinal).toBe(true);
        expect(grades[0].totalScore).toBe(13);
    });

    it('allows concurrent grading across DIFFERENT questions on the same script through the route', async () => {
        const script = await AnswerScript.create({
            exam: exam._id,
            student: studentUser._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            batchId: 'BATCH-CONCURRENCY-DIFF-Q',
            isActive: true,
        });

        await Allocation.create({
            exam: exam._id,
            ta: ta1User._id,
            allocatedBy: profUser._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.QUESTION,
            answerScript: script._id,
            question: 1,
        });

        await Allocation.create({
            exam: exam._id,
            ta: ta2User._id,
            allocatedBy: profUser._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.QUESTION,
            answerScript: script._id,
            question: 2,
        });

        const req1 = new NextRequest(`http://localhost:3000/api/scripts/${script._id.toString()}/questions/1/grade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                marksAwarded: [
                    { criterionName: 'Accuracy', score: 10 },
                    { criterionName: 'Clarity', score: 5 },
                ],
                feedback: 'TA1 graded Q1',
                isFinal: true,
            }),
        });

        const req2 = new NextRequest(`http://localhost:3000/api/scripts/${script._id.toString()}/questions/2/grade`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                marksAwarded: [
                    { criterionName: 'Technique', score: 9 },
                    { criterionName: 'Outcome', score: 4 },
                ],
                feedback: 'TA2 graded Q2',
                isFinal: true,
            }),
        });

        const [res1, res2] = await Promise.all([
            userContext.run({ id: ta1User._id.toString(), email: ta1User.email, role: UserRole.TA }, () =>
                gradePOST(req1, { params: Promise.resolve({ id: script._id.toString(), questionNumber: '1' }) })
            ),
            userContext.run({ id: ta2User._id.toString(), email: ta2User.email, role: UserRole.TA }, () =>
                gradePOST(req2, { params: Promise.resolve({ id: script._id.toString(), questionNumber: '2' }) })
            ),
        ]);

        expect(res1.status).toBe(200);
        expect(res2.status).toBe(200);

        const grades = await Grade.find({ answerScript: script._id }).sort({ question: 1 });
        expect(grades).toHaveLength(2);
        expect(grades[0].question).toBe(1);
        expect(grades[0].totalScore).toBe(15);
        expect(grades[1].question).toBe(2);
        expect(grades[1].totalScore).toBe(13);
    });

    it('safely handles concurrent allocation claims preventing duplicate assignments', async () => {
        const script = await AnswerScript.create({
            exam: exam._id,
            student: studentUser._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            batchId: 'BATCH-CONCURRENCY-CLAIM',
            isActive: true,
        });

        const alloc = await Allocation.create({
            exam: exam._id,
            ta: ta1User._id,
            allocatedBy: profUser._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL,
            answerScript: script._id,
        });

        // Two concurrent claim requests for the pending allocation
        const [r1, r2] = await Promise.allSettled([
            allocationService.claimAllocation(alloc._id.toString(), ta1User._id.toString()),
            allocationService.claimAllocation(alloc._id.toString(), ta1User._id.toString()),
        ]);

        const successful = [r1, r2].filter(r => r.status === 'fulfilled');
        const rejected = [r1, r2].filter(r => r.status === 'rejected');

        // Exactly one should successfully transition the status, the second gets rejected as already claimed
        expect(successful.length).toBe(1);
        expect(rejected.length).toBe(1);

        const updatedAlloc = await Allocation.findById(alloc._id);
        expect(updatedAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
    });
});
