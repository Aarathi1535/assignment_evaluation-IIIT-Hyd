import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Normalized 2D Bounding Box (0.0 to 1.0)
 */
export interface IBoundingBox {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Quality metrics and validity flags for an extracted handwriting region
 */
export interface ISampleQuality {
    contrast: number;             // Luminance variance between ink and background (0.0 to 1.0)
    sharpnessScore: number;       // Gradient energy / edge prominence
    noiseRatio: number;           // High-frequency isolated pixel noise estimate
    strokeCount: number;          // Total connected stroke components detected
    isSufficient: boolean;        // True if sample has sufficient stroke density for analysis
    isBlank: boolean;             // True if page/region has virtually zero ink
    isDiagramHeavy: boolean;      // True if region contains large geometric fills or line drawings
}

/**
 * Deterministic handwriting-specific document analysis features.
 * Note: Stroke width is measured as a geometric stroke-thickness metric;
 * it is an observational proxy for physical pen pressure, NOT a direct transducer measurement.
 */
export interface IHandwritingFeatures {
    /** Ratio of black ink pixels to total analyzed pixels (0.0 to 1.0) */
    inkDensity: number;

    /** Horizontal projection profile statistics (reflects text line structure) */
    horizontalProjection: {
        mean: number;
        variance: number;
        peakCount: number;        // Number of detected text line baselines
    };

    /** Vertical projection profile statistics (reflects character and column grouping) */
    verticalProjection: {
        mean: number;
        variance: number;
    };

    /** Estimated average distance in pixels between detected text baselines */
    estimatedLineSpacing: number;

    /**
     * Stroke width distribution (thickness in pixels).
     * Serves as an observational proxy for pen nib geometry and writing weight.
     */
    strokeWidthProxy: {
        mean: number;
        variance: number;
        median: number;
    };

    /** Estimated dominant stroke slant in degrees (-45° left to +45° right, 0° = vertical) */
    slantAngle: number;

    /** Connected ink component statistics */
    connectedComponents: {
        count: number;
        meanArea: number;
        meanAspectRatio: number;  // Width / Height ratio of individual stroke clusters
    };

    /** Region dimensions normalized to page */
    normalizedDimensions: {
        width: number;
        height: number;
    };

    /** Detailed sample quality and rejection indicators */
    quality: ISampleQuality;

    /**
     * Normalized 8-element numerical feature vector for downstream distance calculations.
     * [inkDensity, hVariance, vVariance, lineSpacingNorm, strokeWidthMean, strokeWidthVar, slantNorm, ccAspectMean]
     */
    rawVector: number[];
}

export enum SampleExtractionStatus {
    VALID = 'VALID',
    INSUFFICIENT_SAMPLE = 'INSUFFICIENT_SAMPLE',
    BLANK = 'BLANK',
    DIAGRAM_REJECTED = 'DIAGRAM_REJECTED',
    ERROR = 'ERROR'
}

export interface IHandwritingSample extends Document {
    sampleId: string;
    answerScript: mongoose.Types.ObjectId;
    student: mongoose.Types.ObjectId;
    pageNumber: number;
    boundingBox?: IBoundingBox;
    status: SampleExtractionStatus;
    features?: IHandwritingFeatures;
    disqualificationReason?: string;
    extractedAt: Date;
}

export enum ProfileStatus {
    PROVISIONAL = 'PROVISIONAL',   // 1 or 2 samples (baseline not yet fully mature)
    ESTABLISHED = 'ESTABLISHED',   // >= 3 samples with calculated intra-student variance
    STALE = 'STALE'                // Profile requires refresh
}

export interface IHandwritingProfile extends Document {
    student: mongoose.Types.ObjectId;
    sampleCount: number;
    featureMeans: number[];        // Mean values for each feature in rawVector
    featureStdDevs: number[];     // Intra-student standard deviations (natural variance)
    status: ProfileStatus;
    samplesUsed: mongoose.Types.ObjectId[];
    updatedAt: Date;
    createdAt: Date;
}

export enum ComparisonMatchState {
    MATCH = 'MATCH',
    REVIEW_REQUIRED = 'REVIEW_REQUIRED',
    INSUFFICIENT_SAMPLE = 'INSUFFICIENT_SAMPLE',
    INCONCLUSIVE = 'INCONCLUSIVE',
    UNASSESSED = 'UNASSESSED'
}

export interface IHandwritingComparison extends Document {
    answerScript: mongoose.Types.ObjectId;
    student: mongoose.Types.ObjectId;
    sample: mongoose.Types.ObjectId;
    profile?: mongoose.Types.ObjectId;
    matchState: ComparisonMatchState;
    distanceScore: number;         // Normalized distance from profile (0.0 to 1.0+)
    confidence: number;            // Heuristic confidence score (0.0 to 1.0)
    anomalyFactors: string[];      // Explanatory breakdown of deviating features
    reviewStatus: 'PENDING_REVIEW' | 'VERIFIED_AUTHENTIC' | 'FLAGGED_MISMATCH';
    reviewedBy?: mongoose.Types.ObjectId;
    reviewedAt?: Date;
    reviewNotes?: string;
    createdAt: Date;
}

// -----------------------------------------------------------------------------
// Mongoose Schemas
// -----------------------------------------------------------------------------

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

const HandwritingFeaturesSchema = new Schema<IHandwritingFeatures>({
    inkDensity: { type: Number, required: true },
    horizontalProjection: {
        mean: { type: Number, required: true },
        variance: { type: Number, required: true },
        peakCount: { type: Number, required: true }
    },
    verticalProjection: {
        mean: { type: Number, required: true },
        variance: { type: Number, required: true }
    },
    estimatedLineSpacing: { type: Number, required: true },
    strokeWidthProxy: {
        mean: { type: Number, required: true },
        variance: { type: Number, required: true },
        median: { type: Number, required: true }
    },
    slantAngle: { type: Number, required: true },
    connectedComponents: {
        count: { type: Number, required: true },
        meanArea: { type: Number, required: true },
        meanAspectRatio: { type: Number, required: true }
    },
    normalizedDimensions: {
        width: { type: Number, required: true },
        height: { type: Number, required: true }
    },
    quality: { type: SampleQualitySchema, required: true },
    rawVector: { type: [Number], required: true }
}, { _id: false });

const HandwritingSampleSchema = new Schema<IHandwritingSample>({
    sampleId: { type: String, required: true, unique: true, index: true },
    answerScript: { type: Schema.Types.ObjectId, ref: 'AnswerScript', required: true, index: true },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    pageNumber: { type: Number, required: true },
    boundingBox: { type: BoundingBoxSchema },
    status: { type: String, enum: Object.values(SampleExtractionStatus), required: true },
    features: { type: HandwritingFeaturesSchema },
    disqualificationReason: { type: String },
    extractedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const HandwritingProfileSchema = new Schema<IHandwritingProfile>({
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    sampleCount: { type: Number, default: 0 },
    featureMeans: { type: [Number], default: [] },
    featureStdDevs: { type: [Number], default: [] },
    status: { type: String, enum: Object.values(ProfileStatus), default: ProfileStatus.PROVISIONAL },
    samplesUsed: [{ type: Schema.Types.ObjectId, ref: 'HandwritingSample' }]
}, { timestamps: true });

const HandwritingComparisonSchema = new Schema<IHandwritingComparison>({
    answerScript: { type: Schema.Types.ObjectId, ref: 'AnswerScript', required: true, index: true },
    student: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    sample: { type: Schema.Types.ObjectId, ref: 'HandwritingSample', required: true },
    profile: { type: Schema.Types.ObjectId, ref: 'HandwritingProfile' },
    matchState: { type: String, enum: Object.values(ComparisonMatchState), required: true },
    distanceScore: { type: Number, required: true },
    confidence: { type: Number, required: true },
    anomalyFactors: { type: [String], default: [] },
    reviewStatus: { type: String, enum: ['PENDING_REVIEW', 'VERIFIED_AUTHENTIC', 'FLAGGED_MISMATCH'], default: 'PENDING_REVIEW' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    reviewNotes: { type: String }
}, { timestamps: true });

export const HandwritingSample: Model<IHandwritingSample> =
    mongoose.models.HandwritingSample || mongoose.model<IHandwritingSample>('HandwritingSample', HandwritingSampleSchema);

export const HandwritingProfile: Model<IHandwritingProfile> =
    mongoose.models.HandwritingProfile || mongoose.model<IHandwritingProfile>('HandwritingProfile', HandwritingProfileSchema);

export const HandwritingComparison: Model<IHandwritingComparison> =
    mongoose.models.HandwritingComparison || mongoose.model<IHandwritingComparison>('HandwritingComparison', HandwritingComparisonSchema);
