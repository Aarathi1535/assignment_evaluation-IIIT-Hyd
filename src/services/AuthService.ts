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

        await User.findByIdAndUpdate(
            user._id,
            {
                $set: {
                    resetPasswordToken: token,
                    resetPasswordExpires: expiry
                }
            },
            { returnDocument: 'after', runValidators: true }
        );

        return token;
    }
}

export default new AuthService();
