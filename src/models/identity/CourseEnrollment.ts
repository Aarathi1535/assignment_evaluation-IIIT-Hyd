import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICourseEnrollment extends Document {
  platformUserId: mongoose.Types.ObjectId;
  courseCode: string;
  courseName: string;
  semester: string; // e.g., 'Monsoon 2026', 'Spring 2026'
  role: 'PROFESSOR' | 'TA' | 'STUDENT';
  status: 'ACTIVE' | 'DROPPED' | 'COMPLETED';
  enrolledAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CourseEnrollmentSchema = new Schema<ICourseEnrollment>(
  {
    platformUserId: { type: Schema.Types.ObjectId, ref: 'IdentityUser', required: true, index: true },
    courseCode: { type: String, required: true, uppercase: true, trim: true, index: true },
    courseName: { type: String, required: true, trim: true },
    semester: { type: String, required: true, trim: true },
    role: {
      type: String,
      enum: ['PROFESSOR', 'TA', 'STUDENT'],
      required: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'DROPPED', 'COMPLETED'],
      default: 'ACTIVE',
    },
    enrolledAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    collection: 'course_enrollments',
  }
);

CourseEnrollmentSchema.index({ platformUserId: 1, courseCode: 1, semester: 1 }, { unique: true });

const CourseEnrollment: Model<ICourseEnrollment> =
  mongoose.models.CourseEnrollment ||
  mongoose.model<ICourseEnrollment>('CourseEnrollment', CourseEnrollmentSchema);

export default CourseEnrollment;
