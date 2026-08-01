import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICriterionGrade {
    criterionName: string;
    score: number;
    feedback?: string;
}

export interface IGrade extends Document {
    answerScript: mongoose.Types.ObjectId;
    rubric: mongoose.Types.ObjectId;
    gradedBy: mongoose.Types.ObjectId;
    marksAwarded: ICriterionGrade[];
    totalScore: number;
    feedback?: string;
    isFinal: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const CriterionGradeSchema = new Schema<ICriterionGrade>(
    {
        criterionName: {
            type: String,
            required: true,
            trim: true
        },
        score: {
            type: Number,
            required: true,
            min: 0
        },
        feedback: {
            type: String,
            trim: true
        }
    },
    { _id: false }
);

const GradeSchema = new Schema<IGrade>(
    {
        answerScript: {
            type: Schema.Types.ObjectId,
            ref: 'AnswerScript',
            required: true,
            unique: true
        },
        rubric: {
            type: Schema.Types.ObjectId,
            ref: 'Rubric',
            required: true,
            index: true
        },
        gradedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        marksAwarded: [CriterionGradeSchema],
        totalScore: {
            type: Number,
            required: true,
            min: 0
        },
        feedback: {
            type: String,
            trim: true
        },
        isFinal: {
            type: Boolean,
            default: false
        }
    },
    {
        timestamps: true
    }
);



const Grade: Model<IGrade> = mongoose.models.Grade || mongoose.model<IGrade>('Grade', GradeSchema);

export default Grade;
