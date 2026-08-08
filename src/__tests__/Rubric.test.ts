/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import Rubric from '../models/Rubric';

describe('Rubric Model Tests', () => {

    it('should validate a correct Rubric document successfully', async () => {
        const examId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();

        const rubricData = {
            exam: examId,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 10,
                    criteria: [
                        {
                            criterionName: 'Correctness',
                            description: 'Is the solution logically correct?',
                            points: 7
                        },
                        {
                            criterionName: 'Formatting',
                            points: 3
                        }
                    ]
                }
            ],
            createdBy: userId
        };

        const rubric = new Rubric(rubricData);
        await expect(rubric.validate()).resolves.toBeUndefined();
        expect(rubric.isActive).toBe(true);
        expect(rubric.version).toBe(1);
    });

    it('should fail validation if exam is missing', async () => {
        const userId = new mongoose.Types.ObjectId();

        const rubricData = {
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 10,
                    criteria: [
                        {
                            criterionName: 'Correctness',
                            points: 10
                        }
                    ]
                }
            ],
            createdBy: userId
        };

        const rubric = new Rubric(rubricData);
        let error: any;
        try {
            await rubric.validate();
        } catch (err) {
            error = err;
        }
        expect(error).toBeDefined();
        expect(error.errors.exam).toBeDefined();
    });

    it('should fail validation if createdBy is missing', async () => {
        const examId = new mongoose.Types.ObjectId();

        const rubricData = {
            exam: examId,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 10,
                    criteria: [
                        {
                            criterionName: 'Correctness',
                            points: 10
                        }
                    ]
                }
            ]
        };

        const rubric = new Rubric(rubricData);
        let error: any;
        try {
            await rubric.validate();
        } catch (err) {
            error = err;
        }
        expect(error).toBeDefined();
        expect(error.errors.createdBy).toBeDefined();
    });

    it('should fail validation if a criterion is missing criterionName', async () => {
        const examId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();

        const rubricData = {
            exam: examId,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 10,
                    criteria: [
                        {
                            points: 10
                        } as any
                    ]
                }
            ],
            createdBy: userId
        };

        const rubric = new Rubric(rubricData);
        let error: any;
        try {
            await rubric.validate();
        } catch (err) {
            error = err;
        }
        expect(error).toBeDefined();
        expect(error.errors['questions.0.criteria.0.criterionName']).toBeDefined();
    });

    it('should fail validation if a criterion has negative points', async () => {
        const examId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();

        const rubricData = {
            exam: examId,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 10,
                    criteria: [
                        {
                            criterionName: 'Correctness',
                            points: -5
                        }
                    ]
                }
            ],
            createdBy: userId
        };

        const rubric = new Rubric(rubricData);
        let error: any;
        try {
            await rubric.validate();
        } catch (err) {
            error = err;
        }
        expect(error).toBeDefined();
        expect(error.errors['questions.0.criteria.0.points']).toBeDefined();
    });

    it('should save a valid Rubric document to the database and generate timestamps', async () => {
        const examId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();

        const rubricData = {
            exam: examId,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 10,
                    criteria: [
                        {
                            criterionName: 'Correctness',
                            points: 10
                        }
                    ]
                }
            ],
            createdBy: userId
        };

        const rubric = new Rubric(rubricData);
        const savedRubric = await rubric.save();

        expect(savedRubric._id).toBeDefined();
        expect(savedRubric.createdAt).toBeDefined();
        expect(savedRubric.updatedAt).toBeDefined();
        expect(savedRubric.isActive).toBe(true);

        // Cleanup
        await Rubric.findByIdAndDelete(savedRubric._id);
    });
});
