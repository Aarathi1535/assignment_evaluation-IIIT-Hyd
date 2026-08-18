import mongoose, { Schema, Document, Model } from 'mongoose';

export enum PageProcessingStatus {
    PENDING = 'pending',
    PROCESSED = 'processed',
    FAILED = 'failed'
}

export type DecodeOutcome = 'found' | 'not_found' | 'multiple';

export interface IIngestionPage extends Document {
    batchId: string;
    job: mongoose.Types.ObjectId;
    fileId: string;
    fileIndex: number;
    storageKey: string;
    thumbnailKey?: string | null;
    width?: number;
    height?: number;
    pageNumber: number;
    status: PageProcessingStatus;
    processedAt?: Date;
    failureReason?: string;
    metadata?: Record<string, unknown>;
    isCoverPage?: boolean;
    candidateStudentId?: string | null;
    decodeOutcome?: DecodeOutcome | null;
    answerScript?: mongoose.Types.ObjectId | null;
    nearBlank?: boolean;
    isDuplicate?: boolean;
    duplicateOf?: mongoose.Types.ObjectId | null;
    perceptualHash?: string | null;
    enhancementParams?: Record<string, number> | null;
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
        fileIndex: {
            type: Number,
            required: true,
            min: 0
        },
        storageKey: {
            type: String,
            required: true,
            trim: true
        },
        thumbnailKey: {
            type: String,
            default: null,
            trim: true
        },
        width: {
            type: Number,
            min: 1
        },
        height: {
            type: Number,
            min: 1
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
        isCoverPage: {
            type: Boolean,
            default: false,
            index: true
        },
        candidateStudentId: {
            type: String,
            trim: true,
            default: null,
            index: true
        },
        decodeOutcome: {
            type: String,
            enum: ['found', 'not_found', 'multiple', null],
            default: null
        },
        answerScript: {
            type: Schema.Types.ObjectId,
            ref: 'AnswerScript',
            default: null,
            index: true
        },
        nearBlank: {
            type: Boolean,
            default: false,
            index: true
        },
        isDuplicate: {
            type: Boolean,
            default: false,
            index: true
        },
        duplicateOf: {
            type: Schema.Types.ObjectId,
            ref: 'IngestionPage',
            default: null,
            index: true
        },
        perceptualHash: {
            type: String,
            default: null
        },
        enhancementParams: {
            type: Schema.Types.Mixed,
            default: null
        },
        metadata: {
            type: Schema.Types.Mixed
        }
    },
    {
        timestamps: true
    }
);

// Enforce deterministic uniqueness per (batchId, fileIndex, pageNumber)
IngestionPageSchema.index({ batchId: 1, fileIndex: 1, pageNumber: 1 }, { unique: true });

const IngestionPage: Model<IIngestionPage> =
    mongoose.models.IngestionPage || mongoose.model<IIngestionPage>('IngestionPage', IngestionPageSchema);

export default IngestionPage;
