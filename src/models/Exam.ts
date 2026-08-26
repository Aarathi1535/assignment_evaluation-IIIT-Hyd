import mongoose, { Schema, Document, Model } from 'mongoose';

export enum ExamStatus {
    DRAFT = 'DRAFT',
    SCHEDULED = 'SCHEDULED',
    SCANNING = 'SCANNING',
    EVALUATING = 'EVALUATING',
    REVIEW_PENDING = 'REVIEW_PENDING',
    PUBLISHED = 'PUBLISHED',
    ARCHIVED = 'ARCHIVED'
}

export enum SplittingStrategyType {
    COVER_PAGE = 'COVER_PAGE',
    FIXED_PAGE = 'FIXED_PAGE'
}

export enum IngestionApprovalStatus {
    PENDING_REVIEW = 'PENDING_REVIEW',
    APPROVED = 'APPROVED'
}

export interface IOMRBubble {
    value: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface IOMRColumn {
    columnIndex: number;
    bubbles: IOMRBubble[];
}

export interface IOMRTemplate {
    pageIndex: number;
    columns: IOMRColumn[];
}

export interface IExam extends Document {
    title: string;
    course: mongoose.Types.ObjectId;
    createdBy: mongoose.Types.ObjectId;
    examDate: Date;
    totalMarks: number;
    status: ExamStatus;
    numberOfQuestions: number;
    enrolledStudents?: mongoose.Types.ObjectId[];
    rubric?: mongoose.Types.ObjectId;
    splittingStrategy?: SplittingStrategyType;
    fixedPageCount?: number;
    omrTemplate?: IOMRTemplate | null;
    isActive: boolean;
    ingestionApprovalStatus: IngestionApprovalStatus;
    approvedBy?: mongoose.Types.ObjectId | null;
    approvedAt?: Date | null;
    assemblySeal?: string | null;
    assemblySealKeyId?: string | null;
    assemblySealAt?: Date | null;
    assemblySealBy?: mongoose.Types.ObjectId | null;
    blindGrading?: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const OMRBubbleSchema = new Schema<IOMRBubble>(
    {
        value: { type: String, required: true, trim: true },
        x: { type: Number, required: true, min: 0, max: 1 },
        y: { type: Number, required: true, min: 0, max: 1 },
        width: { type: Number, required: true, min: 0, max: 1 },
        height: { type: Number, required: true, min: 0, max: 1 }
    },
    { _id: false }
);

const OMRColumnSchema = new Schema<IOMRColumn>(
    {
        columnIndex: { type: Number, required: true, min: 0 },
        bubbles: { type: [OMRBubbleSchema], required: true }
    },
    { _id: false }
);

const OMRTemplateSchema = new Schema<IOMRTemplate>(
    {
        pageIndex: { type: Number, required: true, min: 0 },
        columns: { type: [OMRColumnSchema], required: true }
    },
    { _id: false }
);

const ExamSchema = new Schema<IExam>(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },
        course: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
            index: true
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        examDate: {
            type: Date,
            required: true
        },
        totalMarks: {
            type: Number,
            required: true,
            min: 0
        },
        status: {
            type: String,
            enum: Object.values(ExamStatus),
            default: ExamStatus.DRAFT,
            required: true,
            index: true
        },
        numberOfQuestions: {
            type: Number,
            required: true
        },
        enrolledStudents: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User'
            }
        ],
        rubric: {
            type: Schema.Types.ObjectId,
            ref: 'Rubric',
            index: true
        },
        splittingStrategy: {
            type: String,
            enum: Object.values(SplittingStrategyType),
            default: SplittingStrategyType.COVER_PAGE,
            index: true
        },
        fixedPageCount: {
            type: Number,
            min: 1
        },
        omrTemplate: {
            type: OMRTemplateSchema,
            default: null
        },
        isActive: {
            type: Boolean,
            default: true
        },
        ingestionApprovalStatus: {
            type: String,
            enum: Object.values(IngestionApprovalStatus),
            default: IngestionApprovalStatus.PENDING_REVIEW,
            required: true,
            index: true
        },
        approvedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        approvedAt: {
            type: Date,
            default: null
        },
        assemblySeal: {
            type: String,
            default: null
        },
        assemblySealKeyId: {
            type: String,
            default: null
        },
        assemblySealAt: {
            type: Date,
            default: null
        },
        assemblySealBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        blindGrading: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true
    }
);

// Indexes for common query patterns
ExamSchema.index({ course: 1, examDate: -1 });

const Exam: Model<IExam> = mongoose.models.Exam || mongoose.model<IExam>('Exam', ExamSchema);

export default Exam;
