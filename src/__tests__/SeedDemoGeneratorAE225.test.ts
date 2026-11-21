/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { seedDemoData, isDatabaseHostAllowed } from '../scripts/seedDemoData';
import defaultDerivedStorageService from '../services/DerivedStorageService';
import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Page from '../models/Page';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Grade from '../models/Grade';
import StudentMapping from '../models/StudentMapping';

describe('AE-225: Repeatable Seed/Demo Data Generator', () => {
    beforeEach(async () => {
        // Clean database collections
        await Promise.all([
            Grade.deleteMany({}),
            Allocation.deleteMany({}),
            Page.deleteMany({}),
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

    it('refuses to seed non-allowlisted database hosts', async () => {
        const originalUri = process.env.MONGODB_URI;
        try {
            process.env.MONGODB_URI = 'mongodb://prod-cluster.mongodb.net:27017/production_db';
            await expect(seedDemoData({ studentsCount: 2 })).rejects.toThrow(
                /non-allowlisted database hosts/i
            );
        } finally {
            process.env.MONGODB_URI = originalUri;
        }

        expect(isDatabaseHostAllowed('mongodb://127.0.0.1:27017/test')).toBe(true);
        expect(isDatabaseHostAllowed('mongodb://localhost:27017/test')).toBe(true);
        expect(isDatabaseHostAllowed('mongodb://[::1]:27017/test')).toBe(true);
        // Host containing "demo" must NOT be allowed without explicit DEMO_CLUSTER_HOST configuration
        expect(isDatabaseHostAllowed('mongodb://demo-cluster.internal:27017/test')).toBe(false);

        const originalDemoCluster = process.env.DEMO_CLUSTER_HOST;
        try {
            process.env.DEMO_CLUSTER_HOST = 'demo-cluster.internal';
            expect(isDatabaseHostAllowed('mongodb://demo-cluster.internal:27017/test')).toBe(true);
            expect(isDatabaseHostAllowed('mongodb://other-demo-cluster.internal:27017/test')).toBe(false);
        } finally {
            process.env.DEMO_CLUSTER_HOST = originalDemoCluster;
        }

        expect(isDatabaseHostAllowed('mongodb://prod.customer-data.internal:27017/live')).toBe(false);
        expect(isDatabaseHostAllowed('not-a-mongo-uri')).toBe(false);
        expect(isDatabaseHostAllowed('')).toBe(false);
        expect(isDatabaseHostAllowed(undefined)).toBe(false);
    });

    it('generates complete demonstration environment with valid referential integrity, pages, and dynamic credentials', async () => {
        const result = await seedDemoData({
            coursesCount: 1,
            examsPerCourse: 1,
            studentsCount: 3,
            tasCount: 2,
            questionsCount: 2,
            pagesPerScript: 2,
            withGrades: true,
        });

        expect(result.stats.courses).toBe(1);
        expect(result.stats.exams).toBe(1);
        expect(result.stats.students).toBe(3);
        expect(result.stats.tas).toBe(2);
        expect(result.stats.scripts).toBe(3);
        expect(result.stats.pages).toBe(6); // 3 scripts * 2 pages
        expect(result.stats.allocations).toBe(3);
        expect(result.stats.grades).toBe(6); // 3 students * 2 questions
        expect(result.generatedPassword).toBeDefined();

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

        // Verify pages and derived image storage
        const pages = await Page.find({ answerScript: { $in: result.scriptIds } });
        expect(pages.length).toBe(6);
        for (const page of pages) {
            expect(page.imagePath).toBeDefined();
            expect(page.imagePath.length).toBeGreaterThan(0);
            expect(page.width).toBe(800);
            expect(page.height).toBe(1000);

            // Verify that generated page images are actually persisted and readable from DerivedStorageService
            const exists = await defaultDerivedStorageService.derivedPageExists(page.imagePath);
            expect(exists).toBe(true);
            const imageBuffer = await defaultDerivedStorageService.readDerivedPage(page.imagePath);
            expect(imageBuffer.length).toBeGreaterThan(0);
            // PNG signature bytes: 89 50 4E 47 0D 0A 1A 0A
            expect(imageBuffer.subarray(0, 8)).toEqual(
                Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
            );
        }

        // Verify grades
        const grades = await Grade.find({ rubric: rubric?._id });
        expect(grades.length).toBe(6);
        for (const grade of grades) {
            expect(grade.isFinal).toBe(true);
            expect(grade.totalScore).toBeGreaterThan(0);
        }

        // Verify password hash against the returned generated password
        const prof = await User.findById(course?.professor);
        const matches = await bcrypt.compare(result.generatedPassword!, prof!.password!);
        expect(matches).toBe(true);
    });

    it('--clean deletes ONLY demo records without touching real production or non-demo exams', async () => {
        // 1. Create a real non-demo Course, and an Exam whose title contains "Demo"
        const realProf = await User.create({
            name: 'Prof. Real Faculty',
            email: 'real.professor@university.edu',
            password: 'RealPassword123!',
            role: UserRole.PROFESSOR,
            isActive: true,
        });

        const realCourse = await Course.create({
            courseCode: 'REAL-CS500',
            courseName: 'Advanced Distributed Systems',
            professor: realProf._id,
            semester: 2,
            academicYear: '2026-2027',
            isActive: true,
        });

        const realExam = await Exam.create({
            title: 'Midterm Demo Examination 2026',
            course: realCourse._id,
            createdBy: realProf._id,
            examDate: new Date(),
            numberOfQuestions: 1,
            totalMarks: 20,
            status: ExamStatus.EVALUATING,
            isActive: true,
        });

        const realRubric = await Rubric.create({
            exam: realExam._id,
            createdBy: realProf._id,
            scoreStep: 1,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 20,
                    description: 'Question 1',
                    criteria: [{ criterionName: 'Correctness', points: 20 }],
                },
            ],
            isActive: true,
        });

        const realScript = await AnswerScript.create({
            exam: realExam._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            batchId: 'REAL-BATCH-001',
            fileIndex: 0,
            startPageNumber: 1,
            endPageNumber: 2,
            filename: 'real_exam.pdf',
            pageCount: 2,
            isActive: true,
        });

        const realPage = await Page.create({
            answerScript: realScript._id,
            pageNumber: 1,
            imagePath: 'real/storage/path/page1.png',
            width: 800,
            height: 1000,
        });

        const realAllocation: any = await Allocation.create({
            exam: realExam._id,
            answerScript: realScript._id,
            ta: realProf._id,
            allocatedBy: realProf._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL,
        });

        const realStudentMapping = await StudentMapping.create({
            exam: realExam._id,
            student: realProf._id,
            anonymousId: 'REAL-ANON-1',
            rollNumber: 'REAL-ROLL-001',
            isVerified: true,
        });

        const realGrade = await Grade.create({
            answerScript: realScript._id,
            rubric: realRubric._id,
            gradedBy: realProf._id,
            question: 1,
            totalScore: 18,
            isFinal: true,
        });

        // 2. Run seed with cleanFirst
        await seedDemoData({
            coursesCount: 1,
            studentsCount: 2,
            tasCount: 1,
            cleanFirst: true,
        });

        // 3. Assert real non-demo records were NOT deleted despite exam title containing "Demo"
        expect(await Course.findById(realCourse._id)).not.toBeNull();
        expect(await Exam.findById(realExam._id)).not.toBeNull();
        expect(await Rubric.findById(realRubric._id)).not.toBeNull();
        expect(await AnswerScript.findById(realScript._id)).not.toBeNull();
        expect(await Page.findById(realPage._id)).not.toBeNull();
        expect(await Allocation.findById(realAllocation._id)).not.toBeNull();
        expect(await StudentMapping.findById(realStudentMapping._id)).not.toBeNull();
        expect(await Grade.findById(realGrade._id)).not.toBeNull();
        expect(await User.findById(realProf._id)).not.toBeNull();

        // Assert demo course also exists
        expect(await Course.countDocuments({ courseCode: /^DEMO-/ })).toBe(1);
    });

    it('is repeatable and idempotent across multiple runs without --clean', async () => {
        // Run 1
        const run1 = await seedDemoData({
            coursesCount: 1,
            examsPerCourse: 1,
            studentsCount: 3,
            tasCount: 2,
            cleanFirst: false,
        });

        expect(run1.stats.courses).toBe(1);
        expect(run1.stats.exams).toBe(1);
        expect(await Course.countDocuments({ courseCode: /^DEMO-/ })).toBe(1);
        expect(await Exam.countDocuments({ title: /Demo/i })).toBe(1);

        // Run 2: Same parameters without --clean
        const run2 = await seedDemoData({
            coursesCount: 1,
            examsPerCourse: 1,
            studentsCount: 3,
            tasCount: 2,
            cleanFirst: false,
        });

        // Should not duplicate courses or exams; should not collide on courseCode unique index
        expect(run2.stats.courses).toBe(1);
        expect(run2.stats.exams).toBe(1);
        expect(await Course.countDocuments({ courseCode: /^DEMO-/ })).toBe(1);
        expect(await Exam.countDocuments({ title: /Demo/i })).toBe(1);
        expect(await AnswerScript.countDocuments({ batchId: /^DEMO-BATCH/ })).toBe(3);
    });
});
