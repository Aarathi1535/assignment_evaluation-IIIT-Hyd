import mongoose, { Schema, Document, Model } from 'mongoose';
import {
    ComparisonMatchState,
    IFeatureDeviation,
    ISampleQuality
} from './HandwritingConsistency';

export interface IHandwritingComparisonDocument extends Document {
    student: mongoose.Types.ObjectId;
    profile?: mongoose.Types.ObjectId;
    profileVersion?: number;
    sample: mongoose.Types.ObjectId;
    status: ComparisonMatchState;
    distance: number;
    confidence: number;
    featureDeviations: IFeatureDeviation[];
    anomalyFactors: string[];
    sampleQuality?: ISampleQuality;
    comparedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const FeatureDeviationSchema = new Schema<IFeatureDeviation>(
    {
        feature: { type: String, required: true },
        baselineMean: { type: Number, required: true },
        baselineStdDev: { type: Number, required: true },
        observed: { type: Number, required: true },
        normalizedDeviation: { type: Number, required: true },
        contribution: { type: Number, required: true }
    },
    { _id: false }
);

const SampleQualitySchema = new Schema<ISampleQuality>(
    {
        contrast: { type: Number, required: true },
        sharpnessScore: { type: Number, required: true },
        noiseRatio: { type: Number, required: true },
        strokeCount: { type: Number, required: true },
        isSufficient: { type: Boolean, required: true },
        isBlank: { type: Boolean, required: true },
        isDiagramHeavy: { type: Boolean, required: true }
    },
    { _id: false }
);

const HandwritingComparisonSchema = new Schema<IHandwritingComparisonDocument>(
    {
        student: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        profile: {
            type: Schema.Types.ObjectId,
            ref: 'HandwritingProfilePersistence',
            index: true
        },
        profileVersion: {
            type: Number
        },
        sample: {
            type: Schema.Types.ObjectId,
            ref: 'HandwritingSamplePersistence',
            required: true,
            index: true
        },
        status: {
            type: String,
            enum: Object.values(ComparisonMatchState),
            required: true,
            index: true
        },
        distance: {
            type: Number,
            required: true,
            validate: {
                validator: (v: number) => Number.isFinite(v) && v >= 0,
                message: 'distance must be a non-negative finite number'
            }
        },
        confidence: {
            type: Number,
            required: true,
            validate: {
                validator: (v: number) => Number.isFinite(v) && v >= 0 && v <= 1,
                message: 'confidence must be a finite number between 0.0 and 1.0'
            }
        },
        featureDeviations: {
            type: [FeatureDeviationSchema],
            default: []
        },
        anomalyFactors: {
            type: [String],
            default: []
        },
        sampleQuality: {
            type: SampleQualitySchema
        },
        comparedAt: {
            type: Date,
            required: true,
            default: Date.now,
            index: true
        }
    },
    {
        timestamps: true
    }
);

// Student-scoped indexes for auditability and query isolation
HandwritingComparisonSchema.index({ student: 1, comparedAt: -1 });
HandwritingComparisonSchema.index({ student: 1, status: 1 });

export const HandwritingComparisonModel: Model<IHandwritingComparisonDocument> =
    mongoose.models.HandwritingComparisonPersistence ||
    mongoose.model<IHandwritingComparisonDocument>('HandwritingComparisonPersistence', HandwritingComparisonSchema);

export default HandwritingComparisonModel;
