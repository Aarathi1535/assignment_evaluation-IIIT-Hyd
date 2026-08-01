import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IStudentMapping extends Document {
    exam: mongoose.Types.ObjectId;
    student: mongoose.Types.ObjectId;
    anonymousId: string;
    isVerified: boolean;
    verifiedBy?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const StudentMappingSchema = new Schema<IStudentMapping>(
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
        anonymousId: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        isVerified: {
            type: Boolean,
            default: false
        },
        verifiedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User'
        }
    },
    {
        timestamps: true
    }
);

StudentMappingSchema.index({ exam: 1, student: 1 }, { unique: true });
StudentMappingSchema.index({ exam: 1, anonymousId: 1 }, { unique: true });

const StudentMapping: Model<IStudentMapping> = mongoose.models.StudentMapping || mongoose.model<IStudentMapping>('StudentMapping', StudentMappingSchema);

export default StudentMapping;
