import mongoose, { Schema, Document, Model } from 'mongoose';
import { ProfileStatus } from './HandwritingConsistency';

export interface IHandwritingProfileDocument extends Document {
    student: mongoose.Types.ObjectId;
    sampleCount: number;
    samplesUsed: mongoose.Types.ObjectId[];
    featureMeans: number[];
    featureStdDevs: number[];
    status: ProfileStatus;
    profileVersion: number;
    extractionVersion: string;
    isCurrent: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const HandwritingProfileSchema = new Schema<IHandwritingProfileDocument>(
    {
        student: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        sampleCount: {
            type: Number,
            required: true,
            default: 0,
            min: 0
        },
        samplesUsed: [
            {
                type: Schema.Types.ObjectId,
                ref: 'HandwritingSamplePersistence'
            }
        ],
        featureMeans: {
            type: [Number],
            required: true,
            validate: {
                validator: (v: number[]) => v && v.length === 8 && v.every(n => Number.isFinite(n)),
                message: 'featureMeans must contain exactly 8 finite numeric values'
            }
        },
        featureStdDevs: {
            type: [Number],
            required: true,
            validate: {
                validator: (v: number[]) => v && v.length === 8 && v.every(n => Number.isFinite(n) && n >= 0),
                message: 'featureStdDevs must contain exactly 8 finite non-negative numeric values'
            }
        },
        status: {
            type: String,
            enum: Object.values(ProfileStatus),
            required: true,
            default: ProfileStatus.PROVISIONAL,
            index: true
        },
        profileVersion: {
            type: Number,
            required: true,
            default: 1,
            min: 1
        },
        extractionVersion: {
            type: String,
            required: true,
            default: '1.0.0'
        },
        isCurrent: {
            type: Boolean,
            required: true,
            default: true,
            index: true
        }
    },
    {
        timestamps: true
    }
);

// Explicit unique versioning per student
HandwritingProfileSchema.index({ student: 1, profileVersion: 1 }, { unique: true });
HandwritingProfileSchema.index({ student: 1, isCurrent: 1 });
HandwritingProfileSchema.index({ student: 1, profileVersion: -1 });

export const HandwritingProfileModel: Model<IHandwritingProfileDocument> =
    mongoose.models.HandwritingProfilePersistence ||
    mongoose.model<IHandwritingProfileDocument>('HandwritingProfilePersistence', HandwritingProfileSchema);

export default HandwritingProfileModel;
