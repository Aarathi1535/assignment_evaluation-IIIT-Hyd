/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AllocationService from '../services/AllocationService';

describe('AE-106A — Allocation Timing Metadata Tests', () => {
    let prof: any;
    let ta1: any;
    let ta2: any;
    let student1: any;
    let course: any;
    let exam: any;
    let script: any;

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
            name: 'Prof. Minerva',
            email: 'minerva@hogwarts.edu',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        ta1 = await User.create({
            name: 'Hermione Granger',
            email: 'hermione@hogwarts.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        ta2 = await User.create({
            name: 'Ron Weasley',
            email: 'ron@hogwarts.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        student1 = await User.create({
            name: 'Harry Potter',
            email: 'harry@hogwarts.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        course = await Course.create({
            courseCode: 'TRANS101',
            courseName: 'Transfiguration',
            semester: 1,
            academicYear: '2026-2027',
            professor: prof._id,
            teachingAssistants: [ta1._id, ta2._id],
            enrolledStudents: [student1._id],
            isActive: true
        });

        exam = await Exam.create({
            title: 'Transfiguration Exam',
            course: course._id,
            status: ExamStatus.PUBLISHED,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            numberOfQuestions: 3
        });

        script = await AnswerScript.create({
            exam: exam._id,
            student: student1._id,
            filePath: '/scans/trans/script1.pdf',
            filename: 'script1.pdf',
            startPageNumber: 1,
            endPageNumber: 3,
            pageCount: 3,
            isActive: true
        });
    });

    it('1. claimedAt exists on the allocation model/schema as an optional timestamp', async () => {
        const alloc = new Allocation({
            exam: exam._id,
            ta: ta1._id,
            answerScript: script._id,
            allocatedBy: prof._id,
            status: AllocationStatus.PENDING
        });
        const saved = await alloc.save();

        // Field is optional and undefined by default on newly created pending allocation
        expect(saved.claimedAt).toBeUndefined();

        const customDate = new Date('2026-09-01T10:00:00.000Z');
        saved.claimedAt = customDate;
        const updated = await saved.save();

        expect(updated.claimedAt).toBeInstanceOf(Date);
        expect(updated.claimedAt?.getTime()).toBe(customDate.getTime());
    });

    it('2. A successfully claimed allocation receives claimedAt', async () => {
        const alloc = await Allocation.create({
            exam: exam._id,
            ta: ta1._id,
            answerScript: script._id,
            allocatedBy: prof._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        });

        const beforeClaim = Date.now();
        const claimed = await AllocationService.claimAllocation(alloc._id.toString(), ta1._id.toString());
        const afterClaim = Date.now();

        expect(claimed.status).toBe(AllocationStatus.IN_PROGRESS);
        expect(claimed.claimedAt).toBeDefined();
        expect(claimed.claimedAt).toBeInstanceOf(Date);

        const claimedTime = new Date(claimed.claimedAt!).getTime();
        expect(claimedTime).toBeGreaterThanOrEqual(beforeClaim);
        expect(claimedTime).toBeLessThanOrEqual(afterClaim);

        // Verify in DB
        const dbAlloc = await Allocation.findById(alloc._id);
        expect(dbAlloc!.claimedAt).toBeDefined();
        expect(dbAlloc!.claimedAt?.getTime()).toBe(claimedTime);
    });

    it('3. An allocation that has not been claimed does not receive a fabricated claimedAt', async () => {
        const alloc = await Allocation.create({
            exam: exam._id,
            ta: ta1._id,
            answerScript: script._id,
            allocatedBy: prof._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        });

        const dbAlloc = await Allocation.findById(alloc._id);
        expect(dbAlloc!.claimedAt).toBeUndefined();
        // Ensure not fabricated from createdAt
        expect(dbAlloc!.claimedAt).not.toEqual(dbAlloc!.createdAt);
    });

    it('4. completedAt exists on the allocation model/schema as an optional timestamp', async () => {
        const alloc = new Allocation({
            exam: exam._id,
            ta: ta1._id,
            answerScript: script._id,
            allocatedBy: prof._id,
            status: AllocationStatus.PENDING
        });
        const saved = await alloc.save();

        expect(saved.completedAt).toBeUndefined();

        const customDate = new Date('2026-09-01T12:00:00.000Z');
        saved.completedAt = customDate;
        const updated = await saved.save();

        expect(updated.completedAt).toBeInstanceOf(Date);
        expect(updated.completedAt?.getTime()).toBe(customDate.getTime());
    });

    it('5. A successfully completed allocation receives completedAt', async () => {
        const alloc = await Allocation.create({
            exam: exam._id,
            ta: ta1._id,
            answerScript: script._id,
            allocatedBy: prof._id,
            status: AllocationStatus.IN_PROGRESS,
            rule: AllocationRule.EQUAL
        });

        const beforeComplete = Date.now();
        const completed = await AllocationService.markCompleted(alloc._id.toString(), {
            actingUserId: ta1._id.toString(),
            actingUserRole: UserRole.TA
        });
        const afterComplete = Date.now();

        expect(completed.status).toBe(AllocationStatus.COMPLETED);
        expect(completed.completedAt).toBeDefined();
        expect(completed.completedAt).toBeInstanceOf(Date);

        const completedTime = new Date(completed.completedAt!).getTime();
        expect(completedTime).toBeGreaterThanOrEqual(beforeComplete);
        expect(completedTime).toBeLessThanOrEqual(afterComplete);

        // Verify in DB
        const dbAlloc = await Allocation.findById(alloc._id);
        expect(dbAlloc!.completedAt).toBeDefined();
        expect(dbAlloc!.completedAt?.getTime()).toBe(completedTime);
    });

    it('6. completedAt is associated with the transition to COMPLETED', async () => {
        const alloc = await Allocation.create({
            exam: exam._id,
            ta: ta1._id,
            answerScript: script._id,
            allocatedBy: prof._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        });

        // 1. Initial pending allocation has neither claimedAt nor completedAt
        expect(alloc.claimedAt).toBeUndefined();
        expect(alloc.completedAt).toBeUndefined();

        // 2. Claiming sets claimedAt, but completedAt remains undefined
        const claimed = await AllocationService.claimAllocation(alloc._id.toString(), ta1._id.toString());
        expect(claimed.status).toBe(AllocationStatus.IN_PROGRESS);
        expect(claimed.claimedAt).toBeDefined();
        expect(claimed.completedAt).toBeUndefined();

        // 3. Completing transitions to COMPLETED and sets completedAt
        const completed = await AllocationService.markCompleted(alloc._id.toString(), {
            actingUserId: ta1._id.toString(),
            actingUserRole: UserRole.TA
        });
        expect(completed.status).toBe(AllocationStatus.COMPLETED);
        expect(completed.claimedAt).toBeDefined();
        expect(completed.completedAt).toBeDefined();
        expect(new Date(completed.completedAt!).getTime()).toBeGreaterThanOrEqual(new Date(completed.claimedAt!).getTime());
    });

    it('7. An allocation that has not been completed does not receive a fabricated completedAt', async () => {
        const allocPending = await Allocation.create({
            exam: exam._id,
            ta: ta1._id,
            answerScript: script._id,
            allocatedBy: prof._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        });

        expect(allocPending.completedAt).toBeUndefined();

        const allocClaimed = await AllocationService.claimAllocation(allocPending._id.toString(), ta1._id.toString());
        expect(allocClaimed.status).toBe(AllocationStatus.IN_PROGRESS);
        expect(allocClaimed.completedAt).toBeUndefined();

        const dbAlloc = await Allocation.findById(allocPending._id);
        expect(dbAlloc!.completedAt).toBeUndefined();
        // Ensure not fabricated from updatedAt
        expect(dbAlloc!.completedAt).not.toEqual(dbAlloc!.updatedAt);
    });

    it('8. Reassignment does not incorrectly overwrite completedAt', async () => {
        // Pending allocation reassign should not populate or alter completedAt
        const alloc = await Allocation.create({
            exam: exam._id,
            ta: ta1._id,
            answerScript: script._id,
            allocatedBy: prof._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        });

        const reassigned = await AllocationService.reassignAllocation(
            exam._id.toString(),
            alloc._id.toString(),
            ta2._id.toString(),
            prof._id.toString()
        );

        expect(reassigned.ta.toString()).toBe(ta2._id.toString());
        expect(reassigned.completedAt).toBeUndefined();
        expect(reassigned.claimedAt).toBeUndefined();

        const dbAlloc = await Allocation.findById(alloc._id);
        expect(dbAlloc!.ta.toString()).toBe(ta2._id.toString());
        expect(dbAlloc!.completedAt).toBeUndefined();
        expect(dbAlloc!.claimedAt).toBeUndefined();
    });

    it('9. Existing allocation status transition behavior remains unchanged', async () => {
        const alloc = await Allocation.create({
            exam: exam._id,
            ta: ta1._id,
            answerScript: script._id,
            allocatedBy: prof._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        });

        // Cannot complete from PENDING
        await expect(
            AllocationService.markCompleted(alloc._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            })
        ).rejects.toThrow('Cannot complete a pending allocation');

        // Claim succeeds PENDING -> IN_PROGRESS
        const claimed = await AllocationService.claimAllocation(alloc._id.toString(), ta1._id.toString());
        expect(claimed.status).toBe(AllocationStatus.IN_PROGRESS);
        expect(claimed.claimedAt).toBeDefined();

        // Release succeeds IN_PROGRESS -> PENDING
        // Release succeeds IN_PROGRESS -> PENDING and clears claimedAt (AE-110)
        const released = await AllocationService.releaseAllocation(alloc._id.toString(), ta1._id.toString());
        expect(released.status).toBe(AllocationStatus.PENDING);
        expect(released.claimedAt).toBeUndefined();

        // Verify in DB that claimedAt is completely removed
        const dbReleased = await Allocation.findById(alloc._id);
        expect(dbReleased!.status).toBe(AllocationStatus.PENDING);
        expect(dbReleased!.claimedAt).toBeUndefined();

        // Re-claim succeeds PENDING -> IN_PROGRESS
        const reclaimed = await AllocationService.claimAllocation(alloc._id.toString(), ta1._id.toString());
        expect(reclaimed.status).toBe(AllocationStatus.IN_PROGRESS);
        expect(reclaimed.claimedAt).toBeDefined();

        // Mark completed succeeds IN_PROGRESS -> COMPLETED
        const completed = await AllocationService.markCompleted(alloc._id.toString(), {
            actingUserId: ta1._id.toString(),
            actingUserRole: UserRole.TA
        });
        expect(completed.status).toBe(AllocationStatus.COMPLETED);
        expect(completed.completedAt).toBeDefined();

        // Cannot claim already completed
        await expect(
            AllocationService.claimAllocation(alloc._id.toString(), ta1._id.toString())
        ).rejects.toThrow('Cannot claim a completed allocation');

        // Cannot re-complete already completed (idempotent 409)
        await expect(
            AllocationService.markCompleted(alloc._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            })
        ).rejects.toThrow('Allocation is already completed');
    });

    it('10. Existing allocations without these fields remain compatible', async () => {
        // Direct insertion simulating legacy allocation without claimedAt or completedAt
        const legacyId = new mongoose.Types.ObjectId();
        await Allocation.collection.insertOne({
            _id: legacyId,
            exam: exam._id,
            ta: ta1._id,
            answerScript: script._id,
            allocatedBy: prof._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL,
            createdAt: new Date('2026-08-01T00:00:00.000Z'),
            updatedAt: new Date('2026-08-01T00:00:00.000Z')
        });

        const fetched = await Allocation.findById(legacyId);
        expect(fetched).not.toBeNull();
        expect(fetched!.claimedAt).toBeUndefined();
        expect(fetched!.completedAt).toBeUndefined();
        expect(fetched!.status).toBe(AllocationStatus.PENDING);

        // Can still claim legacy allocation seamlessly
        const claimed = await AllocationService.claimAllocation(legacyId.toString(), ta1._id.toString());
        expect(claimed.status).toBe(AllocationStatus.IN_PROGRESS);
        expect(claimed.claimedAt).toBeDefined();
        expect(claimed.completedAt).toBeUndefined();

        // Can still complete legacy allocation seamlessly
        const completed = await AllocationService.markCompleted(legacyId.toString(), {
            actingUserId: ta1._id.toString(),
            actingUserRole: UserRole.TA
        });
        expect(completed.status).toBe(AllocationStatus.COMPLETED);
        expect(completed.completedAt).toBeDefined();
    });

    it('11. releaseAllocation clears claimedAt and subsequent reassignment does not carry stale claim timestamps (AE-110)', async () => {
        // Step 1: Create a pending allocation
        const alloc = await Allocation.create({
            exam: exam._id,
            ta: ta1._id,
            answerScript: script._id,
            allocatedBy: prof._id,
            status: AllocationStatus.PENDING,
            rule: AllocationRule.EQUAL
        });

        // Step 2: TA-1 claims allocation (receives claimedAt timestamp)
        const claimed = await AllocationService.claimAllocation(alloc._id.toString(), ta1._id.toString());
        expect(claimed.status).toBe(AllocationStatus.IN_PROGRESS);
        expect(claimed.claimedAt).toBeInstanceOf(Date);

        // Step 3: TA-1 releases allocation back to PENDING
        const released = await AllocationService.releaseAllocation(alloc._id.toString(), ta1._id.toString());
        expect(released.status).toBe(AllocationStatus.PENDING);
        expect(released.claimedAt).toBeUndefined();

        const dbAfterRelease = await Allocation.findById(alloc._id);
        expect(dbAfterRelease!.claimedAt).toBeUndefined();

        // Step 4: Professor reassigns PENDING allocation to TA-2
        const reassigned = await AllocationService.reassignAllocation(
            exam._id.toString(),
            alloc._id.toString(),
            ta2._id.toString(),
            prof._id.toString()
        );

        // Assert: resulting allocation has TA-2, status PENDING, and no stale claimedAt or completedAt
        expect(reassigned.ta.toString()).toBe(ta2._id.toString());
        expect(reassigned.status).toBe(AllocationStatus.PENDING);
        expect(reassigned.claimedAt).toBeUndefined();
        expect(reassigned.completedAt).toBeUndefined();

        const dbAfterReassign = await Allocation.findById(alloc._id);
        expect(dbAfterReassign!.ta.toString()).toBe(ta2._id.toString());
        expect(dbAfterReassign!.claimedAt).toBeUndefined();
        expect(dbAfterReassign!.completedAt).toBeUndefined();
    });
});
