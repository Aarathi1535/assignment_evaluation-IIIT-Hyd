import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import AuditLog from '../models/AuditLog';
import AuditLogIntegrityState from '../models/AuditLogIntegrityState';
import { writeAuditLog } from '../lib/audit';
import auditIntegrityService from '../services/AuditIntegrityService';

function assertReplicaSetTransactionsCapable(): void {
    const client = (mongoose.connection as unknown as { client?: { topology?: { description?: { type?: string } } } })?.client;
    const topologyType = client?.topology?.description?.type ?? 'Unknown';
    const isCapable = [
        'ReplicaSetWithPrimary',
        'ReplicaSetNoPrimary',
        'Sharded',
        'LoadBalanced',
    ].includes(topologyType);

    if (!isCapable) {
        throw new Error(
            `Transactions unavailable: topology '${topologyType}' does not support replica-set multi-document transactions. Standalone MongoDB fallback is strictly prohibited.`
        );
    }
}

describe('AuditLog Concurrent Transaction Regression Test (Replica Set)', () => {
    let replSet: MongoMemoryReplSet;

    beforeAll(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
        replSet = await MongoMemoryReplSet.create({
            replSet: { count: 1, storageEngine: 'wiredTiger' },
        });
        const uri = replSet.getUri();
        await mongoose.connect(uri);

        assertReplicaSetTransactionsCapable();

        // Ensure collections exist before multi-document transactions are executed
        if (mongoose.connection.db) {
            await mongoose.connection.db.createCollection('auditlogs').catch(() => {});
            await mongoose.connection.db.createCollection('auditlogintegritystates').catch(() => {});
        }
    }, 60000);

    afterAll(async () => {
        if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
        }
        if (replSet) {
            await replSet.stop();
        }
    }, 60000);

    beforeEach(async () => {
        if (mongoose.connection.readyState !== 0) {
            await AuditLog.collection.deleteMany({});
            await AuditLogIntegrityState.deleteMany({});
        }
    });

    it('enforces replica-set transactions requirement and strictly rejects standalone fallback', () => {
        expect(() => assertReplicaSetTransactionsCapable()).not.toThrow();
    });

    it('executes exactly two concurrent transactions each calling writeAuditLog with active session', async () => {
        assertReplicaSetTransactionsCapable();

        const actorId = new mongoose.Types.ObjectId();

        const runTransactionA = async () => {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const writeResult = await writeAuditLog({
                    user: actorId,
                    action: 'CONCURRENT_TX_A',
                    outcome: 'SUCCESS',
                    details: { thread: 'A' },
                    session,
                });
                expect(writeResult).toBe(true);
                await session.commitTransaction();
            } finally {
                await session.endSession();
            }
        };

        const runTransactionB = async () => {
            const session = await mongoose.startSession();
            session.startTransaction();
            try {
                const writeResult = await writeAuditLog({
                    user: actorId,
                    action: 'CONCURRENT_TX_B',
                    outcome: 'SUCCESS',
                    details: { thread: 'B' },
                    session,
                });
                expect(writeResult).toBe(true);
                await session.commitTransaction();
            } finally {
                await session.endSession();
            }
        };

        // Run both transactions concurrently
        await Promise.all([runTransactionA(), runTransactionB()]);

        // 4. Verify exactly two audit records are persisted with unique, continuous sequence numbers
        const logs = await AuditLog.find({
            action: { $in: ['CONCURRENT_TX_A', 'CONCURRENT_TX_B'] },
        })
            .select('+integritySeal +previousSeal')
            .sort({ sequence: 1 });

        expect(logs).toHaveLength(2);
        expect(logs[0].sequence).toBe(1);
        expect(logs[1].sequence).toBe(2);

        // Verify seals exist and match chain
        expect(logs[0].previousSeal).toBe('GENESIS');
        expect(logs[0].integritySeal).toBeDefined();
        expect(logs[1].previousSeal).toBe(logs[0].integritySeal);
        expect(logs[1].integritySeal).toBeDefined();

        // 5. Verify auditIntegrityService reports an intact trail with zero missing sequences
        const trail = await auditIntegrityService.verifyAuditTrail();
        expect(trail.valid).toBe(true);
        expect(trail.status).toBe('INTACT');
        expect(trail.sealedRecords).toBe(2);
        expect(trail.missingSequences).toBe(0);
        expect(trail.invalidSeals).toBe(0);
    });

    it('protects in-flight transaction lease from being prematurely cleared by post-save hooks', async () => {
        assertReplicaSetTransactionsCapable();

        const actorId = new mongoose.Types.ObjectId();
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            await writeAuditLog({
                user: actorId,
                action: 'IN_FLIGHT_LEASE_TEST',
                outcome: 'SUCCESS',
                details: { test: 'lease-retention' },
                session,
            });

            // Even after AuditLog document is saved inside the transaction,
            // leaseExpiresAt must NOT be cleared until the transaction completes,
            // protecting against premature orphan recovery.
            const state = await AuditLogIntegrityState.findById('global').lean();
            expect(state).not.toBeNull();
            expect(state!.leaseExpiresAt).toBeDefined();
            expect(new Date(state!.leaseExpiresAt!).getTime()).toBeGreaterThan(Date.now());

            await session.commitTransaction();
        } finally {
            await session.endSession();
        }
    });
});
