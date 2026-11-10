import mongoose, { Schema, Document, Model } from 'mongoose';

export enum RegradeStatus {
    OPEN = 'OPEN',
    REVIEWING = 'REVIEWING',
    RESOLVED = 'RESOLVED'
}

const VALID_REGRADE_STATUS_TRANSITIONS: Record<RegradeStatus, RegradeStatus[]> = {
    [RegradeStatus.OPEN]: [RegradeStatus.REVIEWING, RegradeStatus.RESOLVED],
    [RegradeStatus.REVIEWING]: [RegradeStatus.RESOLVED, RegradeStatus.OPEN],
    [RegradeStatus.RESOLVED]: []
};

export function isValidRegradeTransition(current: RegradeStatus, next: RegradeStatus): boolean {
    if (current === next) return true;
    return VALID_REGRADE_STATUS_TRANSITIONS[current]?.includes(next) ?? false;
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
    createdAt: Date;
    updatedAt: Date;
}

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

RegradeRequestSchema.post('init', function () {
    (this as unknown as { _originalStatus?: RegradeStatus })._originalStatus = this.status;
});

RegradeRequestSchema.pre('validate', function () {
    const original = (this as unknown as { _originalStatus?: RegradeStatus })._originalStatus;
    if (!this.isNew && this.isModified('status') && original) {
        if (!isValidRegradeTransition(original, this.status)) {
            throw new Error(`Invalid regrade status transition from ${original} to ${this.status}`);
        }
    }
    this.isOpen = this.status !== RegradeStatus.RESOLVED;
});

export function transitionRegradeStatus(doc: IRegradeRequest, nextStatus: RegradeStatus): void {
    if (!isValidRegradeTransition(doc.status, nextStatus)) {
        throw new Error(`Invalid regrade status transition from ${doc.status} to ${nextStatus}`);
    }
    doc.status = nextStatus;
    doc.isOpen = nextStatus !== RegradeStatus.RESOLVED;
}

RegradeRequestSchema.pre(['updateOne', 'findOneAndUpdate'], function () {
    const update = this.getUpdate() as Record<string, unknown> | null;
    if (update) {
        if (update.status) {
            update.isOpen = update.status !== RegradeStatus.RESOLVED;
        } else if (update.$set && typeof update.$set === 'object' && 'status' in update.$set) {
            const setObj = update.$set as Record<string, unknown>;
            setObj.isOpen = setObj.status !== RegradeStatus.RESOLVED;
        }
    }
});

const RegradeRequest: Model<IRegradeRequest> = mongoose.models.RegradeRequest || mongoose.model<IRegradeRequest>('RegradeRequest', RegradeRequestSchema);

export default RegradeRequest;
