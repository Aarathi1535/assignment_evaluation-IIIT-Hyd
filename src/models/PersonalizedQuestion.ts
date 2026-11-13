import mongoose, { Schema, Document, Model } from 'mongoose';

export type QuestionDifficulty = 'EASY' | 'MEDIUM' | 'HARD';
export type QuestionCategory = 'CONCEPTUAL' | 'APPLICATION' | 'ANALYSIS' | 'DESIGN';

export type QuestionType =
    | 'CODING'
    | 'DEBUGGING'
    | 'ANALYTICAL'
    | 'NUMERICAL'
    | 'THEORY'
    | 'OUTPUT_PREDICTION'
    | 'FIND_ERROR'
    | 'CONCEPTUAL'
    | 'APPLICATION'
    | 'ANALYSIS'
    | 'DESIGN';

export type OrganizationStatus = 'PENDING' | 'ORGANIZED' | 'MANUAL' | 'FAILED';

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
    subtopic?: string;
    unit?: string;
    difficulty: QuestionDifficulty;
    category?: QuestionCategory;
    questionType?: QuestionType;
    questionPrompt: string;
    options?: string[];
    correctOptionIndex?: number | null;
    explanation?: string | null;
    expectedConcepts?: string[];
    skills?: string[];
    learningObjectives?: string[];
    prerequisites?: string[];
    relatedConcepts?: string[];
    combinesConcepts?: string[];
    dependencyQuestionIds?: mongoose.Types.ObjectId[];
    organizationStatus?: OrganizationStatus;
    estimatedMinutes?: number;
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
        subtopic: {
            type: String,
            trim: true,
            index: true
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
        category: {
            type: String,
            enum: ['CONCEPTUAL', 'APPLICATION', 'ANALYSIS', 'DESIGN'],
            default: 'CONCEPTUAL',
            trim: true
        },
        questionType: {
            type: String,
            trim: true
        },
        questionPrompt: {
            type: String,
            required: true,
            trim: true
        },
        options: {
            type: [String],
            default: []
        },
        correctOptionIndex: {
            type: Number,
            default: null
        },
        explanation: {
            type: String,
            default: null,
            trim: true
        },
        expectedConcepts: {
            type: [String],
            default: []
        },
        skills: {
            type: [String],
            default: []
        },
        learningObjectives: {
            type: [String],
            default: []
        },
        prerequisites: {
            type: [String],
            default: []
        },
        relatedConcepts: {
            type: [String],
            default: []
        },
        combinesConcepts: {
            type: [String],
            default: []
        },
        dependencyQuestionIds: [
            {
                type: Schema.Types.ObjectId,
                ref: 'PersonalizedQuestion'
            }
        ],
        organizationStatus: {
            type: String,
            enum: ['PENDING', 'ORGANIZED', 'MANUAL', 'FAILED'],
            default: 'PENDING',
            index: true
        },
        estimatedMinutes: {
            type: Number,
            default: 3
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
