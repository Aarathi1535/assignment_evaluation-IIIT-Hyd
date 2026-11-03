import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IClassroomParticipant extends Document {
    session: mongoose.Types.ObjectId;
    participantId: string;
    name: string;
    token: string;
    userId?: mongoose.Types.ObjectId | null;
    joinedAt: Date;
    lastActiveAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ClassroomParticipantSchema = new Schema<IClassroomParticipant>(
    {
        session: {
            type: Schema.Types.ObjectId,
            ref: 'ClassroomSession',
            required: true,
            index: true
        },
        participantId: {
            type: String,
            required: true,
            trim: true
        },
        name: {
            type: String,
            required: true,
            trim: true
        },
        token: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        joinedAt: {
            type: Date,
            default: Date.now
        },
        lastActiveAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        timestamps: true
    }
);

// One participant identity per participantId per session
ClassroomParticipantSchema.index({ session: 1, participantId: 1 }, { unique: true });

const ClassroomParticipant: Model<IClassroomParticipant> =
    mongoose.models.ClassroomParticipant ||
    mongoose.model<IClassroomParticipant>('ClassroomParticipant', ClassroomParticipantSchema);

export default ClassroomParticipant;
