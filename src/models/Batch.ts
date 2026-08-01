import mongoose, { Schema, Document, Model } from 'mongoose';

export enum BatchStatus {
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    PARTIAL_FAILURE = 'PARTIAL_FAILURE'
}

export enum ModelProvider {
    DEEPSEEK = 'DEEPSEEK',
    VERTEX = 'VERTEX',
    OPENAI = 'OPENAI',
    OLLAMA = 'OLLAMA'
}

export interface IBatch extends Document {
    userId: mongoose.Types.ObjectId;
    status: BatchStatus;
    totalCount: number;
    completedCount: number;
    failedCount: number;
    questionFilename?: string;
    rubricFilename?: string;
    jobIds: mongoose.Types.ObjectId[];
    modelProvider?: ModelProvider;
    createdAt: Date;
    updatedAt: Date;
}

const BatchSchema = new Schema<IBatch>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        status: {
            type: String,
            enum: Object.values(BatchStatus),
            default: BatchStatus.PROCESSING,
            required: true,
            index: true
        },
        totalCount: {
            type: Number,
            default: 0,
            required: true,
            min: 0
        },
        completedCount: {
            type: Number,
            default: 0,
            required: true,
            min: 0
        },
        failedCount: {
            type: Number,
            default: 0,
            required: true,
            min: 0
        },
        questionFilename: {
            type: String,
            trim: true
        },
        rubricFilename: {
            type: String,
            trim: true
        },
        jobIds: [
            {
                type: Schema.Types.ObjectId,
                ref: 'Job'
            }
        ],
        modelProvider: {
            type: String,
            enum: Object.values(ModelProvider),
            index: true
        }
    },
    {
        timestamps: true
    }
);

const Batch: Model<IBatch> = mongoose.models.Batch || mongoose.model<IBatch>('Batch', BatchSchema);

export default Batch;
