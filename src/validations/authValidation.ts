import { z } from 'zod';

export const registerSchema = z.object({
  name: z.string().trim().min(3, { message: 'Name must be at least 3 characters long' }),
  email: z.string().trim().email({ message: 'Invalid email address' }),
  password: z.string().min(8, { message: 'Password must be at least 8 characters long' }),
  // Public sign-up creates STUDENT accounts only. Staff accounts (TA, PROFESSOR, ADMIN)
  // are created by an admin through /api/users (or /api/users/import), never self-assigned.
  role: z.literal('STUDENT', { message: 'Public registration creates student accounts only' }).optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;
