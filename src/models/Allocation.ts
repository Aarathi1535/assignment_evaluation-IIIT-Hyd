import mongoose, { Schema, Document, Model } from 'mongoose';

export enum AllocationStatus {
    PENDING = 'PENDING',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED'
}

export enum AllocationRule {
    EQUAL = 'EQUAL',
    QUESTION = 'QUESTION',
    RANDOM = 'RANDOM'
}

export interface IAllocation extends Document {
    exam: mongoose.Types.ObjectId;
    ta: mongoose.Types.ObjectId;
    answerScript: mongoose.Types.ObjectId;
    allocatedBy: mongoose.Types.ObjectId;
    status: AllocationStatus;
    rule?: AllocationRule;
    question?: number;
    seed?: number;
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
        },
        rule: {
            type: String,
            enum: Object.values(AllocationRule),
            required: false,
            index: true
        },
        question: {
            type: Number,
            required: false,
            index: true
        },
        seed: {
            type: Number,
            required: false
        }
    },
    {
        timestamps: true
    }
);

// Ensure a script is not allocated to the same TA multiple times for the same question/whole-script
AllocationSchema.index({ ta: 1, answerScript: 1, question: 1 }, { unique: true });

// Prevent mixed-mode allocations: an answer script cannot simultaneously participate in whole-script allocation and question-wise allocation
AllocationSchema.pre('save', async function () {
    const AllocationModel = this.constructor as mongoose.Model<IAllocation>;
    
    if (this.question !== undefined && this.question !== null) {
        // Saving a question-wise allocation. Ensure no whole-script allocation exists for this script.
        const wholeScriptExists = await AllocationModel.exists({
            answerScript: this.answerScript,
            _id: { $ne: this._id }, // exclude self
            $or: [{ question: null }, { question: { $exists: false } }]
        });
        if (wholeScriptExists) {
            throw new Error('Cannot create question-wise allocation: a whole-script allocation already exists for this answer script.');
        }
    } else {
        // Saving a whole-script allocation. Ensure no question-wise allocation exists for this script.
        const questionWiseExists = await AllocationModel.exists({
            answerScript: this.answerScript,
            _id: { $ne: this._id }, // exclude self
            question: { $ne: null, $exists: true }
        });
        if (questionWiseExists) {
            throw new Error('Cannot create whole-script allocation: question-wise allocations already exist for this answer script.');
        }
    }
});

const Allocation: Model<IAllocation> = mongoose.models.Allocation || mongoose.model<IAllocation>('Allocation', AllocationSchema);

export default Allocation;

