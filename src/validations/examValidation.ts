import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = z.string().regex(objectIdRegex, {
  message: 'Invalid MongoDB ObjectId',
});

const omrBubbleSchema = z.object({
  value: z.string().min(1, { message: 'Bubble value must not be empty' }),
  x: z.number().min(0, { message: 'x coordinate must be >= 0' }).max(1, { message: 'x coordinate must be <= 1' }),
  y: z.number().min(0, { message: 'y coordinate must be >= 0' }).max(1, { message: 'y coordinate must be <= 1' }),
  width: z.number().min(0, { message: 'width must be >= 0' }).max(1, { message: 'width must be <= 1' }),
  height: z.number().min(0, { message: 'height must be >= 0' }).max(1, { message: 'height must be <= 1' })
}).refine(data => data.x + data.width <= 1.000001, {
  message: 'Bubble region width extends outside the normalized page boundary'
}).refine(data => data.y + data.height <= 1.000001, {
  message: 'Bubble region height extends outside the normalized page boundary'
});

const omrColumnSchema = z.object({
  columnIndex: z.number().int({ message: 'columnIndex must be an integer' }).min(0, { message: 'columnIndex must be >= 0' }),
  bubbles: z.array(omrBubbleSchema).min(1, { message: 'Column must contain at least one bubble' })
}).refine(data => {
  const values = data.bubbles.map(b => b.value);
  return new Set(values).size === values.length;
}, {
  message: 'Duplicate bubble values detected in the same column'
});

export const omrTemplateSchema = z.object({
  pageIndex: z.number().int({ message: 'pageIndex must be an integer' }).min(0, { message: 'pageIndex must be >= 0' }),
  columns: z.array(omrColumnSchema).min(1, { message: 'OMR template must contain at least one column' })
}).refine(data => {
  const indices = data.columns.map(c => c.columnIndex);
  return new Set(indices).size === indices.length;
}, {
  message: 'Duplicate columnIndexes detected in OMR template'
}).refine(data => {
  const indices = data.columns.map(c => c.columnIndex).sort((a, b) => a - b);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) {
      return false;
    }
  }
  return true;
}, {
  message: 'Column indexes must be contiguous and start from 0'
}).refine(data => {
  const coordinates = new Set<string>();
  for (const col of data.columns) {
    for (const b of col.bubbles) {
      const key = `${b.x.toFixed(6)},${b.y.toFixed(6)}`;
      if (coordinates.has(key)) {
        return false;
      }
      coordinates.add(key);
    }
  }
  return true;
}, {
  message: 'Duplicate bubble coordinates detected in OMR template'
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
  omrTemplate: omrTemplateSchema.nullable().optional(),
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


