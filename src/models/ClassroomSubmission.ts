import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IClassroomCriterionScore {
    criterionName: string;
    marksAwarded: number;
    maxMarks: number;
    feedback?: string;
    evidence?: string;
}

export type ClassroomSubmissionStatus = 'SUBMITTED' | 'EVALUATING' | 'EVALUATED' | 'REVIEWED' | 'FAILED';

export interface IClassroomSubmission extends Document {
    question: mongoose.Types.ObjectId;
    session?: mongoose.Types.ObjectId | null;
    student?: mongoose.Types.ObjectId | null;
    participantId?: string | null;
    studentName?: string;
    selectedOption?: number | null;
    textResponse?: string | null;
    isCorrect?: boolean | null;
    score: number;
    maxMarks: number;
    status: ClassroomSubmissionStatus;
    feedback?: string;
    reviewNote?: string | null;
    reviewedBy?: mongoose.Types.ObjectId | null;
    imagePath?: string | null;
    originalFilename?: string | null;
    fileSize?: number | null;
    mimeType?: string | null;
    criterionScores?: IClassroomCriterionScore[];
    confidence?: number | null;
    submittedAt: Date;
    evaluatedAt?: Date | null;
    reviewedAt?: Date | null;
    errorMessage?: string | null;
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
        session: {
            type: Schema.Types.ObjectId,
            ref: 'ClassroomSession',
            default: null,
            index: true
        },
        student: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true
        },
        participantId: {
            type: String,
            trim: true,
            index: true
        },
        studentName: {
            type: String,
            default: '',
            trim: true
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
            enum: ['SUBMITTED', 'EVALUATING', 'EVALUATED', 'REVIEWED', 'FAILED'],
            default: 'SUBMITTED',
            index: true
        },
        feedback: {
            type: String,
            default: '',
            trim: true
        },
        reviewNote: {
            type: String,
            default: null,
            trim: true
        },
        reviewedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
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
        reviewedAt: {
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

// Compound indices with partial filter expressions to support both logged-in students and classroom-specific participant identities
ClassroomSubmissionSchema.index(
    { question: 1, student: 1 },
    { unique: true, partialFilterExpression: { student: { $type: 'objectId' } } }
);
ClassroomSubmissionSchema.index(
    { question: 1, participantId: 1 },
    { unique: true, partialFilterExpression: { participantId: { $type: 'string' } } }
);
ClassroomSubmissionSchema.index({ session: 1, submittedAt: -1 });

const ClassroomSubmission: Model<IClassroomSubmission> =
    mongoose.models.ClassroomSubmission ||
    mongoose.model<IClassroomSubmission>('ClassroomSubmission', ClassroomSubmissionSchema);

export default ClassroomSubmission;
