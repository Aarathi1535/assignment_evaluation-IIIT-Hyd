import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IEvaluation extends Document {
    jobId: mongoose.Types.ObjectId;
    score: number;
    maxScore: number;
    grade?: string;
    feedback: string;
    breakdown?: Record<string, any>;
    rawAiOutput: Record<string, any>;
    createdAt: Date;
    updatedAt: Date;
}

const EvaluationSchema = new Schema<IEvaluation>(
    {
        jobId: {
            type: Schema.Types.ObjectId,
            ref: 'Job',
            required: true,
            index: true
        },
        score: {
            type: Number,
            required: true,
            min: 0
        },
        maxScore: {
            type: Number,
            default: 100,
            required: true,
            min: 0
        },
        grade: {
            type: String,
            trim: true
        },
        feedback: {
            type: String,
            required: true,
            trim: true
        },
        breakdown: {
            type: Schema.Types.Mixed
        },
        rawAiOutput: {
            type: Schema.Types.Mixed,
            default: {}
        }
    },
    {
        timestamps: true
    }
);

// Additional composite indexes if needed
EvaluationSchema.index({ score: -1 });

const Evaluation: Model<IEvaluation> = mongoose.models.Evaluation || mongoose.model<IEvaluation>('Evaluation', EvaluationSchema);

export default Evaluation;
