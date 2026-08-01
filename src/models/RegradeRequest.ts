import mongoose, { Schema, Document, Model } from 'mongoose';

export enum RegradeStatus {
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED'
}

export interface IRegradeRequest extends Document {
    answerScript: mongoose.Types.ObjectId;
    student: mongoose.Types.ObjectId;
    reason: string;
    status: RegradeStatus;
    handledBy?: mongoose.Types.ObjectId;
    resolutionNotes?: string;
    createdAt: Date;
    updatedAt: Date;
}

const RegradeRequestSchema = new Schema<IRegradeRequest>(
    {
        answerScript: {
            type: Schema.Types.ObjectId,
            ref: 'AnswerScript',
            required: true,
            unique: true
        },
        student: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        reason: {
            type: String,
            required: true,
            trim: true
        },
        status: {
            type: String,
            enum: Object.values(RegradeStatus),
            default: RegradeStatus.PENDING,
            required: true,
            index: true
        },
        handledBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        resolutionNotes: {
            type: String,
            trim: true
        }
    },
    {
        timestamps: true
    }
);



const RegradeRequest: Model<IRegradeRequest> = mongoose.models.RegradeRequest || mongoose.model<IRegradeRequest>('RegradeRequest', RegradeRequestSchema);

export default RegradeRequest;
