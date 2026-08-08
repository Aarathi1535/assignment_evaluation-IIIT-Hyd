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

describe('User Management API Tests (AE-030)', () => {
  let usersGET: any;
  let usersPOST: any;
  let userDetailPUT: any;
  let userDetailPATCH: any;

  beforeAll(async () => {
    usersGET = (await import('../app/api/users/route')).GET;
    usersPOST = (await import('../app/api/users/route')).POST;
    userDetailPUT = (await import('../app/api/users/[id]/route')).PUT;
    userDetailPATCH = (await import('../app/api/users/[id]/route')).PATCH;
  });

  describe('Authorization and Permission Enforcement', () => {
    it('should return 401 for GET /api/users when unauthenticated', async () => {
      mockSessionUser = null;
      const res = await usersGET();
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Unauthorized');
    });

    it('should return 403 Forbidden for STUDENT GET /api/users (lacks MANAGE_USERS)', async () => {
      mockSessionUser = {
        id: '000000000000000000000002',
        email: 'student@university.edu',
        name: 'Student User',
        role: 'STUDENT',
      };
      const res = await usersGET();
      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe('Forbidden');
    });

    it('should return 403 Forbidden for PROFESSOR POST /api/users (lacks MANAGE_USERS)', async () => {
      mockSessionUser = {
        id: '000000000000000000000003',
        email: 'prof@university.edu',
        name: 'Professor User',
        role: 'PROFESSOR',
      };
      const req = new Request('http://localhost:3000/api/users', {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await usersPOST(req as any);
      expect(res.status).toBe(403);
    });

    it('should return 403 Forbidden for TA PUT /api/users/some-id (lacks MANAGE_USERS)', async () => {
      mockSessionUser = {
        id: '000000000000000000000004',
        email: 'ta@university.edu',
        name: 'TA User',
        role: 'TA',
      };
      const req = new Request('http://localhost:3000/api/users/some-id', {
        method: 'PUT',
        body: JSON.stringify({}),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await userDetailPUT(req as any, { params: Promise.resolve({ id: 'some-id' }) });
      expect(res.status).toBe(403);
    });
  });

  describe('Admin Operations (Authorized)', () => {
    beforeEach(() => {
      mockSessionUser = {
        id: '000000000000000000000001',
        email: 'admin@university.edu',
        name: 'Admin User',
        role: 'ADMIN',
      };
    });

    it('should retrieve list of users successfully', async () => {
      // Seed a user in the database
      const passwordHash = await bcrypt.hash('password123', 10);
      const taUser = new User({
        name: 'Active TA',
        email: 'activeta@university.edu',
        password: passwordHash,
        role: UserRole.TA,
        isActive: true,
      });
      await taUser.save();

      const deactivatedUser = new User({
        name: 'Deactivated Student',
        email: 'deactivated@university.edu',
        password: passwordHash,
        role: UserRole.STUDENT,
        isActive: false, // Soft deleted user
      });
      await deactivatedUser.save();

      const res = await usersGET();
      expect(res.status).toBe(200);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.message).toBe('Users retrieved successfully');
      
      // Should return only active users
      expect(resBody.data.length).toBe(1);
      expect(resBody.data[0].name).toBe('Active TA');
      expect(resBody.data[0].email).toBe('activeta@university.edu');
      expect(resBody.data[0].password).toBeUndefined(); // Sanitized password
    });

    it('should create a new user successfully with hashed password', async () => {
      const payload = {
        name: 'New Professor',
        email: 'newprof@university.edu',
        password: 'securePassword789',
        role: 'PROFESSOR',
      };

      const req = new Request('http://localhost:3000/api/users', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await usersPOST(req as any);
      expect(res.status).toBe(201);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.data.name).toBe('New Professor');
      expect(resBody.data.email).toBe('newprof@university.edu');
      expect(resBody.data.role).toBe('PROFESSOR');
      expect(resBody.data.password).toBeUndefined(); // Sanitized password

      // Query database directly to check password hashing
      const dbUser = await User.findOne({ email: 'newprof@university.edu' });
      expect(dbUser).not.toBeNull();
      const match = await bcrypt.compare('securePassword789', dbUser!.password);
      expect(match).toBe(true);
    });

    it('should return 400 validation error when creating user with invalid payload', async () => {
      const payload = {
        name: 'AB', // too short
        email: 'invalid-email',
        password: 'short', // too short
        role: 'SUPERADMIN', // invalid role
      };

      const req = new Request('http://localhost:3000/api/users', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await usersPOST(req as any);
      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toBe('Validation failed');
      expect(resBody.data).toBeDefined();
    });

    it('should return 400 when trying to create user with existing email', async () => {
      const existingEmail = 'dup@university.edu';
      const existingUser = new User({
        name: 'Existing User',
        email: existingEmail,
        password: 'somePassword',
        role: UserRole.STUDENT,
        isActive: true,
      });
      await existingUser.save();

      const payload = {
        name: 'Another User',
        email: existingEmail,
        password: 'newPassword123',
        role: 'TA',
      };

      const req = new Request('http://localhost:3000/api/users', {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await usersPOST(req as any);
      expect(res.status).toBe(409);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toBe('Email already exists');
    });

    it('should update user successfully and hash password if provided', async () => {
      const passwordHash = await bcrypt.hash('oldPassword', 10);
      const dbUser = new User({
        name: 'Old Name',
        email: 'oldemail@university.edu',
        password: passwordHash,
        role: UserRole.STUDENT,
        isActive: true,
      });
      await dbUser.save();

      const payload = {
        name: 'Updated Name',
        password: 'newSecurePassword',
      };

      const req = new Request(`http://localhost:3000/api/users/${dbUser._id}`, {
        method: 'PUT',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await userDetailPUT(req as any, { params: Promise.resolve({ id: dbUser._id.toString() }) });
      expect(res.status).toBe(200);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.data.name).toBe('Updated Name');
      expect(resBody.data.password).toBeUndefined(); // Sanitized password

      // Query database directly to check password hashing and other fields
      const updatedDbUser = await User.findById(dbUser._id);
      expect(updatedDbUser!.name).toBe('Updated Name');
      expect(updatedDbUser!.email).toBe('oldemail@university.edu'); // Unchanged
      const match = await bcrypt.compare('newSecurePassword', updatedDbUser!.password);
      expect(match).toBe(true);
    });

    it('should deactivate user successfully (soft delete)', async () => {
      const passwordHash = await bcrypt.hash('somePassword', 10);
      const dbUser = new User({
        name: 'Target User',
        email: 'target@university.edu',
        password: passwordHash,
        role: UserRole.TA,
        isActive: true,
      });
      await dbUser.save();

      const req = new Request(`http://localhost:3000/api/users/${dbUser._id}`, {
        method: 'PATCH',
      });

      const res = await userDetailPATCH(req as any, { params: Promise.resolve({ id: dbUser._id.toString() }) });
      expect(res.status).toBe(200);
      const resBody = await res.json();
      expect(resBody.success).toBe(true);
      expect(resBody.message).toBe('User deactivated successfully');
      expect(resBody.data.isActive).toBe(false);

      // Verify in DB directly
      const updatedDbUser = await User.findById(dbUser._id);
      expect(updatedDbUser!.isActive).toBe(false);
    });

    it('should return 404 when updating non-existent user', async () => {
      const nonExistentId = new User()._id.toString();
      const req = new Request(`http://localhost:3000/api/users/${nonExistentId}`, {
        method: 'PUT',
        body: JSON.stringify({ name: 'Valid Name' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await userDetailPUT(req as any, { params: Promise.resolve({ id: nonExistentId }) });
      expect(res.status).toBe(404);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toBe('User not found');
    });

    it('should prevent self-deactivation (self-lockout)', async () => {
      const adminId = '000000000000000000000001';
      // Seed admin user
      const admin = new User({
        _id: adminId,
        name: 'Admin User',
        email: 'admin@university.edu',
        password: await bcrypt.hash('password123', 10),
        role: UserRole.ADMIN,
        isActive: true,
      });
      await admin.save();

      const req = new Request(`http://localhost:3000/api/users/${adminId}`, {
        method: 'PATCH',
      });

      const res = await userDetailPATCH(req as any, { params: Promise.resolve({ id: adminId }) });
      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toContain('Self-deactivation is not allowed');
    });

    it('should prevent self-demotion from ADMIN', async () => {
      const adminId = '000000000000000000000001';
      // Seed admin user
      const admin = new User({
        _id: adminId,
        name: 'Admin User',
        email: 'admin@university.edu',
        password: await bcrypt.hash('password123', 10),
        role: UserRole.ADMIN,
        isActive: true,
      });
      await admin.save();

      const req = new Request(`http://localhost:3000/api/users/${adminId}`, {
        method: 'PUT',
        body: JSON.stringify({ role: UserRole.STUDENT }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await userDetailPUT(req as any, { params: Promise.resolve({ id: adminId }) });
      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toContain('Self-demotion from ADMIN is not allowed');
    });

    it('should prevent deactivating the last active ADMIN', async () => {
      // Seed active admin A
      const adminAId = '000000000000000000000001';
      const adminA = new User({
        _id: adminAId,
        name: 'Admin A',
        email: 'adminA@university.edu',
        password: await bcrypt.hash('password123', 10),
        role: UserRole.ADMIN,
        isActive: true,
      });
      await adminA.save();

      // Create another admin user but deactivated
      const adminB = new User({
        name: 'Admin B',
        email: 'adminB@university.edu',
        password: 'password123',
        role: UserRole.ADMIN,
        isActive: false
      });
      await adminB.save();

      // Attempt to deactivate active admin A (acting user is Admin C, who is not in DB)
      mockSessionUser = {
        id: '000000000000000000000009',
        email: 'adminC@university.edu',
        name: 'Admin C',
        role: 'ADMIN',
      };

      const req = new Request(`http://localhost:3000/api/users/${adminAId}`, {
        method: 'PATCH',
      });

      const res = await userDetailPATCH(req as any, { params: Promise.resolve({ id: adminAId }) });
      expect(res.status).toBe(400);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toContain('Cannot deactivate or demote the last active ADMIN');
    });

    it('should return 409 conflict when updating a user to an already existing email', async () => {
      const user1 = new User({
        name: 'User 1',
        email: 'user1@university.edu',
        password: await bcrypt.hash('password123', 10),
        role: UserRole.STUDENT,
        isActive: true,
      });
      await user1.save();

      const user2 = new User({
        name: 'User 2',
        email: 'user2@university.edu',
        password: await bcrypt.hash('password123', 10),
        role: UserRole.STUDENT,
        isActive: true,
      });
      await user2.save();

      const req = new Request(`http://localhost:3000/api/users/${user2._id}`, {
        method: 'PUT',
        body: JSON.stringify({ email: 'user1@university.edu' }),
        headers: { 'Content-Type': 'application/json' },
      });

      const res = await userDetailPUT(req as any, { params: Promise.resolve({ id: user2._id.toString() }) });
      expect(res.status).toBe(409);
      const resBody = await res.json();
      expect(resBody.success).toBe(false);
      expect(resBody.message).toBe('Email already exists');
    });

    it('should throw HttpError with 400 when self-deactivation is attempted on UserService.updateUser', async () => {
      const adminId = '000000000000000000000001';
      const admin = new User({
        _id: adminId,
        name: 'Admin User',
        email: 'admin@university.edu',
        password: await bcrypt.hash('password123', 10),
        role: UserRole.ADMIN,
        isActive: true,
      });
      await admin.save();

      const UserService = (await import('../services/UserService')).default;
      const { HttpError } = await import('../lib/errors');

      try {
        await UserService.updateUser(adminId, { isActive: false }, { actingUserId: adminId });
        expect.unreachable('Should have thrown an HttpError');
      } catch (err: any) {
        expect(err).toBeInstanceOf(HttpError);
        expect(err.statusCode).toBe(400);
        expect(err.message).toBe('Self-deactivation is not allowed');
      }
    });
  });
});
