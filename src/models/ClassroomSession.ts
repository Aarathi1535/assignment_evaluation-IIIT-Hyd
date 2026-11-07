import mongoose, { Schema, Document, Model } from 'mongoose';

export type ClassroomSessionStatus = 'ACTIVE' | 'CLOSED';

export interface IClassroomSession extends Document {
    title: string;
    joinCode: string;
    qrCodeSvg: string;
    createdBy: mongoose.Types.ObjectId;
    status: ClassroomSessionStatus;
    currentActivity?: mongoose.Types.ObjectId | null;
    defaultTimeLimit: number;
    participantCount: number;
    createdAt: Date;
    updatedAt: Date;
}

const ClassroomSessionSchema = new Schema<IClassroomSession>(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },
        joinCode: {
            type: String,
            required: true,
            unique: true,
            uppercase: true,
            trim: true,
            index: true
        },
        qrCodeSvg: {
            type: String,
            default: ''
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        status: {
            type: String,
            enum: ['ACTIVE', 'CLOSED'],
            default: 'ACTIVE',
            index: true
        },
        currentActivity: {
            type: Schema.Types.ObjectId,
            ref: 'ClassroomQuestion',
            default: null
        },
        defaultTimeLimit: {
            type: Number,
            default: 180,
            min: 0
        },
        participantCount: {
            type: Number,
            default: 0,
            min: 0
        }
    },
    {
        timestamps: true
    }
);

const ClassroomSession: Model<IClassroomSession> =
    mongoose.models.ClassroomSession ||
    mongoose.model<IClassroomSession>('ClassroomSession', ClassroomSessionSchema);

export default ClassroomSession;

