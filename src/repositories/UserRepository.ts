import User, { IUser } from '../models/User';

class UserRepository {
    async createUser(data: Partial<IUser>): Promise<IUser> {
        const user = new User(data);
        return await user.save();
    }

    async getAllUsers(): Promise<IUser[]> {
        return await User.find({ isActive: true }).sort({ createdAt: -1 });
    }

    async getUserById(id: string): Promise<IUser | null> {
        return await User.findOne({ _id: id, isActive: true });
    }

    async getUserByEmail(email: string): Promise<IUser | null> {
        return await User.findOne({ email: email.toLowerCase(), isActive: true });
    }

    async updateUser(id: string, data: Partial<IUser>): Promise<IUser | null> {
        return await User.findOneAndUpdate(
            { _id: id, isActive: true },
            data,
            { new: true, runValidators: true }
        );
    }

    async deactivateUser(id: string): Promise<IUser | null> {
        return await User.findOneAndUpdate(
            { _id: id, isActive: true },
            { isActive: false },
            { new: true }
        );
    }
}

const userRepository = new UserRepository();
export default userRepository;
