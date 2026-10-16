import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import User, { UserRole } from '../models/User';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import Rubric from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Page from '../models/Page';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import AuditLog from '../models/AuditLog';
import gradingService from '../services/GradingService';
import AllocationService from '../services/AllocationService';
import { AnnotationPersistenceService, annotationPersistenceService } from '../services/AnnotationPersistenceService';
import { writeAuditLog, sanitizeAuditFeedback } from '../lib/audit';

describe('AE-248: Audit logging overhead reduction and hardening', () => {
    let replSet: MongoMemoryReplSet;

    const professorId = new mongoose.Types.ObjectId().toString();
    const taId = new mongoose.Types.ObjectId().toString();

    let testCourseId: mongoose.Types.ObjectId;
    let testExamId: mongoose.Types.ObjectId;
    let testScriptId: mongoose.Types.ObjectId;
    let testPageId: mongoose.Types.ObjectId;
    let testRubricId: mongoose.Types.ObjectId;

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
        vi.restoreAllMocks();

        await User.deleteMany({});
        await Course.deleteMany({});
        await Exam.deleteMany({});
        await Rubric.deleteMany({});
        await AnswerScript.deleteMany({});
        await Allocation.deleteMany({});
        await Page.deleteMany({});
        await IngestionPage.deleteMany({});
        await AuditLog.collection.deleteMany({});

        await User.create([
            { _id: new mongoose.Types.ObjectId(professorId), name: 'Prof Test', email: 'prof@test.com', password: 'hash', role: UserRole.PROFESSOR },
            { _id: new mongoose.Types.ObjectId(taId), name: 'TA Test', email: 'ta@test.com', password: 'hash', role: UserRole.TA }
        ]);

        const course = await Course.create({
            courseCode: 'CS301',
            courseName: 'Algorithms',
            semester: 1,
            academicYear: '2026-27',
            professor: new mongoose.Types.ObjectId(professorId),
            teachingAssistants: [new mongoose.Types.ObjectId(taId)],
            isActive: true
        });
        testCourseId = course._id;

        const exam = await Exam.create({
            title: 'Midterm',
            course: testCourseId,
            createdBy: new mongoose.Types.ObjectId(professorId),
            examDate: new Date('2026-10-15'),
            totalMarks: 20,
            status: ExamStatus.PUBLISHED,
            numberOfQuestions: 2,
            isActive: true
        });
        testExamId = exam._id;

        const rubric = await Rubric.create({
            exam: testExamId,
            createdBy: new mongoose.Types.ObjectId(professorId),
            version: 1,
            scoreStep: 0.5,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 10,
                    criteria: [
                        { criterionName: 'Correctness', points: 5 },
                        { criterionName: 'Complexity', points: 5 }
                    ]
                },
                {
                    questionNumber: 2,
                    maxMarks: 10,
                    criteria: [
                        { criterionName: 'Quality', points: 10 }
                    ]
                }
            ],
            isActive: true
        });
        testRubricId = rubric._id;

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
            imagePath: '/images/p1.png',
            isActive: true,
            annotations: { annotations: [], strokes: [] }
        });
        testPageId = page._id;

        await Allocation.create({
            exam: testExamId,
            answerScript: testScriptId,
            ta: new mongoose.Types.ObjectId(taId),
            allocatedBy: new mongoose.Types.ObjectId(professorId),
            rule: AllocationRule.EQUAL,
            status: AllocationStatus.IN_PROGRESS
        });
    });

    // 1. Audit payload: Keep before and after; remove duplicate changes, previousValues/newValues, aliases
    it('1. GradingService audit payload preserves before and after while omitting duplicate changes and aliases', async () => {
        // Step 1: Initial grade save
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [
                { criterionName: 'Correctness', score: 3 },
                { criterionName: 'Complexity', score: 2 }
            ],
            feedback: 'Initial draft comment',
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false
        });

        // Step 2: Update grade
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [
                { criterionName: 'Correctness', score: 4 },
                { criterionName: 'Complexity', score: 3 }
            ],
            feedback: 'Updated refined comment',
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false
        });

        const logs = await AuditLog.find({ action: 'GRADE_UPDATED' });
        expect(logs).toHaveLength(1);

        const details = (logs[0].details || {}) as Record<string, unknown>;

        // Must retain before and after
        expect(details.before).toBeDefined();
        expect(details.after).toBeDefined();
        const before = details.before as Record<string, unknown>;
        const after = details.after as Record<string, unknown>;

        expect(before.totalScore).toBe(5);
        expect(after.totalScore).toBe(7);
        expect(before.feedback).toBe('Initial draft comment');
        expect(after.feedback).toBe('Updated refined comment');

        // Must remove duplicate changes, previousValues/newValues, and aliases
        expect(details.changes).toBeUndefined();
        expect(details.previousValues).toBeUndefined();
        expect(details.newValues).toBeUndefined();
        expect(details.previousTotalScore).toBeUndefined();
        expect(details.newTotalScore).toBeUndefined();
        expect(details.previousScore).toBeUndefined();
        expect(details.newScore).toBeUndefined();
        expect(details.previousFeedback).toBeUndefined();
        expect(details.newFeedback).toBeUndefined();
        expect(details.previousMarksAwarded).toBeUndefined();
        expect(details.newMarksAwarded).toBeUndefined();
        expect(details.previousTagIds).toBeUndefined();
        expect(details.newTagIds).toBeUndefined();
    });

    // 2. Measure serialized audit-row size for an actual persisted GRADE_UPDATED row
    it('2. measures serialized audit-row size of an actual persisted GRADE_UPDATED audit row and demonstrates >60% payload reduction', async () => {
        const commentBefore = 'A'.repeat(2000);
        const commentAfter = 'B'.repeat(2000);

        // Step 1: Initial grade save with long comment
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [
                { criterionName: 'Correctness', score: 3 },
                { criterionName: 'Complexity', score: 2 }
            ],
            feedback: commentBefore,
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false
        });

        // Step 2: Update grade with new long comment to trigger GRADE_UPDATED audit log insertion
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [
                { criterionName: 'Correctness', score: 4 },
                { criterionName: 'Complexity', score: 3 }
            ],
            feedback: commentAfter,
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false
        });

        // Retrieve the actual persisted GRADE_UPDATED row from the database
        const persistedDoc = await AuditLog.findOne({ action: 'GRADE_UPDATED' }).lean();
        expect(persistedDoc).not.toBeNull();

        const details = (persistedDoc!.details || {}) as Record<string, unknown>;

        // Verify clean structure: contains before and after, but no duplicates or aliases
        expect(details.before).toBeDefined();
        expect(details.after).toBeDefined();
        expect(details.changes).toBeUndefined();
        expect(details.previousValues).toBeUndefined();
        expect(details.newValues).toBeUndefined();
        expect(details.previousTotalScore).toBeUndefined();
        expect(details.newTotalScore).toBeUndefined();
        expect(details.previousFeedback).toBeUndefined();
        expect(details.newFeedback).toBeUndefined();

        // Measure serialized size of the actual persisted row
        const afterSerialized = JSON.stringify(persistedDoc);
        const afterBytes = Buffer.byteLength(afterSerialized, 'utf8');

        // Construct the equivalent legacy document containing the duplicate fields
        const legacyDetails: Record<string, unknown> = {
            ...details,
            rubricId: testRubricId.toString(),
            changes: {
                feedback: { previous: commentBefore, new: commentAfter },
                totalScore: { previous: 5, new: 7 }
            },
            previousValues: { feedback: commentBefore, totalScore: 5 },
            newValues: { feedback: commentAfter, totalScore: 7 },
            previousTotalScore: 5,
            newTotalScore: 7,
            previousScore: 5,
            newScore: 7,
            previousFeedback: commentBefore,
            newFeedback: commentAfter,
            previousMarksAwarded: [
                { criterionName: 'Correctness', score: 3 },
                { criterionName: 'Complexity', score: 2 }
            ],
            newMarksAwarded: [
                { criterionName: 'Correctness', score: 4 },
                { criterionName: 'Complexity', score: 3 }
            ]
        };

        const legacyAuditDoc = {
            ...persistedDoc,
            details: legacyDetails
        };

        const beforeSerialized = JSON.stringify(legacyAuditDoc);
        const beforeBytes = Buffer.byteLength(beforeSerialized, 'utf8');
        const reductionBytes = beforeBytes - afterBytes;
        const reductionPercentage = (reductionBytes / beforeBytes) * 100;

        // Size with duplicates was ~17.8 KB; clean persisted row is ~4.8 KB
        expect(beforeBytes).toBeGreaterThan(16000);
        expect(afterBytes).toBeLessThan(5500);
        expect(reductionPercentage).toBeGreaterThan(65);
    });

    // 3. Autosave in AnnotationPersistenceService: reads previous annotations only when write will occur and uses .select('metadata.annotations')
    it('3. AnnotationPersistenceService reads previous annotations only when write will occur and uses .select(metadata.annotations) for IngestionPage', async () => {
        const ingestionPage = await IngestionPage.create({
            batchId: 'batch-248',
            job: new mongoose.Types.ObjectId(),
            fileId: 'file-248',
            fileIndex: 0,
            storageKey: 'storage/p1.png',
            pageNumber: 1,
            status: PageProcessingStatus.PROCESSED,
            answerScript: testScriptId,
            metadata: {
                heavyRawOcrData: 'X'.repeat(5000),
                annotations: {
                    annotations: [{ id: 'ann-init', type: 'check', x: 50, y: 50, size: 24, color: '#16a34a' }],
                    strokes: []
                }
            }
        });

        const observedProjections: string[] = [];
        const origFindById = IngestionPage.findById.bind(IngestionPage);
        const findByIdSpy = vi.spyOn(IngestionPage, 'findById').mockImplementation((...args: unknown[]) => {
            const query = (origFindById as (...fnArgs: unknown[]) => mongoose.Query<unknown, unknown>)(...args);
            const origSelect = query.select.bind(query);
            query.select = vi.fn().mockImplementation((proj: unknown) => {
                if (typeof proj === 'string') {
                    observedProjections.push(proj);
                }
                return origSelect(proj as never);
            });
            return query;
        });

        // Save 1: Unthrottled save -> write will occur, so previous snapshot MUST be read using projection metadata.annotations
        const firstSave = await annotationPersistenceService.savePageAnnotations({
            scriptId: testScriptId.toString(),
            pageIdentifier: ingestionPage._id.toString(),
            payload: {
                version: 1,
                pages: {
                    [ingestionPage._id.toString()]: {
                        annotations: [
                            { id: 'ann-init', type: 'check', x: 50, y: 50, size: 24, color: '#16a34a' },
                            { id: 'ann-new', type: 'cross', x: 100, y: 100, size: 24, color: '#dc2626' }
                        ],
                        strokes: []
                    }
                }
            },
            userId: taId,
            userRole: UserRole.TA,
            requireBaseUpdatedAt: false
        });

        expect(firstSave).toBeDefined();

        // Assert that the projection metadata.annotations was used when snapshot was needed
        expect(observedProjections).toContain('metadata.annotations');

        const logs = await AuditLog.find({ action: 'PAGE_ANNOTATIONS_SAVED', entityId: ingestionPage._id });
        expect(logs).toHaveLength(1);
        const details = logs[0].details as Record<string, unknown>;
        expect(details.annotationsAdded).toBe(1);
        expect(details.previousAnnotationsCount).toBe(1);

        // Reset observed projections for throttled save check
        observedProjections.length = 0;

        // Save 2: Throttled save shortly afterward -> write will NOT occur
        const secondSave = await annotationPersistenceService.savePageAnnotations({
            scriptId: testScriptId.toString(),
            pageIdentifier: ingestionPage._id.toString(),
            payload: {
                version: 1,
                pages: {
                    [ingestionPage._id.toString()]: {
                        annotations: [
                            { id: 'ann-init', type: 'check', x: 50, y: 50, size: 24, color: '#16a34a' },
                            { id: 'ann-new', type: 'cross', x: 100, y: 100, size: 24, color: '#dc2626' },
                            { id: 'ann-third', type: 'cross', x: 150, y: 150, size: 24, color: '#dc2626' }
                        ],
                        strokes: []
                    }
                }
            },
            userId: taId,
            userRole: UserRole.TA,
            requireBaseUpdatedAt: false
        });

        expect(secondSave).toBeDefined();

        // Verify that a throttled save avoids reading the previous annotation snapshot
        expect(observedProjections).not.toContain('metadata.annotations');

        // Audit log count remains 1 due to throttling
        const logsAfterThrottled = await AuditLog.find({ action: 'PAGE_ANNOTATIONS_SAVED', entityId: ingestionPage._id });
        expect(logsAfterThrottled).toHaveLength(1);

        findByIdSpy.mockRestore();
    });

    // 4. Throttle: Advance timestamp only after writeAuditLog succeeds; prune stale throttle keys safely
    it('4. AnnotationPersistenceService advances throttle timestamp only after writeAuditLog succeeds and prunes stale keys', async () => {
        // Step A: Make AuditLog.create reject once instead of mocking writeAuditLog to reject
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const createSpy = vi.spyOn(AuditLog, 'create').mockRejectedValueOnce(new Error('Audit DB write error') as never);

        // Verify the first annotation save succeeds even though its audit insert fails
        const firstSaveResult = await annotationPersistenceService.savePageAnnotations({
            scriptId: testScriptId.toString(),
            pageIdentifier: testPageId.toString(),
            payload: {
                version: 1,
                pages: {
                    [testPageId.toString()]: {
                        annotations: [{ id: 'ann-1', type: 'check', x: 10, y: 20, size: 20, color: '#16a34a' }],
                        strokes: []
                    }
                }
            },
            userId: taId,
            userRole: UserRole.TA,
            requireBaseUpdatedAt: false
        });

        expect(firstSaveResult).toBeDefined();
        expect(firstSaveResult.annotations).toHaveLength(1);
        expect(consoleErrorSpy).toHaveBeenCalled();

        // Assert that the throttle map remains empty
        expect(AnnotationPersistenceService.getThrottleKeyCount()).toBe(0);

        // Verify no audit row was inserted
        const logsAfterFailed = await AuditLog.find({ action: 'PAGE_ANNOTATIONS_SAVED' });
        expect(logsAfterFailed).toHaveLength(0);

        // Step B: Perform a second save shortly afterward and verify that it successfully writes an audit row
        const secondSaveResult = await annotationPersistenceService.savePageAnnotations({
            scriptId: testScriptId.toString(),
            pageIdentifier: testPageId.toString(),
            payload: {
                version: 1,
                pages: {
                    [testPageId.toString()]: {
                        annotations: [
                            { id: 'ann-1', type: 'check', x: 10, y: 20, size: 20, color: '#16a34a' },
                            { id: 'ann-2', type: 'cross', x: 30, y: 40, size: 20, color: '#dc2626' }
                        ],
                        strokes: []
                    }
                }
            },
            userId: taId,
            userRole: UserRole.TA,
            requireBaseUpdatedAt: false
        });

        expect(secondSaveResult).toBeDefined();
        expect(secondSaveResult.annotations).toHaveLength(2);

        // Verify that the second save successfully wrote an audit row
        const logsAfterSuccess = await AuditLog.find({ action: 'PAGE_ANNOTATIONS_SAVED' });
        expect(logsAfterSuccess).toHaveLength(1);
        expect(logsAfterSuccess[0].details).toMatchObject({
            annotationsAdded: 1,
            totalAnnotations: 2
        });

        // Verify the throttle map is populated only after the successful insertion
        expect(AnnotationPersistenceService.getThrottleKeyCount()).toBe(1);

        // Step C: Test pruneStaleThrottleKeys
        // Calling prune with a simulated future timestamp > 60s in the future should prune the entry
        AnnotationPersistenceService.pruneStaleThrottleKeys(Date.now() + 65000);
        expect(AnnotationPersistenceService.getThrottleKeyCount()).toBe(0);

        createSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    // 5. Sanitizer: return safe placeholder beyond depth limit and verify circular reference at depth 7 persists successfully
    it('5. sanitizeAuditFeedback returns safe placeholder beyond depth 6 and circular reference at depth 7 persists successfully', async () => {
        // Construct an object nested 7 levels deep with a circular reference at depth 7
        const cyclicObj: Record<string, unknown> = { level: 1 };
        let current = cyclicObj;
        for (let d = 2; d <= 7; d++) {
            const nextLevel: Record<string, unknown> = { level: d };
            current[`level${d}`] = nextLevel;
            current = nextLevel;
        }
        // At depth 7 (level 7), create circular references to itself and to root
        current.self = current;
        current.root = cyclicObj;

        // Verify sanitizer behavior: level 7 children are replaced with safe placeholder
        const sanitized = sanitizeAuditFeedback(cyclicObj) as Record<string, unknown>;
        let curSanitized = sanitized;
        for (let d = 2; d <= 7; d++) {
            curSanitized = curSanitized[`level${d}`] as Record<string, unknown>;
            expect(curSanitized).toBeDefined();
        }
        // Beyond depth 6 (at depth 7), properties are replaced with [DEPTH_LIMIT_EXCEEDED]
        expect(curSanitized.self).toBe('[DEPTH_LIMIT_EXCEEDED]');
        expect(curSanitized.root).toBe('[DEPTH_LIMIT_EXCEEDED]');

        // Now test actual audit persistence with circular reference at depth 7
        await writeAuditLog({
            user: taId,
            action: 'DEEP_CYCLIC_TEST',
            outcome: 'SUCCESS',
            entityId: testScriptId,
            entityType: 'AnswerScript',
            details: cyclicObj
        });

        const log = await AuditLog.findOne({ action: 'DEEP_CYCLIC_TEST' });
        expect(log).not.toBeNull();
        expect(log?.outcome).toBe('SUCCESS');
        const details = log?.details as Record<string, unknown>;

        let curInDb = details;
        for (let d = 2; d <= 7; d++) {
            curInDb = curInDb[`level${d}`] as Record<string, unknown>;
        }
        expect(curInDb.self).toBe('[DEPTH_LIMIT_EXCEEDED]');
        expect(curInDb.root).toBe('[DEPTH_LIMIT_EXCEEDED]');
    });

    // 6. Cleanup: IAuditLog has no updatedAt, SCRIPT_SUBMITTED has no perPageAnnotations, AllocationService has no delete itemDetails.ipAddress
    it('6. Cleanup verifies IAuditLog has no updatedAt, SCRIPT_SUBMITTED has no perPageAnnotations, and AllocationService cleans details', async () => {
        // Grade both questions so script can be submitted
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 1,
            marksAwarded: [{ criterionName: 'Correctness', score: 4 }, { criterionName: 'Complexity', score: 4 }],
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false,
        });
        await gradingService.saveGrade({
            scriptId: testScriptId,
            question: 2,
            marksAwarded: [{ criterionName: 'Quality', score: 8 }],
            userId: taId,
            userRole: UserRole.TA,
            isFinal: false,
        });

        // Step A: Submit script and verify audit log has pageAnnotations but not perPageAnnotations
        const submitRes = await gradingService.submitScript({
            scriptId: testScriptId,
            userId: taId,
            userRole: UserRole.TA
        });
        expect(submitRes.isSubmitted).toBe(true);

        const submitLog = await AuditLog.findOne({ action: 'SCRIPT_SUBMITTED' });
        expect(submitLog).not.toBeNull();
        const submitDetails = submitLog?.details as Record<string, unknown>;

        expect(submitDetails.pageAnnotations).toBeDefined();
        expect(submitDetails.perPageAnnotations).toBeUndefined();

        // Step B: Verify IAuditLog document does not contain updatedAt
        expect((submitLog as unknown as { updatedAt?: unknown }).updatedAt).toBeUndefined();

        // Step C: Verify AllocationService activity feed handles details cleanly
        const feed = await AllocationService.getActivityFeed(
            { id: professorId, role: UserRole.PROFESSOR },
            { examId: testExamId.toString() }
        );
        expect(feed.activities.length).toBeGreaterThan(0);
        const submitActivity = feed.activities.find(a => a.action === 'SCRIPT_SUBMITTED');
        expect(submitActivity).toBeDefined();
        expect(submitActivity?.details).toBeDefined();
    });
});
