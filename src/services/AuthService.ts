import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import User, { IUser, UserRole } from '../models/User';
import { RegisterInput } from '../validations/authValidation';

class AuthService {
    async register(data: RegisterInput): Promise<Omit<IUser, 'password'>> {
        const { email, password, name, role } = data;

        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            throw new Error("Email already registered");
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const user = await User.create({
            name,
            email,
            password: hashedPassword,
            role: role as UserRole
        });

        const userObj = user.toObject();
        const { password: _, ...userWithoutPassword } = userObj;

        return userWithoutPassword as unknown as Omit<IUser, 'password'>;
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
            throw new Error('Token is required');
        }
        if (!newPassword || newPassword.length < 8) {
            throw new Error('Password must be at least 8 characters long');
        }

        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const user = await User.findOne({
            resetPasswordToken: hashedToken,
        });

        if (!user) {
            throw new Error('Invalid or expired token');
        }

        if (!user.resetPasswordExpires || user.resetPasswordExpires.getTime() < Date.now()) {
            throw new Error('Invalid or expired token');
        }

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

        return true;
    }
}

export default new AuthService();
