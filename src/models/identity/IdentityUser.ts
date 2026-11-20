import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IIdentityUser extends Document {
  name: string;
  email: string;
  password?: string;
  role: 'ADMIN' | 'PROFESSOR' | 'TA' | 'STUDENT';
  department?: string;
  rollNumber?: string;
  isActive: boolean;
  failedLoginAttempts: number;
  lockoutUntil?: Date;
  lastLoginAt?: Date;
  comparePassword(candidate: string): Promise<boolean>;
  createdAt: Date;
  updatedAt: Date;
}

const IdentityUserSchema = new Schema<IIdentityUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, select: true },
    role: {
      type: String,
      enum: ['ADMIN', 'PROFESSOR', 'TA', 'STUDENT'],
      default: 'STUDENT',
      required: true,
    },
    department: { type: String, trim: true },
    rollNumber: { type: String, trim: true, sparse: true },
    isActive: { type: Boolean, default: true },
    failedLoginAttempts: { type: Number, default: 0 },
    lockoutUntil: { type: Date },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'identity_users',
  }
);

IdentityUserSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) {
    return;
  }
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

IdentityUserSchema.methods.comparePassword = async function (candidate: string): Promise<boolean> {
  if (!this.password) return false;
  return bcrypt.compare(candidate, this.password);
};

const IdentityUser: Model<IIdentityUser> =
  mongoose.models.IdentityUser || mongoose.model<IIdentityUser>('IdentityUser', IdentityUserSchema);

export default IdentityUser;
