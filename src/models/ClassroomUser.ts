import mongoose, { Schema, Document, Model } from 'mongoose';

export type ClassroomUserRole = 'PROFESSOR' | 'STUDENT' | 'TA';

export interface IClassroomUser extends Document {
  name: string;
  email: string;
  password: string;
  role: ClassroomUserRole;
  department?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ClassroomUserSchema = new Schema<IClassroomUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['PROFESSOR', 'STUDENT', 'TA'],
      default: 'PROFESSOR',
    },
    department: {
      type: String,
      trim: true,
      default: '',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

const ClassroomUser: Model<IClassroomUser> =
  mongoose.models.ClassroomUser ||
  mongoose.model<IClassroomUser>('ClassroomUser', ClassroomUserSchema);

export default ClassroomUser;
