import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IApiClientCredential extends Document {
  clientId: string;
  clientSecretHash: string;
  name: string;
  ownerId: string;
  scopes: {
    service: 'evaluation-service' | 'classroom-service' | 'practice-service' | 'identity-service';
    actions: ('read' | 'write' | 'admin')[];
  }[];
  isActive: boolean;
  expiresAt?: Date;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ApiClientCredentialSchema = new Schema<IApiClientCredential>(
  {
    clientId: { type: String, required: true, unique: true, index: true },
    clientSecretHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    ownerId: { type: String, required: true, index: true },
    scopes: [
      {
        service: {
          type: String,
          enum: ['evaluation-service', 'classroom-service', 'practice-service', 'identity-service'],
          required: true,
        },
        actions: [{ type: String, enum: ['read', 'write', 'admin'] }],
      },
    ],
    isActive: { type: Boolean, default: true },
    expiresAt: { type: Date },
    lastUsedAt: { type: Date },
  },
  {
    timestamps: true,
    collection: 'api_client_credentials',
  }
);

const ApiClientCredential: Model<IApiClientCredential> =
  mongoose.models.ApiClientCredential ||
  mongoose.model<IApiClientCredential>('ApiClientCredential', ApiClientCredentialSchema);

export default ApiClientCredential;
