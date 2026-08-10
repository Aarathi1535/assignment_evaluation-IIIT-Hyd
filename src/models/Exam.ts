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

export interface IExam extends Document {
    title: string;
    course: mongoose.Types.ObjectId;
    createdBy: mongoose.Types.ObjectId;
    examDate: Date;
    totalMarks: number;
    status: ExamStatus;
    numberOfQuestions: number;
    enrolledStudents?: mongoose.Types.ObjectId[];
    rubric?: mongoose.Types.ObjectId;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

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
        enrolledStudents: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User'
            }
        ],
        rubric: {
            type: Schema.Types.ObjectId,
            ref: 'Rubric',
            index: true
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

// Indexes for common query patterns
ExamSchema.index({ course: 1, examDate: -1 });

const Exam: Model<IExam> = mongoose.models.Exam || mongoose.model<IExam>('Exam', ExamSchema);

export default Exam;
