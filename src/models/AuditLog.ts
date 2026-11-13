import mongoose, { Schema, Document, Model } from 'mongoose';
import crypto from 'crypto';
import AuditLogIntegrityState, { IAuditLogIntegrityState } from './AuditLogIntegrityState';
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
    previousSeal?: string;
    integritySeal?: string;
    integrityKeyId?: string;
    allocationToken?: string;
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
        previousSeal: {
            type: String,
            select: false
        },
        integritySeal: {
            type: String,
            select: false
        },
        integrityKeyId: {
            type: String,
            select: false
        },
        allocationToken: {
            type: String,
            select: false
        }
    },
    {
        timestamps: { createdAt: true, updatedAt: false }
    }
);

// In-process lock to serialize sequence allocation within a single Node.js process
let sequenceLock = Promise.resolve();

async function withSequenceLock<T>(fn: () => Promise<T>): Promise<T> {
    let release: () => void;
    const nextLock = new Promise<void>((resolve) => {
        release = resolve;
    });
    const currentLock = sequenceLock;
    sequenceLock = currentLock.then(() => nextLock);
    await currentLock;
    try {
        return await fn();
    } finally {
        release!();
    }
}

async function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export interface ReconcileOptions {
    maxWaitMs?: number;
    force?: boolean;
}

/**
 * Reconciles an orphaned integrity state if a process crashed or aborted
 * between sequence allocation and audit insertion.
 *
 * Coordination Mechanism:
 * Active allocations hold an allocation lease (`leaseExpiresAt`).
 * If a record is not yet committed to AuditLog:
 * - If the lease is active (not expired), the write is actively in-flight on another
 *   instance. Recovery will NOT mistake it for an orphan or roll it back.
 * - If maxWaitMs > 0, it coordinates by waiting for the in-flight write to complete.
 * - Only when the lease is confirmed expired and the record does not exist does recovery
 *   reconcile the state back to the latest confirmed committed record.
 */
export async function reconcileOrphanedIntegrityState(
    state: IAuditLogIntegrityState,
    options: ReconcileOptions = {}
): Promise<IAuditLogIntegrityState> {
    if (state.lastSequence <= 0) {
        return state;
    }

    // 1. Check if the record for state.lastSequence actually exists in AuditLog
    let recordExists = await AuditLog.exists({ sequence: state.lastSequence });
    if (recordExists) {
        return state;
    }

    // 2. Check if an active instance holds a valid allocation lease
    const now = Date.now();
    const leaseExpiresAt = state.leaseExpiresAt ? new Date(state.leaseExpiresAt).getTime() : 0;
    const isLeaseActive = !options.force && leaseExpiresAt > now;

    // 3. If an active lease is held and wait is allowed, coordinate by waiting
    // for the in-flight write to finish persisting.
    const maxWaitMs = options.maxWaitMs ?? (isLeaseActive ? Math.min(leaseExpiresAt - now, 2000) : 0);
    if (maxWaitMs > 0) {
        const pollInterval = 25;
        const startTime = Date.now();
        while (Date.now() - startTime < maxWaitMs) {
            await sleep(pollInterval);
            recordExists = await AuditLog.exists({ sequence: state.lastSequence });
            if (recordExists) {
                return state;
            }
            if (state.leaseExpiresAt && Date.now() >= new Date(state.leaseExpiresAt).getTime()) {
                break;
            }
        }
    }

    // 4. Re-check existence after wait
    recordExists = await AuditLog.exists({ sequence: state.lastSequence });
    if (recordExists) {
        return state;
    }

    // 5. If the lease is STILL active (or unforced), this write is actively in-flight
    // on another Cloud Run instance. We MUST NOT treat it as an orphan or roll it back.
    if (!options.force && state.leaseExpiresAt && new Date(state.leaseExpiresAt).getTime() > Date.now()) {
        return state;
    }

    // 6. Confirmed crash/orphan (lease expired or absent): heal state back to actual committed record
    const actualLatestRecord = await AuditLog.findOne({
        sequence: { $exists: true, $ne: null }
    })
        .select('+integritySeal sequence')
        .sort({ sequence: -1 })
        .lean()
        .exec();

    const actualSequence = actualLatestRecord?.sequence ?? 0;
    const actualHmac = actualLatestRecord?.integritySeal || undefined;
    const cutoverSequence = state.cutoverSequence ?? 1;

    const healedStateSeal = actualSequence > 0
        ? createAuditIntegrityStateSeal(actualSequence, actualHmac, cutoverSequence)
        : { hmac: undefined, keyId: undefined };

    // Atomic CAS: only heal if state.lastSequence has not changed in the meantime
    const healedState = await AuditLogIntegrityState.findOneAndUpdate(
        {
            _id: 'global',
            lastSequence: state.lastSequence
        },
        {
            $set: {
                lastSequence: actualSequence,
                lastRecordHmac: actualHmac || null,
                cutoverSequence,
                integritySeal: healedStateSeal.hmac || null,
                integrityKeyId: healedStateSeal.keyId || null,
                lastAllocatedAt: new Date()
            },
            $unset: {
                leaseExpiresAt: 1,
                allocationToken: 1
            }
        },
        { returnDocument: 'after', lean: true }
    );

    return healedState || state;
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

export interface AllocatedAuditSequence {
    sequence: number;
    previousSeal: string;
    integritySeal: string;
    integrityKeyId: string;
    allocationToken: string;
    createdAt: Date;
}

/**
 * Allocates a sequence number, generates HMAC seals, and records an allocation lease
 * with atomic Compare-and-Swap (CAS) on AuditLogIntegrityState.
 */
export async function allocateAuditSequence(
    recordData: {
        user: mongoose.Types.ObjectId | string;
        action: string;
        outcome?: 'SUCCESS' | 'FAILURE';
        entityId?: mongoose.Types.ObjectId | string;
        entityType?: string;
        details?: unknown;
        ipAddress?: string;
        createdAt?: Date;
    },
    options?: { leaseDurationMs?: number }
): Promise<AllocatedAuditSequence> {
    return withSequenceLock(async () => {
        const maxRetries = 10;
        let lastError: unknown = null;
        const leaseDurationMs = options?.leaseDurationMs ?? (process.env.AUDIT_ALLOCATION_LEASE_MS
            ? parseInt(process.env.AUDIT_ALLOCATION_LEASE_MS, 10)
            : 5000);

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                let state: IAuditLogIntegrityState | null = await AuditLogIntegrityState.findById('global')
                    .lean()
                    .exec();

                if (!state) {
                    try {
                        const created = await AuditLogIntegrityState.create({
                            _id: 'global',
                            lastSequence: 0,
                            cutoverSequence: 1,
                            cutoverDate: new Date(),
                            lastAllocatedAt: new Date()
                        });
                        state = created.toObject();
                    } catch (err) {
                        if (!isDuplicateKeyError(err)) throw err;
                        state = await AuditLogIntegrityState.findById('global')
                            .lean()
                            .exec();
                    }
                }

                if (!state) {
                    throw new Error('Could not allocate an audit-log sequence state.');
                }

                // Check and reconcile any crashed/orphaned allocation before advancing sequence.
                state = await reconcileOrphanedIntegrityState(state);

                // If another instance is actively persisting state.lastSequence within its lease,
                // wait for it to commit before allocating nextSequence.
                if (state.lastSequence > 0 && !await AuditLog.exists({ sequence: state.lastSequence })) {
                    const isLeaseActive = state.leaseExpiresAt && new Date(state.leaseExpiresAt).getTime() > Date.now();
                    if (isLeaseActive && attempt < maxRetries) {
                        await sleep(50 * attempt);
                        continue;
                    }
                }

                const nextSequence = state.lastSequence + 1;
                const cutoverSequence = state.cutoverSequence ?? 1;
                const previousSeal = nextSequence <= cutoverSequence
                    ? 'GENESIS'
                    : (state.lastRecordHmac || 'GENESIS');

                const createdAt = recordData.createdAt || new Date();
                const allocationToken = crypto.randomUUID();
                const leaseExpiresAt = new Date(Date.now() + leaseDurationMs);

                const integritySeal = createAuditIntegritySeal({
                    user: recordData.user,
                    action: recordData.action,
                    outcome: recordData.outcome,
                    entityId: recordData.entityId,
                    entityType: recordData.entityType,
                    details: recordData.details,
                    ipAddress: recordData.ipAddress,
                    createdAt,
                    sequence: nextSequence,
                    previousSeal
                }, nextSequence);

                const stateSeal = createAuditIntegrityStateSeal(nextSequence, integritySeal.hmac, cutoverSequence);

                // Atomic CAS condition: lastSequence must match state.lastSequence
                // across any and all application instances.
                const updatedState = await AuditLogIntegrityState.findOneAndUpdate(
                    {
                        _id: 'global',
                        lastSequence: state.lastSequence
                    },
                    {
                        $set: {
                            lastSequence: nextSequence,
                            lastRecordHmac: integritySeal.hmac,
                            cutoverSequence,
                            integritySeal: stateSeal.hmac,
                            integrityKeyId: stateSeal.keyId,
                            lastAllocatedAt: new Date(),
                            leaseExpiresAt,
                            allocationToken
                        }
                    },
                    { returnDocument: 'after', lean: true }
                );

                if (!updatedState) {
                    // Contention across instances: retry to re-read updated state, chain, and CAS again.
                    if (attempt < maxRetries) {
                        await sleep(10 * attempt + Math.floor(Math.random() * 20));
                        continue;
                    }
                    throw new Error('Could not allocate an audit-log sequence due to concurrent contention.');
                }

                return {
                    sequence: nextSequence,
                    previousSeal,
                    integritySeal: integritySeal.hmac,
                    integrityKeyId: integritySeal.keyId,
                    allocationToken,
                    createdAt
                };
            } catch (err) {
                lastError = err;
                if (attempt < maxRetries) {
                    await sleep(10 * attempt + Math.floor(Math.random() * 20));
                }
            }
        }

        throw lastError || new Error('Could not allocate an audit-log sequence.');
    });
}

AuditLogSchema.pre('save', async function () {
    if (!this.isNew) {
        throw new Error('AuditLog records are immutable and cannot be updated.');
    }

    // 1. If sequence was not yet allocated, allocate it now
    if (!this.sequence) {
        const allocation = await allocateAuditSequence({
            user: this.user,
            action: this.action,
            outcome: this.outcome,
            entityId: this.entityId,
            entityType: this.entityType,
            details: this.details,
            ipAddress: this.ipAddress,
            createdAt: this.createdAt
        });

        this.sequence = allocation.sequence;
        this.previousSeal = allocation.previousSeal;
        this.integritySeal = allocation.integritySeal;
        this.integrityKeyId = allocation.integrityKeyId;
        this.allocationToken = allocation.allocationToken;
        this.createdAt = allocation.createdAt;
    }

    // 2. Fencing verification: prove that this writer's allocation token is still current and valid.
    // An instance whose lease expired or was recovered by another instance will be fenced and rejected.
    if (this.allocationToken) {
        const currentState = await AuditLogIntegrityState.findById('global').lean();
        const isLeaseActive = currentState?.leaseExpiresAt
            ? new Date(currentState.leaseExpiresAt).getTime() > Date.now()
            : false;

        const isCurrent = currentState &&
            currentState.lastSequence === this.sequence &&
            currentState.allocationToken === this.allocationToken &&
            isLeaseActive;

        if (!isCurrent) {
            throw new Error(
                `Stale write rejected: allocation token for sequence ${this.sequence} has expired or been superseded.`
            );
        }
    }
});

AuditLogSchema.post('save', async function () {
    if (this.sequence && this.allocationToken) {
        try {
            await AuditLogIntegrityState.updateOne(
                {
                    _id: 'global',
                    lastSequence: this.sequence,
                    allocationToken: this.allocationToken
                },
                { $unset: { leaseExpiresAt: 1, allocationToken: 1 } }
            );
        } catch {
            // Best-effort cleanup: the document already exists in AuditLog
        }
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

const AuditLog: Model<IAuditLog> =
    mongoose.models.AuditLog || mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);

export default AuditLog;
