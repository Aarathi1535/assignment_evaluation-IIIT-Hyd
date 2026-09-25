import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ISyllabusUnit {
    unitNumber: number;
    unitTitle: string;
    topics: string[];
    description?: string;
}

export interface ICourseSyllabus extends Document {
    course: mongoose.Types.ObjectId;
    title: string;
    rawText: string;
    units: ISyllabusUnit[];
    extractedTopics: string[];
    learningObjectives?: string[];
    uploadedBy: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const SyllabusUnitSchema = new Schema<ISyllabusUnit>(
    {
        unitNumber: {
            type: Number,
            required: true
        },
        unitTitle: {
            type: String,
            required: true,
            trim: true
        },
        topics: {
            type: [String],
            required: true,
            default: []
        },
        description: {
            type: String,
            trim: true
        }
    },
    { _id: false }
);

const CourseSyllabusSchema = new Schema<ICourseSyllabus>(
    {
        course: {
            type: Schema.Types.ObjectId,
            ref: 'Course',
            required: true,
            unique: true,
            index: true
        },
        title: {
            type: String,
            required: true,
            trim: true
        },
        rawText: {
            type: String,
            required: true
        },
        units: {
            type: [SyllabusUnitSchema],
            required: true,
            default: []
        },
        extractedTopics: {
            type: [String],
            required: true,
            default: []
        },
        learningObjectives: {
            type: [String],
            default: []
        },
        uploadedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true
        }
    },
    {
        timestamps: true
    }
);

const CourseSyllabus: Model<ICourseSyllabus> =
    mongoose.models.CourseSyllabus ||
    mongoose.model<ICourseSyllabus>('CourseSyllabus', CourseSyllabusSchema);

export default CourseSyllabus;
