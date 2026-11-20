import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUserFederationLink extends Document {
  platformUserId: mongoose.Types.ObjectId;
  localUserId: string;
  product: 'EVALUATION' | 'CLASSROOM' | 'PRACTICE';
  linkedAt: Date;
  linkedBy: string;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const UserFederationLinkSchema = new Schema<IUserFederationLink>(
  {
    platformUserId: { type: Schema.Types.ObjectId, ref: 'IdentityUser', required: true, index: true },
    localUserId: { type: String, required: true, index: true },
    product: {
      type: String,
      enum: ['EVALUATION', 'CLASSROOM', 'PRACTICE'],
      required: true,
      index: true,
    },
    linkedAt: { type: Date, default: Date.now },
    linkedBy: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    collection: 'user_federation_links',
  }
);

UserFederationLinkSchema.index({ platformUserId: 1, product: 1 }, { unique: true });
UserFederationLinkSchema.index({ localUserId: 1, product: 1 }, { unique: true });

const UserFederationLink: Model<IUserFederationLink> =
  mongoose.models.UserFederationLink ||
  mongoose.model<IUserFederationLink>('UserFederationLink', UserFederationLinkSchema);

export default UserFederationLink;
