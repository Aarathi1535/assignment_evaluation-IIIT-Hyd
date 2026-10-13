import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Page from '../models/Page';
import Grade from '../models/Grade';
import AuditLog, { IAuditLog } from '../models/AuditLog';
import Notification from '../models/Notification';
import CommentTag, { TagScope } from '../models/CommentTag';
import gradingService from '../services/GradingService';
import AllocationService from '../services/AllocationService';
import { AnnotationPersistenceService, annotationPersistenceService } from '../services/AnnotationPersistenceService';
import { HttpError } from '../lib/errors';
import { writeAuditLog, sanitizeAuditFeedback } from '../lib/audit';

describe('AE-179: Audit-log every grading action hardening tests', () => {
    let replSet: MongoMemoryReplSet;

    const professorId = new mongoose.Types.ObjectId().toString();
    const otherProfId = new mongoose.Types.ObjectId().toString();
    const taId = new mongoose.Types.ObjectId().toString();
    const otherTaId = new mongoose.Types.ObjectId().toString();

    let testCourseId: mongoose.Types.ObjectId;
    let testExamId: mongoose.Types.ObjectId;
    let testScriptId: mongoose.Types.ObjectId;
    let testPageId: mongoose.Types.ObjectId;

    beforeAll(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }

        replSet = await MongoMemoryReplSet.create({
            replSet: { count: 1, storageEngine: 'wiredTiger' }
        });
        const uri = replSet.getUri();
        await mongoose.connect(uri);
    }, 60000);

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
    }, 60000);

    beforeEach(async () => {
        AnnotationPersistenceService.resetAuditThrottle();
        await AuditLog.collection.deleteMany({});
        await User.deleteMany({});
        await Course.deleteMany({});
        await Exam.deleteMany({});
        await Rubric.deleteMany({});
        await AnswerScript.deleteMany({});
        await Allocation.deleteMany({});
        await Page.deleteMany({});
        await Notification.deleteMany({});
        await CommentTag.deleteMany({});

        AnnotationPersistenceService.resetAuditThrottle();

        // Seed Users
        await User.create([
            {
                _id: new mongoose.Types.ObjectId(professorId),
                name: 'Professor Alpha',
                email: 'prof.alpha@university.edu',
                role: UserRole.PROFESSOR,
                password: 'password123',
                isActive: true,
            },
            {
                _id: new mongoose.Types.ObjectId(otherProfId),
                name: 'Professor Beta',
                email: 'prof.beta@university.edu',
                role: UserRole.PROFESSOR,
                password: 'password123',
                isActive: true,
            },
            {
                _id: new mongoose.Types.ObjectId(taId),
                name: 'TA Charlie',
                email: 'ta.charlie@university.edu',
                role: UserRole.TA,
                password: 'password123',
                isActive: true,
            },
            {
                _id: new mongoose.Types.ObjectId(otherTaId),
                name: 'TA Delta',
                email: 'ta.delta@university.edu',
                role: UserRole.TA,
                password: 'password123',
                isActive: true,
            },
        ]);

        // Seed Course & Exam
        const course = await Course.create({
            courseCode: 'CS301',
            courseName: 'Algorithms',
            semester: 1,
            academicYear: '2026-27',
            professor: new mongoose.Types.ObjectId(professorId),
            teachingAssistants: [new mongoose.Types.ObjectId(taId)],
            isActive: true,
        });
        testCourseId = course._id;

        const exam = await Exam.create({
            title: 'Midterm Algorithms',
            course: testCourseId,
            createdBy: new mongoose.Types.ObjectId(professorId),
            examDate: new Date('2026-10-15'),
            totalMarks: 50,
            numberOfQuestions: 2,
            isActive: true,
        });
        testExamId = exam._id;

        // Seed Rubric
        await Rubric.create({
            exam: testExamId,
            createdBy: new mongoose.Types.ObjectId(professorId),
            version: 1,
            isActive: true,
            scoreStep: 0.5,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 10,
                    criteria: [
                        { criterionName: 'Correctness', points: 5 },
                        { criterionName: 'Efficiency', points: 5 },
                    ],
                },
                {
                    questionNumber: 2,
                    maxMarks: 10,
                    criteria: [
                        { criterionName: 'Completeness', points: 10 },
                    ],
                },
            ],
        });

        // Seed AnswerScript & Pages
        const script = await AnswerScript.create({
            exam: testExamId,
            student: new mongoose.Types.ObjectId(),
            needsManualId: false,
            isActive: true,
        });
        testScriptId = script._id;

        const page = await Page.create({
            answerScript: testScriptId,
            pageNumber: 1,
            imagePath: '/images/page1.jpg',
            isActive: true,
            annotations: {
                annotations: [
                    { id: 'ann-1', page: 1, type: 'check', x: 100, y: 150 },
                ],
                strokes: [],
            },
        });
        testPageId = page._id;

        // Seed Allocation
        await Allocation.create({
            exam: testExamId,
            ta: new mongoose.Types.ObjectId(taId),
            answerScript: testScriptId,
            allocatedBy: new mongoose.Types.ObjectId(professorId),
            status: AllocationStatus.IN_PROGRESS,
            rule: AllocationRule.EQUAL,
        });
    });

    // 1. Changing a grade from 2 to 3 creates exactly one GRADE_UPDATED row with before/after values.
    it('1. changing a grade from 2 to 3 creates exactly one GRADE_UPDATED row with before/after values', async () => {
        const tag1Doc = await CommentTag.create({
            label: 'Tag 1',
            scope: TagScope.GLOBAL,
            createdBy: new mongoose.Types.ObjectId(taId),
        });
        const tag2Doc = await CommentTag.create({
            label: 'Tag 2',
            scope: TagScope.GLOBAL,
            createdBy: new mongoose.Types.ObjectId(taId),
        });
        const tag1 = tag1Doc._id as mongoose.Types.ObjectId;
        const tag2 = tag2Doc._id as mongoose.Types.ObjectId;

        // Initial draft save: 2 marks with tags
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [
                { criterionName: 'Correctness', score: 2, feedback: 'Initial note' },
            ],
            tagIds: [tag1],
            feedback: 'Initial evaluation',
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false,
        });

        const initialLogs = await AuditLog.find({ entityType: 'Grade' });
        expect(initialLogs).toHaveLength(1);
        expect(initialLogs[0].action).toBe('GRADE_SAVED');

        // Update mark from 2 to 3 and change tags
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [
                { criterionName: 'Correctness', score: 3, feedback: 'Updated note' },
            ],
            tagIds: [tag2],
            feedback: 'Initial evaluation',
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false,
        });

        const updatedLogs = await AuditLog.find({ action: 'GRADE_UPDATED' });
        expect(updatedLogs).toHaveLength(1);

        const details = (updatedLogs[0].details || {}) as Record<string, unknown>;
        expect(details.totalScore).toBe(3);
        const changes = details.changes as Record<string, { previous: unknown; new: unknown }>;
        expect(changes?.totalScore).toEqual({ previous: 2, new: 3 });
        expect(details.previousTotalScore).toBe(2);
        expect(details.newTotalScore).toBe(3);

        // Verify changes behavior remains intact
        expect(changes?.marksAwarded).toBeDefined();
        const prevMarks = changes.marksAwarded.previous as Array<{ score: number }>;
        const newMarks = changes.marksAwarded.new as Array<{ score: number }>;
        expect(prevMarks[0].score).toBe(2);
        expect(newMarks[0].score).toBe(3);

        expect(changes?.tagIds).toBeDefined();
        expect(changes.tagIds.previous).toEqual([tag1.toString()]);
        expect(changes.tagIds.new).toEqual([tag2.toString()]);

        // Explicitly verify before and after snapshots (AE-179 mentor review)
        const before = details.before as Record<string, unknown>;
        const after = details.after as Record<string, unknown>;
        expect(before).toBeDefined();
        expect(after).toBeDefined();

        // 1. before.marksAwarded and after.marksAwarded retain correct types, values, and arrays
        expect(Array.isArray(before.marksAwarded)).toBe(true);
        expect(Array.isArray(after.marksAwarded)).toBe(true);
        expect(before.marksAwarded).toEqual([
            { criterionName: 'Correctness', score: 2, feedback: 'Initial note' },
        ]);
        expect(after.marksAwarded).toEqual([
            { criterionName: 'Correctness', score: 3, feedback: 'Updated note' },
        ]);

        // 2. before.tagIds and after.tagIds retain correct types, values, and arrays
        expect(Array.isArray(before.tagIds)).toBe(true);
        expect(Array.isArray(after.tagIds)).toBe(true);
        expect(before.tagIds).toEqual([tag1.toString()]);
        expect(after.tagIds).toEqual([tag2.toString()]);
    });

    // 1b. GRADE_FINALIZED snapshot preserves before and after marksAwarded and tagIds
    it('1b. GRADE_FINALIZED snapshot retains before/after marksAwarded and tagIds with correct types and values', async () => {
        const tagAlphaDoc = await CommentTag.create({
            label: 'Tag Alpha',
            scope: TagScope.GLOBAL,
            createdBy: new mongoose.Types.ObjectId(taId),
        });
        const tagBetaDoc = await CommentTag.create({
            label: 'Tag Beta',
            scope: TagScope.GLOBAL,
            createdBy: new mongoose.Types.ObjectId(taId),
        });
        const tagAlpha = tagAlphaDoc._id as mongoose.Types.ObjectId;
        const tagBeta = tagBetaDoc._id as mongoose.Types.ObjectId;

        // Save initial draft
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [
                { criterionName: 'Correctness', score: 2, feedback: 'Draft evaluation' },
            ],
            tagIds: [tagAlpha],
            feedback: 'Working on solution',
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false,
        });

        // Finalize the grade with updated marks and tags
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [
                { criterionName: 'Correctness', score: 4.5, feedback: 'Final approved evaluation' },
            ],
            tagIds: [tagBeta],
            feedback: 'Final remarks',
            userId: taId,
            userRole: UserRole.TA,
            isFinal: true,
        });

        const finalizedLogs = await AuditLog.find({ action: 'GRADE_FINALIZED' });
        expect(finalizedLogs).toHaveLength(1);
        const details = (finalizedLogs[0].details || {}) as Record<string, unknown>;

        // Verify snapshots are preserved in GRADE_FINALIZED
        const before = details.before as Record<string, unknown>;
        const after = details.after as Record<string, unknown>;
        expect(before).toBeDefined();
        expect(after).toBeDefined();

        // Check before.marksAwarded and after.marksAwarded
        expect(Array.isArray(before.marksAwarded)).toBe(true);
        expect(Array.isArray(after.marksAwarded)).toBe(true);
        expect(before.marksAwarded).toEqual([
            { criterionName: 'Correctness', score: 2, feedback: 'Draft evaluation' },
        ]);
        expect(after.marksAwarded).toEqual([
            { criterionName: 'Correctness', score: 4.5, feedback: 'Final approved evaluation' },
        ]);

        // Check before.tagIds and after.tagIds
        expect(Array.isArray(before.tagIds)).toBe(true);
        expect(Array.isArray(after.tagIds)).toBe(true);
        expect(before.tagIds).toEqual([tagAlpha.toString()]);
        expect(after.tagIds).toEqual([tagBeta.toString()]);

        // Changes object also intact
        const changes = details.changes as Record<string, { previous: unknown; new: unknown }>;
        expect(changes.marksAwarded).toBeDefined();
        expect(changes.tagIds).toBeDefined();
    });

    // 1c. sanitizeAuditFeedback preserves repeated objects across sibling branches while safely breaking cycles
    it('1c. sanitizeAuditFeedback preserves repeated objects across sibling snapshot branches while safely breaking cycles', () => {
        const sharedCriterion = { criterionName: 'Correctness', score: 5, feedback: 'Great' };
        const sharedMarksAwarded = [sharedCriterion];
        const sharedTagIds = ['tag-1', 'tag-2'];

        const auditPayload = {
            changes: {
                marksAwarded: { previous: sharedMarksAwarded, new: [{ ...sharedCriterion, score: 7 }] },
                tagIds: { previous: sharedTagIds, new: ['tag-3'] },
            },
            before: {
                marksAwarded: sharedMarksAwarded,
                tagIds: sharedTagIds,
            },
            after: {
                marksAwarded: [{ ...sharedCriterion, score: 7 }],
                tagIds: ['tag-3'],
            },
            previousMarksAwarded: sharedMarksAwarded,
            previousTagIds: sharedTagIds,
        };

        const sanitized = sanitizeAuditFeedback(auditPayload) as typeof auditPayload;
        expect(sanitized.before.marksAwarded).toEqual([
            { criterionName: 'Correctness', score: 5, feedback: 'Great' },
        ]);
        expect(sanitized.before.tagIds).toEqual(['tag-1', 'tag-2']);
        expect(sanitized.after.marksAwarded).toEqual([
            { criterionName: 'Correctness', score: 7, feedback: 'Great' },
        ]);
        expect(sanitized.after.tagIds).toEqual(['tag-3']);
        expect(sanitized.previousMarksAwarded).toEqual([
            { criterionName: 'Correctness', score: 5, feedback: 'Great' },
        ]);

        // Verify circular reference handling
        const cyclicObj: Record<string, unknown> = { name: 'Root', nested: {} };
        (cyclicObj.nested as Record<string, unknown>).parent = cyclicObj;
        const sanitizedCyclic = sanitizeAuditFeedback(cyclicObj) as Record<string, unknown>;
        expect(sanitizedCyclic.name).toBe('Root');
        expect((sanitizedCyclic.nested as Record<string, unknown>).parent).toBeUndefined();

        // Verify string truncation
        const longText = 'A'.repeat(2500);
        const sanitizedLong = sanitizeAuditFeedback({ comment: longText }) as { comment: string };
        expect(sanitizedLong.comment.length).toBeLessThanOrEqual(2000);
        expect(sanitizedLong.comment).toContain('... [TRUNCATED]');
    });

    // 2. Changing only feedback creates one row with before/after feedback.
    it('2. changing only feedback creates one row with before/after feedback', async () => {
        // Initial draft save
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [
                { criterionName: 'Correctness', score: 4 },
            ],
            feedback: 'Draft comment A',
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false,
        });

        // Update only feedback
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [
                { criterionName: 'Correctness', score: 4 },
            ],
            feedback: 'Draft comment B (refined)',
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false,
        });

        const updatedLogs = await AuditLog.find({ action: 'GRADE_UPDATED' });
        expect(updatedLogs).toHaveLength(1);

        const details = (updatedLogs[0].details || {}) as Record<string, unknown>;
        const changes = details.changes as Record<string, { previous: unknown; new: unknown }>;
        expect(changes?.feedback).toEqual({
            previous: 'Draft comment A',
            new: 'Draft comment B (refined)',
        });
        expect(details.previousFeedback).toBe('Draft comment A');
        expect(details.newFeedback).toBe('Draft comment B (refined)');

        // marksAwarded and totalScore did NOT change, so they must not be in changes
        expect(changes?.marksAwarded).toBeUndefined();
        expect(changes?.totalScore).toBeUndefined();
    });

    // 3. Saving identical grade values creates no duplicate grade-change row.
    it('3. saving identical grade values creates no duplicate grade-change row', async () => {
        // Initial draft save
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [
                { criterionName: 'Correctness', score: 3.5 },
            ],
            feedback: 'Solid work',
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false,
        });

        const logsBefore = await AuditLog.countDocuments({ action: 'GRADE_UPDATED' });
        expect(logsBefore).toBe(0);

        // Save identical values again
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [
                { criterionName: 'Correctness', score: 3.5 },
            ],
            feedback: 'Solid work',
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false,
        });

        const logsAfter = await AuditLog.countDocuments({ action: 'GRADE_UPDATED' });
        expect(logsAfter).toBe(0);
    });

    // 4. An aborted transaction leaves no corresponding GRADE_FINALIZED or SCRIPT_SUBMITTED success row.
    it('4. an aborted transaction leaves no corresponding GRADE_FINALIZED or SCRIPT_SUBMITTED success row', async () => {
        // A. GRADE_FINALIZED rollback test
        const readySpy = vi.spyOn(AllocationService, 'isCompletionReady').mockRejectedValueOnce(
            new Error('Simulated failure during grade finalization transaction')
        );

        await expect(
            gradingService.saveGrade({
                scriptId: testScriptId,
                question: 1,
                marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
                userId: taId,
                userRole: UserRole.TA,
                isFinal: true,
            })
        ).rejects.toThrow('Simulated failure during grade finalization transaction');

        readySpy.mockRestore();

        const finalizedLogs = await AuditLog.find({ action: 'GRADE_FINALIZED' });
        expect(finalizedLogs).toHaveLength(0);

        // B. SCRIPT_SUBMITTED rollback test
        // First grade question 1 and question 2 so script is ready for submission
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false,
        });
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 2,
            marksAwarded: [{ criterionName: 'Completeness', score: 8 }],
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false,
        });

        const getNextSpy = vi.spyOn(AllocationService, 'getNextAllocation').mockRejectedValueOnce(
            new Error('Simulated failure during script submission transaction')
        );

        await expect(
            gradingService.submitScript({
                scriptId: testScriptId,
                userId: taId,
                userRole: UserRole.TA,
            })
        ).rejects.toThrow('Simulated failure during script submission transaction');

        getNextSpy.mockRestore();

        const submittedLogs = await AuditLog.find({ action: 'SCRIPT_SUBMITTED' });
        expect(submittedLogs).toHaveLength(0);

        // C. Audit-write failure inside transaction propagates and aborts the transaction
        const auditSaveSpy = vi.spyOn(AuditLog.prototype, 'save').mockRejectedValueOnce(
            new Error('Database error during transactional audit record save')
        );

        await expect(
            gradingService.saveGrade({
                scriptId: testScriptId,
                question: 1,
                marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
                userId: taId,
                userRole: UserRole.TA,
                isFinal: true,
            })
        ).rejects.toThrow('Database error during transactional audit record save');

        auditSaveSpy.mockRestore();

        // Grade was NOT finalized (transaction rolled back)
        const unfinalizedGrade = await Grade.findOne({ answerScript: testScriptId, question: 1 });
        expect(unfinalizedGrade?.isFinal).toBe(false);

        const logs = await AuditLog.find({ action: 'GRADE_FINALIZED' });
        expect(logs).toHaveLength(0);

        // D. Successful submitScript preserves session transaction, generates sha256 page hashes, and writes SCRIPT_SUBMITTED audit row
        const submitResult = await gradingService.submitScript({
            scriptId: testScriptId,
            userId: taId,
            userRole: UserRole.TA,
        });

        expect(submitResult.isSubmitted).toBe(true);
        expect(submitResult.finalizedQuestions).toEqual([1, 2]);

        const submitLog = await AuditLog.findOne({ action: 'SCRIPT_SUBMITTED', entityId: testScriptId });
        expect(submitLog).not.toBeNull();
        const submitDetails = (submitLog?.details || {}) as Record<string, unknown>;
        expect(submitDetails.finalizedQuestions).toEqual([1, 2]);

        // Verify page hashes and perPageAnnotations
        const pageAnnotations = submitDetails.pageAnnotations as Array<{ pageNumber: number; annotationCount: number; hash: string }>;
        expect(Array.isArray(pageAnnotations)).toBe(true);
        expect(pageAnnotations.length).toBeGreaterThan(0);
        for (const pAnn of pageAnnotations) {
            expect(pAnn.pageNumber).toBe(1);
            expect(pAnn.annotationCount).toBeGreaterThanOrEqual(1);
            expect(typeof pAnn.hash).toBe('string');
            expect(pAnn.hash).toHaveLength(64); // SHA-256 hex string
        }
        expect(submitDetails.perPageAnnotations).toEqual(pageAnnotations);
    });

    // 5. If reopening notification creation fails and the transaction aborts, no ALLOCATION_REOPENED success row remains.
    it('5. if reopening notification creation fails and the transaction aborts, no ALLOCATION_REOPENED success row remains', async () => {
        // Complete the allocation first so it can be reopened
        const alloc = await Allocation.findOne({ answerScript: testScriptId, ta: taId });
        expect(alloc).not.toBeNull();
        alloc!.status = AllocationStatus.COMPLETED;
        alloc!.completedAt = new Date();
        await alloc!.save();

        // Spy on Notification.create and simulate failure inside transaction
        const notifSpy = vi.spyOn(Notification, 'create').mockRejectedValueOnce(
            new Error('Simulated notification dispatch failure during reopen')
        );

        await expect(
            AllocationService.reopenAllocation({
                allocationId: alloc!._id.toString(),
                userId: professorId,
                userRole: UserRole.PROFESSOR,
                reason: 'Rechecking answers after student request',
            })
        ).rejects.toThrow('Simulated notification dispatch failure during reopen');

        notifSpy.mockRestore();

        const reopenLogs = await AuditLog.find({ action: 'ALLOCATION_REOPENED' });
        expect(reopenLogs).toHaveLength(0);

        // Allocation remains COMPLETED and completedAt remains set (rolled back together)
        const checkAlloc = await Allocation.findById(alloc!._id);
        expect(checkAlloc?.status).toBe(AllocationStatus.COMPLETED);
        expect(checkAlloc?.completedAt).toBeDefined();
    });

    // 6. A locked script returning HTTP 409 does not create a false success audit entry.
    it('6. a locked script returning HTTP 409 does not create a false success audit entry', async () => {
        // Finalize a grade
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [{ criterionName: 'Correctness', score: 4 }],
            userId: taId,
            userRole: UserRole.TA,
            isFinal: true,
        });

        const logsCountBefore = await AuditLog.countDocuments({ action: 'GRADE_UPDATED' });

        // Attempt to edit finalized grade
        await expect(
            gradingService.saveGrade({
                scriptId: testScriptId,
                question: 1,
                marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
                userId: taId,
                userRole: UserRole.TA,
                isFinal: false,
            })
        ).rejects.toThrow(HttpError);

        const logsCountAfter = await AuditLog.countDocuments({ action: 'GRADE_UPDATED' });
        expect(logsCountAfter).toBe(logsCountBefore);
    });

    // 7. AuditLog.updateOne(...) and AuditLog.deleteOne(...) are rejected.
    it('7. AuditLog.updateOne(...) and AuditLog.deleteOne(...) are rejected, and updatedAt is not maintained', async () => {
        const log = await AuditLog.create({
            user: new mongoose.Types.ObjectId(taId),
            action: 'TEST_IMMUTABILITY',
            outcome: 'SUCCESS',
            details: { test: true },
        });

        expect(log.createdAt).toBeDefined();
        expect(log.updatedAt).toBeUndefined();

        // 1. AuditLog.updateOne rejects
        await expect(
            AuditLog.updateOne({ _id: log._id }, { $set: { action: 'MUTATED' } })
        ).rejects.toThrow(/AuditLog records are immutable and cannot be updated/);

        // 2. AuditLog.deleteOne rejects
        await expect(
            AuditLog.deleteOne({ _id: log._id })
        ).rejects.toThrow(/AuditLog records are append-only and cannot be deleted/);

        // 3. Document-level deleteOne rejects
        await expect(
            log.deleteOne()
        ).rejects.toThrow(/AuditLog records are append-only and cannot be deleted/);

        // 4. Document-level save mutation rejects
        log.action = 'TRY_SAVE';
        await expect(
            log.save()
        ).rejects.toThrow(/AuditLog records are immutable and cannot be updated/);

        // 5. AuditLog.deleteMany({}) rejects (including empty filter)
        await expect(
            AuditLog.deleteMany({})
        ).rejects.toThrow(/AuditLog records are append-only and cannot be deleted/);

        await expect(
            AuditLog.deleteMany({ action: 'TEST_IMMUTABILITY' })
        ).rejects.toThrow(/AuditLog records are append-only and cannot be deleted/);

        // 6. AuditLog.findOneAndReplace rejects mutation
        await expect(
            AuditLog.findOneAndReplace({ _id: log._id }, { user: new mongoose.Types.ObjectId(taId), action: 'REPLACED' } as unknown as IAuditLog)
        ).rejects.toThrow(/AuditLog records are immutable and cannot be updated/);

        // 7. AuditLog.bulkWrite rejects updates, replaces, and deletes
        await expect(
            AuditLog.bulkWrite([{ updateOne: { filter: { _id: log._id }, update: { $set: { action: 'BULK_UPDATE' } } } }])
        ).rejects.toThrow(/AuditLog records are immutable and cannot be updated/);

        await expect(
            AuditLog.bulkWrite([{ updateMany: { filter: {}, update: { $set: { action: 'BULK_UPDATE_MANY' } } } }])
        ).rejects.toThrow(/AuditLog records are immutable and cannot be updated/);

        await expect(
            AuditLog.bulkWrite([{ replaceOne: { filter: { _id: log._id }, replacement: { user: new mongoose.Types.ObjectId(taId), action: 'BULK_REPLACE' } as unknown as IAuditLog } }])
        ).rejects.toThrow(/AuditLog records are immutable and cannot be updated/);

        await expect(
            AuditLog.bulkWrite([{ deleteOne: { filter: { _id: log._id } } }])
        ).rejects.toThrow(/AuditLog records are append-only and cannot be deleted/);

        await expect(
            AuditLog.bulkWrite([{ deleteMany: { filter: {} } }])
        ).rejects.toThrow(/AuditLog records are append-only and cannot be deleted/);

        // 8. Legitimate bulkWrite insertOne is permitted
        const bulkInsertRes = await AuditLog.bulkWrite([
            {
                insertOne: {
                    document: {
                        user: new mongoose.Types.ObjectId(taId),
                        action: 'BULK_INSERTED',
                        outcome: 'SUCCESS',
                        details: { batch: 1 },
                    },
                },
            },
        ]);
        expect(bulkInsertRes.insertedCount).toBe(1);
        const insertedLog = await AuditLog.findOne({ action: 'BULK_INSERTED' });
        expect(insertedLog).not.toBeNull();
    });

    // 8. Fifty autosaves for the same actor and page within one minute produce no more than two audit rows.
    it('8. fifty autosaves for the same actor and page within one minute produce no more than two audit rows', async () => {
        /**
         * Counting Rule Explanation:
         * A sliding 60-second window throttles PAGE_ANNOTATIONS_SAVED audit log generation per actor and page.
         * The first save emits an audit log and registers the timestamp. Subsequent saves within 60 seconds
         * of the recorded timestamp skip audit log row generation while successfully persisting the annotations.
         * Thus, 50 autosaves executed within 60 seconds produce at most 1 audit row (strictly bounded by <= 2).
         */
        const persistenceService = annotationPersistenceService;

        for (let i = 1; i <= 50; i++) {
            await persistenceService.savePageAnnotations({
                scriptId: testScriptId.toString(),
                pageIdentifier: testPageId.toString(),
                payload: {
                    version: 1,
                    pages: {
                        [testPageId.toString()]: {
                            annotations: [
                                { id: 'ann-1', type: 'check', x: 100, y: 150, size: 32, color: '#16a34a' },
                                { id: `ann-${i}`, type: 'cross', x: 200, y: i * 2, size: 24, color: '#dc2626' },
                            ],
                            strokes: [],
                        },
                    },
                },
                userId: taId,
                userRole: UserRole.TA,
                requireBaseUpdatedAt: false,
            });
        }

        const annotationLogs = await AuditLog.find({
            action: 'PAGE_ANNOTATIONS_SAVED',
            user: new mongoose.Types.ObjectId(taId),
            entityId: testPageId,
        });

        // Bounded by at most two audit rows (produces exactly 1)
        expect(annotationLogs.length).toBeGreaterThanOrEqual(1);
        expect(annotationLogs.length).toBeLessThanOrEqual(2);
    });

    // 8b. Annotation save captures pre-mutation snapshot: calculates added and removed delta correctly
    it('8b. captures pre-mutation annotation state before persistence to accurately compute added and removed counts', async () => {
        AnnotationPersistenceService.resetAuditThrottle();
        const persistenceService = annotationPersistenceService;

        // 1. Initial save to establish existing annotations [ann-1, ann-2] on page
        await persistenceService.savePageAnnotations({
            scriptId: testScriptId.toString(),
            pageIdentifier: testPageId.toString(),
            payload: {
                version: 1,
                pages: {
                    [testPageId.toString()]: {
                        annotations: [
                            { id: 'ann-1', type: 'check', x: 100, y: 150, size: 32, color: '#16a34a' },
                            { id: 'ann-2', type: 'cross', x: 200, y: 250, size: 24, color: '#dc2626' },
                        ],
                        strokes: [],
                    },
                },
            },
            userId: taId,
            userRole: UserRole.TA,
            requireBaseUpdatedAt: false,
        });

        // Reset throttle so the next save writes an audit row
        AnnotationPersistenceService.resetAuditThrottle();

        // 2. Next save: Keep ann-2, remove ann-1, and add ann-3
        // Result: 1 added (ann-3), 1 removed (ann-1), previous count 2, total count 2
        await persistenceService.savePageAnnotations({
            scriptId: testScriptId.toString(),
            pageIdentifier: testPageId.toString(),
            payload: {
                version: 1,
                pages: {
                    [testPageId.toString()]: {
                        annotations: [
                            { id: 'ann-2', type: 'cross', x: 200, y: 250, size: 24, color: '#dc2626' },
                            { id: 'ann-3', type: 'check', x: 300, y: 350, size: 32, color: '#16a34a' },
                        ],
                        strokes: [],
                    },
                },
            },
            userId: taId,
            userRole: UserRole.TA,
            requireBaseUpdatedAt: false,
        });

        // 3. Find the second PAGE_ANNOTATIONS_SAVED audit log
        const logs = await AuditLog.find({
            action: 'PAGE_ANNOTATIONS_SAVED',
            user: new mongoose.Types.ObjectId(taId),
            entityId: testPageId,
        }).sort({ createdAt: 1 });

        expect(logs).toHaveLength(2);
        const latestLog = logs[1];
        const details = (latestLog.details || {}) as Record<string, unknown>;

        // If previous state were read only after persistence, previous annotations would equal [ann-2, ann-3],
        // resulting in annotationsAdded: 0, annotationsRemoved: 0, previousAnnotationsCount: 2.
        // Because previous state was snapshotted BEFORE persistence, it correctly sees:
        expect(details.previousAnnotationsCount).toBe(2);
        expect(details.totalAnnotations).toBe(2);
        expect(details.annotationsAdded).toBe(1);
        expect(details.annotationsRemoved).toBe(1);
    });

    // 9. The activity feed does not expose grading audit rows to a TA or a non-owning professor.
    it('9. the activity feed does not expose grading audit rows to a TA or a non-owning professor', async () => {
        // Create grading audit entries for Exam Alpha (owned by professorId)
        await AuditLog.create([
            {
                user: new mongoose.Types.ObjectId(taId),
                action: 'GRADE_UPDATED',
                outcome: 'SUCCESS',
                details: { examId: testExamId.toString(), question: 1, totalScore: 7 },
            },
            {
                user: new mongoose.Types.ObjectId(taId),
                action: 'GRADE_FINALIZED',
                outcome: 'SUCCESS',
                details: { examId: testExamId.toString(), question: 1, totalScore: 7 },
            },
        ]);

        // TA requests activity feed
        const taFeed = await AllocationService.getActivityFeed(
            { id: taId, role: UserRole.TA },
            { examId: testExamId.toString() }
        );
        const taGradingActions = taFeed.activities.filter(a =>
            ['GRADE_SAVED', 'GRADE_UPDATED', 'GRADE_FINALIZED', 'SCRIPT_SUBMITTED'].includes(a.action)
        );
        expect(taGradingActions).toHaveLength(0);

        // Non-owning Professor requests activity feed
        const nonOwnerFeed = await AllocationService.getActivityFeed(
            { id: otherProfId, role: UserRole.PROFESSOR },
            { examId: testExamId.toString() }
        );
        expect(nonOwnerFeed.activities).toHaveLength(0);
        expect(nonOwnerFeed.total).toBe(0);
    });

    // 10. The authorized professor can see the relevant grading audit entries without receiving ipAddress.
    it('10. the authorized professor can see the relevant grading audit entries without receiving ipAddress', async () => {
        // Save a grade with an x-forwarded-for chain IP
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [{ criterionName: 'Correctness', score: 5 }],
            feedback: 'Detailed feedback for question 1',
            userId: taId,
            userRole: UserRole.TA,
            ipAddress: '198.51.100.1, 203.0.113.195, 70.41.3.18',
            isFinal: true,
        });

        // Authorized owning professor queries activity feed
        const feed = await AllocationService.getActivityFeed(
            { id: professorId, role: UserRole.PROFESSOR },
            { examId: testExamId.toString() }
        );

        expect(feed.activities.length).toBeGreaterThanOrEqual(1);

        const finalizedItem = feed.activities.find(a => a.action === 'GRADE_FINALIZED');
        expect(finalizedItem).toBeDefined();

        // 1. Does not return ipAddress in the feed item or in details
        expect((finalizedItem as unknown as Record<string, unknown>).ipAddress).toBeUndefined();
        expect(finalizedItem?.details?.ipAddress).toBeUndefined();

        // 2. AuditLog database record retains ONLY first IP
        const dbLog = await AuditLog.findOne({ action: 'GRADE_FINALIZED' });
        expect(dbLog).not.toBeNull();
        expect(dbLog?.ipAddress).toBe('198.51.100.1');

        // 3. Feedback truncation verification: audit metadata with >2000 chars is safely truncated
        const longFeedback = 'B'.repeat(2500);
        await writeAuditLog({
            user: taId,
            action: 'GRADE_UPDATED',
            outcome: 'SUCCESS',
            details: {
                examId: testExamId.toString(),
                feedback: longFeedback,
            },
        });

        const updatedDbLog = await AuditLog.findOne({ action: 'GRADE_UPDATED', 'details.examId': testExamId.toString() });
        expect(updatedDbLog).not.toBeNull();
        const updatedDetails = (updatedDbLog?.details || {}) as Record<string, unknown>;
        const feedbackStr = updatedDetails?.feedback as string;
        expect(feedbackStr?.length).toBeLessThanOrEqual(2000);
        expect(feedbackStr).toContain('[TRUNCATED]');
    });
});
