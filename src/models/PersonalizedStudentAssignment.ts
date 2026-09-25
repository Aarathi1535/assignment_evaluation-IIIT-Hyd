import mongoose, { Schema, Document, Model } from 'mongoose';

export type AssignmentStatus = 'LOCKED' | 'AVAILABLE' | 'IN_PROGRESS' | 'SUBMITTED' | 'MISSED';

export interface IPersonalizedStudentAssignment extends Document {
    schedule: mongoose.Types.ObjectId;
    student: mongoose.Types.ObjectId;
    question: mongoose.Types.ObjectId;
    dayNumber: number;
    scheduledDate: Date;
    windowStart: Date;
    windowEnd: Date;
    status: AssignmentStatus;
    startedAt?: Date | null;
    submittedAt?: Date | null;
    studentAnswer?: string | null;
    score?: number | null;
    feedback?: string | null;
    createdAt: Date;
    updatedAt: Date;
}

const PersonalizedStudentAssignmentSchema = new Schema<IPersonalizedStudentAssignment>(
    {
        schedule: {
            type: Schema.Types.ObjectId,
            ref: 'PersonalizedAssessmentSchedule',
            required: true,
            index: true
        },
        student: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        question: {
            type: Schema.Types.ObjectId,
            ref: 'PersonalizedQuestion',
            required: true,
            index: true
        },
        dayNumber: {
            type: Number,
            required: true,
            min: 1
        },
        scheduledDate: {
            type: Date,
            required: true,
            index: true
        },
        windowStart: {
            type: Date,
            required: true
        },
        windowEnd: {
            type: Date,
            required: true
        },
        status: {
            type: String,
            enum: ['LOCKED', 'AVAILABLE', 'IN_PROGRESS', 'SUBMITTED', 'MISSED'],
            default: 'LOCKED',
            required: true,
            index: true
        },
        startedAt: {
            type: Date,
            default: null
        },
        submittedAt: {
            type: Date,
            default: null
        },
        studentAnswer: {
            type: String,
            default: null
        },
        score: {
            type: Number,
            default: null
        },
        feedback: {
            type: String,
            default: null
        }
    },
    {
        timestamps: true
    }
);

// 1. Exactly one assignment per student per day slot in the schedule
PersonalizedStudentAssignmentSchema.index({ schedule: 1, student: 1, dayNumber: 1 }, { unique: true });

// 2. No question collision for the same schedule + scheduled date
PersonalizedStudentAssignmentSchema.index({ schedule: 1, scheduledDate: 1, question: 1 }, { unique: true });

// 3. Unique assignment per student per scheduled date
PersonalizedStudentAssignmentSchema.index({ schedule: 1, student: 1, scheduledDate: 1 }, { unique: true });

// 4. Fast lookup for today query
PersonalizedStudentAssignmentSchema.index({ student: 1, scheduledDate: 1 });

const PersonalizedStudentAssignment: Model<IPersonalizedStudentAssignment> =
    mongoose.models.PersonalizedStudentAssignment ||
    mongoose.model<IPersonalizedStudentAssignment>(
        'PersonalizedStudentAssignment',
        PersonalizedStudentAssignmentSchema
    );

export default PersonalizedStudentAssignment;
