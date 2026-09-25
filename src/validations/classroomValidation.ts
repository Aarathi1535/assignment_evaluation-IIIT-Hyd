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
  maxMarks: z.number().positive({ message: 'Max marks must be greater than 0' }),
  rubricCriteria: z.array(classroomCriterionSchema).optional(),
  sampleSolution: z.string().trim().optional(),
  course: objectIdSchema.optional(),
  isActive: z.boolean().optional(),
}).strict().refine((data) => {
  if (data.rubricCriteria && data.rubricCriteria.length > 0) {
    const sumPoints = data.rubricCriteria.reduce((sum, c) => sum + c.points, 0);
    return sumPoints <= data.maxMarks;
  }
  return true;
}, {
  message: 'The sum of criterion points cannot exceed the maximum marks',
  path: ['rubricCriteria'],
});

export const updateClassroomQuestionSchema = z.object({
  title: z.string().trim().min(1).optional(),
  questionPrompt: z.string().trim().min(1).optional(),
  maxMarks: z.number().positive().optional(),
  rubricCriteria: z.array(classroomCriterionSchema).optional(),
  sampleSolution: z.string().trim().optional(),
  isActive: z.boolean().optional(),
  status: z.enum(['ACTIVE', 'CLOSED', 'DRAFT']).optional(),
}).strict();
