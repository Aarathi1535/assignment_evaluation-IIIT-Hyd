import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, {
  message: 'Invalid MongoDB ObjectId',
});

export const criterionSchema = z.object({
  criterionName: z.string().trim().min(1, { message: 'Criterion name is required' }),
  description: z.string().trim().optional(),
  points: z.number().positive({ message: 'Points must be positive' }),
}).strict();

export const questionSchema = z.object({
  questionNumber: z.number().int().positive({ message: 'Question number must be positive' }),
  maxMarks: z.number().positive({ message: 'Max marks must be positive' }),
  criteria: z.array(criterionSchema).min(1, { message: 'At least one criterion is required' }),
}).strict()
.refine((data) => {
  const sumPoints = data.criteria.reduce((sum, c) => sum + c.points, 0);
  return sumPoints <= data.maxMarks;
}, {
  message: 'The sum of criterion points cannot exceed the question maximum marks',
  path: ['criteria'],
});

export const createRubricSchema = z.object({
  exam: objectIdSchema,
  questions: z.array(questionSchema).min(1, { message: 'At least one question is required' }),
}).strict()
.refine((data) => {
  const questionNumbers = data.questions.map(q => q.questionNumber);
  const uniqueNumbers = new Set(questionNumbers);
  return uniqueNumbers.size === questionNumbers.length;
}, {
  message: 'Duplicate question numbers are not allowed',
  path: ['questions'],
});

export const updateRubricSchema = z.object({
  exam: objectIdSchema.optional(),
  questions: z.array(questionSchema).min(1, { message: 'At least one question is required' }).optional(),
}).strict()
.refine((data) => {
  if (data.questions) {
    const questionNumbers = data.questions.map(q => q.questionNumber);
    const uniqueNumbers = new Set(questionNumbers);
    return uniqueNumbers.size === questionNumbers.length;
  }
  return true;
}, {
  message: 'Duplicate question numbers are not allowed',
  path: ['questions'],
});
