import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import User, { IUser, UserRole } from '../models/User';
import { RegisterInput } from '../validations/authValidation';
import { writeAuditLog } from '../lib/audit';
import mongoose from 'mongoose';
import { HttpError, isDuplicateKeyError } from '../lib/errors';

class AuthService {
    async register(data: RegisterInput, ipAddress?: string): Promise<Omit<IUser, 'password'>> {
        const { email, password, name, role } = data;

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            throw new HttpError("Email already registered", 409);
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        try {
            const user = await User.create({
                name,
                email,
                password: hashedPassword,
                role: role as UserRole
            });

            // Write Audit Log
            await writeAuditLog({
                user: user._id as mongoose.Types.ObjectId,
                action: 'USER_REGISTERED',
                entityId: user._id as mongoose.Types.ObjectId,
                entityType: 'User',
                details: {
                    name: user.name,
                    email: user.email,
                    role: user.role
                },
                ipAddress
            });

            const userObj = user.toObject();
            const userWithoutPassword = { ...userObj } as Partial<IUser>;
            delete userWithoutPassword.password;

            return userWithoutPassword as Omit<IUser, 'password'>;
        } catch (error) {
            if (isDuplicateKeyError(error)) {
                throw new HttpError("Email already registered", 409);
            }
            throw error;
        }
    }

    async generateResetToken(email: string): Promise<string | null> {
        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) {
            return null;
        }

        const token = crypto.randomBytes(32).toString('hex');
        const expiry = new Date(Date.now() + 3600000); // 1 hour
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        await User.findByIdAndUpdate(
            user._id,
            {
                $set: {
                    resetPasswordToken: hashedToken,
                    resetPasswordExpires: expiry
                }
            },
            { returnDocument: 'after', runValidators: true }
        );

        return token;
    }

    async resetPassword(token: string, newPassword: string): Promise<boolean> {
        if (!token) {
            throw new HttpError('Token is required', 400);
        }
        if (!newPassword || newPassword.length < 8) {
            throw new HttpError('Password must be at least 8 characters long', 400);
        }

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const user = await User.findOne({
            resetPasswordToken: hashedToken,
        }).select('+resetPasswordToken +resetPasswordExpires');

        if (!user) {
            throw new HttpError('Invalid or expired token', 400);
        }

        if (!user.resetPasswordExpires || user.resetPasswordExpires.getTime() < Date.now()) {
            throw new HttpError('Invalid or expired token', 400);
        }

        try {
            const hashedPassword = await bcrypt.hash(newPassword, 10);

            await User.findByIdAndUpdate(
                user._id,
                {
                    $set: {
                        password: hashedPassword,
                        resetPasswordToken: null,
                        resetPasswordExpires: null
                    }
                },
                { runValidators: true }
            );

            await writeAuditLog({
                user: user._id as mongoose.Types.ObjectId,
                action: 'PASSWORD_RESET',
                outcome: 'SUCCESS',
                entityId: user._id as mongoose.Types.ObjectId,
                entityType: 'User'
            });

            return true;
        } catch (error) {
            await writeAuditLog({
                user: user._id as mongoose.Types.ObjectId,
                action: 'PASSWORD_RESET',
                outcome: 'FAILURE',
                entityId: user._id as mongoose.Types.ObjectId,
                entityType: 'User',
                details: { error: error instanceof Error ? error.message : 'Unknown error' }
            });
            throw error;
        }
    }
}

const authService = new AuthService();
export default authService;
