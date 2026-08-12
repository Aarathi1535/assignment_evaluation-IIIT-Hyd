import mongoose, { Schema, Document, Model } from 'mongoose';

export enum BatchStatus {
    QUEUED = 'queued',
    PROCESSING = 'processing',
    DONE = 'done',
    FAILED = 'failed'
}

export interface IBindingMetadata {
    batchId: string;
    sequenceNumber: number;
    uploader: string;
    timestamp: number;
}

export interface IBatchFile {
    fileId: string;
    fileIndex: number;
    originalFilename: string;
    fileType: string;
    mimeType: string;
    size: number;
    pageCount: number;
    storageKey: string;
    hmac?: string;
    keyId?: string;
    sequenceNumber?: number;
    integrityMetadata?: IBindingMetadata;
}

export interface IBatch extends Document {
    batchId: string;
    uploadedBy: mongoose.Types.ObjectId;
    exam?: mongoose.Types.ObjectId;
    files: IBatchFile[];
    totalFiles: number;
    totalSize: number;
    totalPageCount: number;
    status: BatchStatus;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const BindingMetadataSchema = new Schema<IBindingMetadata>(
    {
        batchId: {
            type: String,
            required: true,
            trim: true
        },
        sequenceNumber: {
            type: Number,
            required: true,
            min: 1
        },
        uploader: {
            type: String,
            required: true,
            trim: true
        },
        timestamp: {
            type: Number,
            required: true
        }
    },
    { _id: false }
);

const BatchFileSchema = new Schema<IBatchFile>(
    {
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
        originalFilename: {
            type: String,
            required: true,
            trim: true
        },
        fileType: {
            type: String,
            required: true,
            trim: true
        },
        mimeType: {
            type: String,
            required: true,
            trim: true
        },
        size: {
            type: Number,
            required: true,
            min: 0
        },
        pageCount: {
            type: Number,
            required: true,
            min: 1
        },
        storageKey: {
            type: String,
            required: true,
            trim: true
        },
        hmac: {
            type: String,
            trim: true
        },
        keyId: {
            type: String,
            trim: true
        },
        sequenceNumber: {
            type: Number,
            min: 1
        },
        integrityMetadata: {
            type: BindingMetadataSchema
        }
    },
    { _id: false }
);

const BatchSchema = new Schema<IBatch>(
    {
        batchId: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            index: true
        },
        uploadedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        exam: {
            type: Schema.Types.ObjectId,
            ref: 'Exam',
            index: true
        },
        files: {
            type: [BatchFileSchema],
            default: []
        },
        totalFiles: {
            type: Number,
            required: true,
            default: 0
        },
        totalSize: {
            type: Number,
            required: true,
            default: 0
        },
        totalPageCount: {
            type: Number,
            required: true,
            default: 0
        },
        status: {
            type: String,
            enum: Object.values(BatchStatus),
            default: BatchStatus.QUEUED,
            required: true,
            index: true
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

BatchSchema.index({ uploadedBy: 1, createdAt: -1 });

const Batch: Model<IBatch> = mongoose.models.Batch || mongoose.model<IBatch>('Batch', BatchSchema);

export default Batch;
