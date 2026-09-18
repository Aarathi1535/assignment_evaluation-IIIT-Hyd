import { z } from 'zod';
import { TagScope } from '../models/CommentTag';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectIdSchema = z.string().regex(objectIdRegex, {
  message: 'Invalid MongoDB ObjectId',
});

export const createTagSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, { message: 'Tag label cannot be empty' })
      .max(100, { message: 'Tag label cannot exceed 100 characters' }),
    scope: z.nativeEnum(TagScope),
    exam: objectIdSchema.optional().nullable(),
    examId: objectIdSchema.optional().nullable(),
    description: z
      .string()
      .trim()
      .max(250, { message: 'Description cannot exceed 250 characters' })
      .optional()
      .nullable(),
  })
  .strict()
  .refine(
    (data) => {
      const examRef = data.exam || data.examId;
      if (data.scope === TagScope.EXAM && !examRef) {
        return false;
      }
      return true;
    },
    {
      message: 'Exam ID is required for EXAM-scoped tags',
      path: ['exam'],
    }
  );

export const updateTagSchema = z
  .object({
    label: z
      .string()
      .trim()
      .min(1, { message: 'Tag label cannot be empty' })
      .max(100, { message: 'Tag label cannot exceed 100 characters' })
      .optional(),
    description: z
      .string()
      .trim()
      .max(250, { message: 'Description cannot exceed 250 characters' })
      .optional()
      .nullable(),
  })
  .strict();

