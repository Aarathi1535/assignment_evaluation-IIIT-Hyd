/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import Allocation, { AllocationRule, AllocationStatus } from '../models/Allocation';
import AnswerScript from '../models/AnswerScript';
import Exam, { IngestionApprovalStatus } from '../models/Exam';
import Course from '../models/Course';
import User from '../models/User';
import Grade from '../models/Grade';

// Mock NextAuth session
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

describe('Professor Allocation Preview & UI Settings API Tests (AE-087)', () => {
    let previewPOST: any;
    let allocateGET: any;
    let allocatePOST: any;
    let testExamId: mongoose.Types.ObjectId;
    let testCourseId: mongoose.Types.ObjectId;
    let professorId: mongoose.Types.ObjectId;
    let taId1: mongoose.Types.ObjectId;
    let taId2: mongoose.Types.ObjectId;
    let studentId1: mongoose.Types.ObjectId;
    let studentId2: mongoose.Types.ObjectId;
    let studentId3: mongoose.Types.ObjectId;

    beforeAll(async () => {
        previewPOST = (await import('../app/api/exams/[id]/allocate/preview/route')).POST;
        allocateGET = (await import('../app/api/exams/[id]/allocate/route')).GET;
        allocatePOST = (await import('../app/api/exams/[id]/allocate/route')).POST;

        // Force model initialization
        await Allocation.init();
        await AnswerScript.init();

        professorId = new mongoose.Types.ObjectId('000000000000000000000100');
        taId1 = new mongoose.Types.ObjectId('000000000000000000000103');
        taId2 = new mongoose.Types.ObjectId('000000000000000000000104');
        studentId1 = new mongoose.Types.ObjectId('000000000000000000000101');
        studentId2 = new mongoose.Types.ObjectId('000000000000000000000102');
        studentId3 = new mongoose.Types.ObjectId('000000000000000000000106');
    });

    beforeEach(async () => {
        // Clean collections
        await Course.deleteMany({});
        await Exam.deleteMany({});
        await Allocation.deleteMany({});
        await AnswerScript.deleteMany({});
        await User.deleteMany({});
        await Grade.deleteMany({});

        // Create TAs in database so populate works
        await new User({ _id: taId1, name: 'TA 1', email: 'ta1@example.com', role: 'TA', password: 'password123' }).save();
        await new User({ _id: taId2, name: 'TA 2', email: 'ta2@example.com', role: 'TA', password: 'password123' }).save();

        // Mock authenticated user as Professor (owners of course/exams)
        mockSessionUser = {
            id: professorId.toString(),
            role: 'PROFESSOR',
            email: 'prof@iiit.ac.in',
            name: 'Prof. Allocation'
        };

        const course = new Course({
            courseCode: 'CS102',
            courseName: 'Data Structures',
            semester: 2,
            academicYear: '2026-2027',
            professor: professorId,
            teachingAssistants: [taId1, taId2],
            enrolledStudents: [studentId1, studentId2, studentId3],
            isActive: true
        });
        const savedCourse = await course.save();
        testCourseId = savedCourse._id as mongoose.Types.ObjectId;

        const exam = new Exam({
            title: 'Quiz 1',
            course: testCourseId,
            createdBy: professorId,
            examDate: new Date('2026-09-15T09:00:00.000Z'),
            totalMarks: 30,
            numberOfQuestions: 3,
            status: 'DRAFT',
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            isActive: true
        });
        const savedExam = await exam.save();
        testExamId = savedExam._id as mongoose.Types.ObjectId;
    });

    // Helper to invoke NextRequest
    function makeRequest(url: string, body: any) {
        return new NextRequest(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    function makeContext(examId: string) {
        return { params: Promise.resolve({ id: examId }) };
    }

    it('1. GET /api/exams/[id]/allocate returns exam settings and TAs', async () => {
        const req = new NextRequest(`http://localhost:3000/api/exams/${testExamId}/allocate`, {
            method: 'GET'
        });
        const res = await allocateGET(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.exam.title).toBe('Quiz 1');
        expect(body.data.teachingAssistants).toHaveLength(2);
        // TAs are populated
        expect(body.data.teachingAssistants[0]._id).toBeDefined();
    });

    it('2. EQUAL rule preview returns correct TA counts, total eligible, and does not create allocations', async () => {
        // Create 2 eligible answer scripts
        await AnswerScript.create([
            { exam: testExamId, student: studentId1, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, isActive: true },
            { exam: testExamId, student: studentId2, batchId: 'b1', fileIndex: 1, startPageNumber: 2, endPageNumber: 2, pageCount: 1, isActive: true }
        ]);

        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/preview`, {
            rule: AllocationRule.EQUAL,
            taIds: [taId1.toString(), taId2.toString()]
        });

        const res = await previewPOST(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.totalEligibleScripts).toBe(2);
        expect(body.data.totalExcludedScripts).toBe(0);
        expect(body.data.excludedCountsByReason).toEqual({});
        
        // 2 scripts allocated equally among 2 TAs => 1 each
        expect(body.data.allocationCounts[taId1.toString()]).toBe(1);
        expect(body.data.allocationCounts[taId2.toString()]).toBe(1);

        // Verify that NO allocations are stored in database
        const dbAllocationsCount = await Allocation.countDocuments({ exam: testExamId });
        expect(dbAllocationsCount).toBe(0);
    });

    it('3. QUESTION rule preview calculates correctly (scripts * questions) and does not commit', async () => {
        // Create 2 eligible answer scripts
        await AnswerScript.create([
            { exam: testExamId, student: studentId1, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, isActive: true },
            { exam: testExamId, student: studentId2, batchId: 'b1', fileIndex: 1, startPageNumber: 2, endPageNumber: 2, pageCount: 1, isActive: true }
        ]);

        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/preview`, {
            rule: AllocationRule.QUESTION,
            taIds: [taId1.toString(), taId2.toString()]
        });

        const res = await previewPOST(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.success).toBe(true);
        // Under QUESTION allocation, total eligible scripts is still 2
        expect(body.data.totalEligibleScripts).toBe(2);

        // 2 scripts * 3 questions = 6 total allocation items.
        // Distributed so each script's 3 questions are allocated to TAs using (q-1)%TAs (reset per script).
        // Resulting in 4 items for taId1 and 2 items for taId2.
        expect(body.data.allocationCounts[taId1.toString()]).toBe(4);
        expect(body.data.allocationCounts[taId2.toString()]).toBe(2);

        const dbAllocationsCount = await Allocation.countDocuments({ exam: testExamId });
        expect(dbAllocationsCount).toBe(0);
    });

    it('4. seeded RANDOM rule preview is deterministic and does not commit', async () => {
        // Create 3 eligible answer scripts
        await AnswerScript.create([
            { exam: testExamId, student: studentId1, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, isActive: true },
            { exam: testExamId, student: studentId2, batchId: 'b1', fileIndex: 1, startPageNumber: 2, endPageNumber: 2, pageCount: 1, isActive: true },
            { exam: testExamId, student: studentId3, batchId: 'b1', fileIndex: 2, startPageNumber: 3, endPageNumber: 3, pageCount: 1, isActive: true }
        ]);

        const req1 = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/preview`, {
            rule: AllocationRule.RANDOM,
            taIds: [taId1.toString(), taId2.toString()],
            seed: 42
        });
        const res1 = await previewPOST(req1, makeContext(testExamId.toString()));
        const body1 = await res1.json();

        const req2 = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/preview`, {
            rule: AllocationRule.RANDOM,
            taIds: [taId1.toString(), taId2.toString()],
            seed: 42
        });
        const res2 = await previewPOST(req2, makeContext(testExamId.toString()));
        const body2 = await res2.json();

        // Check determinism: same seed produces same allocation count mapping
        expect(body1.data.allocationCounts).toEqual(body2.data.allocationCounts);

        const dbAllocationsCount = await Allocation.countDocuments({ exam: testExamId });
        expect(dbAllocationsCount).toBe(0);
    });

    it('5. Preview identifies and counts excluded scripts with reasons (Inactive, Unidentified, Manual ID)', async () => {
        // 1 eligible script, 1 inactive, 1 unidentified (no student), 1 needsManualId
        await AnswerScript.create([
            { exam: testExamId, student: studentId1, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, isActive: true },
            { exam: testExamId, student: studentId2, batchId: 'b1', fileIndex: 1, startPageNumber: 2, endPageNumber: 2, pageCount: 1, isActive: false },
            { exam: testExamId, student: null, batchId: 'b1', fileIndex: 2, startPageNumber: 3, endPageNumber: 3, pageCount: 1, isActive: true },
            { exam: testExamId, student: studentId3, batchId: 'b1', fileIndex: 3, startPageNumber: 4, endPageNumber: 4, pageCount: 1, needsManualId: true, manualIdReason: 'NO_CODE_FOUND', isActive: true }
        ]);

        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/preview`, {
            rule: AllocationRule.EQUAL,
            taIds: [taId1.toString()]
        });

        const res = await previewPOST(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.totalEligibleScripts).toBe(1);
        expect(body.data.totalExcludedScripts).toBe(3);

        // Verify counts grouped by reason
        expect(body.data.excludedCountsByReason).toEqual({
            'Inactive script': 1,
            'Student not identified': 1,
            'NO_CODE_FOUND': 1
        });

        // Verify that raw script IDs/exclusions details are not exposed
        expect(body.data.excludedScripts).toBeUndefined();
    });

    it('6. Ingestion Approval Gate check: preview throws 403 if ingestion review is not approved', async () => {
        // Update exam ingestion status to review pending
        await Exam.findByIdAndUpdate(testExamId, { ingestionApprovalStatus: IngestionApprovalStatus.PENDING_REVIEW });

        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/preview`, {
            rule: AllocationRule.EQUAL,
            taIds: [taId1.toString()]
        });

        const res = await previewPOST(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(403);

        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toContain('Ingestion has not been approved');
    });

    it('7. numberOfQuestions = 0 is rejected by both preview and actual allocation', async () => {
        // Set exam numberOfQuestions to 0
        await Exam.findByIdAndUpdate(testExamId, { numberOfQuestions: 0 });

        // Create 1 eligible script
        await AnswerScript.create([
            { exam: testExamId, student: studentId1, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, isActive: true }
        ]);

        // 1. Preview allocation
        const previewReq = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/preview`, {
            rule: AllocationRule.QUESTION,
            taIds: [taId1.toString()]
        });
        const previewRes = await previewPOST(previewReq, makeContext(testExamId.toString()));
        expect(previewRes.status).toBe(400);
        const previewBody = await previewRes.json();
        expect(previewBody.success).toBe(false);
        expect(previewBody.message).toContain('Invalid number of questions: 0');

        // 2. Actual allocation
        const allocateReq = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate`, {
            rule: AllocationRule.QUESTION,
            taIds: [taId1.toString()]
        });
        const allocateRes = await allocatePOST(allocateReq, makeContext(testExamId.toString()));
        expect(allocateRes.status).toBe(400);
        const allocateBody = await allocateRes.json();
        expect(allocateBody.success).toBe(false);
        expect(allocateBody.message).toContain('Invalid number of questions: 0');
    });

    it('8. preview is rejected when grading has commenced (existing allocation has non-pending status)', async () => {
        // Create 1 eligible script
        const script = await AnswerScript.create(
            { exam: testExamId, student: studentId1, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, isActive: true }
        );

        // Create an existing allocation with status IN_PROGRESS
        await Allocation.create({
            exam: testExamId,
            ta: taId1,
            answerScript: script._id,
            allocatedBy: professorId,
            status: AllocationStatus.IN_PROGRESS,
            rule: AllocationRule.EQUAL
        });

        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/preview`, {
            rule: AllocationRule.EQUAL,
            taIds: [taId1.toString()]
        });

        const res = await previewPOST(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toContain('Cannot re-run allocation: grading has already commenced for this exam.');
    });

    it('9. preview is rejected when grading has commenced (grades exist for the exam)', async () => {
        // Create 1 eligible script
        const script = await AnswerScript.create(
            { exam: testExamId, student: studentId1, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, isActive: true }
        );

        // Create a Grade document for that script
        await Grade.create({
            answerScript: script._id,
            rubric: new mongoose.Types.ObjectId(),
            gradedBy: professorId,
            marksAwarded: [],
            totalScore: 0,
            isFinal: false
        });

        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/preview`, {
            rule: AllocationRule.EQUAL,
            taIds: [taId1.toString()]
        });

        const res = await previewPOST(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toContain('Cannot re-run allocation: grades already exist for this exam.');
    });

    it('10. preview remains side-effect free: does not delete or modify existing allocations', async () => {
        // Create 1 eligible script
        const script = await AnswerScript.create(
            { exam: testExamId, student: studentId1, batchId: 'b1', fileIndex: 0, startPageNumber: 1, endPageNumber: 1, pageCount: 1, isActive: true }
        );

        // Create an existing allocation with status PENDING (which allows preview to proceed, as grading has not commenced)
        const initialAlloc = await Allocation.create({
            exam: testExamId,
            ta: taId1,
            answerScript: script._id,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        });

        // Run preview
        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/preview`, {
            rule: AllocationRule.EQUAL,
            taIds: [taId1.toString()]
        });

        const res = await previewPOST(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(200);

        // Verify that the existing PENDING allocation was NOT deleted (unlike real allocation, which deletes existing allocations on re-run)
        const allocations = await Allocation.find({ exam: testExamId });
        expect(allocations).toHaveLength(1);
        expect(allocations[0]._id.toString()).toBe(initialAlloc._id.toString());
    });
});
