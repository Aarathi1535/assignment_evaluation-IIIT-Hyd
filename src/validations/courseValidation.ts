import { z } from 'zod';

const objectIdRegex = /^[0-9a-fA-F]{24}$/;

const objectIdSchema = z.string().regex(objectIdRegex, {
  message: 'Invalid MongoDB ObjectId',
});

export const createCourseSchema = z.object({
  courseCode: z.string().trim().min(2, { message: 'Course code must be at least 2 characters long' }),
  courseName: z.string().trim().min(3, { message: 'Course name must be at least 3 characters long' }),
  semester: z.string().min(1, { message: 'Semester is required' }),
  academicYear: z.string().min(1, { message: 'Academic year is required' }),
  professor: objectIdSchema,
  teachingAssistants: z.array(objectIdSchema).optional(),
});

export const updateCourseSchema = createCourseSchema.partial();
