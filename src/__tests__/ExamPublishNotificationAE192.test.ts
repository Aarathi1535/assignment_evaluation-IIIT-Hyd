/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import User, { UserRole, IUser } from '../models/User';
import Course, { ICourse } from '../models/Course';
import Exam, { ExamStatus, IExam } from '../models/Exam';
import StudentMapping from '../models/StudentMapping';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import Rubric from '../models/Rubric';
import ScriptFlag from '../models/ScriptFlag';
import Notification, { NotificationType } from '../models/Notification';
import AuditLog from '../models/AuditLog';
import ExamService from '../services/ExamService';
import { emailAdapter } from '../lib/emailAdapter';

let mockSessionUser: { id: string; role: string } | null = null;

vi.mock('../lib/apiAuth', async () => {
    const actual = await vi.importActual<any>('../lib/apiAuth');
    return {
        ...actual,
        requirePermission: vi.fn(async () => {
            if (!mockSessionUser) {
                return {
                    authorized: false,
                    response: new Response(JSON.stringify({ success: false, message: 'Unauthorized' }), { status: 401 })
                };
            }
            return {
                authorized: true,
                user: mockSessionUser
            };
        }),
    };
});

describe('AE-192: Notify Students When Exam Results Are Published', () => {
    let prof: IUser;
    let eligibleStudent1: IUser;
    let eligibleStudent2: IUser;
    let studentNoScript: IUser;
    let studentNonFinalGrade: IUser;
    let otherCourseStudent: IUser;
    let inactiveStudent: IUser;
    let ta: IUser;
    let course: ICourse;
    let exam: IExam;

    beforeEach(async () => {
        emailAdapter.clear();
        process.env.STUDENT_RESULTS_ENABLED = 'true';

        // Clean relevant collections
        await Course.deleteMany({});
        await Exam.deleteMany({});
        await User.deleteMany({});
        await StudentMapping.deleteMany({});
        await AnswerScript.deleteMany({});
        await Grade.deleteMany({});
        await Rubric.deleteMany({});
        await ScriptFlag.deleteMany({});
        await Notification.deleteMany({});
        await AuditLog.collection.deleteMany({});

        prof = await User.create({
            name: 'Prof Ramanujan',
            email: 'ramanujan@iiit.ac.in',
            password: 'Password@123',
            role: UserRole.PROFESSOR,
            isActive: true,
        });

        ta = await User.create({
            name: 'TA Aryabhata',
            email: 'aryabhata@iiit.ac.in',
            password: 'Password@123',
            role: UserRole.TA,
            isActive: true,
        });

        eligibleStudent1 = await User.create({
            name: 'Student Alice',
            email: 'alice@students.iiit.ac.in',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        eligibleStudent2 = await User.create({
            name: 'Student Bob',
            email: 'bob@students.iiit.ac.in',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        studentNoScript = await User.create({
            name: 'Student NoScript',
            email: 'noscript@students.iiit.ac.in',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        studentNonFinalGrade = await User.create({
            name: 'Student NonFinal',
            email: 'nonfinal@students.iiit.ac.in',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        otherCourseStudent = await User.create({
            name: 'Student Charlie',
            email: 'charlie@students.iiit.ac.in',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: true,
        });

        inactiveStudent = await User.create({
            name: 'Student Deactivated',
            email: 'deactivated@students.iiit.ac.in',
            password: 'Password@123',
            role: UserRole.STUDENT,
            isActive: false,
        });

        course = await Course.create({
            courseCode: 'CS6001',
            courseName: 'Advanced Algorithms',
            semester: 1,
            academicYear: '2025-2026',
            professor: prof._id,
            enrolledStudents: [eligibleStudent1._id, eligibleStudent2._id, studentNoScript._id, inactiveStudent._id],
            teachingAssistants: [ta._id],
            isActive: true,
        });

        exam = await Exam.create({
            title: 'CS6001 Mid-Sem Evaluation',
            course: course._id,
            createdBy: prof._id,
            numberOfQuestions: 1,
            status: ExamStatus.REVIEW_PENDING,
            totalMarks: 100,
            examDate: new Date(),
            isActive: true,
        });

        const rubric = await Rubric.create({
            exam: exam._id,
            createdBy: prof._id,
            scoreStep: 1,
            version: 1,
            isActive: true,
            questions: [
                {
                    questionNumber: 1,
                    maxMarks: 100,
                    criteria: [{ criterionName: 'Correctness', points: 100 }]
                }
            ]
        });

        // Script 1: eligibleStudent1 - finalized grade, no flags
        const script1 = await AnswerScript.create({
            exam: exam._id,
            student: eligibleStudent1._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            hasIdentificationConflict: false,
            needsManualId: false,
            isActive: true,
        });
        await Grade.create({
            answerScript: script1._id,
            rubric: rubric._id,
            question: 1,
            gradedBy: prof._id,
            totalScore: 85,
            isFinal: true,
        });

        // Script 2: eligibleStudent2 - finalized grade, no flags
        const script2 = await AnswerScript.create({
            exam: exam._id,
            student: eligibleStudent2._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            hasIdentificationConflict: false,
            needsManualId: false,
            isActive: true,
        });
        await Grade.create({
            answerScript: script2._id,
            rubric: rubric._id,
            question: 1,
            gradedBy: prof._id,
            totalScore: 90,
            isFinal: true,
        });

        // Script 3: studentNonFinalGrade - grade is not finalized
        const script3 = await AnswerScript.create({
            exam: exam._id,
            student: studentNonFinalGrade._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            hasIdentificationConflict: false,
            needsManualId: false,
            isActive: true,
        });
        await Grade.create({
            answerScript: script3._id,
            rubric: rubric._id,
            question: 1,
            gradedBy: prof._id,
            totalScore: 70,
            isFinal: false,
        });

        // studentNoScript has NO answer script created
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        emailAdapter.clear();
        mockSessionUser = null;
        delete process.env.STUDENT_RESULTS_ENABLED;
    });

    it('1. Publishes exam and creates in-app notifications & stub emails ONLY for eligible students', async () => {
        const publishedExam = await ExamService.publishExam(
            exam._id.toString(),
            prof._id.toString(),
            UserRole.PROFESSOR
        );

        expect(publishedExam.status).toBe(ExamStatus.PUBLISHED);
        expect(publishedExam.publishedBy?.toString()).toBe(prof._id.toString());
        expect(publishedExam.publishedAt).toBeDefined();

        // Verify in-app notifications only exist for eligible students with finalized scripts
        const notifications = await Notification.find({ exam: exam._id, type: NotificationType.PUBLISH });
        expect(notifications).toHaveLength(2);

        const recipientIds = notifications.map(n => n.recipient.toString());
        expect(recipientIds).toContain(eligibleStudent1._id.toString());
        expect(recipientIds).toContain(eligibleStudent2._id.toString());
        expect(recipientIds).not.toContain(studentNoScript._id.toString());
        expect(recipientIds).not.toContain(studentNonFinalGrade._id.toString());

        for (const notif of notifications) {
            expect(notif.title).toBe('Grades Published');
            expect(notif.message).toContain('CS6001 Mid-Sem Evaluation');
            expect(notif.read).toBe(false);
        }

        // Verify stub email adapter sent emails only to eligible students
        const sentEmails = emailAdapter.getSentEmails();
        expect(sentEmails).toHaveLength(2);
        const emailRecipients = sentEmails.map(e => e.to);
        expect(emailRecipients).toContain('alice@students.iiit.ac.in');
        expect(emailRecipients).toContain('bob@students.iiit.ac.in');
        expect(emailRecipients).not.toContain('noscript@students.iiit.ac.in');
        expect(emailRecipients).not.toContain('nonfinal@students.iiit.ac.in');
    });

    it('2. Ineligible students (no script, non-final grade, other course, inactive, staff) are NOT notified', async () => {
        await ExamService.publishExam(
            exam._id.toString(),
            prof._id.toString(),
            UserRole.PROFESSOR
        );

        // Student with no script: NOT notified
        const noScriptNotifs = await Notification.find({ recipient: studentNoScript._id });
        expect(noScriptNotifs).toHaveLength(0);

        // Student with non-final grade: NOT notified
        const nonFinalNotifs = await Notification.find({ recipient: studentNonFinalGrade._id });
        expect(nonFinalNotifs).toHaveLength(0);

        // Other course student: NOT notified
        const charlieNotifs = await Notification.find({ recipient: otherCourseStudent._id });
        expect(charlieNotifs).toHaveLength(0);

        // Inactive student: NOT notified
        const inactiveNotifs = await Notification.find({ recipient: inactiveStudent._id });
        expect(inactiveNotifs).toHaveLength(0);

        // TA and Professor: NOT notified
        const taNotifs = await Notification.find({ recipient: ta._id });
        expect(taNotifs).toHaveLength(0);
        const profNotifs = await Notification.find({ recipient: prof._id });
        expect(profNotifs).toHaveLength(0);
    });

    it('3. Duplicate notifications are prevented on retries and concurrent publishes', async () => {
        // Initial publication
        await ExamService.publishExam(
            exam._id.toString(),
            prof._id.toString(),
            UserRole.PROFESSOR
        );

        const firstCount = await Notification.countDocuments({ exam: exam._id, type: NotificationType.PUBLISH });
        expect(firstCount).toBe(2);
        expect(emailAdapter.getSentEmails()).toHaveLength(2);

        // Calling publishExam again on already published exam (retry path)
        await ExamService.publishExam(
            exam._id.toString(),
            prof._id.toString(),
            UserRole.PROFESSOR
        );

        // Notifications count remains unchanged
        const secondCount = await Notification.countDocuments({ exam: exam._id, type: NotificationType.PUBLISH });
        expect(secondCount).toBe(2);
        expect(emailAdapter.getSentEmails()).toHaveLength(2);
    });

    it('4. Notification failures do NOT roll back exam publication status', async () => {
        // Mock Notification.updateOne to throw an unexpected DB failure
        vi.spyOn(Notification, 'updateOne').mockRejectedValueOnce(
            new Error('Database network timeout during notification upsert')
        );

        const publishedExam = await ExamService.publishExam(
            exam._id.toString(),
            prof._id.toString(),
            UserRole.PROFESSOR
        );

        // Publication still succeeds
        expect(publishedExam.status).toBe(ExamStatus.PUBLISHED);

        const dbExam = await Exam.findById(exam._id);
        expect(dbExam!.status).toBe(ExamStatus.PUBLISHED);

        // Audit log still exists
        const auditLog = await AuditLog.findOne({ entityId: exam._id, action: 'EXAM_PUBLISHED' });
        expect(auditLog).toBeDefined();
        expect(auditLog!.outcome).toBe('SUCCESS');
    });

    it('5. Skips notification dispatch when STUDENT_RESULTS_ENABLED is false', async () => {
        process.env.STUDENT_RESULTS_ENABLED = 'false';

        await ExamService.publishExam(
            exam._id.toString(),
            prof._id.toString(),
            UserRole.PROFESSOR
        );

        const notifs = await Notification.find({ exam: exam._id, type: NotificationType.PUBLISH });
        expect(notifs).toHaveLength(0);
        expect(emailAdapter.getSentEmails()).toHaveLength(0);
    });

    it('6. Route test: POST /api/exams/[id]/publish dispatches notifications to eligible students', async () => {
        const publishPOST = (await import('../app/api/exams/[id]/publish/route')).POST;
        mockSessionUser = { id: prof._id.toString(), role: UserRole.PROFESSOR };

        const req = new NextRequest(`http://localhost:3000/api/exams/${exam._id}/publish`, {
            method: 'POST',
        });
        const res = await publishPOST(req, { params: Promise.resolve({ id: exam._id.toString() }) });
        expect(res.status).toBe(200);

        const notifications = await Notification.find({ exam: exam._id, type: NotificationType.PUBLISH });
        expect(notifications).toHaveLength(2);
        const recipientIds = notifications.map(n => n.recipient.toString());
        expect(recipientIds).toContain(eligibleStudent1._id.toString());
        expect(recipientIds).toContain(eligibleStudent2._id.toString());
    });
});
