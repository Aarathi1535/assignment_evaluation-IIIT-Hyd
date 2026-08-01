import bcrypt from 'bcryptjs';
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
}

export default new AuthService();
