import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import User, { IUser } from '../models/User';
import Course, { ICourse } from '../models/Course';
import PersonalizedStudentAssignment from '../models/PersonalizedStudentAssignment';
import personalizedAssessmentService from '../services/PersonalizedAssessmentService';
import classroomEvaluationService from '../services/ClassroomEvaluationService';
import { UserRole } from '../constants/permissions';
import { submitStudentAssignmentSchema } from '../validations/personalizedAssessmentValidation';

describe('Mentor-Reviewed Personalized Assessment: Daily Text Answer & Evaluation Delegation', () => {
    let professorUser: IUser;
    let studentUser: IUser;
    let testCourse: ICourse;
    let seededQuestionIds: mongoose.Types.ObjectId[] = [];
    const originalFeatureFlag = process.env.FEATURE_PERSONALIZED_ASSESSMENT;

    beforeAll(() => {
        process.env.FEATURE_PERSONALIZED_ASSESSMENT = 'true';
    });

    afterAll(() => {
        if (originalFeatureFlag !== undefined) {
            process.env.FEATURE_PERSONALIZED_ASSESSMENT = originalFeatureFlag;
        } else {
            delete process.env.FEATURE_PERSONALIZED_ASSESSMENT;
        }
    });

    beforeEach(async () => {
        await User.deleteMany({});
        await Course.deleteMany({});
        await PersonalizedStudentAssignment.deleteMany({});

        // 1. Create Professor
        professorUser = await User.create({
            name: 'Prof. C. V. Jawahar',
            email: 'jawahar@iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        // 2. Create Student
        studentUser = await User.create({
            name: 'Alice Student',
            email: 'alice@students.iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.STUDENT,
            isActive: true
        });

        // 3. Create Course
        testCourse = await Course.create({
            courseCode: 'CS7.501',
            courseName: 'Advanced Computer Vision & Learning',
            semester: 1,
            academicYear: '2026-2027',
            professor: professorUser._id,
            teachingAssistants: [],
            enrolledStudents: [studentUser._id],
            isActive: true
        });

        // 4. Seed question pool (100 questions)
        seededQuestionIds = [];
        const questionDocs = [];
        for (let i = 1; i <= 100; i++) {
            const qId = new mongoose.Types.ObjectId();
            seededQuestionIds.push(qId);
            questionDocs.push({
                _id: qId,
                course: testCourse._id,
                questionIndex: i,
                title: `Algorithm Challenge #${i}`,
                topic: i % 2 === 0 ? 'Computer Vision' : 'Optimization',
                difficulty: 'MEDIUM',
                questionPrompt: `Derive and solve benchmark task ${i} with complete mathematical reasoning.`,
                maxMarks: 10,
                hints: [`Hint for question ${i}`],
                referenceAnswer: `Reference answer for question ${i}`,
                createdBy: professorUser._id
            });
        }
        await mongoose.model('PersonalizedQuestion').deleteMany({});
        await mongoose.model('PersonalizedQuestion').insertMany(questionDocs);
    });

    // =========================================================================
    // 1. Daily Answer is TEXT ONLY & Schema Validation
    // =========================================================================
    describe('1. Daily Answer is TEXT ONLY', () => {
        it('validates that daily answer schema accepts text and rejects empty strings or whitespace', () => {
            // Valid text solution
            const valid = submitStudentAssignmentSchema.safeParse({
                answer: 'Let f(x) = x^2. The derivative is f\'(x) = 2x by definition of limit.'
            });
            expect(valid.success).toBe(true);

            // Empty string rejected
            const empty = submitStudentAssignmentSchema.safeParse({ answer: '' });
            expect(empty.success).toBe(false);

            // Pure whitespace rejected
            const whitespace = submitStudentAssignmentSchema.safeParse({ answer: '     ' });
            expect(whitespace.success).toBe(false);

            // Missing answer field rejected
            const missing = submitStudentAssignmentSchema.safeParse({});
            expect(missing.success).toBe(false);
        });

        it('rejects non-text submission in submitTodayAssignment with HttpError 400', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Text-Only Test Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    dailyWindowStartTime: '00:00',
                    dailyWindowEndTime: '23:59',
                    enrolledStudents: [studentUser._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUser._id
            }))!;

            // Rejects empty text
            await expect(
                personalizedAssessmentService.submitTodayAssignment(
                    studentUser._id.toString(),
                    assignment._id.toString(),
                    '',
                    new Date()
                )
            ).rejects.toThrow(/Daily personalized assessment answer must be non-empty text/);

            // Rejects whitespace-only text
            await expect(
                personalizedAssessmentService.submitTodayAssignment(
                    studentUser._id.toString(),
                    assignment._id.toString(),
                    '    \n\t   ',
                    new Date()
                )
            ).rejects.toThrow(/Daily personalized assessment answer must be non-empty text/);
        });
    });

    // =========================================================================
    // 2. Daily Answer is Stored in Database
    // =========================================================================
    describe('2. Daily Answer is Stored as Typed Text', () => {
        it('stores the typed student answer and marks assignment as SUBMITTED', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Storage Verification Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    dailyWindowStartTime: '00:00',
                    dailyWindowEndTime: '23:59',
                    enrolledStudents: [studentUser._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUser._id,
                dayNumber: 1
            }))!;

            const typedText = [
                'Theorem 1: Convergence of gradient descent under Lipschitz continuity.',
                'Proof:',
                'Step 1: By the descent lemma, f(x_{t+1}) <= f(x_t) - eta (1 - L*eta/2) ||grad f(x_t)||^2.',
                'Step 2: Choosing step size eta = 1/L yields monotonic decrease f(x_{t+1}) <= f(x_t) - 1/(2L) ||grad f(x_t)||^2.',
                'Q.E.D.'
            ].join('\n');

            const submittedResult = await personalizedAssessmentService.submitTodayAssignment(
                studentUser._id.toString(),
                assignment._id.toString(),
                typedText,
                new Date()
            );

            expect(submittedResult.status).toBe('SUBMITTED');
            expect(submittedResult.studentAnswer).toBe(typedText);

            // Check directly in database
            const persistedDoc = await PersonalizedStudentAssignment.findById(assignment._id);
            expect(persistedDoc).not.toBeNull();
            expect(persistedDoc?.status).toBe('SUBMITTED');
            expect(persistedDoc?.studentAnswer).toBe(typedText);
            expect(persistedDoc?.submittedAt).toBeInstanceOf(Date);
        });
    });

    // =========================================================================
    // 3. Daily Answer is NOT Graded / Evaluated
    // =========================================================================
    describe('3. Daily Answer is NOT Graded (No AI Evaluation)', () => {
        it('ensures daily answer submission leaves score and feedback null without invoking grading', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'No-Grading Verification Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    dailyWindowStartTime: '00:00',
                    dailyWindowEndTime: '23:59',
                    enrolledStudents: [studentUser._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUser._id,
                dayNumber: 1
            }))!;

            // Spy on classroom evaluation service to prove it is NEVER called during daily answer submission
            const classroomEvalSpy = vi.spyOn(classroomEvaluationService, 'evaluateHandwrittenAnswer');

            const typedAnswer = 'This is my typed practice answer for today.';
            const result = await personalizedAssessmentService.submitTodayAssignment(
                studentUser._id.toString(),
                assignment._id.toString(),
                typedAnswer,
                new Date()
            );

            // Score and feedback must remain null (no grade assigned)
            expect(result.score).toBeNull();
            expect(result.feedback).toBeNull();

            // Verify in DB that no score or feedback was written
            const saved = await PersonalizedStudentAssignment.findById(assignment._id);
            expect(saved?.score).toBeNull();
            expect(saved?.feedback).toBeNull();

            // Verify no AI evaluation was triggered
            expect(classroomEvalSpy).not.toHaveBeenCalled();

            classroomEvalSpy.mockRestore();
        });
    });

    // =========================================================================
    // 4. Scheduling & Allocation Invariants Preserved
    // =========================================================================
    describe('4. Scheduling & Allocation Invariants Preserved', () => {
        it('preserves 100 distinct questions per student and valid weekday schedule generation', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: '100-Question Invariant Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6], // Daily (7 days/week to fit 100 slots in 16 weeks)
                    enrolledStudents: [studentUser._id.toString()]
                },
                professorUser._id.toString()
            );

            const studentAssignments = await PersonalizedStudentAssignment.find({
                schedule: schedule._id,
                student: studentUser._id
            });

            // Exactly 100 questions allocated
            expect(studentAssignments).toHaveLength(100);

            // Zero duplicate questions for this student
            const questionIds = studentAssignments.map((a) => a.question.toString());
            const uniqueQuestions = new Set(questionIds);
            expect(uniqueQuestions.size).toBe(100);

            // Day numbers strictly range 1..100
            const dayNumbers = studentAssignments.map((a) => a.dayNumber).sort((a, b) => a - b);
            expect(dayNumbers[0]).toBe(1);
            expect(dayNumbers[99]).toBe(100);
        });
    });

    // =========================================================================
    // 5. Delegation of Handwritten/Photo Evaluation to Classroom Service
    // =========================================================================
    describe('5. Handwritten / Photo Evaluation Delegation', () => {
        it('delegates handwritten answer evaluation directly to ClassroomEvaluationService without duplicate evaluator', async () => {
            // Mock classroom evaluation service response
            const mockClassroomOutcome = {
                score: 8.5,
                maxMarks: 10,
                feedback: 'Accurate derivation with clear step progression.',
                confidence: 0.94,
                criterionScores: [
                    {
                        criterionName: 'Step 1: Formula Setup',
                        marksAwarded: 4.5,
                        maxMarks: 5,
                        feedback: 'Correct integral setup'
                    },
                    {
                        criterionName: 'Step 2: Integration Calculation',
                        marksAwarded: 4.0,
                        maxMarks: 5,
                        feedback: 'Minor simplification arithmetic'
                    }
                ]
            };

            const evalSpy = vi.spyOn(classroomEvaluationService, 'evaluateHandwrittenAnswer')
                .mockResolvedValueOnce(mockClassroomOutcome);

            const dummyImageBuffer = Buffer.from('mock-handwritten-image-bytes');
            const result = await personalizedAssessmentService.evaluateHandwrittenAnswer({
                questionPrompt: 'Calculate the double integral of xy over the unit square.',
                maxMarks: 10,
                rubricCriteria: [
                    { criterionName: 'Step 1: Formula Setup', points: 5 },
                    { criterionName: 'Step 2: Integration Calculation', points: 5 }
                ],
                sampleSolution: 'Integral = 1/4',
                imageBuffer: dummyImageBuffer,
                mimeType: 'image/png'
            });

            // Ensure delegation occurred to ClassroomEvaluationService
            expect(evalSpy).toHaveBeenCalledTimes(1);
            expect(evalSpy).toHaveBeenCalledWith(expect.objectContaining({
                questionPrompt: 'Calculate the double integral of xy over the unit square.',
                maxMarks: 10,
                imageBuffer: dummyImageBuffer,
                mimeType: 'image/png'
            }));

            // Outcome matches classroom evaluation outcome
            expect(result.score).toBe(8.5);
            expect(result.feedback).toContain('Accurate derivation');
            expect(result.criterionScores).toHaveLength(2);

            evalSpy.mockRestore();
        });
    });
});
