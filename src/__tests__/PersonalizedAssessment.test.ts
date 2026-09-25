import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import User, { IUser } from '../models/User';
import Course, { ICourse } from '../models/Course';
import PersonalizedQuestion, { IPersonalizedQuestion } from '../models/PersonalizedQuestion';
import { IPersonalizedAssessmentSchedule } from '../models/PersonalizedAssessmentSchedule';
import PersonalizedStudentAssignment, { IPersonalizedStudentAssignment } from '../models/PersonalizedStudentAssignment';
import personalizedAssessmentService from '../services/PersonalizedAssessmentService';
import syllabusProcessingService from '../services/SyllabusProcessingService';
import personalizedQuestionGenerationService from '../services/PersonalizedQuestionGenerationService';
import personalizationService from '../services/PersonalizationService';
import { MockAIQuestionGenerationProvider } from '../services/ai/AIQuestionGenerationProvider';
import { UserRole } from '../constants/permissions';
import {
    createPersonalizedQuestionSchema,
    bulkCreatePersonalizedQuestionsSchema,
    createPersonalizedScheduleSchema,
    uploadSyllabusSchema,
    generateQuestionsSchema
} from '../validations/personalizedAssessmentValidation';

describe('Research Direction 2: Personalized Assessment Test Suite', () => {
    let professorUser: IUser;
    let studentUserA: IUser;
    let studentUserB: IUser;
    let studentUsersCohort: IUser[] = [];
    let testCourse: ICourse;
    let seededQuestionPool: IPersonalizedQuestion[] = [];

    beforeEach(async () => {
        // 1. Create Professor
        professorUser = await User.create({
            name: 'Prof. C. V. Jawahar',
            email: 'jawahar@iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        // 2. Create Student A & B
        studentUserA = await User.create({
            name: 'Student Alice',
            email: 'alice@students.iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.STUDENT,
            isActive: true
        });

        studentUserB = await User.create({
            name: 'Student Bob',
            email: 'bob@students.iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.STUDENT,
            isActive: true
        });

        // 3. Create a cohort of 50 students
        studentUsersCohort = [studentUserA, studentUserB];
        const extraStudents = [];
        for (let i = 3; i <= 50; i++) {
            extraStudents.push({
                name: `Cohort Student ${i}`,
                email: `student${i}@students.iiit.ac.in`,
                password: 'hashedPassword123',
                role: UserRole.STUDENT,
                isActive: true
            });
        }
        const createdExtras = await User.insertMany(extraStudents);
        studentUsersCohort.push(...createdExtras);

        // 4. Create Course
        testCourse = await Course.create({
            courseCode: 'CS7.501',
            courseName: 'Advanced Computer Vision & Learning',
            semester: 1,
            academicYear: '2026-2027',
            professor: professorUser._id,
            teachingAssistants: [],
            enrolledStudents: studentUsersCohort.map((s) => s._id),
            isActive: true
        });

        // 5. Seed 100 Questions in the Question Bank
        const questionDocs = [];
        for (let i = 1; i <= 100; i++) {
            questionDocs.push({
                course: testCourse._id,
                questionIndex: i,
                title: `Algorithm Challenge #${i}`,
                topic: i % 2 === 0 ? 'Computer Vision' : 'Optimization',
                difficulty: 'MEDIUM',
                questionPrompt: `Derive and solve benchmark task ${i} with complete mathematical reasoning.`,
                maxMarks: 10,
                hints: [`Hint for question ${i}`],
                referenceAnswer: `Reference answer for question ${i}`,
                rubricCriteria: [
                    { criterionName: 'Theory Formulation', points: 4 },
                    { criterionName: 'Algorithm Steps', points: 6 }
                ],
                createdBy: professorUser._id,
                isActive: true
            });
        }
        seededQuestionPool = (await PersonalizedQuestion.insertMany(questionDocs)) as unknown as IPersonalizedQuestion[];
    });

    // =========================================================================
    // 1. 50 Students × 100 Slots Collision-Free Allocation Test
    // =========================================================================
    describe('1. 50 Students × 100 Slots Allocation Invariant', () => {
        it('guarantees no two students share a question on the same day and each student receives 100 distinct questions', () => {
            const studentIds = studentUsersCohort.map((s) => s._id.toString());
            const questionIds = seededQuestionPool.map((q) => q._id.toString());

            const matrix = personalizedAssessmentService.generateAllocationMatrix(
                studentIds,
                questionIds,
                100
            );

            expect(matrix.size).toBe(50);

            // Test Invariant 1: No collision on the same day slot across all 50 students
            for (let day = 0; day < 100; day++) {
                const dayAssignedQuestions = new Set<string>();
                for (const studentId of studentIds) {
                    const studentQuestions = matrix.get(studentId)!;
                    const assignedQ = studentQuestions[day];
                    expect(dayAssignedQuestions.has(assignedQ)).toBe(false);
                    dayAssignedQuestions.add(assignedQ);
                }
                expect(dayAssignedQuestions.size).toBe(50);
            }

            // Test Invariant 2: Every student receives exactly 100 distinct questions
            for (const studentId of studentIds) {
                const studentQuestions = matrix.get(studentId)!;
                expect(studentQuestions.length).toBe(100);
                const uniqueQuestions = new Set(studentQuestions);
                expect(uniqueQuestions.size).toBe(100);
            }
        });
    });

    // =========================================================================
    // 2 & 3. Question Pool Sizing & Pre-Validation Checks
    // =========================================================================
    describe('2 & 3. Question Pool Boundary Validations', () => {
        it('refuses schedule creation if question pool size < 100', async () => {
            const smallPool = seededQuestionPool.slice(0, 50).map((q) => q._id.toString());

            await expect(
                personalizedAssessmentService.createSchedule(
                    {
                        course: testCourse._id.toString(),
                        title: 'Invalid Small Pool Schedule',
                        startDate: '2026-08-01',
                        activeDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                        enrolledStudents: [studentUserA._id.toString()],
                        questionPool: smallPool
                    },
                    professorUser._id.toString()
                )
            ).rejects.toThrow(/Question pool size .* is insufficient/);
        });

        it('refuses schedule creation if enrolled students > question pool size', async () => {
            // Create 110 dummy student IDs
            const dummyStudentIds = Array.from({ length: 110 }, () => new mongoose.Types.ObjectId().toString());
            const pool100 = seededQuestionPool.map((q) => q._id.toString());

            await expect(
                personalizedAssessmentService.createSchedule(
                    {
                        course: testCourse._id.toString(),
                        title: 'Oversubscribed Cohort Schedule',
                        startDate: '2026-08-01',
                        activeDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                        enrolledStudents: dummyStudentIds,
                        questionPool: pool100
                    },
                    professorUser._id.toString()
                )
            ).rejects.toThrow(/Question pool size .* is insufficient/);
        });
    });

    // =========================================================================
    // 4. Future Question Window & Prompt Redaction
    // =========================================================================
    describe('4. Future Assessment Slot Security', () => {
        let schedule: IPersonalizedAssessmentSchedule;
        let futureAssignment: IPersonalizedStudentAssignment;

        beforeEach(async () => {
            // Schedule starting tomorrow
            const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
            const tomorrowStr = tomorrow.toISOString().slice(0, 10);

            schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Future Cohort Schedule',
                    startDate: tomorrowStr,
                    activeDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                    dailyWindowStartTime: '09:00',
                    dailyWindowEndTime: '22:00',
                    enrolledStudents: [studentUserA._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignments = await PersonalizedStudentAssignment.find({
                schedule: schedule._id,
                student: studentUserA._id
            }).sort({ dayNumber: 1 });

            futureAssignment = assignments[0];
        });

        it('redacts question prompt, hints, and reference answers for future LOCKED slots', async () => {
            // Simulated time is today (before tomorrow window)
            const today = new Date();
            const todayResult = await personalizedAssessmentService.getTodayAssignment(
                studentUserA._id.toString(),
                today
            );

            // No assignment scheduled for today since start is tomorrow
            expect(todayResult?.assignment).toBeNull();

            // Direct dynamic status check on future assignment
            const status = personalizedAssessmentService.evaluateDynamicStatus(futureAssignment, today);
            expect(status).toBe('LOCKED');

            const redacted = personalizedAssessmentService.redactQuestionContent(futureAssignment, 'LOCKED');
            expect(redacted?.questionPrompt).toBeNull();
            expect(redacted?.referenceAnswer).toBeNull();
            expect(redacted?.hints).toEqual([]);
            expect(redacted?.title).toBe('Upcoming Assessment Slot');
        });

        it('rejects attempts to start or submit future LOCKED assignments', async () => {
            const simulatedBeforeTime = new Date(futureAssignment.windowStart.getTime() - 3600 * 1000);

            await expect(
                personalizedAssessmentService.startTodayAssignment(
                    studentUserA._id.toString(),
                    futureAssignment._id.toString(),
                    simulatedBeforeTime
                )
            ).rejects.toThrow(/Cannot start assignment before its scheduled window opens/);

            await expect(
                personalizedAssessmentService.submitTodayAssignment(
                    studentUserA._id.toString(),
                    futureAssignment._id.toString(),
                    'Attempting early answer',
                    simulatedBeforeTime
                )
            ).rejects.toThrow(/Submission rejected: The window for this question has not opened yet/);
        });
    });

    // =========================================================================
    // 5. Current Valid Window Lifecycle (Start & Submit)
    // =========================================================================
    describe('5. Active Window Assessment Lifecycle', () => {
        let schedule: IPersonalizedAssessmentSchedule;
        let todayAssignment: IPersonalizedStudentAssignment;
        let validNow: Date;

        beforeEach(async () => {
            const todayStr = new Date().toISOString().slice(0, 10);

            schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Active Today Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                    dailyWindowStartTime: '08:00',
                    dailyWindowEndTime: '23:00',
                    enrolledStudents: [studentUserA._id.toString()]
                },
                professorUser._id.toString()
            );

            todayAssignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUserA._id,
                dayNumber: 1
            }).populate('question'))!;

            validNow = new Date(todayAssignment.scheduledDate.getTime());
            validNow.setUTCHours(12, 0, 0, 0); // 12:00 UTC, within 08:00 - 23:00
        });

        it('allows retrieval, starting, and submitting during valid daily window', async () => {
            // 1. Retrieve today
            const todayRes = await personalizedAssessmentService.getTodayAssignment(
                studentUserA._id.toString(),
                validNow
            );
            expect(todayRes).not.toBeNull();
            expect(todayRes!.assignment?.status).toBe('AVAILABLE');
            expect(todayRes!.assignment?.question?.questionPrompt).toContain('Derive and solve benchmark task');

            // 2. Start today
            const started = await personalizedAssessmentService.startTodayAssignment(
                studentUserA._id.toString(),
                todayAssignment._id.toString(),
                validNow
            );
            expect(started.status).toBe('IN_PROGRESS');

            // 3. Submit today
            const answerContent = 'My complete derived mathematical proof using dynamic programming.';
            const submitted = await personalizedAssessmentService.submitTodayAssignment(
                studentUserA._id.toString(),
                todayAssignment._id.toString(),
                answerContent,
                validNow
            );

            expect(submitted.status).toBe('SUBMITTED');
            expect(submitted.studentAnswer).toBe(answerContent);
            expect(submitted.submittedAt).toBeDefined();

            // 4. Verify in DB
            const dbRecord = await PersonalizedStudentAssignment.findById(todayAssignment._id);
            expect(dbRecord?.status).toBe('SUBMITTED');
            expect(dbRecord?.studentAnswer).toBe(answerContent);
        });
    });

    // =========================================================================
    // 6. Expired Window & Anti-Postponement Guard
    // =========================================================================
    describe('6. Anti-Postponement & Expired Window Enforcement', () => {
        let schedule: IPersonalizedAssessmentSchedule;
        let pastAssignment: IPersonalizedStudentAssignment;
        let expiredNow: Date;

        beforeEach(async () => {
            const todayStr = new Date().toISOString().slice(0, 10);

            schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Anti-Postponement Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                    dailyWindowStartTime: '08:00',
                    dailyWindowEndTime: '18:00',
                    enrolledStudents: [studentUserA._id.toString()]
                },
                professorUser._id.toString()
            );

            pastAssignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUserA._id,
                dayNumber: 1
            }))!;

            // Simulated time is 20:00 (after 18:00 windowEnd)
            expiredNow = new Date(pastAssignment.scheduledDate.getTime());
            expiredNow.setUTCHours(20, 0, 0, 0);
        });

        it('transitions status to MISSED and permanently rejects late submissions', async () => {
            const status = personalizedAssessmentService.evaluateDynamicStatus(pastAssignment, expiredNow);
            expect(status).toBe('MISSED');

            await expect(
                personalizedAssessmentService.submitTodayAssignment(
                    studentUserA._id.toString(),
                    pastAssignment._id.toString(),
                    'Late submission attempt at 20:00',
                    expiredNow
                )
            ).rejects.toThrow(/has expired/i);

            // DB status is locked to MISSED
            const updated = await PersonalizedStudentAssignment.findById(pastAssignment._id);
            expect(updated?.status).toBe('MISSED');
        });
    });

    // =========================================================================
    // 7. Database Unique Invariants (No Collision, One Per Student Per Day)
    // =========================================================================
    describe('7. Database Invariant Constraints', () => {
        it('enforces unique (schedule, student, scheduledDate) and rejects duplicate assignments for same day', async () => {
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'DB Invariant Schedule',
                    startDate: new Date().toISOString().slice(0, 10),
                    activeDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                    enrolledStudents: [studentUserA._id.toString()]
                },
                professorUser._id.toString()
            );

            const existing = await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUserA._id,
                dayNumber: 1
            });

            // Attempt to insert duplicate assignment for student on same scheduled date
            await expect(
                PersonalizedStudentAssignment.create({
                    schedule: schedule._id,
                    student: studentUserA._id,
                    question: seededQuestionPool[10]._id,
                    dayNumber: 999,
                    scheduledDate: existing!.scheduledDate,
                    windowStart: existing!.windowStart,
                    windowEnd: existing!.windowEnd,
                    status: 'LOCKED'
                })
            ).rejects.toThrow();
        });

        it('enforces unique (schedule, scheduledDate, question) and rejects duplicate question on same day', async () => {
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Question Collision Invariant Schedule',
                    startDate: new Date().toISOString().slice(0, 10),
                    activeDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                    enrolledStudents: [studentUserA._id.toString(), studentUserB._id.toString()]
                },
                professorUser._id.toString()
            );

            const studentAAssignment = await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUserA._id,
                dayNumber: 1
            });

            // Attempt to insert an assignment giving student B the SAME question on the SAME scheduled date
            await expect(
                PersonalizedStudentAssignment.create({
                    schedule: schedule._id,
                    student: studentUserB._id,
                    question: studentAAssignment!.question,
                    dayNumber: 888,
                    scheduledDate: studentAAssignment!.scheduledDate,
                    windowStart: studentAAssignment!.windowStart,
                    windowEnd: studentAAssignment!.windowEnd,
                    status: 'LOCKED'
                })
            ).rejects.toThrow();
        });
    });

    // =========================================================================
    // 8. Student Isolation & Privacy
    // =========================================================================
    describe('8. Student Isolation & Privacy Controls', () => {
        let schedule: IPersonalizedAssessmentSchedule;
        let studentAAssignment: IPersonalizedStudentAssignment;

        beforeEach(async () => {
            schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Isolation Schedule',
                    startDate: new Date().toISOString().slice(0, 10),
                    activeDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                    enrolledStudents: [studentUserA._id.toString(), studentUserB._id.toString()]
                },
                professorUser._id.toString()
            );

            studentAAssignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUserA._id,
                dayNumber: 1
            }))!;
        });

        it('prevents Student B from accessing, starting, or submitting Student A’s assignment', async () => {
            const validNow = new Date(studentAAssignment.scheduledDate.getTime());
            validNow.setUTCHours(12, 0, 0, 0);

            await expect(
                personalizedAssessmentService.startTodayAssignment(
                    studentUserB._id.toString(), // Student B acting on Student A's assignment
                    studentAAssignment._id.toString(),
                    validNow
                )
            ).rejects.toThrow(/Forbidden: This is not your assignment/);

            await expect(
                personalizedAssessmentService.submitTodayAssignment(
                    studentUserB._id.toString(),
                    studentAAssignment._id.toString(),
                    'Malicious submission',
                    validNow
                )
            ).rejects.toThrow(/Forbidden: This is not your assignment/);
        });
    });

    // =========================================================================
    // 9. Professor Authorization Controls
    // =========================================================================
    describe('9. Professor Authorization Guardrails', () => {
        it('denies students from creating questions or schedules', async () => {
            await expect(
                personalizedAssessmentService.createQuestion(
                    {
                        course: testCourse._id.toString(),
                        questionIndex: 101,
                        title: 'Unauthorized Question',
                        topic: 'Testing',
                        difficulty: 'EASY',
                        questionPrompt: 'Test'
                    },
                    studentUserA._id.toString(), // Student trying to create
                    { actingUserRole: UserRole.STUDENT }
                )
            ).rejects.toThrow(/Forbidden: You are not the instructor for this course/);

            await expect(
                personalizedAssessmentService.createSchedule(
                    {
                        course: testCourse._id.toString(),
                        title: 'Unauthorized Schedule',
                        startDate: '2026-08-01',
                        activeDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                        enrolledStudents: [studentUserA._id.toString()]
                    },
                    studentUserA._id.toString(),
                    { actingUserRole: UserRole.STUDENT }
                )
            ).rejects.toThrow(/Forbidden: You are not the instructor for this course/);
        });
    });

    // =========================================================================
    // 10. Exactly 100 Assessment Slots & 16-Week Boundary
    // =========================================================================
    describe('10. 100 Assessment Slots Calendar Logic', () => {
        it('generates exactly 100 assessment dates across 7 active weekdays', () => {
            const dates = personalizedAssessmentService.generateAssessmentDates(
                '2026-08-01',
                16,
                [1, 2, 3, 4, 5, 6, 0], // Every day = 100 days needed = 14.3 weeks
                100
            );

            expect(dates.length).toBe(100);

            // Verify all dates are strictly ascending
            for (let i = 1; i < dates.length; i++) {
                expect(dates[i].getTime()).toBeGreaterThan(dates[i - 1].getTime());
            }

            // Verify 100th date is within 16 weeks (112 days)
            const startDate = dates[0];
            const max16WeekLimit = new Date(startDate.getTime() + 16 * 7 * 86400 * 1000);
            expect(dates[99].getTime()).toBeLessThanOrEqual(max16WeekLimit.getTime());
        });

        it('rejects scheduling if selected active weekdays cannot fit 100 slots in 16 weeks', () => {
            // E.g., 5 days per week (Mon-Fri) * 16 weeks = 80 slots maximum < 100
            expect(() =>
                personalizedAssessmentService.generateAssessmentDates(
                    '2026-08-01',
                    16,
                    [1, 2, 3, 4, 5], // 5 weekdays
                    100
                )
            ).toThrow(/Configured active weekdays .* cannot yield 100 slots within 16 weeks/);
        });
    });

    // =========================================================================
    // 11. Concurrent Student Submissions
    // =========================================================================
    describe('11. Concurrent Student Submissions', () => {
        it('handles simultaneous submissions from multiple students without state corruption', async () => {
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Concurrency Schedule',
                    startDate: new Date().toISOString().slice(0, 10),
                    activeDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                    dailyWindowStartTime: '08:00',
                    dailyWindowEndTime: '23:00',
                    enrolledStudents: studentUsersCohort.slice(0, 10).map((s) => s._id.toString())
                },
                professorUser._id.toString()
            );

            const cohort10 = studentUsersCohort.slice(0, 10);
            const validNow = new Date();
            validNow.setUTCHours(14, 0, 0, 0);

            // Fetch day 1 assignment for all 10 students
            const assignments = await Promise.all(
                cohort10.map((s) =>
                    PersonalizedStudentAssignment.findOne({
                        schedule: schedule._id,
                        student: s._id,
                        dayNumber: 1
                    })
                )
            );

            // Simulate concurrent submissions
            const submissionPromises = cohort10.map((student, idx) => {
                const a = assignments[idx]!;
                return personalizedAssessmentService.submitTodayAssignment(
                    student._id.toString(),
                    a._id.toString(),
                    `Concurrent solution from ${student.name}`,
                    validNow
                );
            });

            const results = await Promise.all(submissionPromises);

            expect(results.length).toBe(10);
            for (let i = 0; i < 10; i++) {
                expect(results[i].status).toBe('SUBMITTED');
                expect(results[i].studentAnswer).toContain(`Concurrent solution from ${cohort10[i].name}`);
            }

            // Verify cohort progress
            const progress = await personalizedAssessmentService.getScheduleProgress(
                schedule._id.toString(),
                professorUser._id.toString(),
                UserRole.PROFESSOR
            );

            expect(progress.studentProgress.length).toBe(10);
            for (const sp of progress.studentProgress) {
                expect(sp.submittedCount).toBe(1);
            }
        });
    });

    // =========================================================================
    // 12. Repeated Submission Prevention
    // =========================================================================
    describe('12. Repeated Submission Guard', () => {
        it('rejects re-submitting an already SUBMITTED assignment', async () => {
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Repeated Submission Schedule',
                    startDate: new Date().toISOString().slice(0, 10),
                    activeDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                    dailyWindowStartTime: '08:00',
                    dailyWindowEndTime: '23:00',
                    enrolledStudents: [studentUserA._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignment = await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUserA._id,
                dayNumber: 1
            });

            const validNow = new Date();
            validNow.setUTCHours(12, 0, 0, 0);

            // First submission
            await personalizedAssessmentService.submitTodayAssignment(
                studentUserA._id.toString(),
                assignment!._id.toString(),
                'Initial submission',
                validNow
            );

            // Second submission attempt
            await expect(
                personalizedAssessmentService.submitTodayAssignment(
                    studentUserA._id.toString(),
                    assignment!._id.toString(),
                    'Second submission attempt',
                    validNow
                )
            ).rejects.toThrow(/already been submitted and finalized/);
        });
    });

    // =========================================================================
    // 13. Student Progress & Streak Tracking
    // =========================================================================
    describe('13. Student Progress & Streak Tracking', () => {
        it('calculates completion statistics and streak progression correctly in getMySchedule', async () => {
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Streak Tracking Schedule',
                    startDate: new Date().toISOString().slice(0, 10),
                    activeDaysOfWeek: [1, 2, 3, 4, 5, 6, 0],
                    dailyWindowStartTime: '08:00',
                    dailyWindowEndTime: '23:00',
                    enrolledStudents: [studentUserA._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignments = await PersonalizedStudentAssignment.find({
                schedule: schedule._id,
                student: studentUserA._id
            }).sort({ dayNumber: 1 });

            // Mark day 1 & day 2 as SUBMITTED
            assignments[0].status = 'SUBMITTED';
            await assignments[0].save();

            assignments[1].status = 'SUBMITTED';
            await assignments[1].save();

            const mySchedule = await personalizedAssessmentService.getMySchedule(
                studentUserA._id.toString(),
                new Date()
            );

            expect(mySchedule.stats.total).toBe(100);
            expect(mySchedule.stats.completed).toBe(2);
            expect(mySchedule.stats.streak).toBe(2);
            expect(mySchedule.stats.completionPercentage).toBe(2);
            expect(mySchedule.slots.length).toBe(100);
        });
    });

    // =========================================================================
    // 14. Syllabus Processing & Topic Extraction
    // =========================================================================
    describe('14. Syllabus Processing & Topic Extraction', () => {
        it('processes structured syllabus text and extracts units and topics', async () => {
            const syllabusText = `
            Unit 1: Foundations of Algorithms
            - Asymptotic notation and Recurrence relations
            - Divide and Conquer paradigm

            Unit 2: Dynamic Programming & Optimization
            - Optimal substructure & Memoization
            - Matrix Chain Multiplication
            - Knapsack 0/1 Problem

            Unit 3: Graph Algorithms
            - Breadth First Search & Depth First Search
            - Dijkstra Shortest Path
            - Prim and Kruskal MST
            `;

            const syllabus = await syllabusProcessingService.processSyllabus(
                testCourse._id.toString(),
                syllabusText,
                professorUser._id.toString(),
                { userRole: UserRole.PROFESSOR }
            );

            expect(syllabus).toBeDefined();
            expect(syllabus.units.length).toBe(3);
            expect(syllabus.units[0].unitTitle).toContain('Foundations of Algorithms');
            expect(syllabus.units[1].topics.length).toBe(3);
            expect(syllabus.extractedTopics.length).toBeGreaterThanOrEqual(8);
            expect(syllabus.uploadedBy.toString()).toBe(professorUser._id.toString());

            // Verify retrieval
            const retrieved = await syllabusProcessingService.getSyllabus(testCourse._id.toString());
            expect(retrieved).not.toBeNull();
            expect(retrieved?.units.length).toBe(3);
        });

        it('rejects syllabus upload if professor is not authorized for the course', async () => {
            const otherProfessor = await User.create({
                name: 'Other Professor',
                email: 'otherprof@iiit.ac.in',
                password: 'hashedPassword123',
                role: UserRole.PROFESSOR,
                isActive: true
            });

            await expect(
                syllabusProcessingService.processSyllabus(
                    testCourse._id.toString(),
                    'Unit 1: Intro\n- Topic A',
                    otherProfessor._id.toString(),
                    { userRole: UserRole.PROFESSOR }
                )
            ).rejects.toThrow(/Forbidden: You are not authorized to manage the syllabus/);
        });

        it('rejects syllabus upload if authenticated userId is invalid or missing', async () => {
            await expect(
                syllabusProcessingService.processSyllabus(
                    testCourse._id.toString(),
                    'Unit 1: Test\n- Topic A',
                    'invalid-non-objectid-user'
                )
            ).rejects.toThrow(/Invalid or missing authenticated user identity/);
        });

        it('rejects empty syllabus content with a 400 error', async () => {
            await expect(
                syllabusProcessingService.processSyllabus(
                    testCourse._id.toString(),
                    '   ',
                    professorUser._id.toString()
                )
            ).rejects.toThrow(/cannot be empty/i);
        });
    });



    // =========================================================================
    // 15. AI Question Generation & Provider Configuration Guard
    // =========================================================================
    describe('15. AI Question Generation & Grounding', () => {
        beforeEach(async () => {
            await syllabusProcessingService.processSyllabus(
                testCourse._id.toString(),
                `
                Unit 1: Linear Models & Optimization
                - Gradient Descent and Convexity
                - Ridge & Lasso Regularization

                Unit 2: Neural Networks & Backpropagation
                - Multilayer Perceptrons
                - Loss Functions & Activations
                `,
                professorUser._id.toString()
            );
        });

        it('throws 503 configuration error when AI provider is not configured', async () => {
            const unconfiguredProvider = new MockAIQuestionGenerationProvider(false);

            await expect(
                personalizedQuestionGenerationService.generateQuestionBank(
                    {
                        courseId: testCourse._id.toString(),
                        targetCount: 50,
                        userId: professorUser._id.toString()
                    },
                    unconfiguredProvider
                )
            ).rejects.toThrow(/AI question generation is not configured/i);
        });

        it('generates syllabus-grounded questions with difficulty distribution using configured provider', async () => {
            const configuredProvider = new MockAIQuestionGenerationProvider(true);

            const result = await personalizedQuestionGenerationService.generateQuestionBank(
                {
                    courseId: testCourse._id.toString(),
                    targetCount: 120,
                    difficultyDistribution: { EASY: 40, MEDIUM: 60, HARD: 20 },
                    userId: professorUser._id.toString()
                },
                configuredProvider
            );

            expect(result.totalGenerated).toBe(120);
            expect(result.totalInPool).toBeGreaterThanOrEqual(120);
            expect(result.difficultyBreakdown.EASY).toBeGreaterThanOrEqual(40);
            expect(result.questions[0].sourceSyllabusTopic).toBeDefined();
        });
    });

    // =========================================================================
    // 16. Personalization Service & Student Learning Profile
    // =========================================================================
    describe('16. Personalization Service & Learning Profile', () => {
        it('retrieves baseline profile for new student without history', async () => {
            const profile = await personalizationService.getStudentProfile(
                studentUserA._id.toString(),
                testCourse._id.toString()
            );

            expect(profile.studentId).toBe(studentUserA._id.toString());
            expect(profile.studentName).toBe('Student Alice');
            expect(profile.totalAssigned).toBe(0);
            expect(profile.recommendedLevel).toBe('INTERMEDIATE');
        });

        it('rejects schedule generation when pool size is insufficient for enrolled students', () => {
            const smallPool = seededQuestionPool.slice(0, 40); // only 40 questions

            expect(() => {
                personalizationService.generatePersonalizedAllocation({
                    enrolledStudents: studentUsersCohort.map((s) => s._id.toString()), // 50 students
                    questionPool: smallPool,
                    totalSlots: 100
                });
            }).toThrow(/Insufficient question bank capacity/i);
        });
    });

    // =========================================================================
    // 17. Validation & Empty State Regressions
    // =========================================================================
    describe('17. Validation & Empty State Regressions', () => {
        it('successfully evaluates and exports all personalized Zod schemas without runtime errors', () => {
            expect(createPersonalizedQuestionSchema).toBeDefined();
            expect(bulkCreatePersonalizedQuestionsSchema).toBeDefined();
            expect(createPersonalizedScheduleSchema).toBeDefined();
            expect(uploadSyllabusSchema).toBeDefined();
            expect(generateQuestionsSchema).toBeDefined();
        });

        it('validates single question creation and enforces rubric points <= maxMarks', () => {
            const validData = {
                course: new mongoose.Types.ObjectId().toString(),
                questionIndex: 1,
                title: 'Binary Tree Traversal',
                topic: 'Trees',
                difficulty: 'MEDIUM' as const,
                questionPrompt: 'Explain in-order traversal.',
                maxMarks: 10,
                rubricCriteria: [
                    { criterionName: 'Definition', points: 4 },
                    { criterionName: 'Complexity', points: 6 }
                ]
            };

            const validRes = createPersonalizedQuestionSchema.safeParse(validData);
            expect(validRes.success).toBe(true);

            // Exceeds maxMarks
            const invalidData = {
                ...validData,
                rubricCriteria: [
                    { criterionName: 'Definition', points: 6 },
                    { criterionName: 'Complexity', points: 6 } // 6 + 6 = 12 > 10
                ]
            };

            const invalidRes = createPersonalizedQuestionSchema.safeParse(invalidData);
            expect(invalidRes.success).toBe(false);
            if (!invalidRes.success) {
                expect(invalidRes.error.issues[0]?.message).toMatch(/cannot exceed maxMarks/i);
            }
        });

        it('validates bulk question creation schema and preserves rubric points refinement on items', () => {
            const courseId = new mongoose.Types.ObjectId().toString();
            const validBulkData = {
                course: courseId,
                questions: [
                    {
                        questionIndex: 1,
                        title: 'Question 1',
                        topic: 'Arrays',
                        difficulty: 'EASY' as const,
                        questionPrompt: 'Prompt 1',
                        maxMarks: 5,
                        rubricCriteria: [{ criterionName: 'Correctness', points: 5 }]
                    }
                ]
            };

            const validRes = bulkCreatePersonalizedQuestionsSchema.safeParse(validBulkData);
            expect(validRes.success).toBe(true);

            // Refinement check on bulk item: points exceed maxMarks
            const invalidBulkData = {
                course: courseId,
                questions: [
                    {
                        questionIndex: 1,
                        title: 'Question 1',
                        topic: 'Arrays',
                        difficulty: 'EASY' as const,
                        questionPrompt: 'Prompt 1',
                        maxMarks: 5,
                        rubricCriteria: [{ criterionName: 'Correctness', points: 10 }] // 10 > 5
                    }
                ]
            };

            const invalidRes = bulkCreatePersonalizedQuestionsSchema.safeParse(invalidBulkData);
            expect(invalidRes.success).toBe(false);
        });

        it('returns empty array [] for a course with zero questions (empty question bank)', async () => {
            const emptyCourse = await Course.create({
                courseCode: 'CS999',
                courseName: 'Empty Course',
                semester: 1,
                academicYear: '2026-2027',
                professor: professorUser._id,
                teachingAssistants: [],
                enrolledStudents: [],
                isActive: true
            });

            const questions = await personalizedAssessmentService.getQuestions(emptyCourse._id.toString());
            expect(Array.isArray(questions)).toBe(true);
            expect(questions.length).toBe(0);
        });

        it('returns empty array [] for a professor with zero assessment schedules', async () => {
            const newProfessor = await User.create({
                name: 'Prof. Fresh',
                email: 'fresh.prof@iiit.ac.in',
                password: 'hashedPassword123',
                role: UserRole.PROFESSOR,
                isActive: true
            });

            const schedules = await personalizedAssessmentService.getSchedulesByProfessor(
                newProfessor._id.toString()
            );
            expect(Array.isArray(schedules)).toBe(true);
            expect(schedules.length).toBe(0);
        });

        it('returns null for a course with no syllabus yet (empty syllabus state)', async () => {
            const emptyCourse = await Course.create({
                courseCode: 'CS998',
                courseName: 'No Syllabus Course',
                semester: 1,
                academicYear: '2026-2027',
                professor: professorUser._id,
                teachingAssistants: [],
                enrolledStudents: [],
                isActive: true
            });

            const syllabus = await syllabusProcessingService.getSyllabus(emptyCourse._id.toString());
            expect(syllabus).toBeNull();
        });
    });
});

