import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, {
    message: 'Invalid MongoDB ObjectId'
});

const timeStringRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const personalizedRubricCriterionSchema = z
    .object({
        criterionName: z.string().trim().min(1, 'Criterion name is required'),
        points: z.number().positive('Points must be positive'),
        description: z.string().trim().optional()
    })
    .strict();

export const personalizedQuestionBaseSchema = z
    .object({
        course: objectIdSchema,
        questionIndex: z.number().int().min(1, 'Question index must be >= 1'),
        title: z.string().trim().min(1, 'Title is required').max(200, 'Title too long'),
        topic: z.string().trim().min(1, 'Topic is required').max(100, 'Topic too long'),
        difficulty: z.enum(['EASY', 'MEDIUM', 'HARD']).default('MEDIUM'),
        questionPrompt: z.string().trim().min(1, 'Question prompt is required'),
        maxMarks: z.number().positive('Max marks must be positive').default(10),
        hints: z.array(z.string().trim()).optional().default([]),
        referenceAnswer: z.string().trim().optional(),
        rubricCriteria: z.array(personalizedRubricCriterionSchema).optional().default([])
    })
    .strict();

const validateRubricMaxMarks = (data: { rubricCriteria?: Array<{ points: number }>; maxMarks?: number }) => {
    if (data.rubricCriteria && data.rubricCriteria.length > 0) {
        const sum = data.rubricCriteria.reduce((acc, c) => acc + c.points, 0);
        return sum <= (data.maxMarks ?? 10);
    }
    return true;
};

const rubricRefinementConfig = {
    message: 'Sum of rubric criteria points cannot exceed maxMarks',
    path: ['rubricCriteria']
};

export const createPersonalizedQuestionSchema = personalizedQuestionBaseSchema.refine(
    validateRubricMaxMarks,
    rubricRefinementConfig
);

export const bulkQuestionItemSchema = personalizedQuestionBaseSchema
    .omit({ course: true })
    .refine(validateRubricMaxMarks, rubricRefinementConfig);

export const bulkCreatePersonalizedQuestionsSchema = z.object({
    course: objectIdSchema,
    questions: z.array(bulkQuestionItemSchema).min(1, 'At least one question is required')
});

export const createPersonalizedScheduleSchema = z
    .object({
        course: objectIdSchema,
        title: z.string().trim().min(1, 'Schedule title is required').max(200),
        totalQuestionsTarget: z.number().int().min(1).default(100),
        totalWeeks: z.number().int().min(1).max(52).default(16),
        startDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
        endDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).optional(),
        activeDaysOfWeek: z.array(z.number().int().min(0).max(6)).min(1, 'At least one active weekday required'),
        timezone: z.string().trim().default('Asia/Kolkata'),
        dailyWindowStartTime: z.string().regex(timeStringRegex, 'Start time must be in HH:MM format').default('09:00'),
        dailyWindowEndTime: z.string().regex(timeStringRegex, 'End time must be in HH:MM format').default('22:00'),
        enrolledStudents: z.array(objectIdSchema).min(1, 'At least one student must be enrolled'),
        questionPool: z.array(objectIdSchema).optional()
    })
    .strict()
    .refine(
        (data) => {
            const uniqueStudents = new Set(data.enrolledStudents);
            return uniqueStudents.size === data.enrolledStudents.length;
        },
        {
            message: 'Enrolled students list cannot contain duplicates',
            path: ['enrolledStudents']
        }
    )
    .refine(
        (data) => {
            const uniqueDays = new Set(data.activeDaysOfWeek);
            return uniqueDays.size === data.activeDaysOfWeek.length;
        },
        {
            message: 'Active days of week cannot contain duplicates',
            path: ['activeDaysOfWeek']
        }
    );

export const submitStudentAssignmentSchema = z.object({
    answer: z.string().trim().min(1, 'Answer cannot be empty').max(50000, 'Answer exceeds maximum character limit')
});

export const uploadSyllabusSchema = z.object({
    courseId: objectIdSchema,
    syllabusText: z.string().trim().min(10, 'Syllabus content must be at least 10 characters')
});

export const generateQuestionsSchema = z.object({
    courseId: objectIdSchema,
    targetCount: z.number().int().min(1, 'Target count must be at least 1').max(500, 'Max 500 questions per generation batch').default(100),
    difficultyDistribution: z
        .object({
            EASY: z.number().int().min(0).default(30),
            MEDIUM: z.number().int().min(0).default(50),
            HARD: z.number().int().min(0).default(20)
        })
        .optional(),
    selectedTopics: z.array(z.string().trim()).optional()
});

