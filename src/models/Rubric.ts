import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICriterion {
    criterionName: string;
    description?: string;
    points: number;
}

export interface IQuestion {
    questionNumber: number;
    maxMarks: number;
    criteria: ICriterion[];
}

export interface IRubric extends Document {
    exam: mongoose.Types.ObjectId;
    questions: IQuestion[];
    createdBy: mongoose.Types.ObjectId;
    isActive: boolean;
    version: number;
    createdAt: Date;
    updatedAt: Date;
}

const CriterionSchema = new Schema<ICriterion>(
    {
        criterionName: {
            type: String,
            required: true,
            trim: true
        },
        description: {
            type: String,
            trim: true
        },
        points: {
            type: Number,
            required: true,
            min: 0
        }
    },
    {
        _id: false
    }
);

const QuestionSchema = new Schema<IQuestion>(
    {
        questionNumber: {
            type: Number,
            required: true
        },
        maxMarks: {
            type: Number,
            required: true,
            min: 0
        },
        criteria: [CriterionSchema]
    },
    {
        _id: false
    }
);

const RubricSchema = new Schema<IRubric>(
    {
        exam: {
            type: Schema.Types.ObjectId,
            ref: 'Exam',
            required: true,
            index: true
        },
        questions: [QuestionSchema],
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        isActive: {
            type: Boolean,
            default: true
        },
        version: {
            type: Number,
            default: 1
        }
    },
    {
        timestamps: true
    }
);

const Rubric: Model<IRubric> = mongoose.models.Rubric || mongoose.model<IRubric>('Rubric', RubricSchema);

export default Rubric;
