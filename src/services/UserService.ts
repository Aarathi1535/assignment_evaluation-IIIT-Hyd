import UserRepository from '../repositories/UserRepository';
import User, { IUser } from '../models/User';
import bcrypt from 'bcryptjs';
import { writeAuditLog } from '../lib/audit';
import mongoose from 'mongoose';

export interface AuditContext {
    actingUserId?: string;
    ipAddress?: string;
    action?: string;
}

class UserService {
    async createUser(data: Partial<IUser>, context?: AuditContext): Promise<IUser> {
        if (!data.email) {
            throw new Error("Email is required");
        }
        
        const existingUser = await User.findOne({ email: data.email.toLowerCase() });
        if (existingUser) {
            throw new Error("Email already exists");
        }

        const userData = { ...data };
        if (userData.password) {
            userData.password = await bcrypt.hash(userData.password, 10);
        }

        const newUser = await UserRepository.createUser(userData);

        if (context?.actingUserId) {
            const action = context.action || 'USER_CREATED';
            await writeAuditLog({
                user: context.actingUserId,
                action,
                entityId: newUser._id as mongoose.Types.ObjectId,
                entityType: 'User',
                details: {
                    email: newUser.email,
                    role: newUser.role
                },
                ipAddress: context.ipAddress
            });
        }

        return newUser;
    }

    async getAllUsers(): Promise<IUser[]> {
        return await UserRepository.getAllUsers();
    }

    async getUserById(id: string): Promise<IUser | null> {
        return await UserRepository.getUserById(id);
    }

    async updateUser(id: string, data: Partial<IUser>, context?: AuditContext): Promise<IUser | null> {
        const userBefore = await User.findOne({ _id: id, isActive: true });
        if (!userBefore) {
            return null;
        }

        const userData = { ...data };

        if (userData.email) {
            const existingUser = await User.findOne({ 
                email: userData.email.toLowerCase(), 
                _id: { $ne: id } 
            });
            if (existingUser) {
                throw new Error("Email already exists");
            }
        }

        if (userData.password) {
            userData.password = await bcrypt.hash(userData.password, 10);
        }

        const updatedUser = await UserRepository.updateUser(id, userData);

        if (updatedUser && context?.actingUserId) {
            const changedFields: string[] = [];
            if (data.name !== undefined && data.name !== userBefore.name) {
                changedFields.push('name');
            }
            if (data.email !== undefined && data.email.toLowerCase() !== userBefore.email) {
                changedFields.push('email');
            }
            if (data.role !== undefined && data.role !== userBefore.role) {
                changedFields.push('role');
            }
            if (data.password !== undefined) {
                changedFields.push('password');
            }
            if (data.isActive !== undefined && data.isActive !== userBefore.isActive) {
                changedFields.push('isActive');
            }

            await writeAuditLog({
                user: context.actingUserId,
                action: 'USER_UPDATED',
                entityId: updatedUser._id as mongoose.Types.ObjectId,
                entityType: 'User',
                details: {
                    email: updatedUser.email,
                    role: updatedUser.role,
                    changedFields
                },
                ipAddress: context.ipAddress
            });
        }

        return updatedUser;
    }

    async deactivateUser(id: string, context?: AuditContext): Promise<IUser | null> {
        const userBefore = await User.findOne({ _id: id, isActive: true });
        if (!userBefore) {
            return null;
        }

        const deactivatedUser = await UserRepository.deactivateUser(id);

        if (deactivatedUser && context?.actingUserId) {
            await writeAuditLog({
                user: context.actingUserId,
                action: 'USER_DEACTIVATED',
                entityId: deactivatedUser._id as mongoose.Types.ObjectId,
                entityType: 'User',
                details: {
                    email: deactivatedUser.email,
                    role: deactivatedUser.role,
                    changedFields: ['isActive']
                },
                ipAddress: context.ipAddress
            });
        }

        return deactivatedUser;
    }
}

const userService = new UserService();
export default userService;
