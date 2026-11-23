import mongoose, { Schema, Document, Model } from 'mongoose';
import { UserRole } from '../constants/permissions';

export { UserRole };

export interface IUser extends Document {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    isActive: boolean;
    classroomAccess?: boolean;
    classroomRequestStatus?: 'NONE' | 'REQUESTED' | 'APPROVED' | 'REJECTED';
    classroomRequestedAt?: Date | null;
    resetPasswordToken?: string;
    resetPasswordExpires?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const UserSchema = new Schema<IUser>(
    {
        name: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true
        },
        password: {
            type: String,
            required: true
        },
        role: {
            type: String,
            enum: Object.values(UserRole),
            required: true
        },
        isActive: {
            type: Boolean,
            default: true
        },
        classroomAccess: {
            type: Boolean,
            default: false
        },
        classroomRequestStatus: {
            type: String,
            enum: ['NONE', 'REQUESTED', 'APPROVED', 'REJECTED'],
            default: 'NONE'
        },
        classroomRequestedAt: {
            type: Date,
            default: null
        },
        resetPasswordToken: {
            type: String,
            default: null,
            select: false
        },
        resetPasswordExpires: {
            type: Date,
            default: null,
            select: false
        }
    },
    {
        timestamps: true
    }
);

const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>('User', UserSchema);

export default User;
