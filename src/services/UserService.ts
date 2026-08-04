import UserRepository from '../repositories/UserRepository';
import User, { IUser } from '../models/User';
import bcrypt from 'bcryptjs';

class UserService {
    async createUser(data: Partial<IUser>): Promise<IUser> {
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

        return await UserRepository.createUser(userData);
    }

    async getAllUsers(): Promise<IUser[]> {
        return await UserRepository.getAllUsers();
    }

    async getUserById(id: string): Promise<IUser | null> {
        return await UserRepository.getUserById(id);
    }

    async updateUser(id: string, data: Partial<IUser>): Promise<IUser | null> {
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

        return await UserRepository.updateUser(id, userData);
    }

    async deactivateUser(id: string): Promise<IUser | null> {
        return await UserRepository.deactivateUser(id);
    }
}

const userService = new UserService();
export default userService;
