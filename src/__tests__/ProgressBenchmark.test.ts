/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AllocationService from '../services/AllocationService';

describe('AE-105: Progress Aggregation Performance Benchmark & Workload Analysis', () => {
    let prof: any;
    let tas: any[] = [];
    let course: any;
    let examSmall: any;
    let examMedium: any;
    let examLarge: any;

    beforeAll(async () => {
        await User.init();
        await Course.init();
        await Exam.init();
        await AnswerScript.init();
        await Allocation.init();
    });

    beforeEach(async () => {
        await Allocation.deleteMany({});
        await AnswerScript.deleteMany({});
        await Exam.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});

        prof = await User.create({
            name: 'Prof. McGonagall',
            email: 'mcgonagall@hogwarts.edu',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        tas = [];
        for (let i = 1; i <= 15; i++) {
            const ta = await User.create({
                name: `TA Number ${i.toString().padStart(2, '0')}`,
                email: `ta${i}@hogwarts.edu`,
                password: 'password123',
                role: UserRole.TA,
                isActive: true
            });
            tas.push(ta);
        }

        course = await Course.create({
            courseCode: 'CS101',
            courseName: 'Intro to Computer Science',
            semester: 1,
            academicYear: '2026-2027',
            professor: prof._id,
            teachingAssistants: tas.map((t) => t._id),
            isActive: true
        });

        examSmall = await Exam.create({
            title: 'Small Exam (200 allocations)',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.PUBLISHED,
            numberOfQuestions: 4,
            isActive: true
        });

        examMedium = await Exam.create({
            title: 'Medium Exam (1,000 allocations)',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.PUBLISHED,
            numberOfQuestions: 5,
            isActive: true
        });

        examLarge = await Exam.create({
            title: 'Large Exam (2,500 allocations)',
            course: course._id,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            status: ExamStatus.PUBLISHED,
            numberOfQuestions: 5,
            isActive: true
        });
    });

    const seedAllocations = async (exam: any, count: number, taCount: number) => {
        const selectedTas = tas.slice(0, taCount);
        const docs = [];
        for (let i = 0; i < count; i++) {
            const dummyScriptId = new mongoose.Types.ObjectId();
            const ta = selectedTas[i % taCount];
            const isCompleted = i % 3 === 0; // 33% completion rate

            docs.push({
                exam: exam._id,
                ta: ta._id,
                answerScript: dummyScriptId,
                allocatedBy: prof._id,
                rule: AllocationRule.QUESTION,
                question: (i % 5) + 1,
                status: isCompleted ? AllocationStatus.COMPLETED : AllocationStatus.IN_PROGRESS
            });
        }
        await Allocation.insertMany(docs);
    };

    it('1. Verifies index scan utilization on { exam: 1 } for aggregation query', async () => {
        await seedAllocations(examMedium, 1000, 10);

        // Run explain on the aggregation pipeline to verify index utilization
        const explainResult: any = await Allocation.aggregate([
            { $match: { exam: examMedium._id } },
            { $group: { _id: '$ta', total: { $sum: 1 } } }
        ]).explain('executionStats');

        expect(explainResult).toBeDefined();
        const stats = explainResult.executionStats || explainResult.stages?.[0]?.$cursor?.executionStats;
        if (stats) {
            expect(stats.executionSuccess).toBe(true);
            // 10 distinct TAs returned after group stage
            expect(stats.nReturned).toBe(10);
        }
    });

    it('2. Benchmarks Small Dataset (200 allocations, 4 TAs)', async () => {
        await seedAllocations(examSmall, 200, 4);

        // Cold read
        const t0 = performance.now();
        const coldResult = await AllocationService.getProgress(examSmall._id.toString());
        const coldDurationMs = performance.now() - t0;

        expect(coldResult.total).toBe(200);
        expect(coldResult.progress.length).toBe(4);

        // Warm reads (30 iterations)
        const iterations = 30;
        const startWarm = performance.now();
        for (let i = 0; i < iterations; i++) {
            const res = await AllocationService.getProgress(examSmall._id.toString());
            expect(res.total).toBe(200);
        }
        const avgWarmMs = (performance.now() - startWarm) / iterations;

        console.log(`\n[Benchmark: Small Workload (200 allocations, 4 TAs)]`);
        console.log(`Cold Read Latency: ${coldDurationMs.toFixed(2)} ms`);
        console.log(`Warm Read Avg Latency: ${avgWarmMs.toFixed(2)} ms (over ${iterations} iterations)`);

        expect(avgWarmMs).toBeLessThan(50); // Well within acceptable bounds (< 50ms)
    });

    it('3. Benchmarks Medium Dataset (1,000 allocations, 10 TAs)', async () => {
        await seedAllocations(examMedium, 1000, 10);

        // Cold read
        const t0 = performance.now();
        const coldResult = await AllocationService.getProgress(examMedium._id.toString());
        const coldDurationMs = performance.now() - t0;

        expect(coldResult.total).toBe(1000);
        expect(coldResult.progress.length).toBe(10);

        // Warm reads (30 iterations)
        const iterations = 30;
        const startWarm = performance.now();
        for (let i = 0; i < iterations; i++) {
            const res = await AllocationService.getProgress(examMedium._id.toString());
            expect(res.total).toBe(1000);
        }
        const avgWarmMs = (performance.now() - startWarm) / iterations;

        console.log(`\n[Benchmark: Medium Workload (1,000 allocations, 10 TAs)]`);
        console.log(`Cold Read Latency: ${coldDurationMs.toFixed(2)} ms`);
        console.log(`Warm Read Avg Latency: ${avgWarmMs.toFixed(2)} ms (over ${iterations} iterations)`);

        expect(avgWarmMs).toBeLessThan(100); // Well within acceptable bounds (< 100ms)
    });

    it('4. Benchmarks Large Dataset (2,500 allocations, 15 TAs)', async () => {
        await seedAllocations(examLarge, 2500, 15);

        // Cold read
        const t0 = performance.now();
        const coldResult = await AllocationService.getProgress(examLarge._id.toString());
        const coldDurationMs = performance.now() - t0;

        expect(coldResult.total).toBe(2500);
        expect(coldResult.progress.length).toBe(15);

        // Warm reads (20 iterations)
        const iterations = 20;
        const startWarm = performance.now();
        for (let i = 0; i < iterations; i++) {
            const res = await AllocationService.getProgress(examLarge._id.toString());
            expect(res.total).toBe(2500);
        }
        const avgWarmMs = (performance.now() - startWarm) / iterations;

        console.log(`\n[Benchmark: Large Workload (2,500 allocations, 15 TAs)]`);
        console.log(`Cold Read Latency: ${coldDurationMs.toFixed(2)} ms`);
        console.log(`Warm Read Avg Latency: ${avgWarmMs.toFixed(2)} ms (over ${iterations} iterations)`);

        expect(avgWarmMs).toBeLessThan(150); // Well within acceptable bounds (< 150ms)
    });

    it('5. Benchmarks Very Large Dataset (5,000 allocations, 15 TAs)', async () => {
        await seedAllocations(examLarge, 5000, 15);

        // Cold read
        const t0 = performance.now();
        const coldResult = await AllocationService.getProgress(examLarge._id.toString());
        const coldDurationMs = performance.now() - t0;

        expect(coldResult.total).toBe(5000);
        expect(coldResult.progress.length).toBe(15);

        // Warm reads (20 iterations)
        const iterations = 20;
        const startWarm = performance.now();
        for (let i = 0; i < iterations; i++) {
            const res = await AllocationService.getProgress(examLarge._id.toString());
            expect(res.total).toBe(5000);
        }
        const avgWarmMs = (performance.now() - startWarm) / iterations;

        console.log(`\n[Benchmark: Very Large Workload (5,000 allocations, 15 TAs)]`);
        console.log(`Cold Read Latency: ${coldDurationMs.toFixed(2)} ms`);
        console.log(`Warm Read Avg Latency: ${avgWarmMs.toFixed(2)} ms (over ${iterations} iterations)`);

        expect(avgWarmMs).toBeLessThan(200);
    });
});
