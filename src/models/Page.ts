import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IPage extends Document {
    answerScript: mongoose.Types.ObjectId;
    pageNumber: number;
    imagePath: string;
    isActive: boolean;
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
        }
    },
    {
        timestamps: true
    }
);

PageSchema.index({ answerScript: 1, pageNumber: 1 }, { unique: true });

const Page: Model<IPage> = mongoose.models.Page || mongoose.model<IPage>('Page', PageSchema);

export default Page;
