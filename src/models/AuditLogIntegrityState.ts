import mongoose, { Model, Schema } from 'mongoose';

export interface IAuditLogIntegrityState {
    _id: string;
    lastSequence: number;
    integritySeal?: string;
    integrityKeyId?: string;
}

const AuditLogIntegrityStateSchema = new Schema<IAuditLogIntegrityState>(
    {
        _id: { type: String, required: true },
        lastSequence: { type: Number, required: true, min: 0 },
        integritySeal: { type: String, select: false },
        integrityKeyId: { type: String, select: false }
    },
    { versionKey: false }
);

const AuditLogIntegrityState: Model<IAuditLogIntegrityState> =
    mongoose.models.AuditLogIntegrityState ||
    mongoose.model<IAuditLogIntegrityState>('AuditLogIntegrityState', AuditLogIntegrityStateSchema);

export default AuditLogIntegrityState;
