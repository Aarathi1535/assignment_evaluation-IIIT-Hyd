import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICourse extends Document {
    courseCode: string;
    courseName: string;
    semester: number;
    academicYear: string;
    professor: mongoose.Types.ObjectId;
    teachingAssistants: mongoose.Types.ObjectId[];
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const CourseSchema = new Schema<ICourse>(
    {
        courseCode: {
            type: String,
            required: true,
            unique: true,
            trim: true
        },
        courseName: {
            type: String,
            required: true,
            trim: true
        },
        semester: {
            type: Number,
            required: true
        },
        academicYear: {
            type: String,
            required: true,
            trim: true
        },
        professor: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        },
        teachingAssistants: [
            {
                type: Schema.Types.ObjectId,
                ref: 'User'
            }
        ],
        isActive: {
            type: Boolean,
            default: true
        }
    },
    {
        timestamps: true
    }
);

const Course: Model<ICourse> = mongoose.models.Course || mongoose.model<ICourse>('Course', CourseSchema);

export default Course;
