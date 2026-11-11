import mongoose, { Model, Schema } from 'mongoose';

export interface IAuditLogIntegrityState {
    _id: string;
    lastSequence: number;
    cutoverSequence?: number;
    lastRecordHmac?: string;
    cutoverDate?: Date;
    lastAllocatedAt?: Date;
    leaseExpiresAt?: Date | null;
    allocationToken?: string | null;
    integritySeal?: string;
    integrityKeyId?: string;
}

const AuditLogIntegrityStateSchema = new Schema<IAuditLogIntegrityState>(
    {
        _id: { type: String, required: true },
        lastSequence: { type: Number, required: true, min: 0 },
        cutoverSequence: { type: Number, default: 1 },
        lastRecordHmac: { type: String },
        cutoverDate: { type: Date, default: () => new Date() },
        lastAllocatedAt: { type: Date },
        leaseExpiresAt: { type: Date },
        allocationToken: { type: String },
        integritySeal: { type: String },
        integrityKeyId: { type: String }
    },
    { versionKey: false }
);

const AuditLogIntegrityState: Model<IAuditLogIntegrityState> =
    mongoose.models.AuditLogIntegrityState ||
    mongoose.model<IAuditLogIntegrityState>('AuditLogIntegrityState', AuditLogIntegrityStateSchema);

export default AuditLogIntegrityState;
