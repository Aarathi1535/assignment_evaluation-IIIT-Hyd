import mongoose, { Schema, Document, Model } from 'mongoose';

export enum AllocationStatus {
    PENDING = 'PENDING',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED'
}

export interface IAllocation extends Document {
    exam: mongoose.Types.ObjectId;
    ta: mongoose.Types.ObjectId;
    answerScript: mongoose.Types.ObjectId;
    allocatedBy: mongoose.Types.ObjectId;
    status: AllocationStatus;
    createdAt: Date;
    updatedAt: Date;
}

const AllocationSchema = new Schema<IAllocation>(
    {
        exam: {
            type: Schema.Types.ObjectId,
            ref: 'Exam',
            required: true,
            index: true
        },
        ta: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        answerScript: {
            type: Schema.Types.ObjectId,
            ref: 'AnswerScript',
            required: true,
            index: true
        },
        allocatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        status: {
            type: String,
            enum: Object.values(AllocationStatus),
            default: AllocationStatus.PENDING,
            required: true,
            index: true
        }
    },
    {
        timestamps: true
    }
);

// Ensure a script is not allocated to the same TA multiple times
AllocationSchema.index({ ta: 1, answerScript: 1 }, { unique: true });

const Allocation: Model<IAllocation> = mongoose.models.Allocation || mongoose.model<IAllocation>('Allocation', AllocationSchema);

export default Allocation;
