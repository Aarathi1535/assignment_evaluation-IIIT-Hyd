import mongoose, { Schema, Document, Model } from 'mongoose';

export enum PageProcessingStatus {
    PENDING = 'pending',
    PROCESSED = 'processed',
    FAILED = 'failed'
}

export interface IIngestionPage extends Document {
    batchId: string;
    job: mongoose.Types.ObjectId;
    fileId: string;
    storageKey: string;
    pageNumber: number;
    status: PageProcessingStatus;
    processedAt?: Date;
    failureReason?: string;
    metadata?: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

const IngestionPageSchema = new Schema<IIngestionPage>(
    {
        batchId: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        job: {
            type: Schema.Types.ObjectId,
            ref: 'IngestionJob',
            required: true,
            index: true
        },
        fileId: {
            type: String,
            required: true,
            trim: true
        },
        storageKey: {
            type: String,
            required: true,
            trim: true
        },
        pageNumber: {
            type: Number,
            required: true,
            min: 1
        },
        status: {
            type: String,
            enum: Object.values(PageProcessingStatus),
            default: PageProcessingStatus.PENDING,
            required: true,
            index: true
        },
        processedAt: {
            type: Date
        },
        failureReason: {
            type: String,
            trim: true
        },
        metadata: {
            type: Schema.Types.Mixed
        }
    },
    {
        timestamps: true
    }
);

// Enforce deterministic uniqueness per (batchId, fileId, pageNumber)
IngestionPageSchema.index({ batchId: 1, fileId: 1, pageNumber: 1 }, { unique: true });

const IngestionPage: Model<IIngestionPage> =
    mongoose.models.IngestionPage || mongoose.model<IIngestionPage>('IngestionPage', IngestionPageSchema);

export default IngestionPage;
