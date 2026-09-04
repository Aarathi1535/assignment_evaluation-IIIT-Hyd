import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import Course from '../models/Course';
import Exam, { ExamStatus, IngestionApprovalStatus } from '../models/Exam';
import User, { UserRole } from '../models/User';
import AnswerScript from '../models/AnswerScript';
import Allocation, { AllocationStatus, AllocationRule } from '../models/Allocation';
import Grade from '../models/Grade';
import Rubric from '../models/Rubric';
import Notification from '../models/Notification';
import AllocationService from '../services/AllocationService';
import NotificationService from '../services/NotificationService';

describe('AE-119: Allocation & Progress Bug Fixes Regression Suite', () => {
    let testCourseId: mongoose.Types.ObjectId;
    let testExamId: mongoose.Types.ObjectId;
    let professorId: mongoose.Types.ObjectId;
    let taId1: mongoose.Types.ObjectId;
    let taId2: mongoose.Types.ObjectId;
    let studentId1: mongoose.Types.ObjectId;
    let studentId2: mongoose.Types.ObjectId;
    let rubricId: mongoose.Types.ObjectId;

    beforeAll(async () => {
        await User.init();
        await Course.init();
        await Exam.init();
        await AnswerScript.init();
        await Allocation.init();
        await Grade.init();
        await Rubric.init();
        await Notification.init();

        professorId = new mongoose.Types.ObjectId('000000000000000000000500');
        taId1 = new mongoose.Types.ObjectId('000000000000000000000501');
        taId2 = new mongoose.Types.ObjectId('000000000000000000000502');
        studentId1 = new mongoose.Types.ObjectId('000000000000000000000503');
        studentId2 = new mongoose.Types.ObjectId('000000000000000000000504');
    });

    beforeEach(async () => {
        await Notification.deleteMany({});
        await Grade.deleteMany({});
        await Rubric.deleteMany({});
        await Allocation.deleteMany({});
        await AnswerScript.deleteMany({});
        await Exam.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});

        await User.create({
            _id: professorId,
            name: 'Prof. Slughorn',
            email: 'slughorn@hogwarts.edu',
            password: 'password123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        await User.create({
            _id: taId1,
            name: 'Hermione Granger',
            email: 'hermione@hogwarts.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        await User.create({
            _id: taId2,
            name: 'Ron Weasley',
            email: 'ron@hogwarts.edu',
            password: 'password123',
            role: UserRole.TA,
            isActive: true
        });

        await User.create({
            _id: studentId1,
            name: 'Harry Potter',
            email: 'harry@hogwarts.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        await User.create({
            _id: studentId2,
            name: 'Draco Malfoy',
            email: 'draco@hogwarts.edu',
            password: 'password123',
            role: UserRole.STUDENT,
            isActive: true
        });

        const course = await Course.create({
            courseCode: 'POT201',
            courseName: 'Advanced Potions',
            semester: 1,
            academicYear: '2026-2027',
            professor: professorId,
            teachingAssistants: [taId1, taId2],
            enrolledStudents: [studentId1, studentId2],
            isActive: true
        });
        testCourseId = course._id as mongoose.Types.ObjectId;

        const exam = await Exam.create({
            title: 'Potions Midterm',
            course: testCourseId,
            createdBy: professorId,
            examDate: new Date(),
            totalMarks: 100,
            numberOfQuestions: 2,
            status: ExamStatus.DRAFT,
            ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
            isActive: true
        });
        testExamId = exam._id as mongoose.Types.ObjectId;

        const rubric = await Rubric.create({
            exam: testExamId,
            questions: [{
                questionNumber: 1,
                maxMarks: 50,
                criteria: [{
                    criterionName: 'Correctness',
                    points: 50
                }]
            }],
            createdBy: professorId,
            isActive: true,
            version: 1
        });
        rubricId = rubric._id as mongoose.Types.ObjectId;
    });

    describe('Bug 1: Inactive Graded Script Leak in checkGradingCommenced', () => {
        it('throws 400 when an inactive answer script belonging to the exam already has a Grade', async () => {
            // Create an inactive answer script with an existing grade
            const inactiveScript = await AnswerScript.create({
                exam: testExamId,
                student: studentId1,
                filePath: '/scans/script1.pdf',
                filename: 'script1.pdf',
                startPageNumber: 1,
                endPageNumber: 2,
                pageCount: 2,
                isActive: false
            });

            await Grade.create({
                answerScript: inactiveScript._id,
                rubric: rubricId,
                gradedBy: taId1,
                marksAwarded: [{ criterionName: 'Correctness', score: 45 }],
                totalScore: 45,
                isFinal: true
            });

            // Also have an active eligible script
            await AnswerScript.create({
                exam: testExamId,
                student: studentId2,
                filePath: '/scans/script2.pdf',
                filename: 'script2.pdf',
                startPageNumber: 3,
                endPageNumber: 4,
                pageCount: 2,
                isActive: true
            });

            // Attempting to run allocateEqual should be blocked because grades already exist for this exam
            await expect(
                AllocationService.allocateEqual(
                    testExamId.toString(),
                    [taId1.toString(), taId2.toString()],
                    professorId.toString()
                )
            ).rejects.toThrow('Cannot re-run allocation: grades already exist for this exam.');
        });
    });

    describe('Bug 2: Orphaned Notifications & Inflated Unread Counts on Allocation Re-run', () => {
        it('cleans up stale uncommenced assignment notifications when allocation is re-run before grading commences', async () => {
            await AnswerScript.create({
                exam: testExamId,
                student: studentId1,
                filePath: '/scans/script1.pdf',
                filename: 'script1.pdf',
                startPageNumber: 1,
                endPageNumber: 2,
                pageCount: 2,
                isActive: true
            });

            await AnswerScript.create({
                exam: testExamId,
                student: studentId2,
                filePath: '/scans/script2.pdf',
                filename: 'script2.pdf',
                startPageNumber: 3,
                endPageNumber: 4,
                pageCount: 2,
                isActive: true
            });

            // Run initial allocation
            const firstAllocations = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString(), taId2.toString()],
                professorId.toString()
            );

            expect(firstAllocations).toHaveLength(2);

            let unreadCountTA1 = await NotificationService.getUnreadCount(taId1.toString());
            let unreadCountTA2 = await NotificationService.getUnreadCount(taId2.toString());
            expect(unreadCountTA1).toBe(1);
            expect(unreadCountTA2).toBe(1);

            let totalNotifications = await Notification.countDocuments({ exam: testExamId });
            expect(totalNotifications).toBe(2);

            // Re-run allocation before grading commences (with only TA1 selected)
            const secondAllocations = await AllocationService.allocateEqual(
                testExamId.toString(),
                [taId1.toString()],
                professorId.toString()
            );

            expect(secondAllocations).toHaveLength(2);

            // Verify notifications were cleaned up and re-created cleanly
            totalNotifications = await Notification.countDocuments({ exam: testExamId });
            expect(totalNotifications).toBe(2);

            // TA1 now has 2 new notifications, TA2 has 0 notifications
            unreadCountTA1 = await NotificationService.getUnreadCount(taId1.toString());
            unreadCountTA2 = await NotificationService.getUnreadCount(taId2.toString());
            expect(unreadCountTA1).toBe(2);
            expect(unreadCountTA2).toBe(0);

            // Verify all existing notifications point to active new allocation IDs
            const newAllocationIds = secondAllocations.map(a => a._id.toString());
            const notifications = await Notification.find({ exam: testExamId });
            for (const notif of notifications) {
                expect(newAllocationIds).toContain(notif.allocation?.toString());
            }
        });
    });

    describe('Bug 3: Reassignment Conflict Check Precision for Whole-Script vs Question-Wise', () => {
        it('prevents duplicate whole-script allocation conflict on target TA', async () => {
            const script1 = await AnswerScript.create({
                exam: testExamId,
                student: studentId1,
                filePath: '/scans/script1.pdf',
                filename: 'script1.pdf',
                startPageNumber: 1,
                endPageNumber: 2,
                pageCount: 2,
                isActive: true
            });

            // TA1 has script1 (whole script)
            const alloc1 = await Allocation.create({
                exam: testExamId,
                ta: taId1,
                answerScript: script1._id,
                allocatedBy: professorId,
                status: AllocationStatus.PENDING,
                rule: AllocationRule.EQUAL
            });

            // TA2 also has script1 (whole script) - created directly to test conflict detection
            await Allocation.create({
                exam: testExamId,
                ta: taId2,
                answerScript: script1._id,
                allocatedBy: professorId,
                status: AllocationStatus.PENDING,
                rule: AllocationRule.EQUAL
            });

            // Attempting to reassign alloc1 to TA2 should trigger the conflict error
            await expect(
                AllocationService.reassignAllocation(
                    testExamId.toString(),
                    alloc1._id.toString(),
                    taId2.toString(),
                    professorId.toString()
                )
            ).rejects.toThrow('Reassignment conflict: The target TA is already allocated to this script/question.');
        });

        it('allows reassigning a different question of the same script to a TA who already has question 1', async () => {
            const script1 = await AnswerScript.create({
                exam: testExamId,
                student: studentId1,
                filePath: '/scans/script1.pdf',
                filename: 'script1.pdf',
                startPageNumber: 1,
                endPageNumber: 2,
                pageCount: 2,
                isActive: true
            });

            // TA1 has Q1 of script1
            await Allocation.create({
                exam: testExamId,
                ta: taId1,
                answerScript: script1._id,
                allocatedBy: professorId,
                status: AllocationStatus.PENDING,
                rule: AllocationRule.QUESTION,
                question: 1
            });

            // TA2 has Q2 of script1
            const allocQ2 = await Allocation.create({
                exam: testExamId,
                ta: taId2,
                answerScript: script1._id,
                allocatedBy: professorId,
                status: AllocationStatus.PENDING,
                rule: AllocationRule.QUESTION,
                question: 2
            });

            // Reassign Q2 from TA2 to TA1 -> TA1 now grades both Q1 and Q2 of script1
            const reassigned = await AllocationService.reassignAllocation(
                testExamId.toString(),
                allocQ2._id.toString(),
                taId1.toString(),
                professorId.toString()
            );

            expect(reassigned.ta.toString()).toBe(taId1.toString());
            expect(reassigned.question).toBe(2);

            const ta1Allocations = await Allocation.find({ ta: taId1, exam: testExamId });
            expect(ta1Allocations).toHaveLength(2);
            const questions = ta1Allocations.map(a => a.question).sort();
            expect(questions).toEqual([1, 2]);
        });

        it('blocks reassigning question 1 to target TA if target TA already has question 1', async () => {
            const script1 = await AnswerScript.create({
                exam: testExamId,
                student: studentId1,
                filePath: '/scans/script1.pdf',
                filename: 'script1.pdf',
                startPageNumber: 1,
                endPageNumber: 2,
                pageCount: 2,
                isActive: true
            });

            // TA1 has Q1
            const allocQ1Ta1 = await Allocation.create({
                exam: testExamId,
                ta: taId1,
                answerScript: script1._id,
                allocatedBy: professorId,
                status: AllocationStatus.PENDING,
                rule: AllocationRule.QUESTION,
                question: 1
            });

            // TA2 already has Q1 as well
            await Allocation.create({
                exam: testExamId,
                ta: taId2,
                answerScript: script1._id,
                allocatedBy: professorId,
                status: AllocationStatus.PENDING,
                rule: AllocationRule.QUESTION,
                question: 1
            });

            await expect(
                AllocationService.reassignAllocation(
                    testExamId.toString(),
                    allocQ1Ta1._id.toString(),
                    taId2.toString(),
                    professorId.toString()
                )
            ).rejects.toThrow('Reassignment conflict: The target TA is already allocated to this script/question.');
        });
    });
});
