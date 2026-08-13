import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = z.string().regex(objectIdRegex, {
  message: 'Invalid MongoDB ObjectId',
});

export const createExamSchema = z.object({
  title: z.string()
    .trim()
    .min(3, { message: 'Title must be at least 3 characters long' })
    .max(100, { message: 'Title cannot exceed 100 characters' }),
  course: objectIdSchema,
  examDate: z.string()
    .min(1, { message: 'Exam date is required' })
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'Invalid date format',
    }),
  totalMarks: z.number()
    .min(0, { message: 'Total marks must be non-negative' })
    .max(1000, { message: 'Total marks cannot exceed 1000' }),
  status: z.enum(['DRAFT', 'SCHEDULED', 'SCANNING', 'EVALUATING', 'REVIEW_PENDING', 'PUBLISHED', 'ARCHIVED']).optional(),
  numberOfQuestions: z.number()
    .int({ message: 'Number of questions must be an integer' })
    .min(1, { message: 'Number of questions must be at least 1' })
    .max(100, { message: 'Number of questions cannot exceed 100' }),
}).strict();

export const updateExamSchema = createExamSchema.partial();

import { ExamStatus } from '../models/Exam';

const VALID_TRANSITIONS: Record<ExamStatus, ExamStatus[]> = {
    [ExamStatus.DRAFT]: [ExamStatus.SCHEDULED],
    [ExamStatus.SCHEDULED]: [ExamStatus.DRAFT, ExamStatus.SCANNING],
    [ExamStatus.SCANNING]: [ExamStatus.EVALUATING],
    [ExamStatus.EVALUATING]: [ExamStatus.REVIEW_PENDING],
    [ExamStatus.REVIEW_PENDING]: [ExamStatus.PUBLISHED],
    [ExamStatus.PUBLISHED]: [ExamStatus.ARCHIVED],
    [ExamStatus.ARCHIVED]: []
};

export function isValidTransition(current: ExamStatus, next: ExamStatus): boolean {
    if (current === next) return true;
    return VALID_TRANSITIONS[current]?.includes(next) || false;
}

export const enrollStudentsSchema = z.object({
  studentIds: z.array(objectIdSchema)
    .min(1, { message: 'Student list cannot be empty' })
    .refine((items) => new Set(items).size === items.length, {
      message: 'Duplicate student IDs are not allowed in the request',
    }),
  rollNumbers: z.record(z.string(), z.string().nullable().optional()).optional(),
}).strict();


