import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IClassroomCriterion {
    criterionName: string;
    points: number;
    description?: string;
}

export type ClassroomQuestionType = 'MULTIPLE_CHOICE' | 'SHORT_ANSWER' | 'POLL';
export type ClassroomQuestionStatus = 'ACTIVE' | 'CLOSED' | 'REVEALED' | 'DRAFT';

export interface IClassroomQuestion extends Document {
    title: string;
    questionPrompt: string;
    type: ClassroomQuestionType;
    options: string[];
    correctOptionIndex?: number | null;
    correctAnswerText?: string | null;
    explanation?: string;
    order: number;
    maxMarks: number;
    rubricCriteria?: IClassroomCriterion[];
    sampleSolution?: string;
    course?: mongoose.Types.ObjectId;
    createdBy: mongoose.Types.ObjectId;
    isActive: boolean;
    isRevealed: boolean;
    status: ClassroomQuestionStatus;
    activatedAt?: Date;
    closedAt?: Date;
    revealedAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const ClassroomCriterionSchema = new Schema<IClassroomCriterion>(
    {
        criterionName: {
            type: String,
            required: true,
            trim: true
        },
        points: {
            type: Number,
            required: true,
            min: 0
        },
        description: {
            type: String,
            trim: true
        }
    },
    { _id: false }
);

const ClassroomQuestionSchema = new Schema<IClassroomQuestion>(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },
        questionPrompt: {
            type: String,
            required: true,
            trim: true
        },
        type: {
            type: String,
            enum: ['MULTIPLE_CHOICE', 'SHORT_ANSWER', 'POLL'],
            default: 'MULTIPLE_CHOICE'
        },
        options: {
            type: [String],
            default: []
        },
        correctOptionIndex: {
            type: Number,
            default: null
        },
        correctAnswerText: {
            type: String,
            trim: true,
            default: null
        },
        explanation: {
            type: String,
            trim: true,
            default: ''
        },
        order: {
            type: Number,
            default: 0
        },
        maxMarks: {
            type: Number,
            default: 1,
            min: 0
        },
        rubricCriteria: {
            type: [ClassroomCriterionSchema],
            default: []
        },
        sampleSolution: {
            type: String,
            trim: true
        },
        course: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            default: null
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        isActive: {
            type: Boolean,
            default: false,
            index: true
        },
        isRevealed: {
            type: Boolean,
            default: false
        },
        status: {
            type: String,
            enum: ['ACTIVE', 'CLOSED', 'REVEALED', 'DRAFT'],
            default: 'ACTIVE'
        },
        activatedAt: {
            type: Date,
            default: null
        },
        closedAt: {
            type: Date,
            default: null
        },
        revealedAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true
    }
);

const ClassroomQuestion: Model<IClassroomQuestion> =
    mongoose.models.ClassroomQuestion ||
    mongoose.model<IClassroomQuestion>('ClassroomQuestion', ClassroomQuestionSchema);

export default ClassroomQuestion;
