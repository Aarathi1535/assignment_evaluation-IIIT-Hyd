import mongoose, { Schema, Document, Model } from 'mongoose';
import type { SerializedPageAnnotations } from '../lib/annotationSerialization';

export interface IPage extends Document {
    answerScript: mongoose.Types.ObjectId;
    pageNumber: number;
    imagePath: string;
    isActive: boolean;
    annotations?: SerializedPageAnnotations | null;
    annotatedBy?: mongoose.Types.ObjectId | null;
    createdAt: Date;
    updatedAt: Date;
}

const PageSchema = new Schema<IPage>(
    {
        answerScript: {
            type: Schema.Types.ObjectId,
            ref: 'AnswerScript',
            required: true,
            index: true
        },
        pageNumber: {
            type: Number,
            required: true,
            min: 1
        },
        imagePath: {
            type: String,
            required: true,
            trim: true
        },
        isActive: {
            type: Boolean,
            default: true
        },
        annotations: {
            type: Schema.Types.Mixed,
            default: null
        },
        annotatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        }
    },
    {
        timestamps: true
    }
);

PageSchema.index({ answerScript: 1, pageNumber: 1 }, { unique: true });

const Page: Model<IPage> = mongoose.models.Page || mongoose.model<IPage>('Page', PageSchema);

export default Page;
