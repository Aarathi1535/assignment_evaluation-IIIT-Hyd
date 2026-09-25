import mongoose from 'mongoose';
import personalizedAssessmentRepository from '../repositories/PersonalizedAssessmentRepository';
import { IPersonalizedQuestion, QuestionDifficulty } from '../models/PersonalizedQuestion';
import { IPersonalizedAssessmentSchedule } from '../models/PersonalizedAssessmentSchedule';
import { IPersonalizedStudentAssignment, AssignmentStatus } from '../models/PersonalizedStudentAssignment';
import Course from '../models/Course';
import { HttpError } from '../lib/errors';
import { writeAuditLog } from '../lib/audit';

export interface CreatePersonalizedQuestionInput {
    course: string;
    questionIndex: number;
    title: string;
    topic: string;
    difficulty: QuestionDifficulty;
    questionPrompt: string;
    maxMarks?: number;
    hints?: string[];
    referenceAnswer?: string;
    rubricCriteria?: Array<{
        criterionName: string;
        points: number;
        description?: string;
    }>;
}

export interface CreatePersonalizedScheduleInput {
    course: string;
    title: string;
    totalQuestionsTarget?: number;
    totalWeeks?: number;
    startDate: string; // YYYY-MM-DD or ISO
    endDate?: string;
    activeDaysOfWeek: number[]; // e.g. [1, 2, 3, 4, 5, 6]
    timezone?: string;
    dailyWindowStartTime?: string; // HH:MM
    dailyWindowEndTime?: string; // HH:MM
    enrolledStudents: string[];
    questionPool?: string[];
}

export interface AuditContext {
    actingUserId?: string;
    actingUserRole?: string;
    ipAddress?: string;
}

export class PersonalizedAssessmentService {
    // ==========================================
    // Date & Time Utility Functions
    // ==========================================

    /**
     * Generates exactly `targetSlots` calendar dates on `activeDaysOfWeek`
     * starting on or after `startDate`.
     */
    generateAssessmentDates(
        startDateInput: string | Date,
        totalWeeks: number,
        activeDaysOfWeek: number[],
        targetSlots = 100
    ): Date[] {
        const start = new Date(startDateInput);
        // Normalize start to midnight UTC
        const current = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));

        const maxEndDate = new Date(current.getTime() + totalWeeks * 7 * 24 * 60 * 60 * 1000);
        const dates: Date[] = [];

        // Traverse days until targetSlots are collected
        const cursor = new Date(current.getTime());
        const maxIterationDays = totalWeeks * 7 + 14; // Guard ceiling

        let iteration = 0;
        while (dates.length < targetSlots && iteration < maxIterationDays) {
            const dayOfWeek = cursor.getUTCDay(); // 0=Sunday, 1=Monday...
            if (activeDaysOfWeek.includes(dayOfWeek)) {
                dates.push(new Date(cursor.getTime()));
            }
            cursor.setUTCDate(cursor.getUTCDate() + 1);
            iteration++;
        }

        if (dates.length < targetSlots) {
            throw new HttpError(
                `Configured active weekdays (${activeDaysOfWeek.length} days/week) cannot yield ${targetSlots} slots within ${totalWeeks} weeks. Max available slots: ${dates.length}`,
                400
            );
        }

        const lastSlotDate = dates[dates.length - 1];
        if (lastSlotDate.getTime() > maxEndDate.getTime()) {
            throw new HttpError(
                `The 100th assessment slot (${lastSlotDate.toISOString().slice(0, 10)}) exceeds the ${totalWeeks}-week limit (${maxEndDate.toISOString().slice(0, 10)})`,
                400
            );
        }

        return dates;
    }

    /**
     * Constructs windowStart and windowEnd timestamps for a given date string and HH:MM range.
     */
    computeWindowTimes(
        date: Date,
        startTimeStr: string,
        endTimeStr: string
    ): { windowStart: Date; windowEnd: Date } {
        const [startHours, startMinutes] = startTimeStr.split(':').map(Number);
        const [endHours, endMinutes] = endTimeStr.split(':').map(Number);

        const windowStart = new Date(date.getTime());
        windowStart.setUTCHours(startHours, startMinutes, 0, 0);

        const windowEnd = new Date(date.getTime());
        windowEnd.setUTCHours(endHours, endMinutes, 59, 999);

        return { windowStart, windowEnd };
    }

    /**
     * Evaluates dynamic status for an assignment based on the reference timestamp.
     */
    evaluateDynamicStatus(
        assignment: IPersonalizedStudentAssignment,
        now: Date = new Date()
    ): AssignmentStatus {
        if (assignment.status === 'SUBMITTED') {
            return 'SUBMITTED';
        }

        if (now.getTime() < assignment.windowStart.getTime()) {
            return 'LOCKED';
        }

        if (now.getTime() >= assignment.windowStart.getTime() && now.getTime() <= assignment.windowEnd.getTime()) {
            return assignment.status === 'IN_PROGRESS' ? 'IN_PROGRESS' : 'AVAILABLE';
        }

        // now > windowEnd and not SUBMITTED
        return 'MISSED';
    }

    // ==========================================
    // Allocation Matrix Algorithm & Validation
    // ==========================================

    /**
     * Generates a collision-free allocation matrix using cyclic shift:
     * QuestionIndex(studentIdx, dayIdx) = (studentIdx * k + dayIdx) % M
     */
    generateAllocationMatrix(
        studentIds: string[],
        questionIds: string[],
        targetSlots = 100,
        k = 1
    ): Map<string, string[]> {
        const N = studentIds.length;
        const M = questionIds.length;

        if (M < Math.max(N, targetSlots)) {
            throw new HttpError(
                `Question pool size (${M}) must be at least max(enrolledStudents=${N}, targetSlots=${targetSlots}) to guarantee collision-free cyclic allocation`,
                400
            );
        }

        const allocation = new Map<string, string[]>(); // studentId -> questionId[] (length targetSlots)

        for (let s = 0; s < N; s++) {
            const studentId = studentIds[s];
            const assignedQuestions: string[] = [];

            for (let d = 0; d < targetSlots; d++) {
                const questionIndex = (s * k + d) % M;
                assignedQuestions.push(questionIds[questionIndex]);
            }

            allocation.set(studentId, assignedQuestions);
        }

        // Validate the matrix rigorously before returning
        this.validateAllocationMatrix(studentIds, questionIds, allocation, targetSlots);

        return allocation;
    }

    /**
     * Validates that:
     * 1. On any slot d, no two students receive the same question.
     * 2. For every student s, all targetSlots questions are distinct.
     */
    validateAllocationMatrix(
        studentIds: string[],
        questionIds: string[],
        allocation: Map<string, string[]>,
        targetSlots = 100
    ): void {
        const N = studentIds.length;

        // 1. Slot-level collision check across students
        for (let d = 0; d < targetSlots; d++) {
            const seenInSlot = new Set<string>();
            for (let s = 0; s < N; s++) {
                const studentId = studentIds[s];
                const studentQuestions = allocation.get(studentId);
                if (!studentQuestions || studentQuestions.length !== targetSlots) {
                    throw new HttpError(`Allocation matrix incomplete for student ${studentId}`, 400);
                }
                const qId = studentQuestions[d];
                if (seenInSlot.has(qId)) {
                    throw new HttpError(
                        `Schedule matrix collision detected: Question ${qId} assigned to multiple students on slot ${d + 1}`,
                        400
                    );
                }
                seenInSlot.add(qId);
            }
        }

        // 2. Student-level uniqueness check
        for (let s = 0; s < N; s++) {
            const studentId = studentIds[s];
            const studentQuestions = allocation.get(studentId)!;
            const uniqueQuestions = new Set(studentQuestions);
            if (uniqueQuestions.size !== targetSlots) {
                throw new HttpError(
                    `Schedule matrix collision detected: Student ${studentId} has duplicate questions across their 100 slots`,
                    400
                );
            }
        }
    }

    // ==========================================
    // Question Bank Management
    // ==========================================

    async createQuestion(
        input: CreatePersonalizedQuestionInput,
        professorId: string,
        auditCtx?: AuditContext
    ): Promise<IPersonalizedQuestion> {
        const course = await Course.findById(input.course);
        if (!course) {
            throw new HttpError('Course not found', 404);
        }

        if (course.professor.toString() !== professorId && auditCtx?.actingUserRole !== 'ADMIN') {
            throw new HttpError('Forbidden: You are not the instructor for this course', 403);
        }

        const question = await personalizedAssessmentRepository.createQuestion({
            course: new mongoose.Types.ObjectId(input.course),
            questionIndex: input.questionIndex,
            title: input.title,
            topic: input.topic,
            difficulty: input.difficulty,
            questionPrompt: input.questionPrompt,
            maxMarks: input.maxMarks || 10,
            hints: input.hints || [],
            referenceAnswer: input.referenceAnswer || null,
            rubricCriteria: input.rubricCriteria || [],
            createdBy: new mongoose.Types.ObjectId(professorId),
            isActive: true
        });

        await writeAuditLog({
            user: professorId,
            action: 'PERSONALIZED_QUESTION_CREATED',
            outcome: 'SUCCESS',
            details: { questionId: question._id, courseId: input.course, title: input.title }
        });

        return question;
    }

    async bulkCreateQuestions(
        courseId: string,
        questions: Array<Omit<CreatePersonalizedQuestionInput, 'course'>>,
        professorId: string,
        auditCtx?: AuditContext
    ): Promise<IPersonalizedQuestion[]> {
        const course = await Course.findById(courseId);
        if (!course) {
            throw new HttpError('Course not found', 404);
        }

        if (course.professor.toString() !== professorId && auditCtx?.actingUserRole !== 'ADMIN') {
            throw new HttpError('Forbidden: You are not the instructor for this course', 403);
        }

        const docs = questions.map((q) => ({
            course: new mongoose.Types.ObjectId(courseId),
            questionIndex: q.questionIndex,
            title: q.title,
            topic: q.topic,
            difficulty: q.difficulty,
            questionPrompt: q.questionPrompt,
            maxMarks: q.maxMarks || 10,
            hints: q.hints || [],
            referenceAnswer: q.referenceAnswer || null,
            rubricCriteria: q.rubricCriteria || [],
            createdBy: new mongoose.Types.ObjectId(professorId),
            isActive: true
        }));

        const created = await personalizedAssessmentRepository.bulkCreateQuestions(docs);

        await writeAuditLog({
            user: professorId,
            action: 'PERSONALIZED_QUESTIONS_BULK_CREATED',
            outcome: 'SUCCESS',
            details: { count: created.length, courseId }
        });

        return created;
    }

    async getQuestions(courseId: string): Promise<IPersonalizedQuestion[]> {
        return personalizedAssessmentRepository.getQuestionsByCourse(courseId);
    }

    // ==========================================
    // Schedule Creation & Activation
    // ==========================================

    async createSchedule(
        input: CreatePersonalizedScheduleInput,
        professorId: string,
        auditCtx?: AuditContext
    ): Promise<IPersonalizedAssessmentSchedule> {
        const course = await Course.findById(input.course);
        if (!course) {
            throw new HttpError('Course not found', 404);
        }

        if (course.professor.toString() !== professorId && auditCtx?.actingUserRole !== 'ADMIN') {
            throw new HttpError('Forbidden: You are not the instructor for this course', 403);
        }

        const totalSlots = input.totalQuestionsTarget || 100;
        const totalWeeks = input.totalWeeks || 16;
        const startTime = input.dailyWindowStartTime || '09:00';
        const endTime = input.dailyWindowEndTime || '22:00';

        // 1. Fetch Question Pool
        let questionPoolIds = input.questionPool || [];
        if (!questionPoolIds || questionPoolIds.length === 0) {
            const availableQuestions = await personalizedAssessmentRepository.getQuestionsByCourse(input.course);
            questionPoolIds = availableQuestions.map((q) => q._id.toString());
        }

        const N = input.enrolledStudents.length;
        const M = questionPoolIds.length;

        // Requirement check: Pool size >= max(N, 100)
        if (M < Math.max(N, totalSlots)) {
            throw new HttpError(
                `Question pool size (${M}) is insufficient. Required at least max(students=${N}, slots=${totalSlots}) = ${Math.max(
                    N,
                    totalSlots
                )} questions in the pool.`,
                400
            );
        }

        // 2. Generate 100 Schedule Dates on active weekdays
        const slotDates = this.generateAssessmentDates(
            input.startDate,
            totalWeeks,
            input.activeDaysOfWeek,
            totalSlots
        );

        // 3. Generate and validate allocation matrix
        const allocation = this.generateAllocationMatrix(
            input.enrolledStudents,
            questionPoolIds,
            totalSlots
        );

        // 4. Create Schedule Document
        const schedule = await personalizedAssessmentRepository.createSchedule({
            course: new mongoose.Types.ObjectId(input.course),
            title: input.title,
            totalQuestionsTarget: totalSlots,
            totalWeeks: totalWeeks,
            startDate: slotDates[0],
            endDate: slotDates[slotDates.length - 1],
            activeDaysOfWeek: input.activeDaysOfWeek,
            timezone: input.timezone || 'Asia/Kolkata',
            dailyWindowStartTime: startTime,
            dailyWindowEndTime: endTime,
            enrolledStudents: input.enrolledStudents.map((id) => new mongoose.Types.ObjectId(id)),
            questionPool: questionPoolIds.map((id) => new mongoose.Types.ObjectId(id)),
            scheduleMatrixGenerated: true,
            status: 'ACTIVE',
            createdBy: new mongoose.Types.ObjectId(professorId)
        });

        // 5. Batch build and insert assignments
        const assignmentsToInsert: Array<Partial<IPersonalizedStudentAssignment>> = [];

        for (const studentId of input.enrolledStudents) {
            const studentQuestions = allocation.get(studentId)!;

            for (let d = 0; d < totalSlots; d++) {
                const scheduledDate = slotDates[d];
                const { windowStart, windowEnd } = this.computeWindowTimes(scheduledDate, startTime, endTime);

                assignmentsToInsert.push({
                    schedule: schedule._id as mongoose.Types.ObjectId,
                    student: new mongoose.Types.ObjectId(studentId),
                    question: new mongoose.Types.ObjectId(studentQuestions[d]),
                    dayNumber: d + 1,
                    scheduledDate,
                    windowStart,
                    windowEnd,
                    status: 'LOCKED',
                    studentAnswer: null,
                    score: null,
                    feedback: null
                });
            }
        }

        await personalizedAssessmentRepository.insertAssignmentsBatch(assignmentsToInsert);

        await writeAuditLog({
            user: professorId,
            action: 'PERSONALIZED_SCHEDULE_ACTIVATED',
            outcome: 'SUCCESS',
            details: {
                scheduleId: schedule._id,
                courseId: input.course,
                studentsCount: N,
                totalSlots,
                totalAssignments: assignmentsToInsert.length
            }
        });

        return schedule;
    }

    async getSchedulesByProfessor(professorId: string): Promise<IPersonalizedAssessmentSchedule[]> {
        return personalizedAssessmentRepository.getSchedulesByProfessor(professorId);
    }

    async getScheduleById(
        scheduleId: string,
        userId: string,
        role: string
    ): Promise<IPersonalizedAssessmentSchedule> {
        const schedule = await personalizedAssessmentRepository.getScheduleById(scheduleId);
        if (!schedule) {
            throw new HttpError('Schedule not found', 404);
        }

        if (role !== 'ADMIN' && schedule.createdBy.toString() !== userId) {
            // Check if student is enrolled
            const isEnrolled = schedule.enrolledStudents.some((s) => s.toString() === userId);
            if (!isEnrolled) {
                throw new HttpError('Forbidden: Access denied to this schedule', 403);
            }
        }

        return schedule;
    }

    async getScheduleProgress(scheduleId: string, professorId: string, role: string) {
        const schedule = await personalizedAssessmentRepository.getScheduleById(scheduleId);
        if (!schedule) {
            throw new HttpError('Schedule not found', 404);
        }

        if (role !== 'ADMIN' && schedule.createdBy.toString() !== professorId) {
            throw new HttpError('Forbidden: Access denied', 403);
        }

        return personalizedAssessmentRepository.getScheduleProgress(scheduleId);
    }

    // ==========================================
    // Student Actions
    // ==========================================

    /**
     * Redacts sensitive question fields if status is LOCKED.
     */
    redactQuestionContent(assignment: IPersonalizedStudentAssignment, status: AssignmentStatus) {
        const rawQuestion = assignment.question as unknown as IPersonalizedQuestion;
        if (!rawQuestion) return null;

        if (status === 'LOCKED') {
            return {
                _id: rawQuestion._id,
                title: 'Upcoming Assessment Slot',
                topic: 'Locked',
                difficulty: rawQuestion.difficulty,
                maxMarks: rawQuestion.maxMarks,
                questionPrompt: null,
                hints: [],
                referenceAnswer: null,
                rubricCriteria: []
            };
        }

        return {
            _id: rawQuestion._id,
            title: rawQuestion.title,
            topic: rawQuestion.topic,
            difficulty: rawQuestion.difficulty,
            maxMarks: rawQuestion.maxMarks,
            questionPrompt: rawQuestion.questionPrompt,
            hints: rawQuestion.hints || [],
            referenceAnswer: status === 'SUBMITTED' ? rawQuestion.referenceAnswer : null,
            rubricCriteria: rawQuestion.rubricCriteria || []
        };
    }

    async getTodayAssignment(
        studentId: string,
        referenceNow: Date = new Date()
    ) {
        const activeSchedule = await personalizedAssessmentRepository.getActiveScheduleForStudent(studentId);
        if (!activeSchedule) {
            return null;
        }

        const dateString = referenceNow.toISOString().slice(0, 10);
        const assignment = await personalizedAssessmentRepository.getAssignmentForStudentByDate(
            studentId,
            dateString
        );

        if (!assignment) {
            return {
                schedule: activeSchedule,
                assignment: null,
                message: 'No personalized assessment scheduled for today.'
            };
        }

        const dynamicStatus = this.evaluateDynamicStatus(assignment, referenceNow);

        // If status changed to MISSED or AVAILABLE, update db
        if (assignment.status !== dynamicStatus && assignment.status !== 'SUBMITTED' && assignment.status !== 'IN_PROGRESS') {
            assignment.status = dynamicStatus;
            await assignment.save();
        } else if (dynamicStatus === 'MISSED' && assignment.status !== 'MISSED' && assignment.status !== 'SUBMITTED') {
            assignment.status = 'MISSED';
            await assignment.save();
        }

        const redactedQuestion = this.redactQuestionContent(assignment, dynamicStatus);

        return {
            schedule: activeSchedule,
            assignment: {
                _id: assignment._id,
                dayNumber: assignment.dayNumber,
                scheduledDate: assignment.scheduledDate,
                windowStart: assignment.windowStart,
                windowEnd: assignment.windowEnd,
                status: dynamicStatus,
                startedAt: assignment.startedAt,
                submittedAt: assignment.submittedAt,
                studentAnswer: assignment.studentAnswer,
                score: assignment.score,
                feedback: assignment.feedback,
                question: redactedQuestion
            },
            serverTime: referenceNow
        };
    }

    async startTodayAssignment(
        studentId: string,
        assignmentId: string,
        referenceNow: Date = new Date(),
        auditCtx?: AuditContext
    ) {
        const assignment = await personalizedAssessmentRepository.getAssignmentById(assignmentId);
        if (!assignment) {
            throw new HttpError('Assignment not found', 404);
        }

        if (assignment.student.toString() !== studentId) {
            throw new HttpError('Forbidden: This is not your assignment', 403);
        }

        const dynamicStatus = this.evaluateDynamicStatus(assignment, referenceNow);

        if (dynamicStatus === 'LOCKED') {
            throw new HttpError('Cannot start assignment before its scheduled window opens', 403);
        }

        if (dynamicStatus === 'MISSED') {
            throw new HttpError('Cannot start assignment: Window has expired', 403);
        }

        if (assignment.status === 'SUBMITTED') {
            throw new HttpError('Assignment has already been submitted', 400);
        }

        assignment.status = 'IN_PROGRESS';
        assignment.startedAt = assignment.startedAt || referenceNow;
        await assignment.save();

        await writeAuditLog({
            user: studentId,
            action: 'PERSONALIZED_ASSIGNMENT_STARTED',
            outcome: 'SUCCESS',
            details: { assignmentId, dayNumber: assignment.dayNumber, ipAddress: auditCtx?.ipAddress }
        });

        const redactedQuestion = this.redactQuestionContent(assignment, 'IN_PROGRESS');

        return {
            ...assignment.toObject(),
            status: 'IN_PROGRESS',
            question: redactedQuestion
        };
    }

    async submitTodayAssignment(
        studentId: string,
        assignmentId: string,
        answerText: string,
        referenceNow: Date = new Date(),
        auditCtx?: AuditContext
    ) {
        const assignment = await personalizedAssessmentRepository.getAssignmentById(assignmentId);
        if (!assignment) {
            throw new HttpError('Assignment not found', 404);
        }

        if (assignment.student.toString() !== studentId) {
            throw new HttpError('Forbidden: This is not your assignment', 403);
        }

        if (assignment.status === 'SUBMITTED') {
            throw new HttpError('This assignment has already been submitted and finalized', 400);
        }

        // Anti-postponement check: strictly enforce windowEnd
        if (referenceNow.getTime() > assignment.windowEnd.getTime()) {
            assignment.status = 'MISSED';
            await assignment.save();
            throw new HttpError(
                'Submission rejected: The daily assessment window for this question has expired (Anti-postponement rule enforced).',
                403
            );
        }

        // Must be during or after windowStart
        if (referenceNow.getTime() < assignment.windowStart.getTime()) {
            throw new HttpError('Submission rejected: The window for this question has not opened yet.', 403);
        }

        assignment.status = 'SUBMITTED';
        assignment.studentAnswer = answerText;
        assignment.submittedAt = referenceNow;
        await assignment.save();

        await writeAuditLog({
            user: studentId,
            action: 'PERSONALIZED_ASSIGNMENT_SUBMITTED',
            outcome: 'SUCCESS',
            details: {
                assignmentId,
                dayNumber: assignment.dayNumber,
                answerLength: answerText.length,
                ipAddress: auditCtx?.ipAddress
            }
        });

        const redactedQuestion = this.redactQuestionContent(assignment, 'SUBMITTED');

        return {
            ...assignment.toObject(),
            status: 'SUBMITTED',
            question: redactedQuestion
        };
    }

    async getMySchedule(
        studentId: string,
        referenceNow: Date = new Date()
    ) {
        const activeSchedule = await personalizedAssessmentRepository.getActiveScheduleForStudent(studentId);
        if (!activeSchedule) {
            return {
                schedule: null,
                slots: [],
                stats: { completed: 0, missed: 0, locked: 0, streak: 0, total: 100 }
            };
        }

        const assignments = await personalizedAssessmentRepository.getAssignmentsByStudentAndSchedule(
            studentId,
            activeSchedule._id as mongoose.Types.ObjectId
        );

        let completed = 0;
        let missed = 0;
        let locked = 0;
        let inProgress = 0;
        let currentStreak = 0;

        const slots = assignments.map((a) => {
            const dynamicStatus = this.evaluateDynamicStatus(a, referenceNow);

            if (dynamicStatus === 'SUBMITTED') {
                completed++;
                currentStreak++;
            } else if (dynamicStatus === 'MISSED') {
                missed++;
                currentStreak = 0; // Streak reset on miss
            } else if (dynamicStatus === 'LOCKED') {
                locked++;
            } else {
                inProgress++;
            }

            const redactedQuestion = this.redactQuestionContent(a, dynamicStatus);

            return {
                _id: a._id,
                dayNumber: a.dayNumber,
                scheduledDate: a.scheduledDate,
                windowStart: a.windowStart,
                windowEnd: a.windowEnd,
                status: dynamicStatus,
                submittedAt: a.submittedAt,
                score: a.score,
                question: redactedQuestion
            };
        });

        return {
            schedule: activeSchedule,
            slots,
            stats: {
                total: assignments.length,
                completed,
                missed,
                locked,
                inProgress,
                streak: currentStreak,
                completionPercentage: assignments.length > 0 ? (completed / assignments.length) * 100 : 0
            }
        };
    }
}

const personalizedAssessmentService = new PersonalizedAssessmentService();
export default personalizedAssessmentService;
