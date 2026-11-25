import mongoose, { Schema, Document, Model } from 'mongoose';

export enum ExamStatus {
    DRAFT = 'DRAFT',
    SCHEDULED = 'SCHEDULED',
    SCANNING = 'SCANNING',
    EVALUATING = 'EVALUATING',
    REVIEW_PENDING = 'REVIEW_PENDING',
    PUBLISHED = 'PUBLISHED',
    ARCHIVED = 'ARCHIVED'
}

export enum SplittingStrategyType {
    COVER_PAGE = 'COVER_PAGE',
    FIXED_PAGE = 'FIXED_PAGE'
}

export enum IngestionApprovalStatus {
    PENDING_REVIEW = 'PENDING_REVIEW',
    APPROVED = 'APPROVED'
}

/**
 * Student PDF download policy for an exam.
 * DISABLED means no official PDF download is available. It cannot prevent viewing, screenshots, screen capture, or saving visible images; that is why viewer images remain watermarked.
 */
export enum StudentDownloadPolicy {
    DISABLED = 'DISABLED',
    WATERMARKED = 'WATERMARKED'
}

export interface IOMRBubble {
    value: string;
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface IOMRColumn {
    columnIndex: number;
    bubbles: IOMRBubble[];
}

export interface IOMRTemplate {
    pageIndex: number;
    columns: IOMRColumn[];
}

export interface IExam extends Document {
    title: string;
    course: mongoose.Types.ObjectId;
    createdBy: mongoose.Types.ObjectId;
    examDate: Date;
    totalMarks: number;
    status: ExamStatus;
    numberOfQuestions: number;
    /** @deprecated Legacy roster mirror; StudentMapping is authoritative. */
    enrolledStudents?: mongoose.Types.ObjectId[];
    rubric?: mongoose.Types.ObjectId;
    splittingStrategy?: SplittingStrategyType;
    fixedPageCount?: number;
    omrTemplate?: IOMRTemplate | null;
    isActive: boolean;
    ingestionApprovalStatus: IngestionApprovalStatus;
    approvedBy?: mongoose.Types.ObjectId | null;
    approvedAt?: Date | null;
    assemblySeal?: string | null;
    assemblySealKeyId?: string | null;
    assemblySealAt?: Date | null;
    assemblySealBy?: mongoose.Types.ObjectId | null;
    blindGrading?: boolean;
    gradingDeadline?: Date | null;
    /**
     * Policy controlling student PDF downloads.
     * DISABLED means no official PDF download is available. It cannot prevent viewing, screenshots, screen capture, or saving visible images; that is why viewer images remain watermarked.
     */
    studentDownloadPolicy?: StudentDownloadPolicy;
    publishedBy?: mongoose.Types.ObjectId | null;
    publishedAt?: Date | null;
    unpublishedBy?: mongoose.Types.ObjectId | null;
    unpublishedAt?: Date | null;
    regradeWindowOpensAt?: Date | null;
    regradeWindowClosesAt?: Date | null;
    published_by?: mongoose.Types.ObjectId | null;
    published_at?: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

const OMRBubbleSchema = new Schema<IOMRBubble>(
    {
        value: { type: String, required: true, trim: true },
        x: { type: Number, required: true, min: 0, max: 1 },
        y: { type: Number, required: true, min: 0, max: 1 },
        width: { type: Number, required: true, min: 0, max: 1 },
        height: { type: Number, required: true, min: 0, max: 1 }
    },
    { _id: false }
);

const OMRColumnSchema = new Schema<IOMRColumn>(
    {
        columnIndex: { type: Number, required: true, min: 0 },
        bubbles: { type: [OMRBubbleSchema], required: true }
    },
    { _id: false }
);

const OMRTemplateSchema = new Schema<IOMRTemplate>(
    {
        pageIndex: { type: Number, required: true, min: 0 },
        columns: { type: [OMRColumnSchema], required: true }
    },
    { _id: false }
);

const ExamSchema = new Schema<IExam>(
    {
        title: {
            type: String,
            required: true,
            trim: true
        },
        course: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
            index: true
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        examDate: {
            type: Date,
            required: true
        },
        totalMarks: {
            type: Number,
            required: true,
            min: 0
        },
        status: {
            type: String,
            enum: Object.values(ExamStatus),
            default: ExamStatus.DRAFT,
            required: true,
            index: true
        },
        numberOfQuestions: {
            type: Number,
            required: true
        },
        rubric: {
            type: Schema.Types.ObjectId,
            ref: 'Rubric',
            index: true
        },
        splittingStrategy: {
            type: String,
            enum: Object.values(SplittingStrategyType),
            default: SplittingStrategyType.COVER_PAGE,
            index: true
        },
        fixedPageCount: {
            type: Number,
            min: 1
        },
        omrTemplate: {
            type: OMRTemplateSchema,
            default: null
        },
        isActive: {
            type: Boolean,
            default: true
        },
        ingestionApprovalStatus: {
            type: String,
            enum: Object.values(IngestionApprovalStatus),
            default: IngestionApprovalStatus.PENDING_REVIEW,
            required: true,
            index: true
        },
        approvedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        approvedAt: {
            type: Date,
            default: null
        },
        assemblySeal: {
            type: String,
            default: null
        },
        assemblySealKeyId: {
            type: String,
            default: null
        },
        assemblySealAt: {
            type: Date,
            default: null
        },
        assemblySealBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        blindGrading: {
            type: Boolean,
            default: false
        },
        gradingDeadline: {
            type: Date,
            default: null
        },
        /**
         * Policy controlling student PDF downloads.
         * DISABLED means no official PDF download is available. It cannot prevent viewing, screenshots, screen capture, or saving visible images; that is why viewer images remain watermarked.
         */
        studentDownloadPolicy: {
            type: String,
            enum: Object.values(StudentDownloadPolicy),
            default: StudentDownloadPolicy.DISABLED
        },
        publishedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        publishedAt: {
            type: Date,
            default: null
        },
        unpublishedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        unpublishedAt: {
            type: Date,
            default: null
        },
        regradeWindowOpensAt: {
            type: Date,
            default: null
        },
        regradeWindowClosesAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true,
        toJSON: { virtuals: true },
        toObject: { virtuals: true }
    }
);

ExamSchema.virtual('published_by')
    .get(function () { return this.publishedBy; })
    .set(function (v: mongoose.Types.ObjectId | null) { this.publishedBy = v; });

ExamSchema.virtual('published_at')
    .get(function () { return this.publishedAt; })
    .set(function (v: Date | null) { this.publishedAt = v; });

// Indexes for common query patterns
ExamSchema.index({ course: 1, examDate: -1 });

/**
 * WORM Immutability Hooks:
 * Prevent deletion or unauthorized core parameter alteration of published exams.
 * Covers: deleteOne, deleteMany, findOneAndDelete, updateOne, updateMany,
 * findOneAndUpdate, replaceOne, findOneAndReplace, bulkWrite, save,
 * $unset, dotted paths, and soft-deletion (isActive: false).
 */
ExamSchema.pre(['deleteOne', 'deleteMany', 'findOneAndDelete'], async function () {
    const options = this.getOptions();
    if (options && (options as Record<string, unknown>).bypassWorm) {
        return;
    }
    const filter = this.getFilter();
    const existingExams = await (this.model as Model<IExam>).find(filter);
    for (const exam of existingExams) {
        if (exam.status === ExamStatus.PUBLISHED) {
            throw new Error(`Cannot delete published exam "${exam.title}" (WORM immutability enforcement)`);
        }
    }
});

ExamSchema.pre('deleteOne', { document: true, query: false }, function () {
    const doc = this as IExam;
    if (doc.status === ExamStatus.PUBLISHED) {
        throw new Error(`Cannot delete published exam "${doc.title}" (WORM immutability enforcement)`);
    }
});

ExamSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne', 'findOneAndReplace'], async function () {
    const options = this.getOptions();
    if (options && (options as Record<string, unknown>).bypassWorm) {
        return;
    }
    const filter = this.getFilter();
    const existingExams = await (this.model as Model<IExam>).find(filter);
    for (const exam of existingExams) {
        if (exam.status === ExamStatus.PUBLISHED) {
            const update = this.getUpdate() as Record<string, unknown> | null;
            if (update) {
                const set = (update.$set || update) as Record<string, unknown>;
                const unset = update.$unset as Record<string, unknown> | undefined;

                if (unset) {
                    for (const key of Object.keys(unset)) {
                        if (key === 'course' || key.startsWith('course.') ||
                            key === 'totalMarks' || key.startsWith('totalMarks.') ||
                            key === 'isActive' || key.startsWith('isActive.')) {
                            throw new Error(`Cannot alter course/totalMarks/isActive of published exam "${exam.title}" (WORM immutability enforcement)`);
                        }
                    }
                }

                if (set.course && set.course.toString() !== exam.course.toString()) {
                    throw new Error(`Cannot alter course of published exam "${exam.title}" (WORM immutability enforcement)`);
                }
                if (set.totalMarks !== undefined && set.totalMarks !== exam.totalMarks) {
                    throw new Error(`Cannot update totalMarks on published exam "${exam.title}" (WORM immutability enforcement)`);
                }
                if (set.isActive === false || set.isActive === 0) {
                    throw new Error(`Cannot delete published exam "${exam.title}" (WORM immutability enforcement)`);
                }

                // Check dotted path updates in set / root update
                for (const key of Object.keys(set)) {
                    if (key.startsWith('course.') && set[key]?.toString() !== exam.course.toString()) {
                        throw new Error(`Cannot alter course of published exam "${exam.title}" (WORM immutability enforcement)`);
                    }
                    if (key.startsWith('totalMarks.') && set[key] !== exam.totalMarks) {
                        throw new Error(`Cannot update totalMarks on published exam "${exam.title}" (WORM immutability enforcement)`);
                    }
                    if (key.startsWith('isActive.') && (set[key] === false || set[key] === 0)) {
                        throw new Error(`Cannot delete published exam "${exam.title}" (WORM immutability enforcement)`);
                    }
                }
            }
        }
    }
});

ExamSchema.pre('save', async function () {
    if (!this.isNew) {
        const existing = await (this.constructor as Model<IExam>).findById(this._id);
        if (existing && existing.status === ExamStatus.PUBLISHED) {
            if (this.isModified('course') && this.course?.toString() !== existing.course?.toString()) {
                throw new Error(`Cannot alter course of published exam "${this.title}" (WORM immutability enforcement)`);
            }
            if (this.isModified('totalMarks') && this.totalMarks !== existing.totalMarks) {
                throw new Error(`Cannot update totalMarks on published exam "${this.title}" (WORM immutability enforcement)`);
            }
            if (this.isModified('isActive') && !this.isActive) {
                throw new Error(`Cannot delete published exam "${this.title}" (WORM immutability enforcement)`);
            }
        }
    }
});

(ExamSchema as unknown as { pre: (event: string, fn: unknown) => void }).pre('bulkWrite', async function (this: unknown, ops: Array<Record<string, Record<string, unknown>>>) {
    if (!Array.isArray(ops)) return;
    const model = this as Model<IExam>;
    for (const op of ops) {
        if (op.deleteOne || op.deleteMany) {
            const filter = (op.deleteOne || op.deleteMany).filter as mongoose.QueryFilter<IExam>;
            const existingExams = await model.find(filter);
            for (const exam of existingExams) {
                if (exam.status === ExamStatus.PUBLISHED) {
                    throw new Error(`Cannot delete published exam "${exam.title}" (WORM immutability enforcement)`);
                }
            }
        }
        if (op.updateOne || op.updateMany || op.replaceOne) {
            const action = op.updateOne || op.updateMany || op.replaceOne;
            const filter = action.filter as mongoose.QueryFilter<IExam>;
            const update = (action.update || action.replacement) as Record<string, unknown> | null;
            const existingExams = await model.find(filter);
            for (const exam of existingExams) {
                if (exam.status === ExamStatus.PUBLISHED && update) {
                    const set = (update.$set || update) as Record<string, unknown>;
                    const unset = update.$unset as Record<string, unknown> | undefined;
                    if (unset) {
                        for (const key of Object.keys(unset)) {
                            if (key === 'course' || key.startsWith('course.') ||
                                key === 'totalMarks' || key.startsWith('totalMarks.') ||
                                key === 'isActive' || key.startsWith('isActive.')) {
                                throw new Error(`Cannot alter course/totalMarks/isActive of published exam "${exam.title}" (WORM immutability enforcement)`);
                            }
                        }
                    }
                    if (set.course && set.course.toString() !== exam.course.toString()) {
                        throw new Error(`Cannot alter course of published exam "${exam.title}" (WORM immutability enforcement)`);
                    }
                    if (set.totalMarks !== undefined && set.totalMarks !== exam.totalMarks) {
                        throw new Error(`Cannot update totalMarks on published exam "${exam.title}" (WORM immutability enforcement)`);
                    }
                    if (set.isActive === false || set.isActive === 0) {
                        throw new Error(`Cannot delete published exam "${exam.title}" (WORM immutability enforcement)`);
                    }
                }
            }
        }
    }
});

const Exam: Model<IExam> = mongoose.models.Exam || mongoose.model<IExam>('Exam', ExamSchema);

export default Exam;
