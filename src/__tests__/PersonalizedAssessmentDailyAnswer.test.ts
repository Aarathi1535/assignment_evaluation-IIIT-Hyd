import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { NextRequest } from 'next/server';
import User, { IUser } from '../models/User';
import Course, { ICourse } from '../models/Course';
import PersonalizedStudentAssignment from '../models/PersonalizedStudentAssignment';
import personalizedAssessmentService from '../services/PersonalizedAssessmentService';
import classroomEvaluationService from '../services/ClassroomEvaluationService';
import { UserRole } from '../constants/permissions';
import { submitStudentAssignmentSchema, submitStudentPhotoAssignmentSchema } from '../validations/personalizedAssessmentValidation';
import { HttpError } from '../lib/errors';
import { POST as submitRoute } from '../app/api/personalized/today/submit/route';

let mockSessionUser: { id: string; role: string } | null = null;

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

vi.mock('../services/CloudStorageService', () => {
    return {
        cloudStorageService: {
            uploadFile: vi.fn().mockImplementation(async ({ bucketName, destination }) => {
                return `gs://${bucketName}/${destination}`;
            }),
            downloadFile: vi.fn().mockResolvedValue(Buffer.from('mock-image-data'))
        }
    };
});

describe('Mentor-Reviewed Personalized Assessment: Daily Photo Upload & Evaluated Answers', () => {
    let professorUser: IUser;
    let studentUser: IUser;
    let studentUser2: IUser;
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
        await mongoose.model('PersonalizedQuestion').deleteMany({});

        // 1. Create Professor
        professorUser = await User.create({
            name: 'Prof. C. V. Jawahar',
            email: 'jawahar@iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.PROFESSOR,
            isActive: true
        });

        // 2. Create Students
        studentUser = await User.create({
            name: 'Alice Student',
            email: 'alice@students.iiit.ac.in',
            password: 'hashedPassword123',
            role: UserRole.STUDENT,
            isActive: true
        });

        studentUser2 = await User.create({
            name: 'Bob Student',
            email: 'bob@students.iiit.ac.in',
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
            enrolledStudents: [studentUser._id, studentUser2._id],
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
                rubricCriteria: [
                    { criterionName: 'Formulation', points: 5, description: 'Mathematical formulation' },
                    { criterionName: 'Execution', points: 5, description: 'Step correctness' }
                ],
                createdBy: professorUser._id
            });
        }
        await mongoose.model('PersonalizedQuestion').insertMany(questionDocs);
    });

    // =========================================================================
    // 1. Text-Only Daily Answer Behavior (Preserved)
    // =========================================================================
    describe('1. Text-Only Daily Answer Behavior (Preserved)', () => {
        it('validates schema: accepts valid text and rejects empty strings or whitespace', () => {
            const valid = submitStudentAssignmentSchema.safeParse({
                answer: 'Let f(x) = x^2. The derivative is f\'(x) = 2x by definition of limit.'
            });
            expect(valid.success).toBe(true);

            expect(submitStudentAssignmentSchema.safeParse({ answer: '' }).success).toBe(false);
            expect(submitStudentAssignmentSchema.safeParse({ answer: '     ' }).success).toBe(false);
            expect(submitStudentAssignmentSchema.safeParse({}).success).toBe(false);
        });

        it('stores text submissions as typed text learning records with null score/feedback and without AI call', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Text Submission Verification Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    dailyWindowStartTime: '00:00',
                    dailyWindowEndTime: '23:59',
                    enrolledStudents: [studentUser._id.toString(), studentUser2._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUser._id,
                dayNumber: 1
            }))!;

            const classroomEvalSpy = vi.spyOn(classroomEvaluationService, 'evaluateHandwrittenAnswer');

            const typedText = 'Detailed typed solution using dynamic programming recurrence.';
            const result = await personalizedAssessmentService.submitTodayAssignment(
                studentUser._id.toString(),
                assignment._id.toString(),
                typedText,
                new Date()
            );

            expect(result.status).toBe('SUBMITTED');
            expect(result.studentAnswer).toBe(typedText);
            expect(result.submissionType).toBe('TEXT');
            expect(result.score).toBeNull();
            expect(result.feedback).toBeNull();

            // Verify in DB
            const persistedDoc = await PersonalizedStudentAssignment.findById(assignment._id);
            expect(persistedDoc?.status).toBe('SUBMITTED');
            expect(persistedDoc?.submissionType).toBe('TEXT');
            expect(persistedDoc?.score).toBeNull();
            expect(persistedDoc?.feedback).toBeNull();

            // AI evaluator was not triggered for text learning record
            expect(classroomEvalSpy).not.toHaveBeenCalled();
            classroomEvalSpy.mockRestore();
        });
    });

    // =========================================================================
    // 2. Photo Upload Acceptance & Validation
    // =========================================================================
    describe('2. Photo Upload Acceptance & Image Validation', () => {
        it('validates photo submission schema with optional answer text and valid assignmentId', () => {
            const valid = submitStudentPhotoAssignmentSchema.safeParse({
                assignmentId: new mongoose.Types.ObjectId().toString(),
                answer: 'Optional note accompanying handwritten solution photo'
            });
            expect(valid.success).toBe(true);

            const emptyNote = submitStudentPhotoAssignmentSchema.safeParse({});
            expect(emptyNote.success).toBe(true);
        });

        it('rejects empty image buffer with HttpError 400', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Empty Photo Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    dailyWindowStartTime: '00:00',
                    dailyWindowEndTime: '23:59',
                    enrolledStudents: [studentUser._id.toString(), studentUser2._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUser._id
            }))!;

            await expect(
                personalizedAssessmentService.submitTodayPhotoAssignment({
                    studentId: studentUser._id.toString(),
                    assignmentId: assignment._id.toString(),
                    fileBuffer: Buffer.alloc(0),
                    mimeType: 'image/png'
                })
            ).rejects.toThrow('Invalid upload: File buffer is empty');
        });

        it('rejects oversized image (>10MB) with HttpError 400', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Oversized Photo Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    dailyWindowStartTime: '00:00',
                    dailyWindowEndTime: '23:59',
                    enrolledStudents: [studentUser._id.toString(), studentUser2._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUser._id
            }))!;

            const oversizedBuffer = Buffer.alloc(10 * 1024 * 1024 + 10);

            await expect(
                personalizedAssessmentService.submitTodayPhotoAssignment({
                    studentId: studentUser._id.toString(),
                    assignmentId: assignment._id.toString(),
                    fileBuffer: oversizedBuffer,
                    mimeType: 'image/png'
                })
            ).rejects.toThrow('File size exceeds the maximum allowed limit of 10MB');
        });

        it('rejects unsupported file mime types with HttpError 400', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'MimeType Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    dailyWindowStartTime: '00:00',
                    dailyWindowEndTime: '23:59',
                    enrolledStudents: [studentUser._id.toString(), studentUser2._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUser._id
            }))!;

            const testBuffer = Buffer.from('dummy-content');

            await expect(
                personalizedAssessmentService.submitTodayPhotoAssignment({
                    studentId: studentUser._id.toString(),
                    assignmentId: assignment._id.toString(),
                    fileBuffer: testBuffer,
                    mimeType: 'application/pdf'
                })
            ).rejects.toThrow('Unsupported file format "application/pdf"');

            await expect(
                personalizedAssessmentService.submitTodayPhotoAssignment({
                    studentId: studentUser._id.toString(),
                    assignmentId: assignment._id.toString(),
                    fileBuffer: testBuffer,
                    mimeType: 'image/gif'
                })
            ).rejects.toThrow('Unsupported file format "image/gif"');
        });
    });

    // =========================================================================
    // 3. Photo Evaluation via Shared Classroom Service & Score/Feedback Persistence
    // =========================================================================
    describe('3. Photo Evaluation via Shared Classroom Evaluator & Persistence', () => {
        it('evaluates photo answer using ClassroomEvaluationService and persists score and feedback', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Photo Evaluation Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    dailyWindowStartTime: '00:00',
                    dailyWindowEndTime: '23:59',
                    enrolledStudents: [studentUser._id.toString(), studentUser2._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUser._id,
                dayNumber: 1
            }))!;

            const mockOutcome = {
                score: 9.0,
                maxMarks: 10,
                feedback: 'Excellent handwritten mathematical derivation with clear steps.',
                confidence: 0.96,
                criterionScores: [
                    {
                        criterionName: 'Formulation',
                        marksAwarded: 4.5,
                        maxMarks: 5,
                        feedback: 'Clean formulation'
                    },
                    {
                        criterionName: 'Execution',
                        marksAwarded: 4.5,
                        maxMarks: 5,
                        feedback: 'Algebraically sound'
                    }
                ]
            };

            const evalSpy = vi.spyOn(classroomEvaluationService, 'evaluateHandwrittenAnswer')
                .mockResolvedValueOnce(mockOutcome);

            const syntheticImageBuffer = Buffer.from('synthetic-handwritten-image-test-bytes');

            const submitted = await personalizedAssessmentService.submitTodayPhotoAssignment({
                studentId: studentUser._id.toString(),
                assignmentId: assignment._id.toString(),
                fileBuffer: syntheticImageBuffer,
                originalFilename: 'math_proof.png',
                mimeType: 'image/png',
                answerText: 'Handwritten proof for today assignment'
            });

            // 1. Verify ClassroomEvaluationService was called with the question context
            expect(evalSpy).toHaveBeenCalledTimes(1);
            expect(evalSpy).toHaveBeenCalledWith(
                expect.objectContaining({
                    maxMarks: 10,
                    imageBuffer: syntheticImageBuffer,
                    mimeType: 'image/png'
                })
            );

            // 2. Verify returned object
            expect(submitted.status).toBe('SUBMITTED');
            expect(submitted.score).toBe(9.0);
            expect(submitted.feedback).toContain('Excellent handwritten mathematical derivation');
            expect(submitted.submissionType).toBe('PHOTO');

            // 3. Verify database persistence
            const persisted = (await PersonalizedStudentAssignment.findById(assignment._id))!;
            expect(persisted.status).toBe('SUBMITTED');
            expect(persisted.submissionType).toBe('PHOTO');
            expect(persisted.score).toBe(9.0);
            expect(persisted.feedback).toBe('Excellent handwritten mathematical derivation with clear steps.');
            expect(persisted.criterionScores).toHaveLength(2);
            expect(persisted.aiConfidence).toBe(0.96);
            expect(persisted.aiEvaluatedAt).toBeInstanceOf(Date);
            expect(persisted.imagePath).toContain('personalized_submissions');
            expect(persisted.isProvisional).toBe(true);
            expect(persisted.evaluationStatus).toBe('EVALUATED');

            // 4. Verify getTodayAssignment includes the evaluated score and feedback
            const todayView = await personalizedAssessmentService.getTodayAssignment(studentUser._id.toString());
            expect(todayView?.assignment?.score).toBe(9.0);
            expect(todayView?.assignment?.feedback).toContain('Excellent handwritten');
            expect(todayView?.assignment?.submissionType).toBe('PHOTO');

            evalSpy.mockRestore();
        });

        it('supports photo submission through submitTodayAssignment object polymorphic overload', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Polymorphic Overload Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    dailyWindowStartTime: '00:00',
                    dailyWindowEndTime: '23:59',
                    enrolledStudents: [studentUser._id.toString(), studentUser2._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUser._id,
                dayNumber: 1
            }))!;

            vi.spyOn(classroomEvaluationService, 'evaluateHandwrittenAnswer').mockResolvedValueOnce({
                score: 8.0,
                maxMarks: 10,
                feedback: 'Solid solution',
                confidence: 0.9,
                criterionScores: []
            });

            const result = await personalizedAssessmentService.submitTodayAssignment(
                studentUser._id.toString(),
                assignment._id.toString(),
                {
                    fileBuffer: Buffer.from('test-image-content'),
                    mimeType: 'image/jpeg',
                    originalFilename: 'student_work.jpg'
                }
            );

            expect(result.status).toBe('SUBMITTED');
            expect(result.submissionType).toBe('PHOTO');
            expect(result.score).toBe(8.0);
            expect(result.feedback).toBe('Solid solution');

            const dbAssigned = await PersonalizedStudentAssignment.findById(assignment._id);
            expect(dbAssigned?.isProvisional).toBe(true);
            expect(dbAssigned?.evaluationStatus).toBe('EVALUATED');
        });
    });

    // =========================================================================
    // 4. Safe Handling of Evaluator Errors
    // =========================================================================
    describe('4. Evaluator Errors Handled Safely', () => {
        it('persists submission safely but marks evaluation as failed when classroom evaluator fails', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Error Handling Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    dailyWindowStartTime: '00:00',
                    dailyWindowEndTime: '23:59',
                    enrolledStudents: [studentUser._id.toString(), studentUser2._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUser._id,
                dayNumber: 1
            }))!;

            // Mock evaluation service error
            vi.spyOn(classroomEvaluationService, 'evaluateHandwrittenAnswer').mockRejectedValueOnce(
                new HttpError('Gemini model service overloaded (503)', 503)
            );

            await personalizedAssessmentService.submitTodayPhotoAssignment({
                studentId: studentUser._id.toString(),
                assignmentId: assignment._id.toString(),
                fileBuffer: Buffer.from('dummy-image'),
                mimeType: 'image/png'
            });

            // Assignment should remain submitted but with FAILED evaluation status
            const submittedDoc = await PersonalizedStudentAssignment.findById(assignment._id);
            expect(submittedDoc?.status).toBe('SUBMITTED');
            expect(submittedDoc?.evaluationStatus).toBe('FAILED');
            expect(submittedDoc?.isProvisional).toBe(true);
            expect(submittedDoc?.score).toBeNull();
        });

        it('allows retrying submission when previous evaluation failed', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Retry Handling Schedule',
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

            // First attempt: mock error
            vi.spyOn(classroomEvaluationService, 'evaluateHandwrittenAnswer').mockRejectedValueOnce(
                new HttpError('Transient error', 503)
            );

            await personalizedAssessmentService.submitTodayPhotoAssignment({
                studentId: studentUser._id.toString(),
                assignmentId: assignment._id.toString(),
                fileBuffer: Buffer.from('dummy-image'),
                mimeType: 'image/png'
            });

            const docAfterFail = await PersonalizedStudentAssignment.findById(assignment._id);
            expect(docAfterFail?.evaluationStatus).toBe('FAILED');

            // Second attempt: retry succeeds
            vi.spyOn(classroomEvaluationService, 'evaluateHandwrittenAnswer').mockResolvedValueOnce({
                score: 8,
                maxMarks: 10,
                feedback: 'Good on retry',
                criterionScores: [],
                confidence: 0.95
            });

            await personalizedAssessmentService.submitTodayPhotoAssignment({
                studentId: studentUser._id.toString(),
                assignmentId: assignment._id.toString(),
                fileBuffer: Buffer.from('dummy-image-2'),
                mimeType: 'image/png'
            });

            const docAfterRetry = await PersonalizedStudentAssignment.findById(assignment._id);
            expect(docAfterRetry?.evaluationStatus).toBe('EVALUATED');
            expect(docAfterRetry?.score).toBe(8);
            expect(docAfterRetry?.feedback).toBe('Good on retry');
        });
    });

    // =========================================================================
    // 5. Scheduling & Allocation Invariants (Collision-Free Daily Question Assignment)
    // =========================================================================
    describe('5. Scheduling & Daily Question Uniqueness Invariants', () => {
        it('ensures no two students receive the same question on the same day', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Uniqueness Verification Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    enrolledStudents: [studentUser._id.toString(), studentUser2._id.toString()]
                },
                professorUser._id.toString()
            );

            // Fetch all assignments for day 1 across students
            const day1Assignments = await PersonalizedStudentAssignment.find({
                schedule: schedule._id,
                dayNumber: 1
            });

            expect(day1Assignments).toHaveLength(2);

            const questionStudent1 = day1Assignments.find(a => a.student.toString() === studentUser._id.toString())?.question.toString();
            const questionStudent2 = day1Assignments.find(a => a.student.toString() === studentUser2._id.toString())?.question.toString();

            // Crucial: No two students have the same question on day 1
            expect(questionStudent1).not.toBe(questionStudent2);
        });

        it('guarantees 100 distinct questions per student across the full schedule', async () => {
            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: '100-Question Invariant Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    enrolledStudents: [studentUser._id.toString(), studentUser2._id.toString()]
                },
                professorUser._id.toString()
            );

            const student1Assignments = await PersonalizedStudentAssignment.find({
                schedule: schedule._id,
                student: studentUser._id
            });

            expect(student1Assignments).toHaveLength(100);
            const uniqueQuestions = new Set(student1Assignments.map(a => a.question.toString()));
            expect(uniqueQuestions.size).toBe(100);
        });
    });

    // =========================================================================
    // 6. Feature-Flag Protection
    // =========================================================================
    describe('6. Feature-Flag Protection', () => {
        it('rejects submissions with 404 when FEATURE_PERSONALIZED_ASSESSMENT is disabled', async () => {
            process.env.FEATURE_PERSONALIZED_ASSESSMENT = 'false';
            process.env.NEXT_PUBLIC_FEATURE_PERSONALIZED_ASSESSMENT = 'false';

            const req = new NextRequest('http://localhost:3000/api/personalized/today/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answer: 'Valid solution text' })
            });

            const response = await submitRoute(req);
            expect(response.status).toBe(404);

            const json = await response.json();
            expect(json.success).toBe(false);
            expect(json.message).toContain('disabled');

            process.env.FEATURE_PERSONALIZED_ASSESSMENT = 'true';
            process.env.NEXT_PUBLIC_FEATURE_PERSONALIZED_ASSESSMENT = 'true';
        });

        it('processes multipart photo submissions when feature flag is enabled', async () => {
            process.env.FEATURE_PERSONALIZED_ASSESSMENT = 'true';
            process.env.NEXT_PUBLIC_FEATURE_PERSONALIZED_ASSESSMENT = 'true';
            mockSessionUser = { id: studentUser._id.toString(), role: 'STUDENT' };

            const todayStr = new Date().toISOString().slice(0, 10);
            const schedule = await personalizedAssessmentService.createSchedule(
                {
                    course: testCourse._id.toString(),
                    title: 'Route Feature Flag Schedule',
                    startDate: todayStr,
                    activeDaysOfWeek: [0, 1, 2, 3, 4, 5, 6],
                    dailyWindowStartTime: '00:00',
                    dailyWindowEndTime: '23:59',
                    enrolledStudents: [studentUser._id.toString(), studentUser2._id.toString()]
                },
                professorUser._id.toString()
            );

            const assignment = (await PersonalizedStudentAssignment.findOne({
                schedule: schedule._id,
                student: studentUser._id,
                dayNumber: 1
            }))!;

            vi.spyOn(classroomEvaluationService, 'evaluateHandwrittenAnswer').mockResolvedValueOnce({
                score: 9.5,
                maxMarks: 10,
                feedback: 'Near perfect handwritten derivation',
                confidence: 0.98,
                criterionScores: []
            });

            const formData = new FormData();
            formData.append('assignmentId', assignment._id.toString());
            const blob = new Blob(['synthetic-image-data'], { type: 'image/png' });
            formData.append('file', blob, 'my_answer.png');
            formData.append('answer', 'Solution comments');

            const req = new NextRequest('http://localhost:3000/api/personalized/today/submit', {
                method: 'POST',
                body: formData
            });

            const response = await submitRoute(req);
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json.success).toBe(true);
            expect(json.data.score).toBe(9.5);
            expect(json.data.submissionType).toBe('PHOTO');

            mockSessionUser = null;
        });
    });
});
