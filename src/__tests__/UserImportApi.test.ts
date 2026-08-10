/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import User from '../models/User';
import { UserRole } from '../constants/permissions';
import bcrypt from 'bcryptjs';

let mockSessionUser: any = null;

// Mock next-auth to allow dynamic control of session users in testing
vi.mock('next-auth', async (importOriginal) => {
  const original = await importOriginal<typeof import('next-auth')>();
  return {
    ...original,
    getServerSession: vi.fn().mockImplementation(() => {
      if (!mockSessionUser) return Promise.resolve(null);
      return Promise.resolve({ user: mockSessionUser });
    }),
  };
});

describe('User Import API Tests (AE-031)', () => {
  let importPOST: any;

  beforeAll(async () => {
    importPOST = (await import('../app/api/users/import/route')).POST;
  });

  describe('Authorization and Permission Enforcement', () => {
    it('should return 401 for POST /api/users/import when unauthenticated', async () => {
      mockSessionUser = null;
      const req = new Request('http://localhost:3000/api/users/import', {
        method: 'POST',
      });
      const res = await importPOST(req as any);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });

    it('should return 403 Forbidden for STUDENT role', async () => {
      mockSessionUser = {
        id: 'student-id',
        email: 'student@university.edu',
        name: 'Student User',
        role: 'STUDENT',
      };
      const req = new Request('http://localhost:3000/api/users/import', {
        method: 'POST',
      });
      const res = await importPOST(req as any);
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Forbidden');
    });

    it('should return 403 Forbidden for TA role', async () => {
      mockSessionUser = {
        id: 'ta-id',
        email: 'ta@university.edu',
        name: 'TA User',
        role: 'TA',
      };
      const req = new Request('http://localhost:3000/api/users/import', {
        method: 'POST',
      });
      const res = await importPOST(req as any);
      expect(res.status).toBe(403);
    });
  });

  describe('Admin Import Operations (Authorized)', () => {
    beforeEach(() => {
      mockSessionUser = {
        id: 'admin-id',
        email: 'admin@university.edu',
        name: 'Admin User',
        role: 'ADMIN',
      };
    });

    it('should return 400 if Content-Type is not multipart/form-data', async () => {
      const req = new Request('http://localhost:3000/api/users/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const res = await importPOST(req as any);
      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toBe('Content type must be multipart/form-data');
    });

    it('should return 400 if CSV file is missing', async () => {
      const formData = new FormData();
      const req = new Request('http://localhost:3000/api/users/import', {
        method: 'POST',
        body: formData,
      });
      const res = await importPOST(req as any);
      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toBe('CSV file is required');
    });

    it('should return 400 if CSV headers are missing required fields', async () => {
      const formData = new FormData();
      const csvContent = 'name,email,role\nUser A,usera@university.edu,STUDENT';
      const file = new File([csvContent], 'users.csv', { type: 'text/csv' });
      formData.append('file', file);

      const req = new Request('http://localhost:3000/api/users/import', {
        method: 'POST',
        body: formData,
      });
      const res = await importPOST(req as any);
      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toContain('CSV headers must include name, email, password, role');
    });

    it('should return 200 and success details on empty CSV file', async () => {
      const formData = new FormData();
      const file = new File([''], 'users.csv', { type: 'text/csv' });
      formData.append('file', file);

      const req = new Request('http://localhost:3000/api/users/import', {
        method: 'POST',
        body: formData,
      });
      const res = await importPOST(req as any);
      expect(res.status).toBe(200);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.data.imported).toBe(0);
      expect(resBody.data.failed).toBe(0);
      expect(resBody.data.errors.length).toBe(0);
    });

    it('should import multiple valid users successfully with hashed passwords', async () => {
      const csvContent = [
        'name,email,password,role',
        'User One,user1@university.edu,pass1234,STUDENT',
        'User Two,user2@university.edu,securePassword99,PROFESSOR',
        'User Three,user3@university.edu,taPassWord123,TA',
      ].join('\n');

      const formData = new FormData();
      const file = new File([csvContent], 'users.csv', { type: 'text/csv' });
      formData.append('file', file);

      const req = new Request('http://localhost:3000/api/users/import', {
        method: 'POST',
        body: formData,
      });

      const res = await importPOST(req as any);
      expect(res.status).toBe(200);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.data.imported).toBe(3);
      expect(resBody.data.failed).toBe(0);
      expect(resBody.data.errors.length).toBe(0);

      // Verify all users created in DB and passwords are hashed properly
      const u1 = await User.findOne({ email: 'user1@university.edu' });
      expect(u1).not.toBeNull();
      expect(u1!.name).toBe('User One');
      expect(u1!.role).toBe(UserRole.STUDENT);
      expect(await bcrypt.compare('pass1234', u1!.password)).toBe(true);

      const u2 = await User.findOne({ email: 'user2@university.edu' });
      expect(u2).not.toBeNull();
      expect(u2!.name).toBe('User Two');
      expect(u2!.role).toBe(UserRole.PROFESSOR);
      expect(await bcrypt.compare('securePassword99', u2!.password)).toBe(true);

      const u3 = await User.findOne({ email: 'user3@university.edu' });
      expect(u3).not.toBeNull();
      expect(u3!.name).toBe('User Three');
      expect(u3!.role).toBe(UserRole.TA);
      expect(await bcrypt.compare('taPassWord123', u3!.password)).toBe(true);
    });

    it('should continue importing when some rows fail validation or database constraints', async () => {
      // Seed a user to cause email duplicate conflict
      const existingUser = new User({
        name: 'Existing User',
        email: 'duplicate@university.edu',
        password: 'hash',
        role: UserRole.STUDENT,
        isActive: true,
      });
      await existingUser.save();

      const csvContent = [
        'name,email,password,role',
        'Valid One,valid1@university.edu,pass1234,STUDENT', // Row 2: Success
        'Short Name,invalid-email,pass1234,STUDENT', // Row 3: Fail (invalid email)
        'Duplicate Name,duplicate@university.edu,pass1234,PROFESSOR', // Row 4: Fail (dup email in DB)
        'Valid Two,valid2@university.edu,pass1234,TA', // Row 5: Success
        'S,valid3@university.edu,pass1234,STUDENT', // Row 6: Fail (name too short, less than 3 chars)
        'Valid Three,valid3@university.edu,short,TA', // Row 7: Fail (password too short, less than 8 chars)
        'Valid Four,valid4@university.edu,pass1234,SUPERADMIN', // Row 8: Fail (invalid role)
      ].join('\n');

      const formData = new FormData();
      const file = new File([csvContent], 'users.csv', { type: 'text/csv' });
      formData.append('file', file);

      const req = new Request('http://localhost:3000/api/users/import', {
        method: 'POST',
        body: formData,
      });

      const res = await importPOST(req as any);
      expect(res.status).toBe(200);
      const resBody = await res.json();

      expect(resBody.success).toBe(true);
      expect(resBody.data.imported).toBe(2);
      expect(resBody.data.failed).toBe(5);

      const errors = resBody.data.errors;
      expect(errors.length).toBe(5);

      // Verify details of row 3 error (invalid email)
      const errorRow3 = errors.find((e: any) => e.row === 3);
      expect(errorRow3).toBeDefined();
      expect(errorRow3.email).toBe('invalid-email');
      expect(errorRow3.errors[0]).toBe('Invalid email address');

      // Verify details of row 4 error (duplicate email)
      const errorRow4 = errors.find((e: any) => e.row === 4);
      expect(errorRow4).toBeDefined();
      expect(errorRow4.email).toBe('duplicate@university.edu');
      expect(errorRow4.errors[0]).toBe('Email already exists');

      // Verify details of row 6 error (name too short)
      const errorRow6 = errors.find((e: any) => e.row === 6);
      expect(errorRow6).toBeDefined();
      expect(errorRow6.email).toBe('valid3@university.edu');
      expect(errorRow6.errors[0]).toBe('Name must be at least 3 characters long');

      // Verify details of row 7 error (password too short)
      const errorRow7 = errors.find((e: any) => e.row === 7);
      expect(errorRow7).toBeDefined();
      expect(errorRow7.email).toBe('valid3@university.edu');
      expect(errorRow7.errors[0]).toBe('Password must be at least 8 characters long');

      // Verify details of row 8 error (invalid role)
      const errorRow8 = errors.find((e: any) => e.row === 8);
      expect(errorRow8).toBeDefined();
      expect(errorRow8.email).toBe('valid4@university.edu');
      expect(errorRow8.errors[0]).toBe('Role must be one of: ADMIN, PROFESSOR, TA, STUDENT');

      // Verify that valid rows are indeed created in DB
      const v1 = await User.findOne({ email: 'valid1@university.edu' });
      expect(v1).not.toBeNull();
      const v2 = await User.findOne({ email: 'valid2@university.edu' });
      expect(v2).not.toBeNull();

      // Verify that failed/invalid rows are NOT in DB (except pre-seeded duplicate)
      const v3 = await User.findOne({ email: 'valid3@university.edu' });
      expect(v3).toBeNull();
      const v4 = await User.findOne({ email: 'valid4@university.edu' });
      expect(v4).toBeNull();
    });
  });
});
