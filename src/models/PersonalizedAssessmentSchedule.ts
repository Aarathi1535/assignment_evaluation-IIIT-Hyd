import mongoose, { Schema, Document, Model } from 'mongoose';

export type ScheduleStatus = 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'PAUSED';

export interface IPersonalizedAssessmentSchedule extends Document {
    course: mongoose.Types.ObjectId;
    title: string;
    totalQuestionsTarget: number;
    totalWeeks: number;
    startDate: Date;
    endDate: Date;
    activeDaysOfWeek: number[];
    timezone: string;
    dailyWindowStartTime: string;
    dailyWindowEndTime: string;
    enrolledStudents: mongoose.Types.ObjectId[];
    questionPool: mongoose.Types.ObjectId[];
    scheduleMatrixGenerated: boolean;
    status: ScheduleStatus;
    createdBy: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const PersonalizedAssessmentScheduleSchema = new Schema<IPersonalizedAssessmentSchedule>(
    {
        course: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
            index: true
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        totalQuestionsTarget: {
            type: Number,
            required: true,
            default: 100,
            min: 1
        },
        totalWeeks: {
            type: Number,
            required: true,
            default: 16,
            min: 1
        },
        startDate: {
            type: Date,
            required: true
        },
        endDate: {
            type: Date,
            required: true
        },
        activeDaysOfWeek: {
            type: [Number],
            required: true,
            validate: {
                validator: (val: number[]) => val.length > 0 && val.every((d) => d >= 0 && d <= 6),
                message: 'activeDaysOfWeek must contain at least one valid day index (0-6)'
            }
        },
        timezone: {
            type: String,
            required: true,
            default: 'Asia/Kolkata'
        },
        dailyWindowStartTime: {
            type: String,
            required: true,
            default: '09:00',
            match: /^([01]\d|2[0-3]):([0-5]\d)$/
        },
        dailyWindowEndTime: {
            type: String,
            required: true,
            default: '22:00',
            match: /^([01]\d|2[0-3]):([0-5]\d)$/
        },
        enrolledStudents: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User'
            }
        ],
        questionPool: [
            {
                type: Schema.Types.ObjectId,
                ref: 'PersonalizedQuestion'
            }
        ],
        scheduleMatrixGenerated: {
            type: Boolean,
            default: false
        },
        status: {
            type: String,
            enum: ['DRAFT', 'ACTIVE', 'COMPLETED', 'PAUSED'],
            default: 'DRAFT',
            required: true
        },
        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        }
    },
    {
        timestamps: true
    }
);

PersonalizedAssessmentScheduleSchema.index({ course: 1, status: 1 });

const PersonalizedAssessmentSchedule: Model<IPersonalizedAssessmentSchedule> =
    mongoose.models.PersonalizedAssessmentSchedule ||
    mongoose.model<IPersonalizedAssessmentSchedule>(
        'PersonalizedAssessmentSchedule',
        PersonalizedAssessmentScheduleSchema
    );

export default PersonalizedAssessmentSchedule;
