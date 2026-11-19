/* eslint-disable @typescript-eslint/no-unused-vars */
import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { seedDemoData } from '../scripts/seedDemoData';
import User from '../models/User';
import Course from '../models/Course';
import Exam from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import Allocation from '../models/Allocation';
import Grade from '../models/Grade';

describe('AE-225: Repeatable Seed/Demo Data Generator', () => {
    beforeEach(async () => {
        // Clean database collections
        await Promise.all([
            Grade.deleteMany({}),
            Allocation.deleteMany({}),
            AnswerScript.deleteMany({}),
            Rubric.deleteMany({}),
            Exam.deleteMany({}),
            Course.deleteMany({}),
            User.deleteMany({}),
        ]);
    });

    it('forbids running seed generation in production environment', async () => {
        const originalEnv = process.env.NODE_ENV;
        try {
            (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
            await expect(seedDemoData({ studentsCount: 2 })).rejects.toThrow(
                /forbidden in production/i
            );
        } finally {
            (process.env as Record<string, string | undefined>).NODE_ENV = originalEnv;
        }
    });

    it('generates a complete demonstration environment with valid referential integrity', async () => {
        const result = await seedDemoData({
            coursesCount: 1,
            examsPerCourse: 1,
            studentsCount: 3,
            tasCount: 2,
            questionsCount: 2,
            withGrades: true,
        });

        expect(result.stats.courses).toBe(1);
        expect(result.stats.exams).toBe(1);
        expect(result.stats.students).toBe(3);
        expect(result.stats.tas).toBe(2);
        expect(result.stats.scripts).toBe(3);
        expect(result.stats.allocations).toBe(3);
        expect(result.stats.grades).toBe(6); // 3 students * 2 questions

        // Verify referential integrity in MongoDB
        const course = await Course.findById(result.courseIds[0]);
        expect(course).not.toBeNull();
        expect(course?.enrolledStudents?.length).toBe(3);
        expect(course?.teachingAssistants?.length).toBe(2);

        const exam = await Exam.findById(result.examIds[0]);
        expect(exam).not.toBeNull();
        expect(exam?.numberOfQuestions).toBe(2);

        const rubric = await Rubric.findOne({ exam: exam?._id });
        expect(rubric).not.toBeNull();
        expect(rubric?.questions.length).toBe(2);

        // Verify allocations
        const allocations = await Allocation.find({ exam: exam?._id });
        expect(allocations.length).toBe(3);
        for (const alloc of allocations) {
            expect(result.taIds).toContain(alloc.ta.toString());
            expect(result.scriptIds).toContain(alloc.answerScript.toString());
        }

        // Verify grades
        const grades = await Grade.find({ rubric: rubric?._id });
        expect(grades.length).toBe(6);
        for (const grade of grades) {
            expect(grade.isFinal).toBe(true);
            expect(grade.totalScore).toBeGreaterThan(0);
        }
    });

    it('supports clean idempotent re-seeding', async () => {
        // First seed
        await seedDemoData({
            coursesCount: 1,
            studentsCount: 2,
            tasCount: 1,
            cleanFirst: true,
        });

        expect(await AnswerScript.countDocuments()).toBe(2);

        // Second seed with cleanFirst
        const result2 = await seedDemoData({
            coursesCount: 1,
            studentsCount: 4,
            tasCount: 2,
            cleanFirst: true,
        });

        expect(result2.stats.students).toBe(4);
        expect(await AnswerScript.countDocuments()).toBe(4);
    });
});
