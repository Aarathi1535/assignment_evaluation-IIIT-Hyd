import mongoose, { Schema, Document, Model } from 'mongoose';

export type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';

export interface IPersonalizedRubricCriterion {
    criterionName: string;
    points: number;
    description?: string;
}

export interface IPersonalizedQuestion extends Document {
    course: mongoose.Types.ObjectId;
    questionIndex: number;
    title: string;
    topic: string;
    unit?: string;
    difficulty: QuestionDifficulty;
    questionPrompt: string;
    expectedConcepts?: string[];
    maxMarks: number;
    hints?: string[];
    referenceAnswer?: string | null;
    rubricCriteria?: IPersonalizedRubricCriterion[];
    sourceSyllabusTopic?: string;
    createdBy: mongoose.Types.ObjectId;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const PersonalizedRubricCriterionSchema = new Schema<IPersonalizedRubricCriterion>(
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

const PersonalizedQuestionSchema = new Schema<IPersonalizedQuestion>(
    {
        course: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
            index: true
        },
        questionIndex: {
            type: Number,
            required: true,
            min: 1
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        topic: {
            type: String,
            required: true,
            trim: true
        },
        unit: {
            type: String,
            trim: true
        },
        difficulty: {
            type: String,
            enum: ['EASY', 'MEDIUM', 'HARD'],
            default: 'MEDIUM',
            required: true
        },
        questionPrompt: {
            type: String,
            required: true,
            trim: true
        },
        expectedConcepts: {
            type: [String],
            default: []
        },
        maxMarks: {
            type: Number,
            required: true,
            default: 10,
            min: 1
        },
        hints: {
            type: [String],
            default: []
        },
        referenceAnswer: {
            type: String,
            default: null
        },
        rubricCriteria: {
            type: [PersonalizedRubricCriterionSchema],
            default: []
        },
        sourceSyllabusTopic: {
            type: String,
            trim: true
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

PersonalizedQuestionSchema.index({ course: 1, questionIndex: 1 }, { unique: true });

const PersonalizedQuestion: Model<IPersonalizedQuestion> =
    mongoose.models.PersonalizedQuestion ||
    mongoose.model<IPersonalizedQuestion>('PersonalizedQuestion', PersonalizedQuestionSchema);

export default PersonalizedQuestion;
