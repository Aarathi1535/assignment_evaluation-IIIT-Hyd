import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAnswerScript extends Document {
    exam: mongoose.Types.ObjectId;
    student?: mongoose.Types.ObjectId | null;
    filePath?: string;
    filename?: string;
    batchId?: string;
    fileIndex?: number;
    startPageNumber?: number;
    endPageNumber?: number;
    pageCount?: number;
    candidateStudentId?: string | null;
    decodeOutcome?: string | null;
    needsManualId?: boolean;
    manualIdReason?: string | null;
    metadata?: Record<string, unknown>;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const AnswerScriptSchema = new Schema<IAnswerScript>(
    {
        exam: {
            type: Schema.Types.ObjectId,
            ref: 'Exam',
            required: true,
            index: true
        },
        student: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true
        },
        filePath: {
            type: String,
            trim: true,
            default: ''
        },
        filename: {
            type: String,
            trim: true,
            default: ''
        },
        batchId: {
            type: String,
            trim: true,
            index: true
        },
        fileIndex: {
            type: Number,
            min: 0
        },
        startPageNumber: {
            type: Number,
            min: 1
        },
        endPageNumber: {
            type: Number,
            min: 1
        },
        pageCount: {
            type: Number,
            min: 1
        },
        candidateStudentId: {
            type: String,
            trim: true,
            default: null
        },
        decodeOutcome: {
            type: String,
            default: null
        },
        needsManualId: {
            type: Boolean,
            default: false
        },
        manualIdReason: {
            type: String,
            default: null
        },
        metadata: {
            type: Schema.Types.Mixed
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

// Compound unique index on (exam, student) enforced only when student is present
AnswerScriptSchema.index(
    { exam: 1, student: 1 },
    { unique: true, partialFilterExpression: { student: { $type: 'objectId' } } }
);

// Deterministic source identity index: (batchId, fileIndex, startPageNumber)
AnswerScriptSchema.index(
    { batchId: 1, fileIndex: 1, startPageNumber: 1 },
    { unique: true, partialFilterExpression: { batchId: { $type: 'string' } } }
);

const AnswerScript: Model<IAnswerScript> =
    mongoose.models.AnswerScript || mongoose.model<IAnswerScript>('AnswerScript', AnswerScriptSchema);

export default AnswerScript;
