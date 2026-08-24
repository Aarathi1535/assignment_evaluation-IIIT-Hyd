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
    question?: number;
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
            required: true
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
        },
        question: {
            type: Number,
            required: false,
            index: true
        }
    },
    {
        timestamps: true
    }
);

// Allow multiple grades per answer script for question-wise grading, but restrict to one grade per script + question combination (and one whole-script grade when question is absent).
GradeSchema.index({ answerScript: 1, question: 1 }, { unique: true });

// Prevent mixed-mode grading: an answer script cannot simultaneously have a whole-script grade and question-wise grades
GradeSchema.pre('save', async function () {
    const GradeModel = this.constructor as mongoose.Model<IGrade>;
    
    if (this.question !== undefined && this.question !== null) {
        // Saving a question-wise grade. Ensure no whole-script grade exists for this script.
        const wholeScriptExists = await GradeModel.exists({
            answerScript: this.answerScript,
            _id: { $ne: this._id }, // exclude self
            $or: [{ question: null }, { question: { $exists: false } }]
        });
        if (wholeScriptExists) {
            throw new Error('Cannot create question-wise grade: a whole-script grade already exists for this answer script.');
        }
    } else {
        // Saving a whole-script grade. Ensure no question-wise grade exists for this script.
        const questionWiseExists = await GradeModel.exists({
            answerScript: this.answerScript,
            _id: { $ne: this._id }, // exclude self
            question: { $ne: null, $exists: true }
        });
        if (questionWiseExists) {
            throw new Error('Cannot create whole-script grade: question-wise grades already exist for this answer script.');
        }
    }
});

const Grade: Model<IGrade> = mongoose.models.Grade || mongoose.model<IGrade>('Grade', GradeSchema);

export default Grade;
