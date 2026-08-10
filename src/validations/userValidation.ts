import { z } from 'zod';

export const createUserSchema = z.object({
  name: z.string().trim().min(3, { message: 'Name must be at least 3 characters long' }),
  email: z.string().trim().email({ message: 'Invalid email address' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters long' }),
  role: z.enum(['ADMIN', 'PROFESSOR', 'TA', 'STUDENT'], {
    message: 'Role must be one of: ADMIN, PROFESSOR, TA, STUDENT',
  }),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(3, { message: 'Name must be at least 3 characters long' }).optional(),
  email: z.string().trim().email({ message: 'Invalid email address' }).optional(),
  password: z.string().min(8, { message: 'Password must be at least 8 characters long' }).optional(),
  role: z.enum(['ADMIN', 'PROFESSOR', 'TA', 'STUDENT'], {
    message: 'Role must be one of: ADMIN, PROFESSOR, TA, STUDENT',
  }).optional(),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
