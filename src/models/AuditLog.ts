import mongoose, { Schema, Document, Model } from 'mongoose';
import AuditLogIntegrityState from './AuditLogIntegrityState';
import { createAuditIntegritySeal, createAuditIntegrityStateSeal } from '../lib/auditIntegrity';
import { isDuplicateKeyError } from '../lib/errors';

export interface IAuditLog extends Document {
    user: mongoose.Types.ObjectId;
    action: string;
    outcome?: 'SUCCESS' | 'FAILURE';
    entityId?: mongoose.Types.ObjectId;
    entityType?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    createdAt: Date;
    sequence?: number;
    integritySeal?: string;
    integrityKeyId?: string;
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
        },
        sequence: {
            type: Number,
            min: 1
        },
        integritySeal: {
            type: String,
            select: false
        },
        integrityKeyId: {
            type: String,
            select: false
        }
    },
    {
        timestamps: { createdAt: true, updatedAt: false }
    }
);

async function allocateAuditSequence(session?: mongoose.ClientSession) {
    try {
        return await AuditLogIntegrityState.findOneAndUpdate(
            { _id: 'global' },
            { $inc: { lastSequence: 1 } },
            { upsert: true, returnDocument: 'after', session }
        );
    } catch (error) {
        if (!isDuplicateKeyError(error)) throw error;
        return AuditLogIntegrityState.findOneAndUpdate(
            { _id: 'global' },
            { $inc: { lastSequence: 1 } },
            { returnDocument: 'after', session }
        );
    }
}

// Index for query sorting logs chronologically
AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ user: 1, createdAt: -1 });
AuditLogSchema.index({ entityId: 1, createdAt: -1 });
AuditLogSchema.index({ 'details.examId': 1, createdAt: -1 });
AuditLogSchema.index({ 'details.exam': 1, createdAt: -1 });
AuditLogSchema.index({ sequence: 1 }, { unique: true, sparse: true });

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

AuditLogSchema.pre('save', async function () {
    if (!this.isNew) {
        throw new Error('AuditLog records are immutable and cannot be updated.');
    }
    const session = this.$session() || undefined;
    const state = await allocateAuditSequence(session);
    if (!state) {
        throw new Error('Could not allocate an audit-log sequence.');
    }

    this.createdAt = this.createdAt || new Date();
    const integritySeal = createAuditIntegritySeal({
        user: this.user,
        action: this.action,
        outcome: this.outcome,
        entityId: this.entityId,
        entityType: this.entityType,
        details: this.details,
        ipAddress: this.ipAddress,
        createdAt: this.createdAt
    }, state.lastSequence);
    this.sequence = state.lastSequence;
    this.integritySeal = integritySeal.hmac;
    this.integrityKeyId = integritySeal.keyId;

    const stateSeal = createAuditIntegrityStateSeal(state.lastSequence);
    await AuditLogIntegrityState.updateOne(
        { _id: 'global', lastSequence: state.lastSequence },
        { $set: { integritySeal: stateSeal.hmac, integrityKeyId: stateSeal.keyId } },
        { session }
    );
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
