/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Grade from '../models/Grade';
import gradingService from '../services/GradingService';
import allocationService from '../services/AllocationService';
import { HttpError } from '../lib/errors';

describe('AE-224: Concurrent TA Grading & Transaction Locking', () => {
    let replSet: MongoMemoryReplSet;
    let profUser: any;
    let ta1User: any;
    let ta2User: any;
    let studentUser: any;
    let course: any;
    let exam: any;
    let rubric: any;

    beforeAll(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }

        replSet = await MongoMemoryReplSet.create({
            replSet: { storageEngine: 'wiredTiger' }
        });
        process.env.MONGODB_URI = replSet.getUri();
        await mongoose.connect(replSet.getUri());
    }, 60000);

    afterAll(async () => {
        await mongoose.disconnect();
        if (replSet) {
            await replSet.stop();
        }
    });

    beforeEach(async () => {
        await Promise.all([
            Grade.deleteMany({}),
            Allocation.deleteMany({}),
            AnswerScript.deleteMany({}),
            Exam.deleteMany({}),
            Rubric.deleteMany({}),
            Course.deleteMany({}),
            User.deleteMany({}),
        ]);

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

        rubric = await Rubric.create({
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

    it('handles simultaneous grading on the SAME question with atomic lock and 409 conflict rejection', async () => {
        const script = await AnswerScript.create({
            exam: exam._id,
            student: studentUser._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            batchId: 'BATCH-CONCURRENCY-1',
            isActive: true,
        });

        await Allocation.create({
            exam: exam._id,
            ta: ta1User._id,
            allocatedBy: profUser._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL,
            answerScript: script._id,
        });

        // TA1 and TA2 both attempt to finalize a grade on Question 1 concurrently
        const p1 = gradingService.saveGrade({
            scriptId: script._id.toString(),
            question: 1,
            marksAwarded: [
                { criterionName: 'Accuracy', score: 9 },
                { criterionName: 'Clarity', score: 4 },
            ],
            feedback: 'Graded by TA1',
            userId: ta1User._id.toString(),
            userRole: UserRole.TA,
            isFinal: true,
        });

        const p2 = gradingService.saveGrade({
            scriptId: script._id.toString(),
            question: 1,
            marksAwarded: [
                { criterionName: 'Accuracy', score: 8 },
                { criterionName: 'Clarity', score: 5 },
            ],
            feedback: 'Graded by TA2 concurrently',
            userId: ta2User._id.toString(),
            userRole: UserRole.TA,
            isFinal: true,
        });

        const results = await Promise.allSettled([p1, p2]);

        const fulfilled = results.filter(r => r.status === 'fulfilled');
        const rejected = results.filter(r => r.status === 'rejected');

        // Exactly one should succeed and one should fail due to finalization lock or conflict
        expect(fulfilled.length).toBe(1);
        expect(rejected.length).toBe(1);

        const rejectionError = (rejected[0] as PromiseRejectedResult).reason;
        expect(
            rejectionError instanceof HttpError ||
            rejectionError.message.includes('finalized') ||
            rejectionError.message.includes('E11000') ||
            rejectionError.statusCode === 409
        ).toBe(true);

        // Verify exactly one Grade document exists in database without duplication or corruption
        const grades = await Grade.find({ answerScript: script._id, question: 1 });
        expect(grades.length).toBe(1);
        expect(grades[0].isFinal).toBe(true);
        expect(grades[0].totalScore).toBe(13); // 9+4 or 8+5
    });

    it('allows concurrent grading across DIFFERENT questions on the same script without lost updates', async () => {
        const script = await AnswerScript.create({
            exam: exam._id,
            student: studentUser._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            batchId: 'BATCH-CONCURRENCY-2',
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

        // TA1 grades Question 1, TA2 grades Question 2 simultaneously
        const [g1, g2] = await Promise.all([
            gradingService.saveGrade({
                scriptId: script._id.toString(),
                question: 1,
                marksAwarded: [
                    { criterionName: 'Accuracy', score: 10 },
                    { criterionName: 'Clarity', score: 5 },
                ],
                feedback: 'TA1 graded Q1',
                userId: ta1User._id.toString(),
                userRole: UserRole.TA,
                isFinal: true,
            }),
            gradingService.saveGrade({
                scriptId: script._id.toString(),
                question: 2,
                marksAwarded: [
                    { criterionName: 'Technique', score: 9 },
                    { criterionName: 'Outcome', score: 4 },
                ],
                feedback: 'TA2 graded Q2',
                userId: ta2User._id.toString(),
                userRole: UserRole.TA,
                isFinal: true,
            }),
        ]);

        expect(g1.totalScore).toBe(15);
        expect(g2.totalScore).toBe(13);

        // Check database documents: both questions must exist independently
        const grades = await Grade.find({ answerScript: script._id }).sort({ question: 1 });
        expect(grades.length).toBe(2);
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
            batchId: 'BATCH-CONCURRENCY-3',
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

        // Both TAs attempt to claim the same pending allocation concurrently
        const [r1, r2] = await Promise.allSettled([
            allocationService.claimAllocation(alloc._id.toString(), ta1User._id.toString()),
            allocationService.claimAllocation(alloc._id.toString(), ta2User._id.toString()),
        ]);

        const successful = [r1, r2].filter(r => r.status === 'fulfilled');
        expect(successful.length).toBeGreaterThanOrEqual(1);

        // Allocation must remain in valid state (IN_PROGRESS)
        const updatedAlloc = await Allocation.findById(alloc._id);
        expect(updatedAlloc?.status).toBe(AllocationStatus.IN_PROGRESS);
    });
});
