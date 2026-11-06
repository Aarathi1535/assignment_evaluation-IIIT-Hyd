import mongoose, { Schema, Document, Model } from 'mongoose';

export type PersonalizedUserRole = 'STUDENT' | 'PROFESSOR';
export type SkillLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';

export interface IPersonalizedUser extends Document {
  name: string;
  email: string;
  password: string;
  role: PersonalizedUserRole;
  targetTopics: string[];
  skillLevel: SkillLevel;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const PersonalizedUserSchema = new Schema<IPersonalizedUser>(
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
      enum: ['STUDENT', 'PROFESSOR'],
      default: 'STUDENT',
    },
    targetTopics: {
      type: [String],
      default: [],
    },
    skillLevel: {
      type: String,
      enum: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'],
      default: 'INTERMEDIATE',
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

const PersonalizedUser: Model<IPersonalizedUser> =
  mongoose.models.PersonalizedUser ||
  mongoose.model<IPersonalizedUser>('PersonalizedUser', PersonalizedUserSchema);

export default PersonalizedUser;
