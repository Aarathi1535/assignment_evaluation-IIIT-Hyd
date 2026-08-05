import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = z.string().regex(objectIdRegex, {
  message: 'Invalid MongoDB ObjectId',
});

export const createExamSchema = z.object({
  title: z.string().trim().min(3, { message: 'Title must be at least 3 characters long' }),
  course: objectIdSchema,
  createdBy: objectIdSchema,
  examDate: z.string().min(1, { message: 'Exam date is required' }),
  totalMarks: z.number().min(0, { message: 'Total marks must be non-negative' }),
  status: z.enum(['DRAFT', 'SCHEDULED', 'SCANNING', 'EVALUATING', 'REVIEW_PENDING', 'PUBLISHED', 'ARCHIVED']).optional(),
  numberOfQuestions: z.number().min(1, { message: 'Number of questions must be at least 1' }),
});

export const updateExamSchema = createExamSchema.partial();
