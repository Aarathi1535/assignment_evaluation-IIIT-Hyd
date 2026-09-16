import mongoose, { Schema, Document, Model } from 'mongoose';

export enum TagScope {
    GLOBAL = 'GLOBAL',
    EXAM = 'EXAM',
}

export interface ICommentTag extends Document {
    label: string;
    scope: TagScope;
    exam?: mongoose.Types.ObjectId | null;
    createdBy: mongoose.Types.ObjectId;
    description?: string;
    createdAt: Date;
    updatedAt: Date;
}

const CommentTagSchema = new Schema<ICommentTag>(
    {
        label: {
            type: String,
            required: true,
            trim: true,
            maxlength: 100,
        },
        scope: {
            type: String,
            enum: Object.values(TagScope),
            default: TagScope.GLOBAL,
            required: true,
            index: true,
        },
        exam: {
            type: Schema.Types.ObjectId,
            ref: 'Exam',
            required: function (this: ICommentTag) {
                return this.scope === TagScope.EXAM;
            },
            default: null,
            index: true,
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },
        description: {
            type: String,
            trim: true,
            maxlength: 250,
        },
    },
    {
        timestamps: true,
    }
);

// Unique partial indexes:
// 1. GLOBAL tags: unique label among GLOBAL tags
CommentTagSchema.index(
    { label: 1 },
    {
        unique: true,
        partialFilterExpression: { scope: TagScope.GLOBAL },
    }
);

// 2. EXAM tags: unique label within the same exam
CommentTagSchema.index(
    { label: 1, exam: 1 },
    {
        unique: true,
        partialFilterExpression: { scope: TagScope.EXAM },
    }
);

const CommentTag: Model<ICommentTag> =
    mongoose.models.CommentTag || mongoose.model<ICommentTag>('CommentTag', CommentTagSchema);

export default CommentTag;
