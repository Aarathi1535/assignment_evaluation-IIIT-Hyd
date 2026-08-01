import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(3, { message: 'Name must be at least 3 characters long' }),
  email: z.string().trim().email({ message: 'Invalid email address' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters long' }),
  role: z.enum(['ADMIN', 'PROFESSOR', 'TA', 'STUDENT'], {
    message: 'Role must be one of: ADMIN, PROFESSOR, TA, STUDENT',
  }),
});

export type RegisterInput = z.infer<typeof registerSchema>;
