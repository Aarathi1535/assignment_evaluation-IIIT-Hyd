import { describe, it, expect, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import User from '../models/User';
import AuditLog from '../models/AuditLog';
import UserService from '../services/UserService';
import AuthService from '../services/AuthService';
import { writeAuditLog } from '../lib/audit';
import { UserRole } from '../constants/permissions';

describe('Audit Logging Utility & Service Tests (AE-033)', () => {
    let actingUserId: mongoose.Types.ObjectId;

    beforeEach(async () => {
        // Generate a test acting user id
        actingUserId = new mongoose.Types.ObjectId();
    });

    describe('writeAuditLog Utility', () => {
        it('should successfully create an AuditLog entry when valid parameters are provided', async () => {
            const targetId = new mongoose.Types.ObjectId();
            await writeAuditLog({
                user: actingUserId,
                action: 'TEST_ACTION',
                entityId: targetId,
                entityType: 'User',
                details: { foo: 'bar' },
                ipAddress: '127.0.0.1'
            });

            const logs = await AuditLog.find({ user: actingUserId });
            expect(logs.length).toBe(1);
            expect(logs[0].action).toBe('TEST_ACTION');
            expect(logs[0].entityId?.toString()).toBe(targetId.toString());
            expect(logs[0].entityType).toBe('User');
            expect(logs[0].details).toEqual({ foo: 'bar' });
            expect(logs[0].ipAddress).toBe('127.0.0.1');
        });

        it('should not throw an error and instead log it when database write fails', async () => {
            const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            // Call writeAuditLog with invalid parameters (e.g. missing required 'user' or 'action')
            await writeAuditLog({
                user: undefined as unknown as mongoose.Types.ObjectId,
                action: 'INVALID_ACTION'
            });

            expect(consoleErrorSpy).toHaveBeenCalled();
            consoleErrorSpy.mockRestore();
        });
    });

    describe('UserService Mutation Logging', () => {
        it('should log USER_CREATED when a user is successfully created with context', async () => {
            const userData = {
                name: 'Test Create',
                email: 'testcreate@university.edu',
                password: 'password123',
                role: UserRole.STUDENT
            };

            const context = {
                actingUserId: actingUserId.toString(),
                ipAddress: '192.168.1.1'
            };

            const user = await UserService.createUser(userData, context);
            expect(user).toBeDefined();

            const logs = await AuditLog.find({ entityId: user._id });
            expect(logs.length).toBe(1);
            expect(logs[0].action).toBe('USER_CREATED');
            expect(logs[0].user.toString()).toBe(actingUserId.toString());
            expect(logs[0].entityType).toBe('User');
            expect(logs[0].details).toEqual({
                email: 'testcreate@university.edu',
                role: UserRole.STUDENT
            });
            expect(logs[0].ipAddress).toBe('192.168.1.1');
        });

        it('should log USER_IMPORTED when createUser is called with action USER_IMPORTED in context', async () => {
            const userData = {
                name: 'Test Import',
                email: 'testimport@university.edu',
                password: 'password123',
                role: UserRole.TA
            };

            const context = {
                actingUserId: actingUserId.toString(),
                ipAddress: '192.168.1.2',
                action: 'USER_IMPORTED'
            };

            const user = await UserService.createUser(userData, context);

            const logs = await AuditLog.find({ entityId: user._id });
            expect(logs.length).toBe(1);
            expect(logs[0].action).toBe('USER_IMPORTED');
            expect(logs[0].details).toEqual({
                email: 'testimport@university.edu',
                role: UserRole.TA
            });
        });

        it('should log USER_UPDATED with correct changedFields on partial user updates', async () => {
            // Seed a user
            const existingUser = new User({
                name: 'Test Update original',
                email: 'testupdate@university.edu',
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });
            await existingUser.save();

            const context = {
                actingUserId: actingUserId.toString(),
                ipAddress: '192.168.1.3'
            };

            // Perform update changing name and role
            const updatedUser = await UserService.updateUser(
                existingUser._id.toString(),
                {
                    name: 'Test Update modified',
                    role: UserRole.PROFESSOR
                },
                context
            );
            expect(updatedUser).not.toBeNull();

            const logs = await AuditLog.find({ entityId: existingUser._id, action: 'USER_UPDATED' });
            expect(logs.length).toBe(1);
            expect(logs[0].user.toString()).toBe(actingUserId.toString());
            expect(logs[0].ipAddress).toBe('192.168.1.3');

            const details = logs[0].details as { email?: string; role?: string; changedFields?: string[] };
            expect(details.email).toBe('testupdate@university.edu');
            expect(details.role).toBe(UserRole.PROFESSOR);
            expect(details.changedFields).toContain('name');
            expect(details.changedFields).toContain('role');
            expect(details.changedFields).not.toContain('email');
        });

        it('should log USER_DEACTIVATED when a user is deactivated', async () => {
            // Seed an active user
            const existingUser = new User({
                name: 'Deactivate Target',
                email: 'deactivatetarget@university.edu',
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: true
            });
            await existingUser.save();

            const context = {
                actingUserId: actingUserId.toString(),
                ipAddress: '192.168.1.4'
            };

            const deactivatedUser = await UserService.deactivateUser(existingUser._id.toString(), context);
            expect(deactivatedUser).not.toBeNull();
            expect(deactivatedUser!.isActive).toBe(false);

            const logs = await AuditLog.find({ entityId: existingUser._id, action: 'USER_DEACTIVATED' });
            expect(logs.length).toBe(1);
            expect(logs[0].user.toString()).toBe(actingUserId.toString());
            expect(logs[0].ipAddress).toBe('192.168.1.4');
            
            const details = logs[0].details as { email?: string; role?: string; changedFields?: string[] };
            expect(details.email).toBe('deactivatetarget@university.edu');
            expect(details.role).toBe(UserRole.STUDENT);
            expect(details.changedFields).toEqual(['isActive']);
        });

        it('should log USER_REGISTERED when a user registers successfully through AuthService', async () => {
            const registerData = {
                name: 'New Registered User',
                email: 'newregister@university.edu',
                password: 'password123',
                role: UserRole.STUDENT
            };

            const user = await AuthService.register(registerData, '192.168.1.5');
            expect(user).toBeDefined();

            // Find the user in the database to get their ID
            const dbUser = await User.findOne({ email: 'newregister@university.edu' });
            expect(dbUser).not.toBeNull();

            const logs = await AuditLog.find({ entityId: dbUser!._id, action: 'USER_REGISTERED' });
            expect(logs.length).toBe(1);
            expect(logs[0].user.toString()).toBe(dbUser!._id.toString());
            expect(logs[0].entityType).toBe('User');
            expect(logs[0].ipAddress).toBe('192.168.1.5');

            const details = logs[0].details as { name?: string; email?: string; role?: string };
            expect(details.name).toBe('New Registered User');
            expect(details.email).toBe('newregister@university.edu');
            expect(details.role).toBe(UserRole.STUDENT);
        });
    });
});
