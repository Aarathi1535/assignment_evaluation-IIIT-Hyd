import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import Exam from '../models/Exam';
import Course from '../models/Course';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import { AllocationService } from '../services/AllocationService';

describe('Allocation Transaction Safety Tests', () => {
    let replSet: MongoMemoryReplSet;
    const professorId = new mongoose.Types.ObjectId().toString();
    const taId = new mongoose.Types.ObjectId().toString();
    let testExamId: mongoose.Types.ObjectId;
    let testCourseId: mongoose.Types.ObjectId;
    let testScriptId: mongoose.Types.ObjectId;

    beforeAll(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }

        replSet = await MongoMemoryReplSet.create({
            replSet: { storageEngine: 'wiredTiger' }
        });
        const uri = replSet.getUri();
        await mongoose.connect(uri);
    });

    afterAll(async () => {
        await mongoose.disconnect();
        if (replSet) {
            await replSet.stop();
        }

        const fallbackUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/test-placeholder-safety';
        try {
            await mongoose.connect(fallbackUri);
        } catch {
            // ignore
        }
    });

    beforeEach(async () => {
        await Course.deleteMany({});
        await Exam.deleteMany({});
        await AnswerScript.deleteMany({});
        await Allocation.deleteMany({});

        // Create Course with TA enrolled
        const course = await Course.create({
            courseCode: 'CS101',
            courseName: 'Intro CS',
            semester: 1,
            academicYear: '2026-27',
            professor: new mongoose.Types.ObjectId(professorId),
            teachingAssistants: [new mongoose.Types.ObjectId(taId)],
            isActive: true
        });
        testCourseId = course._id;

        // Create Exam
        const exam = await Exam.create({
            title: 'Test Exam',
            course: testCourseId,
            createdBy: new mongoose.Types.ObjectId(professorId),
            examDate: new Date('2026-12-01'),
            totalMarks: 100,
            numberOfQuestions: 3,
            isActive: true
        });
        testExamId = exam._id;

        // Create eligible Answer Script
        const script = await AnswerScript.create({
            exam: testExamId,
            student: new mongoose.Types.ObjectId(),
            needsManualId: false,
            isActive: true
        });
        testScriptId = script._id;
    });

    it('1. should roll back and preserve existing allocations if creation of replacement allocations fails', async () => {
        // Seed initial allocations
        const scriptId = new mongoose.Types.ObjectId();
        const initialAlloc = new Allocation({
            exam: testExamId,
            ta: new mongoose.Types.ObjectId(taId),
            answerScript: scriptId,
            allocatedBy: new mongoose.Types.ObjectId(professorId),
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        });
        await initialAlloc.save();

        // Verify initial allocation is seeded
        const initialCount = await Allocation.countDocuments({ exam: testExamId });
        expect(initialCount).toBe(1);

        // Spy on Allocation.create and force it to reject/fail during transaction execution
        const createSpy = vi.spyOn(Allocation, 'create').mockRejectedValueOnce(new Error('Simulated Database Error During Allocation Creation'));

        // Run allocation - it should fail with our simulated error
        await expect(
            AllocationService.allocateEqual(testExamId.toString(), [taId], professorId)
        ).rejects.toThrow('Simulated Database Error During Allocation Creation');

        // Verify that the initial allocation was NOT deleted (rolled back successfully!)
        const afterFailCount = await Allocation.countDocuments({ exam: testExamId });
        expect(afterFailCount).toBe(1);

        const savedAlloc = await Allocation.findOne({ exam: testExamId });
        expect(savedAlloc?.answerScript.toString()).toBe(scriptId.toString());

        createSpy.mockRestore();
    });

    it('2. should replace the previous allocations successfully when transaction commits', async () => {
        // Seed initial allocations
        const scriptId = new mongoose.Types.ObjectId();
        const initialAlloc = new Allocation({
            exam: testExamId,
            ta: new mongoose.Types.ObjectId(taId),
            answerScript: scriptId,
            allocatedBy: new mongoose.Types.ObjectId(professorId),
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        });
        await initialAlloc.save();

        // Run allocation successfully
        const newAllocations = await AllocationService.allocateEqual(testExamId.toString(), [taId], professorId);
        expect(newAllocations.length).toBe(1);

        // Verify that the initial allocation is gone, and only the new one exists
        const count = await Allocation.countDocuments({ exam: testExamId });
        expect(count).toBe(1);

        const savedAlloc = await Allocation.findOne({ exam: testExamId });
        expect(savedAlloc?.answerScript.toString()).not.toBe(scriptId.toString());
        expect(savedAlloc?.answerScript.toString()).toBe(testScriptId.toString());
    });
});
