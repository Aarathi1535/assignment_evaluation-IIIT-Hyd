import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICriterion {
    criterionName: string;
    description?: string;
    maxMarks: number;
}

export interface IRubric extends Document {
    exam: mongoose.Types.ObjectId;
    title: string;
    description?: string;
    criteria: ICriterion[];
    createdBy: mongoose.Types.ObjectId;
    isActive: boolean;
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
        maxMarks: {
            type: Number,
            required: true,
            min: 0
        }
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
        title: {
            type: String,
            required: true,
            trim: true
        },
        description: {
            type: String,
            trim: true
        },
        criteria: [CriterionSchema],
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

const Rubric: Model<IRubric> = mongoose.models.Rubric || mongoose.model<IRubric>('Rubric', RubricSchema);

export default Rubric;
