import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAuditLog extends Document {
    user: mongoose.Types.ObjectId;
    action: string;
    outcome?: 'SUCCESS' | 'FAILURE';
    entityId?: mongoose.Types.ObjectId;
    entityType?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    createdAt: Date;
}

const AuditLogSchema = new Schema<IAuditLog>(
    {
        user: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        action: {
            type: String,
            required: true,
            trim: true,
            index: true
        },
        outcome: {
            type: String,
            enum: ['SUCCESS', 'FAILURE'],
            index: true
        },
        entityId: {
            type: Schema.Types.ObjectId,
            index: true
        },
        entityType: {
            type: String,
            trim: true
        },
        details: {
            type: Schema.Types.Mixed
        },
        ipAddress: {
            type: String,
            trim: true
        }
    },
    {
        timestamps: { createdAt: true, updatedAt: false }
    }
);

// Index for query sorting logs chronologically
AuditLogSchema.index({ createdAt: -1 });

// Safeguards: Reject application-level updates and deletes (AE-179)
AuditLogSchema.pre(['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace'], function () {
    throw new Error('AuditLog records are immutable and cannot be updated.');
});

AuditLogSchema.pre('deleteOne', { document: true, query: true }, function () {
    throw new Error('AuditLog records are append-only and cannot be deleted.');
});

AuditLogSchema.pre('findOneAndDelete', function () {
    throw new Error('AuditLog records are append-only and cannot be deleted.');
});

AuditLogSchema.pre('save', function () {
    if (!this.isNew) {
        throw new Error('AuditLog records are immutable and cannot be updated.');
    }
});

AuditLogSchema.pre('deleteMany', function () {
    throw new Error('AuditLog records are append-only and cannot be deleted.');
});

AuditLogSchema.pre('bulkWrite', function (...args: unknown[]) {
    const operations = Array.isArray(args[0]) ? args[0] : [];
    for (const op of operations) {
        if (op && typeof op === 'object') {
            if ('updateOne' in op || 'updateMany' in op || 'replaceOne' in op) {
                throw new Error('AuditLog records are immutable and cannot be updated.');
            }
            if ('deleteOne' in op || 'deleteMany' in op) {
                throw new Error('AuditLog records are append-only and cannot be deleted.');
            }
        }
    }
});

const AuditLog: Model<IAuditLog> = mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);

export default AuditLog;
