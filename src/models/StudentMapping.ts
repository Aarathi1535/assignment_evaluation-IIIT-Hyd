import mongoose, { Schema, Document, Model } from 'mongoose';
import { normalizeRollNumber } from '../utils/studentMappingUtils';

export interface IStudentMapping extends Document {
    exam: mongoose.Types.ObjectId;
    student: mongoose.Types.ObjectId;
    anonymousId: string;
    rollNumber?: string | null;
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
        rollNumber: {
            type: String,
            trim: true,
            default: null,
            set: (val: unknown) => normalizeRollNumber(val)
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
StudentMappingSchema.index(
    { exam: 1, rollNumber: 1 },
    {
        unique: true,
        partialFilterExpression: { rollNumber: { $type: 'string' } }
    }
);

const StudentMapping: Model<IStudentMapping> = mongoose.models.StudentMapping || mongoose.model<IStudentMapping>('StudentMapping', StudentMappingSchema);

export default StudentMapping;
