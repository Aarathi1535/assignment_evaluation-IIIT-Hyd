import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAnswerScript extends Document {
    exam: mongoose.Types.ObjectId;
    student: mongoose.Types.ObjectId;
    filePath: string;
    filename: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const AnswerScriptSchema = new Schema<IAnswerScript>(
    {
        exam: {
            type: Schema.Types.ObjectId,
            ref: 'Exam',
            required: true,
            index: true
        },
        student: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        filePath: {
            type: String,
            required: true,
            trim: true
        },
        filename: {
            type: String,
            required: true,
            trim: true
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

// Compound unique index: { exam: 1, student: 1 }
AnswerScriptSchema.index({ exam: 1, student: 1 }, { unique: true });

const AnswerScript: Model<IAnswerScript> = mongoose.models.AnswerScript || mongoose.model<IAnswerScript>('AnswerScript', AnswerScriptSchema);

export default AnswerScript;
