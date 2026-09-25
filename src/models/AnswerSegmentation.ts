import mongoose, { Schema, Document, Model } from 'mongoose';

/**
 * Normalized 2D bounding box representing a region within a page.
 * All coordinates are normalized floats in the range [0.0, 1.0].
 * (0,0) is top-left, (1,1) is bottom-right.
 */
export interface IBoundingBox {
    x: number;      // 0.0 - 1.0
    y: number;      // 0.0 - 1.0
    width: number;  // 0.0 - 1.0
    height: number; // 0.0 - 1.0
}

export type SegmentType = 'START' | 'CONTINUATION' | 'ISOLATED' | 'UNCERTAIN';

export interface ICandidateAssociation {
    questionNumber: number;
    score: number; // 0.0 - 1.0 heuristic score
    rationale: string;
}

export interface IAnswerSegment {
    segmentId: string;
    pageNumber: number;
    pageId?: mongoose.Types.ObjectId | string;
    box?: IBoundingBox;
    segmentType: SegmentType;
    sequenceIndex: number; // 1 for start, 2 for continuation 1, etc.
    extractedText?: string;
    detectedHeader?: string; // e.g. "Q1", "Question 1", "Ans 1"
    subQuestion?: string; // e.g. "a", "b", "i"
    continuationMarker?: string; // e.g. "continued on page 7", "PTO"
    confidence: number; // Heuristic confidence score 0.0 - 1.0
    evidence: string[]; // e.g. ["EXPLICIT_HEADER:Q1", "EXPLICIT_CONTD_MARKER:page_7"]
    candidateAssociations?: ICandidateAssociation[];
}

export type ReconstructionStatus = 'AUTO_RECONSTRUCTED' | 'NEEDS_REVIEW' | 'VERIFIED';

export interface IReconstructedAnswer extends Document {
    answerScript: mongoose.Types.ObjectId;
    exam: mongoose.Types.ObjectId;
    questionNumber: number;
    subQuestion?: string;
    segments: IAnswerSegment[];
    totalSegments: number;
    pagesInvolved: number[];
    isNonConsecutive: boolean;
    isAmbiguous: boolean;
    ambiguityReason?: string;
    reconstructionConfidence: number; // Aggregate heuristic score 0.0 - 1.0
    status: ReconstructionStatus;
    reviewNotes?: string;
    verifiedBy?: mongoose.Types.ObjectId;
    verifiedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const BoundingBoxSchema = new Schema<IBoundingBox>(
    {
        x: { type: Number, required: true, min: 0, max: 1 },
        y: { type: Number, required: true, min: 0, max: 1 },
        width: { type: Number, required: true, min: 0, max: 1 },
        height: { type: Number, required: true, min: 0, max: 1 }
    },
    { _id: false }
);

const CandidateAssociationSchema = new Schema<ICandidateAssociation>(
    {
        questionNumber: { type: Number, required: true },
        score: { type: Number, required: true, min: 0, max: 1 },
        rationale: { type: String, required: true }
    },
    { _id: false }
);

const AnswerSegmentSchema = new Schema<IAnswerSegment>(
    {
        segmentId: { type: String, required: true },
        pageNumber: { type: Number, required: true, min: 1 },
        pageId: { type: Schema.Types.ObjectId, ref: 'IngestionPage', default: null },
        box: { type: BoundingBoxSchema, default: undefined },
        segmentType: {
            type: String,
            enum: ['START', 'CONTINUATION', 'ISOLATED', 'UNCERTAIN'],
            required: true
        },
        sequenceIndex: { type: Number, required: true, min: 1 },
        extractedText: { type: String, default: '' },
        detectedHeader: { type: String, default: null },
        subQuestion: { type: String, default: null },
        continuationMarker: { type: String, default: null },
        confidence: { type: Number, required: true, min: 0, max: 1 },
        evidence: { type: [String], default: [] },
        candidateAssociations: { type: [CandidateAssociationSchema], default: [] }
    },
    { _id: false }
);

const ReconstructedAnswerSchema = new Schema<IReconstructedAnswer>(
    {
        answerScript: {
            type: Schema.Types.ObjectId,
            ref: 'AnswerScript',
            required: true,
            index: true
        },
        exam: {
            type: Schema.Types.ObjectId,
            ref: 'Exam',
            required: true,
            index: true
        },
        questionNumber: {
            type: Number,
            required: true,
            min: 1,
            index: true
        },
        subQuestion: {
            type: String,
            default: null,
            trim: true
        },
        segments: {
            type: [AnswerSegmentSchema],
            default: []
        },
        totalSegments: {
            type: Number,
            required: true,
            default: 0
        },
        pagesInvolved: {
            type: [Number],
            default: []
        },
        isNonConsecutive: {
            type: Boolean,
            default: false,
            index: true
        },
        isAmbiguous: {
            type: Boolean,
            default: false,
            index: true
        },
        ambiguityReason: {
            type: String,
            default: null
        },
        reconstructionConfidence: {
            type: Number,
            required: true,
            min: 0,
            max: 1,
            default: 1.0
        },
        status: {
            type: String,
            enum: ['AUTO_RECONSTRUCTED', 'NEEDS_REVIEW', 'VERIFIED'],
            default: 'AUTO_RECONSTRUCTED',
            index: true
        },
        reviewNotes: {
            type: String,
            default: null
        },
        verifiedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        verifiedAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

ReconstructedAnswerSchema.index(
    { answerScript: 1, questionNumber: 1, subQuestion: 1 },
    { unique: true }
);

const ReconstructedAnswer: Model<IReconstructedAnswer> =
    mongoose.models.ReconstructedAnswer ||
    mongoose.model<IReconstructedAnswer>('ReconstructedAnswer', ReconstructedAnswerSchema);

export default ReconstructedAnswer;
