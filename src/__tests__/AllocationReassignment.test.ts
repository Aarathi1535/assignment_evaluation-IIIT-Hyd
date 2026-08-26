/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import Allocation, { AllocationRule, AllocationStatus } from '../models/Allocation';
import AnswerScript from '../models/AnswerScript';
import Exam from '../models/Exam';
import Course from '../models/Course';
import User from '../models/User';
import AuditLog from '../models/AuditLog';
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

describe('Manual Allocation Reassignment API & Transaction Tests (AE-088)', () => {
    let reassignPUT: any;
    let testExamId: mongoose.Types.ObjectId;
    let testCourseId: mongoose.Types.ObjectId;
    let professorId: mongoose.Types.ObjectId;
    let taId1: mongoose.Types.ObjectId;
    let taId2: mongoose.Types.ObjectId;
    let studentId: mongoose.Types.ObjectId;
    let scriptId1: mongoose.Types.ObjectId;

    beforeAll(async () => {
        reassignPUT = (await import('../app/api/exams/[id]/allocate/reassign/route')).PUT;

        // Force model initialization
        await Allocation.init();
        await AnswerScript.init();
        await AuditLog.init();

        professorId = new mongoose.Types.ObjectId('000000000000000000000100');
        taId1 = new mongoose.Types.ObjectId('000000000000000000000103');
        taId2 = new mongoose.Types.ObjectId('000000000000000000000104');
        studentId = new mongoose.Types.ObjectId('000000000000000000000101');
    });

    beforeEach(async () => {
        // Clean collections
        await Course.deleteMany({});
        await Exam.deleteMany({});
        await Allocation.deleteMany({});
        await AnswerScript.deleteMany({});
        await User.deleteMany({});
        await AuditLog.deleteMany({});
        await Grade.deleteMany({});

        // Create Users
        await new User({ _id: professorId, name: 'Prof. Reassign', email: 'prof@iiit.ac.in', role: 'PROFESSOR', password: 'password123' }).save();
        await new User({ _id: taId1, name: 'TA 1', email: 'ta1@example.com', role: 'TA', password: 'password123' }).save();
        await new User({ _id: taId2, name: 'TA 2', email: 'ta2@example.com', role: 'TA', password: 'password123' }).save();

        // Default session as Professor
        mockSessionUser = {
            id: professorId.toString(),
            role: 'PROFESSOR',
            email: 'prof@iiit.ac.in',
            name: 'Prof. Reassign'
        };

        const course = new Course({
            courseCode: 'CS103',
            courseName: 'Algorithms',
            semester: 1,
            academicYear: '2026-2027',
            professor: professorId,
            teachingAssistants: [taId1, taId2],
            enrolledStudents: [studentId],
            isActive: true
        });
        const savedCourse = await course.save();
        testCourseId = savedCourse._id as mongoose.Types.ObjectId;

        const exam = new Exam({
            title: 'Quiz 2',
            course: testCourseId,
            createdBy: professorId,
            examDate: new Date('2026-09-15T09:00:00.000Z'),
            totalMarks: 30,
            numberOfQuestions: 3,
            status: 'DRAFT',
            ingestionApprovalStatus: 'APPROVED',
            isActive: true
        });
        const savedExam = await exam.save();
        testExamId = savedExam._id as mongoose.Types.ObjectId;

        // Create an eligible AnswerScript
        const script = new AnswerScript({
            exam: testExamId,
            student: studentId,
            batchId: 'b2',
            fileIndex: 0,
            startPageNumber: 1,
            endPageNumber: 1,
            pageCount: 1,
            isActive: true
        });
        const savedScript = await script.save();
        scriptId1 = savedScript._id as mongoose.Types.ObjectId;
    });

    // Helper to invoke NextRequest
    function makeRequest(url: string, body: any) {
        return new NextRequest(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
    }

    function makeContext(examId: string) {
        return { params: Promise.resolve({ id: examId }) };
    }

    it('1. Rejection of unauthorized users (TAs/Students)', async () => {
        // Mock TA session
        mockSessionUser = {
            id: taId1.toString(),
            role: 'TA',
            email: 'ta1@example.com',
            name: 'TA 1'
        };

        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
            allocationId: new mongoose.Types.ObjectId().toString(),
            targetTaId: taId2.toString()
        });

        const res = await reassignPUT(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(403);
    });

    it('2. Rejection if target TA is not registered on the course', async () => {
        // Create an allocation for taId1
        const allocation = await new Allocation({
            exam: testExamId,
            ta: taId1,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        }).save();

        const externalTaId = new mongoose.Types.ObjectId(); // TA not in course

        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
            allocationId: allocation._id.toString(),
            targetTaId: externalTaId.toString()
        });

        const res = await reassignPUT(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toContain('is not a teaching assistant for this course');
    });

    it('3. Successful whole-script allocation reassignment and audit log generation', async () => {
        // Create an allocation for taId1
        const allocation = await new Allocation({
            exam: testExamId,
            ta: taId1,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        }).save();

        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
            allocationId: allocation._id.toString(),
            targetTaId: taId2.toString()
        });

        const res = await reassignPUT(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(200);

        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.ta).toBe(taId2.toString());

        // Verify database state
        const dbAlloc = await Allocation.findById(allocation._id);
        expect(dbAlloc).not.toBeNull();
        expect(dbAlloc!.ta.toString()).toBe(taId2.toString());
        expect(dbAlloc!.allocatedBy.toString()).toBe(professorId.toString());

        // Verify audit log
        const audit = await AuditLog.findOne({ action: 'ALLOCATION_REASSIGN' });
        expect(audit).not.toBeNull();
        expect(audit!.user.toString()).toBe(professorId.toString());
        expect(audit!.outcome).toBe('SUCCESS');
        expect(audit!.details).toEqual({
            examId: testExamId.toString(),
            answerScriptId: scriptId1.toString(),
            previousTaId: taId1.toString(),
            newTaId: taId2.toString()
        });
    });

    it('4. Successful single-question allocation reassignment without modifying other questions', async () => {
        // Create question allocations for taId1 (Q1) and taId2 (Q2)
        const q1Alloc = await new Allocation({
            exam: testExamId,
            ta: taId1,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.QUESTION,
            question: 1
        }).save();

        const q2Alloc = await new Allocation({
            exam: testExamId,
            ta: taId2,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.QUESTION,
            question: 2
        }).save();

        // Reassign Q1 from taId1 to taId2
        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
            allocationId: q1Alloc._id.toString(),
            targetTaId: taId2.toString()
        });

        const res = await reassignPUT(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(200);

        // Check Q1 is now allocated to taId2
        const dbQ1 = await Allocation.findById(q1Alloc._id);
        expect(dbQ1!.ta.toString()).toBe(taId2.toString());

        // Check Q2 remains allocated to taId2 (untouched)
        const dbQ2 = await Allocation.findById(q2Alloc._id);
        expect(dbQ2!.ta.toString()).toBe(taId2.toString());
    });

    it('5. Rejection if exam ID in URL does not match allocation exam ID', async () => {
        const allocation = await new Allocation({
            exam: testExamId,
            ta: taId1,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        }).save();

        const wrongExamId = new mongoose.Types.ObjectId().toString();

        const req = makeRequest(`http://localhost:3000/api/exams/${wrongExamId}/allocate/reassign`, {
            allocationId: allocation._id.toString(),
            targetTaId: taId2.toString()
        });

        const res = await reassignPUT(req, makeContext(wrongExamId));
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toContain('does not belong to the specified exam');
    });

    it('6. Reassignment duplicate conflict check', async () => {
        // TA1 is allocated to script1 (Q1)
        const q1Alloc = await new Allocation({
            exam: testExamId,
            ta: taId1,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.QUESTION,
            question: 1
        }).save();

        // TA2 is ALSO allocated to script1 (Q1)
        await new Allocation({
            exam: testExamId,
            ta: taId2,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.QUESTION,
            question: 1
        }).save();

        // Attempting to reassign q1Alloc (currently TA1) to TA2.
        // This is a conflict since TA2 is already allocated to script1 for Q1.
        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
            allocationId: q1Alloc._id.toString(),
            targetTaId: taId2.toString()
        });

        const res = await reassignPUT(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toContain('Reassignment conflict: The target TA is already allocated');
    });

    it('7. Rollback verification on pre-save mixed mode integrity violation', async () => {
        // Let's create a whole-script allocation for script1 under taId1
        await new Allocation({
            exam: testExamId,
            ta: taId1,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        }).save();

        // Now, we want to simulate a transaction rollback.
        // We will directly call AllocationService.reassignAllocation, but bypass some schema check.
        // Wait, to force pre-save hook to fail during update:
        // If we try to save a duplicate whole script, or change the validation.
        // In Mongoose pre-save:
        // "Saving a whole-script allocation. Ensure no question-wise allocation exists for this script."
        // Let's create a question-wise allocation for this script in another document.
        // (This would violate the mixed mode constraint!)
        
        // Directly write a question allocation in DB bypass pre-save if possible, 
        // or just create it first in another transaction.
        // Actually, let's write a question allocation in DB:
        const qAlloc = new Allocation({
            exam: testExamId,
            ta: taId2,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.QUESTION,
            question: 1
        });
        
        // Save it (this will throw if whole script exists).
        // Let's delete the wholeAlloc first to let it save:
        await Allocation.deleteMany({});
        await qAlloc.save(); // Save Q1 allocation
        
        // Re-create a whole-script allocation directly in DB bypassing validation (using insertMany)
        const rawWholeAlloc = await Allocation.insertMany([{
            exam: testExamId,
            ta: taId1,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        }]);
        const wholeAllocId = rawWholeAlloc[0]._id;

        // Now we have both a wholeAlloc and a qAlloc in DB (mixed mode violation!).
        // If we try to reassign wholeAlloc (which calls allocation.save() and triggers pre-save),
        // the pre-save hook will throw: "Cannot create whole-script allocation: question-wise allocations already exist..."
        // This will cause the transaction to roll back!
        
        const reassignPromise = reassignPUT(
            makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
                allocationId: wholeAllocId.toString(),
                targetTaId: taId2.toString()
            }),
            makeContext(testExamId.toString())
        );

        const res = await reassignPromise;
        expect(res.status).toBe(500); // Internal server error from pre-save throw

        // Assert that the whole allocation in DB was NOT modified and remains allocated to taId1
        const dbWhole = await Allocation.findById(wholeAllocId);
        expect(dbWhole!.ta.toString()).toBe(taId1.toString());
    });

    it('8. Reassignment of a non-PENDING allocation is rejected and makes no changes', async () => {
        // Create an allocation for taId1 with status IN_PROGRESS
        const allocation = await new Allocation({
            exam: testExamId,
            ta: taId1,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.IN_PROGRESS,
            rule: AllocationRule.EQUAL
        }).save();

        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
            allocationId: allocation._id.toString(),
            targetTaId: taId2.toString()
        });

        const res = await reassignPUT(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toContain('Cannot reassign allocation: grading/work has already started');

        // Verify database state: TA remains taId1
        const dbAlloc = await Allocation.findById(allocation._id);
        expect(dbAlloc!.ta.toString()).toBe(taId1.toString());

        // Verify no audit log was created
        const auditCount = await AuditLog.countDocuments({ action: 'ALLOCATION_REASSIGN' });
        expect(auditCount).toBe(0);
    });

    it('9. Reassignment when a Grade already exists for the allocation is rejected and makes no changes', async () => {
        // Create an allocation for taId1 with status PENDING, for a specific question (e.g., question 1)
        const allocation = await new Allocation({
            exam: testExamId,
            ta: taId1,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.QUESTION,
            question: 1
        }).save();

        // Create a Grade document for the same answerScript and question
        await Grade.create({
            answerScript: scriptId1,
            rubric: new mongoose.Types.ObjectId(),
            gradedBy: professorId,
            marksAwarded: [],
            totalScore: 0,
            isFinal: false,
            question: 1
        });

        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
            allocationId: allocation._id.toString(),
            targetTaId: taId2.toString()
        });

        const res = await reassignPUT(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toContain('Cannot reassign allocation: a grade already exists');

        // Verify database state: TA remains taId1
        const dbAlloc = await Allocation.findById(allocation._id);
        expect(dbAlloc!.ta.toString()).toBe(taId1.toString());

        // Verify no audit log was created
        const auditCount = await AuditLog.countDocuments({ action: 'ALLOCATION_REASSIGN' });
        expect(auditCount).toBe(0);
    });

    it('10. Reassignment of whole-script allocation when whole-script Grade exists is rejected', async () => {
        // Create an allocation for taId1 with status PENDING (whole script, no question)
        const allocation = await new Allocation({
            exam: testExamId,
            ta: taId1,
            answerScript: scriptId1,
            allocatedBy: professorId,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        }).save();

        // Create a whole-script Grade document (question is undefined)
        await Grade.create({
            answerScript: scriptId1,
            rubric: new mongoose.Types.ObjectId(),
            gradedBy: professorId,
            marksAwarded: [],
            totalScore: 0,
            isFinal: false
        });

        const req = makeRequest(`http://localhost:3000/api/exams/${testExamId}/allocate/reassign`, {
            allocationId: allocation._id.toString(),
            targetTaId: taId2.toString()
        });

        const res = await reassignPUT(req, makeContext(testExamId.toString()));
        expect(res.status).toBe(400);

        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.message).toContain('Cannot reassign allocation: a grade already exists');

        // Verify database state: TA remains taId1
        const dbAlloc = await Allocation.findById(allocation._id);
        expect(dbAlloc!.ta.toString()).toBe(taId1.toString());

        // Verify no audit log was created
        const auditCount = await AuditLog.countDocuments({ action: 'ALLOCATION_REASSIGN' });
        expect(auditCount).toBe(0);
    });
});
