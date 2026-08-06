import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = z.string().regex(objectIdRegex, {
  message: 'Invalid MongoDB ObjectId',
});

export const createCourseSchema = z.object({
  courseCode: z.string()
    .trim()
    .min(2, { message: 'Course code must be at least 2 characters long' })
    .max(20, { message: 'Course code cannot exceed 20 characters' }),
  courseName: z.string()
    .trim()
    .min(3, { message: 'Course name must be at least 3 characters long' })
    .max(100, { message: 'Course name cannot exceed 100 characters' }),
  semester: z.string()
    .min(1, { message: 'Semester is required' })
    .regex(/^[1-9]\d*$/, { message: 'Semester must be a positive integer' }),
  academicYear: z.string()
    .min(1, { message: 'Academic year is required' })
    .regex(/^\d{4}-\d{2,4}$/, { message: 'Academic year must be in YYYY-YY or YYYY-YYYY format' }),
  teachingAssistants: z.array(objectIdSchema)
    .optional()
    .refine((items) => !items || new Set(items).size === items.length, {
      message: 'Duplicate teaching assistants are not allowed',
    }),
}).strict();

export const updateCourseSchema = createCourseSchema.partial();

export const enrollStudentsSchema = z.object({
  studentIds: z.array(objectIdSchema)
    .min(1, { message: 'Student list cannot be empty' })
    .refine((items) => new Set(items).size === items.length, {
      message: 'Duplicate student IDs are not allowed in the request',
    }),
}).strict();

