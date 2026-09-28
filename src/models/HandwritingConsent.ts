import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Explicit retention policy for handwriting consistency samples and profiles.
 * Samples and profiles are retained for at most 365 days (1 academic year)
 * or until the student explicitly revokes consent.
 * Expired data is strictly excluded from active baseline calculations and comparisons.
 */
export const HANDWRITING_RETENTION_POLICY = {
    DEFAULT_RETENTION_DAYS: 365,
    POLICY_NAME: 'ACADEMIC_YEAR_365_DAYS',
    DESCRIPTION:
        'Handwriting samples and profile feature vectors are retained for up to 365 days from acquisition or until consent revocation. Expired data is excluded from all baseline calculations and comparison evidence.'
} as const;

export interface IHandwritingConsentDocument extends Document {
    student: mongoose.Types.ObjectId;
    hasConsented: boolean;
    consentedAt?: Date;
    revokedAt?: Date;
    retentionDays: number;
    retentionExpiresAt?: Date;
    consentVersion: string;
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
}

const HandwritingConsentSchema = new Schema<IHandwritingConsentDocument>(
    {
        student: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            unique: true,
            index: true
        },
        hasConsented: {
            type: Boolean,
            required: true,
            default: false,
            index: true
        },
        consentedAt: {
            type: Date
        },
        revokedAt: {
            type: Date
        },
        retentionDays: {
            type: Number,
            required: true,
            default: HANDWRITING_RETENTION_POLICY.DEFAULT_RETENTION_DAYS,
            min: 1,
            max: 730 // Max 2 academic years
        },
        retentionExpiresAt: {
            type: Date,
            index: true
        },
        consentVersion: {
            type: String,
            required: true,
            default: '1.0'
        },
        notes: {
            type: String
        }
    },
    {
        timestamps: true
    }
);

HandwritingConsentSchema.index({ student: 1, hasConsented: 1 });

export const HandwritingConsentModel: Model<IHandwritingConsentDocument> =
    mongoose.models.HandwritingConsent ||
    mongoose.model<IHandwritingConsentDocument>('HandwritingConsent', HandwritingConsentSchema);

export default HandwritingConsentModel;
