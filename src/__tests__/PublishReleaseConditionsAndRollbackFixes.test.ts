/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import mongoose from 'mongoose';
import User, { UserRole, IUser } from '../models/User';
import Course, { ICourse } from '../models/Course';
import Exam, { ExamStatus, IExam } from '../models/Exam';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import StudentMapping from '../models/StudentMapping';
import Grade from '../models/Grade';
import Rubric from '../models/Rubric';
import Allocation, { AllocationStatus } from '../models/Allocation';
import ScriptFlag, { FlagReason, FlagStatus } from '../models/ScriptFlag';
import Notification, { NotificationType } from '../models/Notification';
import AuditLog from '../models/AuditLog';
import ExamService from '../services/ExamService';
import studentResultService from '../services/StudentResultService';
import * as auditModule from '../lib/audit';
import { emailAdapter } from '../lib/emailAdapter';

describe('PR #324 Review Fixes: Release Conditions Consistency & Safe Conditional Rollback', () => {
    let prof: IUser;
    let studentA: IUser;
    let studentB: IUser;
    let course: ICourse;
    let exam: IExam;
    let rubric: any;

    beforeEach(async () => {
        emailAdapter.clear();
        process.env.STUDENT_RESULTS_ENABLED = 'true';

        // Clear all collections
        await Course.deleteMany({});
        await Exam.deleteMany({});
        await User.deleteMany({});
        await StudentMapping.deleteMany({});
        await AnswerScript.deleteMany({});
        await Grade.deleteMany({});
        await Rubric.deleteMany({});
        await Allocation.deleteMany({});
        await ScriptFlag.deleteMany({});
        await Notification.deleteMany({});
        await AuditLog.collection.deleteMany({});

        // Create professor
        prof = await User.create({
            name: 'Prof Ramanujan',
            email: 'ramanujan@iiit.ac.in',
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true,
        });

        // Create students
        studentA = await User.create({
            name: 'Student A',
            email: 'studentA@students.iiit.ac.in',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        studentB = await User.create({
            name: 'Student B',
            email: 'studentB@students.iiit.ac.in',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        // Create course
        course = await Course.create({
            courseCode: 'CS5001',
            courseName: 'Algorithms & Data Structures',
            semester: 1,
            academicYear: '2025-2026',
            professor: prof._id,
            enrolledStudents: [studentA._id, studentB._id],
            teachingAssistants: [],
            isActive: true,
        });

        // Create exam with 2 questions
        exam = await Exam.create({
            title: 'Midterm Examination',
            course: course._id,
            createdBy: prof._id,
            numberOfQuestions: 2,
            status: ExamStatus.REVIEW_PENDING,
            totalMarks: 100,
            examDate: new Date(),
            isActive: true,
        });

        // Enroll students in exam roster via StudentMapping
        await StudentMapping.create({
            exam: exam._id,
            student: studentA._id,
            anonymousId: 'ANON-STUDENT-A',
            isVerified: true
        });
        await StudentMapping.create({
            exam: exam._id,
            student: studentB._id,
            anonymousId: 'ANON-STUDENT-B',
            isVerified: true
        });

        // Create rubric for 2 questions
        rubric = await Rubric.create({
            exam: exam._id,
            createdBy: prof._id,
            scoreStep: 1,
            version: 1,
            isActive: true,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 50,
                    criteria: [{ criterionName: 'Correctness', points: 50 }]
                },
                {
                    questionNumber: 2,
                    maxMarks: 50,
                    criteria: [{ criterionName: 'Efficiency', points: 50 }]
                }
            ]
        });

        exam.rubric = rubric._id;
        await exam.save();
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        emailAdapter.clear();
        delete process.env.STUDENT_RESULTS_ENABLED;
    });

    describe('1. Publish Release-Condition Consistency (StudentResultService as Single Source of Truth)', () => {
        it('1.1 Partial grading: Student with only Q1 final is NOT released; Student with both Q1 and Q2 final IS released', async () => {
            // Script A for Student A: only Question 1 is graded and final; Question 2 is missing
            const scriptA = await AnswerScript.create({
                exam: exam._id,
                student: studentA._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                hasIdentificationConflict: false,
                needsManualId: false,
                isActive: true,
            });
            await Grade.create({
                answerScript: scriptA._id,
                rubric: rubric._id,
                question: 1,
                gradedBy: prof._id,
                totalScore: 45,
                isFinal: true,
            });

            // Script B for Student B: both Question 1 and Question 2 are graded and final
            const scriptB = await AnswerScript.create({
                exam: exam._id,
                student: studentB._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                hasIdentificationConflict: false,
                needsManualId: false,
                isActive: true,
            });
            await Grade.create({
                answerScript: scriptB._id,
                rubric: rubric._id,
                question: 1,
                gradedBy: prof._id,
                totalScore: 48,
                isFinal: true,
            });
            await Grade.create({
                answerScript: scriptB._id,
                rubric: rubric._id,
                question: 2,
                gradedBy: prof._id,
                totalScore: 42,
                isFinal: true,
            });

            // Check evaluateReleaseConditions directly
            const evalA = await studentResultService.evaluateReleaseConditions(
                studentA._id as mongoose.Types.ObjectId,
                { _id: exam._id, isActive: exam.isActive, status: ExamStatus.PUBLISHED, rubric: exam.rubric },
                scriptA
            );
            expect(evalA.isReleased).toBe(false);

            const evalB = await studentResultService.evaluateReleaseConditions(
                studentB._id as mongoose.Types.ObjectId,
                { _id: exam._id, isActive: exam.isActive, status: ExamStatus.PUBLISHED, rubric: exam.rubric },
                scriptB
            );
            expect(evalB.isReleased).toBe(true);

            // Check getPublishPreview consistency
            const preview = await ExamService.getPublishPreview(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR);
            expect(preview.totalEnrolled).toBe(2);
            expect(preview.readyToRelease).toBe(1); // Only Student B
            expect(preview.notReady).toBe(1);       // Student A is not ready

            // Publish exam and verify notification consistency
            await ExamService.publishExam(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR);

            const notifications = await Notification.find({ exam: exam._id, type: NotificationType.PUBLISH });
            expect(notifications).toHaveLength(1);
            expect(notifications[0].recipient.toString()).toBe(studentB._id.toString());

            const sentEmails = emailAdapter.getSentEmails();
            expect(sentEmails).toHaveLength(1);
            expect(sentEmails[0].to).toBe(studentB.email);
        });

        it('1.2 Incomplete student identification (needsManualId: true) blocks release preview and notification', async () => {
            // Script A has all grades final, but needsManualId is true
            const scriptA = await AnswerScript.create({
                exam: exam._id,
                student: studentA._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                hasIdentificationConflict: false,
                needsManualId: true, // Needs manual identification review
                isActive: true,
            });
            await Grade.create({
                answerScript: scriptA._id,
                rubric: rubric._id,
                question: 1,
                gradedBy: prof._id,
                totalScore: 45,
                isFinal: true,
            });
            await Grade.create({
                answerScript: scriptA._id,
                rubric: rubric._id,
                question: 2,
                gradedBy: prof._id,
                totalScore: 40,
                isFinal: true,
            });

            const preview = await ExamService.getPublishPreview(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR);
            expect(preview.readyToRelease).toBe(0);
            expect(preview.notReady).toBe(2); // Student A not ready + enrolled Student B without script

            await ExamService.publishExam(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR);
            const notifications = await Notification.find({ exam: exam._id, type: NotificationType.PUBLISH });
            expect(notifications).toHaveLength(0);
            expect(emailAdapter.getSentEmails()).toHaveLength(0);
        });

        it('1.3 Pending or in-progress allocation blocks release preview and notification', async () => {
            // Script A has all grades final, but an allocation remains IN_PROGRESS
            const scriptA = await AnswerScript.create({
                exam: exam._id,
                student: studentA._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                hasIdentificationConflict: false,
                needsManualId: false,
                isActive: true,
            });
            await Grade.create({
                answerScript: scriptA._id,
                rubric: rubric._id,
                question: 1,
                gradedBy: prof._id,
                totalScore: 50,
                isFinal: true,
            });
            await Grade.create({
                answerScript: scriptA._id,
                rubric: rubric._id,
                question: 2,
                gradedBy: prof._id,
                totalScore: 50,
                isFinal: true,
            });

            // Allocation still IN_PROGRESS
            await Allocation.create({
                exam: exam._id,
                ta: prof._id,
                allocatedBy: prof._id,
                answerScript: scriptA._id,
                question: 2,
                status: AllocationStatus.IN_PROGRESS,
            });

            const preview = await ExamService.getPublishPreview(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR);
            expect(preview.readyToRelease).toBe(0);
            expect(preview.notReady).toBe(2);

            await ExamService.publishExam(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR);
            const notifications = await Notification.find({ exam: exam._id, type: NotificationType.PUBLISH });
            expect(notifications).toHaveLength(0);
        });

        it('1.4 Open script flag blocks release preview and notification', async () => {
            // Script A has all grades final, but has an open flag
            const scriptA = await AnswerScript.create({
                exam: exam._id,
                student: studentA._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                hasIdentificationConflict: false,
                needsManualId: false,
                isActive: true,
            });
            await Grade.create({
                answerScript: scriptA._id,
                rubric: rubric._id,
                question: 1,
                gradedBy: prof._id,
                totalScore: 50,
                isFinal: true,
            });
            await Grade.create({
                answerScript: scriptA._id,
                rubric: rubric._id,
                question: 2,
                gradedBy: prof._id,
                totalScore: 50,
                isFinal: true,
            });

            await ScriptFlag.create({
                answerScript: scriptA._id,
                exam: exam._id,
                raisedBy: prof._id,
                reason: FlagReason.ILLEGIBLE,
                status: FlagStatus.OPEN,
            });

            const preview = await ExamService.getPublishPreview(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR);
            expect(preview.openFlags).toBe(1);
            expect(preview.readyToRelease).toBe(0);
            expect(preview.notReady).toBe(2);

            // publishExam must be rejected due to open flags, ensuring no notifications are dispatched
            await expect(
                ExamService.publishExam(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR)
            ).rejects.toThrow('Cannot publish exam: There are 1 open flag(s)');

            const notifications = await Notification.find({ exam: exam._id, type: NotificationType.PUBLISH });
            expect(notifications).toHaveLength(0);
        });
    });

    describe('2. Safe Conditional Rollback', () => {
        it('2.1 publishExam rollback: safely reverts status to REVIEW_PENDING when no concurrent modification occurred', async () => {
            // Fail writeAuditLog to trigger fail-closed compensation
            vi.spyOn(auditModule, 'writeAuditLog').mockResolvedValue(false);

            await expect(
                ExamService.publishExam(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR)
            ).rejects.toThrow('Failed to record audit log for exam publication');

            const dbExam = await Exam.findById(exam._id);
            expect(dbExam!.status).toBe(ExamStatus.REVIEW_PENDING);
            expect(dbExam!.publishedBy).toBeNull();
            expect(dbExam!.publishedAt).toBeNull();
        });

        it('2.2 publishExam rollback: does NOT overwrite concurrent status modification', async () => {
            // Intercept writeAuditLog and concurrently modify exam status to EVALUATING
            vi.spyOn(auditModule, 'writeAuditLog').mockImplementation(async () => {
                // Simulate concurrent background worker transitioning exam to EVALUATING
                await Exam.findByIdAndUpdate(exam._id, {
                    $set: { status: ExamStatus.EVALUATING }
                });
                return false; // Trigger error to induce compensation rollback
            });

            await expect(
                ExamService.publishExam(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR)
            ).rejects.toThrow('Failed to record audit log for exam publication');

            // The rollback should fail to match { _id, status: PUBLISHED, publishedAt }, leaving EVALUATING intact!
            const dbExam = await Exam.findById(exam._id);
            expect(dbExam!.status).toBe(ExamStatus.EVALUATING);
        });

        it('2.3 unpublishExam rollback: safely reverts status to PUBLISHED when no concurrent modification occurred', async () => {
            // First publish successfully
            await ExamService.publishExam(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR);
            const publishedExam = await Exam.findById(exam._id);
            expect(publishedExam!.status).toBe(ExamStatus.PUBLISHED);

            // Fail writeAuditLog during unpublish to trigger fail-closed compensation
            vi.spyOn(auditModule, 'writeAuditLog').mockResolvedValue(false);

            await expect(
                ExamService.unpublishExam(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR)
            ).rejects.toThrow('Failed to record audit log for exam unpublication');

            const dbExam = await Exam.findById(exam._id);
            expect(dbExam!.status).toBe(ExamStatus.PUBLISHED);
            expect(dbExam!.unpublishedBy).toBeNull();
            expect(dbExam!.unpublishedAt).toBeNull();
        });

        it('2.4 unpublishExam rollback: does NOT overwrite concurrent status modification', async () => {
            // First publish successfully
            await ExamService.publishExam(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR);
            const publishedExam = await Exam.findById(exam._id);
            expect(publishedExam!.status).toBe(ExamStatus.PUBLISHED);

            // Intercept writeAuditLog and concurrently modify exam status to ARCHIVED
            vi.spyOn(auditModule, 'writeAuditLog').mockImplementation(async () => {
                // Simulate concurrent admin action archiving the exam
                await Exam.findByIdAndUpdate(exam._id, {
                    $set: { status: ExamStatus.ARCHIVED }
                });
                return false; // Trigger error to induce compensation rollback
            });

            await expect(
                ExamService.unpublishExam(exam._id.toString(), prof._id.toString(), UserRole.PROFESSOR)
            ).rejects.toThrow('Failed to record audit log for exam unpublication');

            // The rollback should fail to match { _id, status: REVIEW_PENDING, unpublishedAt }, leaving ARCHIVED intact!
            const dbExam = await Exam.findById(exam._id);
            expect(dbExam!.status).toBe(ExamStatus.ARCHIVED);
        });
    });
});
