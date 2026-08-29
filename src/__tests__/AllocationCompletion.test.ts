/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import AuditLog from '../models/AuditLog';
import AllocationService from '../services/AllocationService';
import { HttpError } from '../lib/errors';

describe('Allocation Completion Transition Tests (AE-099)', () => {
    // Users
    let prof: any;
    let admin: any;
    let ta1: any;
    let ta2: any;
    let student1: any;
    let student2: any;

    let course: any;
    let examWhole: any;
    let examQuestion: any;

    let scriptWhole: any;
    let scriptQuestion: any;

    beforeAll(async () => {
        // Force model initialization
        await User.init();
        await Course.init();
        await Exam.init();
        await AnswerScript.init();
        await Allocation.init();
        await AuditLog.init();
    });

    afterAll(async () => {
        // No replica set to clean up
    });

    beforeEach(async () => {
        await AuditLog.deleteMany({});
        await Allocation.deleteMany({});
        await AnswerScript.deleteMany({});
        await Exam.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});

        // Create Users
        prof = await User.create({
            name: 'Prof. Snape',
            email: 'snape@hogwarts.edu',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        admin = await User.create({
            name: 'Admin Albus',
            email: 'albus@hogwarts.edu',
            password: 'password123',
            role: UserRole.ADMIN,
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

        student2 = await User.create({
            name: 'Draco Malfoy',
            email: 'draco@hogwarts.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        // Create Course
        course = await Course.create({
            courseCode: 'POT101',
            courseName: 'Potions',
            semester: 1,
            academicYear: '2026-2027',
            professor: prof._id,
            teachingAssistants: [ta1._id, ta2._id],
            enrolledStudents: [student1._id, student2._id],
            isActive: true
        });

        // Create Exams
        examWhole = await Exam.create({
            title: 'Potions Final',
            course: course._id,
            status: ExamStatus.PUBLISHED,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            numberOfQuestions: 1
        });

        examQuestion = await Exam.create({
            title: 'Potions Midterm',
            course: course._id,
            status: ExamStatus.PUBLISHED,
            createdBy: prof._id,
            examDate: new Date(),
            totalMarks: 100,
            numberOfQuestions: 5
        });

        // Create AnswerScripts
        scriptWhole = await AnswerScript.create({
            exam: examWhole._id,
            student: student1._id,
            filePath: '/scans/potions/script1.pdf',
            filename: 'script1.pdf',
            startPageNumber: 1,
            endPageNumber: 4,
            pageCount: 4,
            isActive: true
        });

        scriptQuestion = await AnswerScript.create({
            exam: examQuestion._id,
            student: student2._id,
            filePath: '/scans/potions/script2.pdf',
            filename: 'script2.pdf',
            startPageNumber: 5,
            endPageNumber: 8,
            pageCount: 4,
            isActive: true
        });
    });

    describe('1. Successful Transitions', () => {
        it('should successfully complete an IN_PROGRESS whole-script allocation', async () => {
            const alloc = await Allocation.create({
                exam: examWhole._id,
                ta: ta1._id,
                answerScript: scriptWhole._id,
                allocatedBy: prof._id,
                status: AllocationStatus.IN_PROGRESS,
                rule: AllocationRule.EQUAL
            });

            const updated = await AllocationService.markCompleted(alloc._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            });

            expect(updated.status).toBe(AllocationStatus.COMPLETED);

            // Check DB
            const dbAlloc = await Allocation.findById(alloc._id);
            expect(dbAlloc!.status).toBe(AllocationStatus.COMPLETED);

            // Check Audit Log
            const audit = await AuditLog.findOne({ action: 'ALLOCATION_COMPLETE' });
            expect(audit).not.toBeNull();
            expect(audit!.user.toString()).toBe(ta1._id.toString());
            expect(audit!.outcome).toBe('SUCCESS');
            expect(audit!.entityId?.toString()).toBe(alloc._id.toString());
            expect(audit!.details).toEqual({
                examId: examWhole._id.toString(),
                answerScriptId: scriptWhole._id.toString(),
                taId: ta1._id.toString(),
                actingUserId: ta1._id.toString(),
                isOverride: false
            });
        });

        it('should successfully complete an IN_PROGRESS question-wise allocation', async () => {
            const alloc = await Allocation.create({
                exam: examQuestion._id,
                ta: ta1._id,
                answerScript: scriptQuestion._id,
                allocatedBy: prof._id,
                status: AllocationStatus.IN_PROGRESS,
                rule: AllocationRule.QUESTION,
                question: 3
            });

            const updated = await AllocationService.markCompleted(alloc._id.toString(), {
                actingUserId: ta1._id.toString(),
                actingUserRole: UserRole.TA
            });

            expect(updated.status).toBe(AllocationStatus.COMPLETED);

            // Check DB
            const dbAlloc = await Allocation.findById(alloc._id);
            expect(dbAlloc!.status).toBe(AllocationStatus.COMPLETED);

            // Check Audit Log
            const audit = await AuditLog.findOne({ action: 'ALLOCATION_COMPLETE' });
            expect(audit).not.toBeNull();
            expect(audit!.details?.question).toBe(3);
        });
    });

    describe('2. Negative & Boundary Scopes', () => {
        it('should reject transition if allocation is PENDING', async () => {
            const alloc = await Allocation.create({
                exam: examWhole._id,
                ta: ta1._id,
                answerScript: scriptWhole._id,
                allocatedBy: prof._id,
                status: AllocationStatus.PENDING,
                rule: AllocationRule.EQUAL
            });

            await expect(
                AllocationService.markCompleted(alloc._id.toString(), {
                    actingUserId: ta1._id.toString(),
                    actingUserRole: UserRole.TA
                })
            ).rejects.toThrowError(
                new HttpError('Cannot complete a pending allocation', 400)
            );

            // Verify status unchanged
            const dbAlloc = await Allocation.findById(alloc._id);
            expect(dbAlloc!.status).toBe(AllocationStatus.PENDING);

            // Verify no audit log
            const auditCount = await AuditLog.countDocuments({ action: 'ALLOCATION_COMPLETE' });
            expect(auditCount).toBe(0);
        });

        it('should reject with 409 if allocation is already COMPLETED (idempotency)', async () => {
            const alloc = await Allocation.create({
                exam: examWhole._id,
                ta: ta1._id,
                answerScript: scriptWhole._id,
                allocatedBy: prof._id,
                status: AllocationStatus.COMPLETED,
                rule: AllocationRule.EQUAL
            });

            await expect(
                AllocationService.markCompleted(alloc._id.toString(), {
                    actingUserId: ta1._id.toString(),
                    actingUserRole: UserRole.TA
                })
            ).rejects.toThrowError(
                new HttpError('Allocation is already completed', 409)
            );

            // Verify no new audit log
            const auditCount = await AuditLog.countDocuments({ action: 'ALLOCATION_COMPLETE' });
            expect(auditCount).toBe(0);
        });
    });

    describe('3. Authorization & Roles', () => {
        it('should prevent an unassigned TA from completing the allocation', async () => {
            const alloc = await Allocation.create({
                exam: examWhole._id,
                ta: ta1._id,
                answerScript: scriptWhole._id,
                allocatedBy: prof._id,
                status: AllocationStatus.IN_PROGRESS,
                rule: AllocationRule.EQUAL
            });

            await expect(
                AllocationService.markCompleted(alloc._id.toString(), {
                    actingUserId: ta2._id.toString(),
                    actingUserRole: UserRole.TA
                })
            ).rejects.toThrowError(
                new HttpError('Forbidden: This allocation belongs to another TA', 403)
            );

            // Verify status unchanged
            const dbAlloc = await Allocation.findById(alloc._id);
            expect(dbAlloc!.status).toBe(AllocationStatus.IN_PROGRESS);

            // Verify no audit log
            const auditCount = await AuditLog.countDocuments({ action: 'ALLOCATION_COMPLETE' });
            expect(auditCount).toBe(0);
        });

        it('should allow Professor override as a backup operator', async () => {
            const alloc = await Allocation.create({
                exam: examWhole._id,
                ta: ta1._id,
                answerScript: scriptWhole._id,
                allocatedBy: prof._id,
                status: AllocationStatus.IN_PROGRESS,
                rule: AllocationRule.EQUAL
            });

            const updated = await AllocationService.markCompleted(alloc._id.toString(), {
                actingUserId: prof._id.toString(),
                actingUserRole: UserRole.PROFESSOR
            });

            expect(updated.status).toBe(AllocationStatus.COMPLETED);

            // Check Audit Log
            const audit = await AuditLog.findOne({ action: 'ALLOCATION_COMPLETE' });
            expect(audit).not.toBeNull();
            expect(audit!.details?.isOverride).toBe(true);
            expect(audit!.details?.actingUserId).toBe(prof._id.toString());
            expect(audit!.details?.taId).toBe(ta1._id.toString());
        });

        it('should allow Admin override as a backup operator', async () => {
            const alloc = await Allocation.create({
                exam: examWhole._id,
                ta: ta1._id,
                answerScript: scriptWhole._id,
                allocatedBy: prof._id,
                status: AllocationStatus.IN_PROGRESS,
                rule: AllocationRule.EQUAL
            });

            const updated = await AllocationService.markCompleted(alloc._id.toString(), {
                actingUserId: admin._id.toString(),
                actingUserRole: UserRole.ADMIN
            });

            expect(updated.status).toBe(AllocationStatus.COMPLETED);

            // Check Audit Log
            const audit = await AuditLog.findOne({ action: 'ALLOCATION_COMPLETE' });
            expect(audit).not.toBeNull();
            expect(audit!.details?.isOverride).toBe(true);
        });

        it('should fetch user role from DB if role is not provided in actor', async () => {
            const alloc = await Allocation.create({
                exam: examWhole._id,
                ta: ta1._id,
                answerScript: scriptWhole._id,
                allocatedBy: prof._id,
                status: AllocationStatus.IN_PROGRESS,
                rule: AllocationRule.EQUAL
            });

            // Passing only user ID string
            const updated = await AllocationService.markCompleted(alloc._id.toString(), ta1._id.toString());
            expect(updated.status).toBe(AllocationStatus.COMPLETED);

            const audit = await AuditLog.findOne({ action: 'ALLOCATION_COMPLETE' });
            expect(audit).not.toBeNull();
        });
    });

    describe('4. Concurrency Safety', () => {
        it('should allow exactly one successful completion in simultaneous concurrent requests', async () => {
            const alloc = await Allocation.create({
                exam: examWhole._id,
                ta: ta1._id,
                answerScript: scriptWhole._id,
                allocatedBy: prof._id,
                status: AllocationStatus.IN_PROGRESS,
                rule: AllocationRule.EQUAL
            });

            const promises = [
                AllocationService.markCompleted(alloc._id.toString(), {
                    actingUserId: ta1._id.toString(),
                    actingUserRole: UserRole.TA
                }),
                AllocationService.markCompleted(alloc._id.toString(), {
                    actingUserId: ta1._id.toString(),
                    actingUserRole: UserRole.TA
                })
            ];

            const results = await Promise.allSettled(promises);

            const fulfilled = results.filter(r => r.status === 'fulfilled');
            const rejected = results.filter(r => r.status === 'rejected');

            expect(fulfilled.length).toBe(1);
            expect(rejected.length).toBe(1);

            const rejectedError = (rejected[0] as PromiseRejectedResult).reason;
            expect(rejectedError.statusCode).toBe(409);
            expect(rejectedError.message).toBe('Allocation is already completed');

            // Audit log count must be exactly 1
            const auditCount = await AuditLog.countDocuments({ action: 'ALLOCATION_COMPLETE' });
            expect(auditCount).toBe(1);
        });
    });
});
