import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IClassroomCriterion {
    criterionName: string;
    points: number;
    description?: string;
}

export interface IClassroomQuestion extends Document {
    title: string;
    questionPrompt: string;
    maxMarks: number;
    rubricCriteria: IClassroomCriterion[];
    sampleSolution?: string;
    course?: mongoose.Types.ObjectId;
    createdBy: mongoose.Types.ObjectId;
    isActive: boolean;
    status: 'ACTIVE' | 'CLOSED' | 'DRAFT';
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
        maxMarks: {
            type: Number,
            required: true,
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
        status: {
            type: String,
            enum: ['ACTIVE', 'CLOSED', 'DRAFT'],
            default: 'ACTIVE'
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
