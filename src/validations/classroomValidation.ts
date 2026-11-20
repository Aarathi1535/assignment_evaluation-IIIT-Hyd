import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, {
  message: 'Invalid MongoDB ObjectId',
});

export const classroomCriterionSchema = z.object({
  criterionName: z.string().trim().min(1, { message: 'Criterion name is required' }),
  points: z.number().positive({ message: 'Points must be positive' }),
  description: z.string().trim().optional(),
}).strict();

export const createClassroomQuestionSchema = z.object({
  title: z.string().trim().min(1, { message: 'Question title is required' }),
  questionPrompt: z.string().trim().min(1, { message: 'Question prompt is required' }),
  type: z.enum(['MULTIPLE_CHOICE', 'SHORT_ANSWER', 'POLL']).optional().default('MULTIPLE_CHOICE'),
  options: z.array(z.string().trim()).optional().default([]),
  correctOptionIndex: z.number().int().min(0).nullable().optional(),
  correctAnswerText: z.string().trim().nullable().optional(),
  explanation: z.string().trim().optional(),
  maxMarks: z.number().min(0).optional().default(1),
  order: z.number().int().optional().default(0),
  rubricCriteria: z.array(classroomCriterionSchema).optional(),
  sampleSolution: z.string().trim().optional(),
  course: objectIdSchema.optional(),
  isActive: z.boolean().optional(),
}).strict().refine((data) => {
  if (data.type === 'MULTIPLE_CHOICE' && (!data.options || data.options.length < 2)) {
    // If multiple choice, recommend at least 2 options if provided
    return true; // Keep flexible for drafts
  }
  return true;
});

export const updateClassroomQuestionSchema = z.object({
  title: z.string().trim().min(1).optional(),
  questionPrompt: z.string().trim().min(1).optional(),
  type: z.enum(['MULTIPLE_CHOICE', 'SHORT_ANSWER', 'POLL']).optional(),
  options: z.array(z.string().trim()).optional(),
  correctOptionIndex: z.number().int().min(0).nullable().optional(),
  correctAnswerText: z.string().trim().nullable().optional(),
  explanation: z.string().trim().optional(),
  maxMarks: z.number().min(0).optional(),
  order: z.number().int().optional(),
  rubricCriteria: z.array(classroomCriterionSchema).optional(),
  sampleSolution: z.string().trim().optional(),
  isActive: z.boolean().optional(),
  isRevealed: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'CLOSED', 'REVEALED', 'DRAFT']).optional(),
  action: z.enum(['activate', 'close', 'reveal', 'deactivate']).optional(),
}).strict();

export const submitClassroomResponseSchema = z.object({
  questionId: z.string().trim().min(1, { message: 'Question ID is required' }),
  selectedOption: z.number().int().min(0).optional().nullable(),
  textResponse: z.string().trim().optional().nullable(),
});
