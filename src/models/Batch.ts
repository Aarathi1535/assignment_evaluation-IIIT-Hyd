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
 * Covers: deleteOne, deleteMany, findOneAndDelete, updateOne, updateMany,
 * findOneAndUpdate, replaceOne, findOneAndReplace, bulkWrite, save,
 * $unset, $pop, $pull, $push, and dotted-path updates on files.
 */
BatchSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], async function () {
    const options = this.getOptions();
    if (options && (options as Record<string, unknown>).bypassWorm) {
        return;
    }
    const filter = this.getFilter();
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

BatchSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'], async function () {
    const options = this.getOptions();
    if (options && (options as Record<string, unknown>).bypassWorm) {
        return;
    }
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
                const pop = update.$pop as Record<string, unknown> | undefined;
                const unset = update.$unset as Record<string, unknown> | undefined;

                if (pull?.files || push?.files || pop?.files || unset?.files) {
                    throw new Error(`Cannot modify sealed files in batch "${batch.batchId}" (WORM immutability enforcement)`);
                }

                // Check $unset, $pop, $pull for any dotted path touching files
                const mutatingOps = [unset, pop, pull];
                for (const op of mutatingOps) {
                    if (op) {
                        for (const key of Object.keys(op)) {
                            if (key === 'files' || key.startsWith('files.') || key.startsWith('files[')) {
                                throw new Error(`Cannot modify sealed files in batch "${batch.batchId}" (WORM immutability enforcement)`);
                            }
                        }
                    }
                }

                // Check dotted paths in set / root update (e.g. files.0.storageKey)
                for (const key of Object.keys(set)) {
                    if (key.startsWith('files.') || key.startsWith('files[')) {
                        throw new Error(`Cannot modify sealed files in batch "${batch.batchId}" (WORM immutability enforcement)`);
                    }
                }

                if (set.files && Array.isArray(set.files)) {
                    const existingSealed = (batch.files || []).filter(f => Boolean(f.hmac));
                    for (const sf of existingSealed) {
                        const matching = (set.files as IBatchFile[]).find(f => f.fileId === sf.fileId);
                        if (!matching || matching.storageKey !== sf.storageKey || matching.hmac !== sf.hmac) {
                            throw new Error(`Cannot modify sealed files in batch "${batch.batchId}" (WORM immutability enforcement)`);
                        }
                    }
                }
            }
        }
    }
});

BatchSchema.pre('save', async function () {
    if (!this.isNew) {
        const existing = await (this.constructor as Model<IBatch>).findById(this._id);
        if (existing && existing.files && existing.files.some(f => Boolean(f.hmac))) {
            if (this.isModified('files')) {
                const existingSealed = existing.files.filter(f => Boolean(f.hmac));
                for (const sf of existingSealed) {
                    const matching = (this.files || []).find(f => f.fileId === sf.fileId);
                    if (!matching || matching.storageKey !== sf.storageKey || matching.hmac !== sf.hmac) {
                        throw new Error(`Cannot modify sealed files in batch "${this.batchId}" (WORM immutability enforcement)`);
                    }
                }
            }
        }
    }
});

(BatchSchema as unknown as { pre: (event: string, fn: unknown) => void }).pre('bulkWrite', async function (this: unknown, ops: Array<Record<string, Record<string, unknown>>>) {
    if (!Array.isArray(ops)) return;
    const model = this as Model<IBatch>;
    for (const op of ops) {
        if (op.deleteOne || op.deleteMany) {
            const filter = (op.deleteOne || op.deleteMany).filter as mongoose.QueryFilter<IBatch>;
            const existingBatches = await model.find(filter);
            for (const batch of existingBatches) {
                if (batch.files && batch.files.some((f: IBatchFile) => Boolean(f.hmac))) {
                    throw new Error(`Cannot delete batch "${batch.batchId}" containing sealed original files (WORM immutability enforcement)`);
                }
            }
        }
        if (op.updateOne || op.updateMany || op.replaceOne) {
            const action = op.updateOne || op.updateMany || op.replaceOne;
            const filter = action.filter as mongoose.QueryFilter<IBatch>;
            const update = (action.update || action.replacement) as Record<string, unknown> | null;
            const existingBatches = await model.find(filter);
            for (const batch of existingBatches) {
                const hasSealedFiles = batch.files && batch.files.some((f: IBatchFile) => Boolean(f.hmac));
                if (hasSealedFiles && update) {
                    const set = (update.$set || update) as Record<string, unknown>;
                    const pull = update.$pull as Record<string, unknown> | undefined;
                    const push = update.$push as Record<string, unknown> | undefined;
                    const pop = update.$pop as Record<string, unknown> | undefined;
                    const unset = update.$unset as Record<string, unknown> | undefined;
                    if (pull?.files || push?.files || pop?.files || unset?.files) {
                        throw new Error(`Cannot modify sealed files in batch "${batch.batchId}" (WORM immutability enforcement)`);
                    }
                    const mutatingOps = [unset, pop, pull];
                    for (const o of mutatingOps) {
                        if (o) {
                            for (const key of Object.keys(o)) {
                                if (key === 'files' || key.startsWith('files.') || key.startsWith('files[')) {
                                    throw new Error(`Cannot modify sealed files in batch "${batch.batchId}" (WORM immutability enforcement)`);
                                }
                            }
                        }
                    }
                    for (const key of Object.keys(set)) {
                        if (key.startsWith('files.') || key.startsWith('files[')) {
                            throw new Error(`Cannot modify sealed files in batch "${batch.batchId}" (WORM immutability enforcement)`);
                        }
                    }
                    if (set.files && Array.isArray(set.files)) {
                        const existingSealed = (batch.files || []).filter((f: IBatchFile) => Boolean(f.hmac));
                        for (const sf of existingSealed) {
                            const matching = (set.files as IBatchFile[]).find(f => f.fileId === sf.fileId);
                            if (!matching || matching.storageKey !== sf.storageKey || matching.hmac !== sf.hmac) {
                                throw new Error(`Cannot modify sealed files in batch "${batch.batchId}" (WORM immutability enforcement)`);
                            }
                        }
                    }
                }
            }
        }
    }
});

const Batch: Model<IBatch> = mongoose.models.Batch || mongoose.model<IBatch>('Batch', BatchSchema);

export default Batch;
