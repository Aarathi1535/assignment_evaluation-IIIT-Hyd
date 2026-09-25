import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IClassroomCriterionScore {
    criterionName: string;
    marksAwarded: number;
    maxMarks: number;
    feedback?: string;
    evidence?: string;
}

export interface IClassroomSubmission extends Document {
    question: mongoose.Types.ObjectId;
    student: mongoose.Types.ObjectId;
    imagePath: string;
    originalFilename: string;
    fileSize: number;
    mimeType: string;
    status: 'PENDING' | 'EVALUATING' | 'EVALUATED' | 'FAILED';
    score: number;
    maxMarks: number;
    feedback: string;
    criterionScores: IClassroomCriterionScore[];
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
        imagePath: {
            type: String,
            required: true,
            trim: true
        },
        originalFilename: {
            type: String,
            required: true
        },
        fileSize: {
            type: Number,
            required: true
        },
        mimeType: {
            type: String,
            required: true
        },
        status: {
            type: String,
            enum: ['PENDING', 'EVALUATING', 'EVALUATED', 'FAILED'],
            default: 'PENDING',
            index: true
        },
        score: {
            type: Number,
            default: 0,
            min: 0
        },
        maxMarks: {
            type: Number,
            required: true,
            min: 0
        },
        feedback: {
            type: String,
            default: '',
            trim: true
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

// Compound index to quickly query or prevent accidental duplicate submissions
ClassroomSubmissionSchema.index({ question: 1, student: 1 });

const ClassroomSubmission: Model<IClassroomSubmission> =
    mongoose.models.ClassroomSubmission ||
    mongoose.model<IClassroomSubmission>('ClassroomSubmission', ClassroomSubmissionSchema);

export default ClassroomSubmission;
