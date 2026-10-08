import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IClassroomCriterionScore {
    criterionName: string;
    marksAwarded: number;
    maxMarks: number;
    feedback?: string;
    evidence?: string;
}

export type ClassroomSubmissionStatus = 'SUBMITTED' | 'EVALUATING' | 'EVALUATED' | 'FAILED';

export interface IClassroomSubmission extends Document {
    question: mongoose.Types.ObjectId;
    student: mongoose.Types.ObjectId;
    selectedOption?: number | null;
    textResponse?: string | null;
    isCorrect?: boolean | null;
    score: number;
    maxMarks: number;
    status: ClassroomSubmissionStatus;
    feedback?: string;
    imagePath?: string;
    originalFilename?: string;
    fileSize?: number;
    mimeType?: string;
    criterionScores?: IClassroomCriterionScore[];
    confidence?: number;
    submittedAt: Date;
    evaluatedAt?: Date;
    errorMessage?: string;
    createdAt: Date;
    updatedAt: Date;
}

const ClassroomCriterionScoreSchema = new Schema<IClassroomCriterionScore>(
    {
        criterionName: {
            type: String,
            required: true,
            trim: true
        },
        marksAwarded: {
            type: Number,
            required: true,
            min: 0
        },
        maxMarks: {
            type: Number,
            required: true,
            min: 0
        },
        feedback: {
            type: String,
            trim: true
        },
        evidence: {
            type: String,
            trim: true
        }
    },
    { _id: false }
);

const ClassroomSubmissionSchema = new Schema<IClassroomSubmission>(
    {
        question: {
            type: Schema.Types.ObjectId,
            ref: 'ClassroomQuestion',
            required: true,
            index: true
        },
        student: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        selectedOption: {
            type: Number,
            default: null
        },
        textResponse: {
            type: String,
            trim: true,
            default: null
        },
        isCorrect: {
            type: Boolean,
            default: null
        },
        score: {
            type: Number,
            default: 0,
            min: 0
        },
        maxMarks: {
            type: Number,
            default: 1,
            min: 0
        },
        status: {
            type: String,
            enum: ['SUBMITTED', 'EVALUATING', 'EVALUATED', 'FAILED'],
            default: 'SUBMITTED',
            index: true
        },
        feedback: {
            type: String,
            default: '',
            trim: true
        },
        imagePath: {
            type: String,
            trim: true,
            default: null
        },
        originalFilename: {
            type: String,
            default: null
        },
        fileSize: {
            type: Number,
            default: null
        },
        mimeType: {
            type: String,
            default: null
        },
        criterionScores: {
            type: [ClassroomCriterionScoreSchema],
            default: []
        },
        confidence: {
            type: Number,
            min: 0,
            max: 1,
            default: null
        },
        submittedAt: {
            type: Date,
            default: Date.now
        },
        evaluatedAt: {
            type: Date,
            default: null
        },
        errorMessage: {
            type: String,
            default: null
        }
    },
    {
        timestamps: true
    }
);

// Compound index to quickly query or prevent accidental duplicate submissions per student per question
ClassroomSubmissionSchema.index({ question: 1, student: 1 }, { unique: true });

const ClassroomSubmission: Model<IClassroomSubmission> =
    mongoose.models.ClassroomSubmission ||
    mongoose.model<IClassroomSubmission>('ClassroomSubmission', ClassroomSubmissionSchema);

export default ClassroomSubmission;
