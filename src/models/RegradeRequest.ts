import mongoose, { Schema, Document, Model } from 'mongoose';

export enum RegradeStatus {
    OPEN = 'OPEN',
    REVIEWING = 'REVIEWING',
    RESOLVED = 'RESOLVED'
}

export enum RegradeDecisionOutcome {
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED'
}

export interface IRegradeDecision {
    outcome: RegradeDecisionOutcome;
    reason: string;
    reviewer: mongoose.Types.ObjectId;
    decidedAt: Date;
    originalScore: number;
    revisedScore?: number;
}

export interface IRegradeRequest extends Document {
    exam: mongoose.Types.ObjectId;
    answerScript: mongoose.Types.ObjectId;
    questionNumber: number;
    student: mongoose.Types.ObjectId;
    reason: string;
    status: RegradeStatus;
    isOpen: boolean;
    handledBy?: mongoose.Types.ObjectId;
    resolutionNotes?: string;
    decision?: IRegradeDecision;
    createdAt: Date;
    updatedAt: Date;
}

const RegradeDecisionSchema = new Schema<IRegradeDecision>(
    {
        outcome: {
            type: String,
            enum: Object.values(RegradeDecisionOutcome),
            required: true
        },
        reason: {
            type: String,
            required: true,
            trim: true,
            maxlength: 2000
        },
        reviewer: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        decidedAt: {
            type: Date,
            required: true
        },
        originalScore: {
            type: Number,
            required: true,
            min: 0
        },
        revisedScore: {
            type: Number,
            min: 0
        }
    },
    { _id: false }
);

const RegradeRequestSchema = new Schema<IRegradeRequest>(
    {
        exam: {
            type: Schema.Types.ObjectId,
            ref: 'Exam',
            required: true,
            index: true
        },
        answerScript: {
            type: Schema.Types.ObjectId,
            ref: 'AnswerScript',
            required: true
        },
        questionNumber: {
            type: Number,
            required: true,
            min: 1
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
            default: RegradeStatus.OPEN,
            required: true,
            index: true
        },
        isOpen: {
            type: Boolean,
            default: true,
            required: true
        },
        handledBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        },
        resolutionNotes: {
            type: String,
            trim: true
        },
        decision: {
            type: RegradeDecisionSchema,
            default: undefined
        }
    },
    {
        timestamps: true
    }
);

RegradeRequestSchema.index(
    { student: 1, exam: 1, questionNumber: 1, isOpen: 1 },
    { unique: true, partialFilterExpression: { isOpen: true } }
);

RegradeRequestSchema.pre('validate', function () {
    this.isOpen = this.status !== RegradeStatus.RESOLVED;
});

const RegradeRequest: Model<IRegradeRequest> = mongoose.models.RegradeRequest || mongoose.model<IRegradeRequest>('RegradeRequest', RegradeRequestSchema);

export default RegradeRequest;
