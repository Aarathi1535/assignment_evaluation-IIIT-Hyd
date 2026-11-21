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

/**
 * WORM Immutability Hooks:
 * Protect sealed original scan batches and their file records from deletion or modification.
 */
BatchSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], async function () {
    const options = this.getOptions();
    if (options && (options as Record<string, unknown>).bypassWorm) {
        return;
    }
    const filter = this.getFilter();
    // Allow teardown/clearing collection during automated test runs when empty filter is passed
    if (process.env.NODE_ENV === 'test' && (!filter || Object.keys(filter).length === 0)) {
        return;
    }
    const existingBatches = await (this.model as Model<IBatch>).find(filter);
    for (const batch of existingBatches) {
        if (batch.files && batch.files.some(f => Boolean(f.hmac))) {
            throw new Error(`Cannot delete batch "${batch.batchId}" containing sealed original files (WORM immutability enforcement)`);
        }
    }
});

BatchSchema.pre('deleteOne', { document: true, query: false }, function () {
    const doc = this as IBatch;
    if (doc.files && doc.files.some(f => Boolean(f.hmac))) {
        throw new Error(`Cannot delete batch "${doc.batchId}" containing sealed original files (WORM immutability enforcement)`);
    }
});

BatchSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], async function () {
    const filter = this.getFilter();
    const existingBatches = await (this.model as Model<IBatch>).find(filter);
    for (const batch of existingBatches) {
        const hasSealedFiles = batch.files && batch.files.some(f => Boolean(f.hmac));
        if (hasSealedFiles) {
            const update = this.getUpdate() as Record<string, unknown> | null;
            if (update) {
                const set = (update.$set || update) as Record<string, unknown>;
                const pull = update.$pull as Record<string, unknown> | undefined;
                const push = update.$push as Record<string, unknown> | undefined;
                if (set.files || pull?.files || push?.files) {
                    throw new Error(`Cannot modify sealed files in batch "${batch.batchId}" (WORM immutability enforcement)`);
                }
            }
        }
    }
});

const Batch: Model<IBatch> = mongoose.models.Batch || mongoose.model<IBatch>('Batch', BatchSchema);

export default Batch;
