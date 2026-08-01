import mongoose, { Schema, Document, Model } from 'mongoose';

export enum JobStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED'
}

export enum ModelProvider {
    DEEPSEEK = 'DEEPSEEK',
    VERTEX = 'VERTEX',
    OPENAI = 'OPENAI',
    OLLAMA = 'OLLAMA'
}

export interface IJob extends Document {
    userId: mongoose.Types.ObjectId;
    batchId?: mongoose.Types.ObjectId;
    status: JobStatus;
    questionFilePath?: string;
    questionFilename?: string;
    assessmentFilePath?: string;
    assessmentFilename?: string;
    rubricFilePath?: string;
    rubricFilename?: string;
    rubricText?: string;
    webhookUrl?: string;
    modelProvider?: ModelProvider;
    fileDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const JobSchema = new Schema<IJob>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        batchId: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
            required: false,
            index: true
        },
        status: {
            type: String,
            enum: Object.values(JobStatus),
            default: JobStatus.PENDING,
            required: true,
            index: true
        },
        questionFilePath: {
            type: String,
            trim: true
        },
        questionFilename: {
            type: String,
            trim: true
        },
        assessmentFilePath: {
            type: String,
            trim: true
        },
        assessmentFilename: {
            type: String,
            trim: true
        },
        rubricFilePath: {
            type: String,
            trim: true
        },
        rubricFilename: {
            type: String,
            trim: true
        },
        rubricText: {
            type: String,
            trim: true
        },
        webhookUrl: {
            type: String,
            trim: true
        },
        modelProvider: {
            type: String,
            enum: Object.values(ModelProvider),
            index: true
        },
        fileDeleted: {
            type: Boolean,
            default: false,
            required: true
        }
    },
    {
        timestamps: true
    }
);

const Job: Model<IJob> = mongoose.models.Job || mongoose.model<IJob>('Job', JobSchema);

export default Job;
