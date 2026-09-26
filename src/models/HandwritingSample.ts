import mongoose, { Schema, Document, Model } from 'mongoose';
import {
    IBoundingBox,
    IHandwritingFeatures,
    ISampleQuality,
    SampleExtractionStatus
} from './HandwritingConsistency';

export type HandwritingSampleType = 'EXAM_SCRIPT' | 'HOMEWORK' | 'BASELINE_UPLOAD' | 'GENERAL_SUBMISSION';

export interface IHandwritingSampleDocument extends Document {
    student: mongoose.Types.ObjectId;
    sourceReference?: string;
    sampleType: HandwritingSampleType;
    answerScriptId?: mongoose.Types.ObjectId;
    pageNumber?: number;
    boundingBox?: IBoundingBox;
    status: SampleExtractionStatus;
    isUsable: boolean;
    disqualificationReason?: string;
    rawVector?: number[];
    features?: IHandwritingFeatures;
    quality?: ISampleQuality;
    extractionVersion: string;
    createdAt: Date;
    updatedAt: Date;
}

const BoundingBoxSchema = new Schema<IBoundingBox>({
    x: { type: Number, required: true, min: 0, max: 1 },
    y: { type: Number, required: true, min: 0, max: 1 },
    width: { type: Number, required: true, min: 0, max: 1 },
    height: { type: Number, required: true, min: 0, max: 1 }
}, { _id: false });

const SampleQualitySchema = new Schema<ISampleQuality>({
    contrast: { type: Number, required: true },
    sharpnessScore: { type: Number, required: true },
    noiseRatio: { type: Number, required: true },
    strokeCount: { type: Number, required: true },
    isSufficient: { type: Boolean, required: true },
    isBlank: { type: Boolean, required: true },
    isDiagramHeavy: { type: Boolean, required: true }
}, { _id: false });

const HandwritingSampleSchema = new Schema<IHandwritingSampleDocument>(
    {
        student: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        sourceReference: {
            type: String,
            trim: true
        },
        sampleType: {
            type: String,
            enum: ['EXAM_SCRIPT', 'HOMEWORK', 'BASELINE_UPLOAD', 'GENERAL_SUBMISSION'],
            default: 'EXAM_SCRIPT'
        },
        answerScriptId: {
            type: Schema.Types.ObjectId,
            ref: 'AnswerScript'
        },
        pageNumber: {
            type: Number,
            min: 1
        },
        boundingBox: {
            type: BoundingBoxSchema
        },
        status: {
            type: String,
            enum: Object.values(SampleExtractionStatus),
            required: true,
            index: true
        },
        isUsable: {
            type: Boolean,
            required: true,
            default: false,
            index: true
        },
        disqualificationReason: {
            type: String
        },
        rawVector: {
            type: [Number],
            default: undefined,
            validate: {
                validator: (v: number[] | undefined | null) => !v || v.length === 0 || (v.length === 8 && v.every(n => Number.isFinite(n) && n >= 0 && n <= 1)),
                message: 'rawVector must contain exactly 8 finite numbers bounded in [0, 1]'
            }
        },
        features: {
            type: Schema.Types.Mixed
        },
        quality: {
            type: SampleQualitySchema
        },
        extractionVersion: {
            type: String,
            required: true,
            default: '1.0.0'
        }
    },
    {
        timestamps: true
    }
);

// Compound indexes
HandwritingSampleSchema.index(
    { student: 1, sourceReference: 1 },
    { unique: true, sparse: true }
);
HandwritingSampleSchema.index({ student: 1, isUsable: 1, createdAt: 1 });

export const HandwritingSampleModel: Model<IHandwritingSampleDocument> =
    mongoose.models.HandwritingSamplePersistence ||
    mongoose.model<IHandwritingSampleDocument>('HandwritingSamplePersistence', HandwritingSampleSchema);

export default HandwritingSampleModel;
