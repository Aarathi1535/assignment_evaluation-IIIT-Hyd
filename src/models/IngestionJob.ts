import mongoose, { Schema, Document, Model } from 'mongoose';

export enum IngestionStatus {
    QUEUED = 'queued',
    PROCESSING = 'processing',
    DONE = 'done',
    FAILED = 'failed'
}

export interface IIngestionJob extends Document {
    batchId: string;
    batch: mongoose.Types.ObjectId;
    uploadedBy: mongoose.Types.ObjectId;
    status: IngestionStatus;
    totalPages: number;
    processedPages: number;
    failedPages: number;
    startedAt?: Date;
    completedAt?: Date;
    failureReason?: string;
    attempts: number;
    maxRetries: number;
    heartbeatAt?: Date;
    workerId?: string;
    createdAt: Date;
    updatedAt: Date;
}

const IngestionJobSchema = new Schema<IIngestionJob>(
    {
        batchId: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        batch: {
            type: Schema.Types.ObjectId,
            ref: 'Batch',
            required: true,
            index: true
        },
        uploadedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        status: {
            type: String,
            enum: Object.values(IngestionStatus),
            default: IngestionStatus.QUEUED,
            required: true,
            index: true
        },
        totalPages: {
            type: Number,
            required: true,
            min: 0,
            default: 0
        },
        processedPages: {
            type: Number,
            required: true,
            min: 0,
            default: 0
        },
        failedPages: {
            type: Number,
            required: true,
            min: 0,
            default: 0
        },
        startedAt: {
            type: Date
        },
        completedAt: {
            type: Date
        },
        failureReason: {
            type: String,
            trim: true
        },
        attempts: {
            type: Number,
            required: true,
            min: 0,
            default: 0
        },
        maxRetries: {
            type: Number,
            required: true,
            min: 1,
            default: 3
        },
        heartbeatAt: {
            type: Date
        },
        workerId: {
            type: String,
            trim: true
        }
    },
    {
        timestamps: true
    }
);

IngestionJobSchema.index({ uploadedBy: 1, createdAt: -1 });

const IngestionJob: Model<IIngestionJob> = mongoose.models.IngestionJob || mongoose.model<IIngestionJob>('IngestionJob', IngestionJobSchema);

export default IngestionJob;
