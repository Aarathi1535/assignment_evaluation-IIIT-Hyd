import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IAuditLog extends Document {
    user: mongoose.Types.ObjectId;
    action: string;
    entityId?: mongoose.Types.ObjectId;
    entityType?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    createdAt: Date;
    updatedAt: Date;
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
        timestamps: true
    }
);

// Index for query sorting logs chronologically
AuditLogSchema.index({ createdAt: -1 });

const AuditLog: Model<IAuditLog> = mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);

export default AuditLog;
