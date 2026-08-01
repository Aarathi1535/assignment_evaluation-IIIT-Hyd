import { describe, it, expect } from 'vitest';
import mongoose from 'mongoose';
import Rubric from '../models/Rubric';

describe('Rubric Model Tests', () => {

    it('should validate a correct Rubric document successfully', async () => {
        const examId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();

        const rubricData = {
            exam: examId,
            title: 'Midterm 1 Rubric',
            description: 'Grading rubric for Midterm 1',
            criteria: [
                {
                    criterionName: 'Correctness',
                    description: 'Is the solution logically correct?',
                    maxMarks: 10
                },
                {
                    criterionName: 'Formatting',
                    maxMarks: 5
                }
            ],
            createdBy: userId
        };

        const rubric = new Rubric(rubricData);
        await expect(rubric.validate()).resolves.toBeUndefined();
        expect(rubric.isActive).toBe(true);
    });

    it('should fail validation if exam is missing', async () => {
        const userId = new mongoose.Types.ObjectId();

        const rubricData = {
            title: 'Midterm 1 Rubric',
            criteria: [
                {
                    criterionName: 'Correctness',
                    maxMarks: 10
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

    it('should fail validation if title is missing', async () => {
        const examId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();

        const rubricData = {
            exam: examId,
            criteria: [
                {
                    criterionName: 'Correctness',
                    maxMarks: 10
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
        expect(error.errors.title).toBeDefined();
    });

    it('should fail validation if createdBy is missing', async () => {
        const examId = new mongoose.Types.ObjectId();

        const rubricData = {
            exam: examId,
            title: 'Midterm 1 Rubric',
            criteria: [
                {
                    criterionName: 'Correctness',
                    maxMarks: 10
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
            title: 'Midterm 1 Rubric',
            criteria: [
                {
                    maxMarks: 10
                } as any
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
        expect(error.errors['criteria.0.criterionName']).toBeDefined();
    });

    it('should fail validation if a criterion has negative maxMarks', async () => {
        const examId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();

        const rubricData = {
            exam: examId,
            title: 'Midterm 1 Rubric',
            criteria: [
                {
                    criterionName: 'Correctness',
                    maxMarks: -1
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
        expect(error.errors['criteria.0.maxMarks']).toBeDefined();
    });

    it('should save a valid Rubric document to the database and generate timestamps', async () => {
        const examId = new mongoose.Types.ObjectId();
        const userId = new mongoose.Types.ObjectId();

        const rubricData = {
            exam: examId,
            title: 'Midterm 1 Rubric Test Save',
            description: 'Grading rubric test save description',
            criteria: [
                {
                    criterionName: 'Correctness',
                    description: 'Is the solution logically correct?',
                    maxMarks: 10
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
