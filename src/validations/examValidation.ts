import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = z.string().regex(objectIdRegex, {
  message: 'Invalid MongoDB ObjectId',
});

export const createExamSchema = z.object({
  title: z.string().trim().min(3, { message: 'Title must be at least 3 characters long' }),
  course: objectIdSchema,
  examDate: z.string().min(1, { message: 'Exam date is required' }),
  totalMarks: z.number().min(0, { message: 'Total marks must be non-negative' }),
  status: z.enum(['DRAFT', 'SCHEDULED', 'SCANNING', 'EVALUATING', 'REVIEW_PENDING', 'PUBLISHED', 'ARCHIVED']).optional(),
  numberOfQuestions: z.number().min(1, { message: 'Number of questions must be at least 1' }),
});

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

export { enrollStudentsSchema } from './courseValidation';

