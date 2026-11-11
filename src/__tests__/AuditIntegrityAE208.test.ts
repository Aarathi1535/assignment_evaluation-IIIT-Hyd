import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import crypto from 'crypto';
import AuditLog, { allocateAuditSequence, reconcileOrphanedIntegrityState } from '../models/AuditLog';
import AuditLogIntegrityState from '../models/AuditLogIntegrityState';
import User, { UserRole } from '../models/User';
import { writeAuditLog } from '../lib/audit';
import { createAuditIntegritySeal, createAuditIntegrityStateSeal } from '../lib/auditIntegrity';
import auditIntegrityService from '../services/AuditIntegrityService';

let mockSessionUser: { id: string; role: UserRole } | null = null;

vi.mock('next-auth', async (importOriginal) => {
    const original = await importOriginal<typeof import('next-auth')>();
    return {
        ...original,
        getServerSession: vi.fn().mockImplementation(() => (
            mockSessionUser ? { user: mockSessionUser } : null
        ))
    };
});

function isTransactionCapable(): boolean {
    const client = (mongoose.connection as unknown as { client?: { topology?: { description?: { type?: string } } } })?.client;
    const topology = client?.topology;
    const topologyType = (topology?.description?.type as string | undefined) ?? 'Unknown';
    return [
        'ReplicaSetWithPrimary',
        'ReplicaSetNoPrimary',
        'Sharded',
        'LoadBalanced',
    ].includes(topologyType);
}

describe('AE-208 audit-trail integrity verification', () => {
    let verifyRoute: typeof import('../app/api/audit-logs/verify/route').POST;

    beforeAll(async () => {
        verifyRoute = (await import('../app/api/audit-logs/verify/route')).POST;
    });

    afterEach(() => {
        mockSessionUser = null;
    });

    async function createActor(role = UserRole.PROFESSOR) {
        const suffix = `${Date.now()}-${Math.random()}`;
        return User.create({
            name: 'Audit Actor',
            email: `audit-${suffix}@example.edu`,
            password: 'Password@123',
            role,
            isActive: true
        });
    }

    async function writeRecords(userId: string) {
        await writeAuditLog({
            user: userId,
            action: 'EXAM_UPDATED',
            outcome: 'SUCCESS',
            details: { before: { title: 'Midterm' }, after: { title: 'Midterm 1' } }
        });
        await writeAuditLog({
            user: userId,
            action: 'GRADE_FINALIZED',
            outcome: 'SUCCESS',
            details: { score: 8 }
        });
    }

    it('verifies a valid sealed trail without returning seal material', async () => {
        const actor = await createActor();
        await writeRecords(actor._id.toString());

        const result = await auditIntegrityService.verifyAuditTrail();
        expect(result).toMatchObject({
            status: 'INTACT',
            valid: true,
            checkedRecords: 2,
            sealedRecords: 2,
            unsealedRecords: 0,
            invalidSeals: 0,
            missingSequences: 0
        });
        expect(JSON.stringify(result)).not.toContain('test-storage-hmac-secret');
        expect(JSON.stringify(result)).not.toContain('integritySeal');
    });

    it('keeps concurrent audit writes in a verifiable sequence and unbroken cryptographic chain', async () => {
        const actor = await createActor();
        const writes = await Promise.all(Array.from({ length: 8 }, (_, index) =>
            writeAuditLog({
                user: actor._id.toString(),
                action: `CONCURRENT_EVENT_${index}`,
                outcome: 'SUCCESS'
            })
        ));

        expect(writes.every(Boolean)).toBe(true);
        const result = await auditIntegrityService.verifyAuditTrail();
        expect(result.status).toBe('INTACT');
        expect(result.valid).toBe(true);
        expect(result.checkedRecords).toBe(8);
        expect(result.missingSequences).toBe(0);

        // Verify cryptographic hash chain continuity across all records
        const records = await AuditLog.find({})
            .select('+previousSeal +integritySeal sequence')
            .sort({ sequence: 1 })
            .lean();
        expect(records.length).toBe(8);
        for (let i = 0; i < records.length; i++) {
            expect(records[i].sequence).toBe(i + 1);
            if (i === 0) {
                expect(records[i].previousSeal).toBe('GENESIS');
            } else {
                expect(records[i].previousSeal).toBe(records[i - 1].integritySeal);
            }
        }
    });

    it('executes concurrent transactional audit writes without WriteConflicts on the global counter', async () => {
        const actor = await createActor();

        // Simulate 4 concurrent business transactions (e.g. grading or publishing)
        const runTx = async (index: number) => {
            const transactionCapable = isTransactionCapable();
            const session = await mongoose.startSession();
            try {
                if (transactionCapable) {
                    await session.withTransaction(async () => {
                        await writeAuditLog({
                            user: actor._id.toString(),
                            action: `TRANSACTION_EVENT_${index}`,
                            outcome: 'SUCCESS',
                            details: { txIndex: index },
                            session
                        });
                    });
                } else {
                    await writeAuditLog({
                        user: actor._id.toString(),
                        action: `TRANSACTION_EVENT_${index}`,
                        outcome: 'SUCCESS',
                        details: { txIndex: index }
                    });
                }
            } finally {
                await session.endSession();
            }
        };

        await expect(Promise.all([runTx(1), runTx(2), runTx(3), runTx(4)])).resolves.not.toThrow();

        const result = await auditIntegrityService.verifyAuditTrail();
        expect(result.status).toBe('INTACT');
        expect(result.valid).toBe(true);
        expect(result.sealedRecords).toBe(4);
        expect(result.missingSequences).toBe(0);
    });

    it('detects changed records and sequence tampering with safe diagnostics', async () => {
        const actor = await createActor();
        await writeRecords(actor._id.toString());
        const record = await AuditLog.findOne({ action: 'EXAM_UPDATED' });
        if (!record) throw new Error('Expected a sealed audit record');

        await AuditLog.collection.updateOne({ _id: record._id }, { $set: { action: 'REWRITTEN' } });
        const changed = await auditIntegrityService.verifyAuditTrail();
        expect(changed.status).toBe('MISMATCH');
        expect(changed.invalidSeals).toBeGreaterThan(0);
        expect(changed.diagnostics.some(item => item.code === 'SEAL_INVALID')).toBe(true);

        const laterRecord = await AuditLog.findOne({ action: 'GRADE_FINALIZED' });
        if (!laterRecord) throw new Error('Expected a second sealed audit record');
        await AuditLog.collection.updateOne(
            { _id: laterRecord._id },
            { $set: { sequence: (laterRecord.sequence || 0) + 10 } }
        );
        const reordered = await auditIntegrityService.verifyAuditTrail();
        expect(reordered.status).toBe('MISMATCH');
        expect(reordered.missingSequences).toBeGreaterThan(0);
    });

    it('detects deleted records', async () => {
        const actor = await createActor();
        await writeRecords(actor._id.toString());
        const first = await AuditLog.findOne({ action: 'EXAM_UPDATED' });
        if (!first) throw new Error('Expected a sealed audit record');
        await AuditLog.collection.deleteOne({ _id: first._id });

        const deleted = await auditIntegrityService.verifyAuditTrail();
        expect(deleted.status).toBe('MISMATCH');
        expect(deleted.missingSequences).toBe(1);
    });

    it('detects deletion of the newest record and tampering with the signed high-water mark', async () => {
        const actor = await createActor();
        await writeRecords(actor._id.toString());
        const newest = await AuditLog.findOne({ action: 'GRADE_FINALIZED' });
        if (!newest) throw new Error('Expected the newest sealed audit record');
        await AuditLog.collection.deleteOne({ _id: newest._id });

        const deletedTail = await auditIntegrityService.verifyAuditTrail();
        expect(deletedTail.status).toBe('MISMATCH');
        expect(deletedTail.missingSequences).toBe(1);

        await writeRecords(actor._id.toString());
        await AuditLogIntegrityState.updateOne(
            { _id: 'global' },
            { $set: { lastSequence: 1 } }
        );
        const tamperedState = await auditIntegrityService.verifyAuditTrail();
        expect(tamperedState.status).toBe('MISMATCH');
        expect(tamperedState.diagnostics.some(item => item.code === 'INTEGRITY_STATE_INVALID')).toBe(true);
    });

    it('reports legacy audit entries as unsealed without changing them', async () => {
        const actor = await createActor();
        await AuditLog.collection.insertOne({
            user: actor._id,
            action: 'LEGACY_UNSEALED',
            outcome: 'SUCCESS',
            createdAt: new Date()
        });
        const unsealed = await auditIntegrityService.verifyAuditTrail();
        expect(unsealed.status).toBe('UNSEALED');
        expect(unsealed.unsealedRecords).toBe(1);
        expect(unsealed.valid).toBe(false);
    });

    it('allows legacy pre-cutover records to coexist with a valid post-cutover sealed trail', async () => {
        const actor = await createActor();
        // Insert legacy unsealed record with past timestamp
        await AuditLog.collection.insertOne({
            user: actor._id,
            action: 'PRE_CUTOVER_LEGACY',
            outcome: 'SUCCESS',
            createdAt: new Date('2020-01-01T00:00:00.000Z')
        });

        // Write sealed post-cutover records
        await writeRecords(actor._id.toString());

        const result = await auditIntegrityService.verifyAuditTrail();
        expect(result.status).toBe('INTACT');
        expect(result.valid).toBe(true);
        expect(result.unsealedRecords).toBe(1);
        expect(result.sealedRecords).toBe(2);
    });

    it('recovers from a crash failure between sequence allocation and audit insertion on subsequent write', async () => {
        const actor = await createActor();

        // 1. Write an initial valid record (sequence 1)
        await writeAuditLog({
            user: actor._id.toString(),
            action: 'INITIAL_EVENT',
            outcome: 'SUCCESS'
        });

        const initialResult = await auditIntegrityService.verifyAuditTrail();
        expect(initialResult.status).toBe('INTACT');
        expect(initialResult.checkedRecords).toBe(1);

        // 2. Simulate a crash between sequence allocation and audit insertion:
        // Sequence 2 is allocated and state is updated via CAS, but the process "crashes"
        // before inserting the AuditLog document for sequence 2.
        const ghostSeal = 'ghost-hmac-simulating-crashed-insert';
        const ghostStateSeal = createAuditIntegrityStateSeal(2, ghostSeal, 1);
        await AuditLogIntegrityState.updateOne(
            { _id: 'global' },
            {
                $set: {
                    lastSequence: 2,
                    lastRecordHmac: ghostSeal,
                    cutoverSequence: 1,
                    integritySeal: ghostStateSeal.hmac,
                    integrityKeyId: ghostStateSeal.keyId,
                    lastAllocatedAt: new Date(Date.now() - 500)
                }
            }
        );

        // Verify that record 2 does NOT exist in AuditLog
        expect(await AuditLog.exists({ sequence: 2 })).toBeNull();

        // 3. A subsequent audit write occurs
        const writeSuccess = await writeAuditLog({
            user: actor._id.toString(),
            action: 'RECOVERED_EVENT',
            outcome: 'SUCCESS',
            details: { test: 'recovery' }
        });
        expect(writeSuccess).toBe(true);

        // 4. Verify that:
        // - There is no broken chain
        // - There is no duplicate sequence
        // - State seal and record HMAC are valid
        // - verifyAuditTrail returns INTACT
        const records = await AuditLog.find({})
            .select('+previousSeal +integritySeal sequence action')
            .sort({ sequence: 1 })
            .lean();

        expect(records.length).toBe(2);
        expect(records[0].sequence).toBe(1);
        expect(records[0].action).toBe('INITIAL_EVENT');
        expect(records[0].previousSeal).toBe('GENESIS');

        expect(records[1].sequence).toBe(2);
        expect(records[1].action).toBe('RECOVERED_EVENT');
        // previousSeal must chain to record 1's HMAC, NOT the ghost HMAC!
        expect(records[1].previousSeal).toBe(records[0].integritySeal);
        expect(records[1].previousSeal).not.toBe(ghostSeal);

        const state = await AuditLogIntegrityState.findById('global')
            .select('+lastRecordHmac +integritySeal')
            .lean();
        expect(state?.lastSequence).toBe(2);
        expect(state?.lastRecordHmac).toBe(records[1].integritySeal);

        const finalResult = await auditIntegrityService.verifyAuditTrail();
        expect(finalResult.status).toBe('INTACT');
        expect(finalResult.valid).toBe(true);
        expect(finalResult.checkedRecords).toBe(2);
        expect(finalResult.sealedRecords).toBe(2);
        expect(finalResult.invalidSeals).toBe(0);
        expect(finalResult.missingSequences).toBe(0);
    });

    it('recovers from a crash failure when genesis record allocation fails before insertion', async () => {
        const actor = await createActor();

        // Simulate crash on sequence 1: state is at 1, but AuditLog is completely empty
        const ghostSeal = 'ghost-genesis-hmac';
        const ghostStateSeal = createAuditIntegrityStateSeal(1, ghostSeal, 1);
        await AuditLogIntegrityState.create({
            _id: 'global',
            lastSequence: 1,
            lastRecordHmac: ghostSeal,
            cutoverSequence: 1,
            integritySeal: ghostStateSeal.hmac,
            integrityKeyId: ghostStateSeal.keyId,
            lastAllocatedAt: new Date(Date.now() - 500)
        });

        expect(await AuditLog.countDocuments({})).toBe(0);

        // Subsequent write should heal genesis and insert sequence 1
        const writeSuccess = await writeAuditLog({
            user: actor._id.toString(),
            action: 'FIRST_COMMITTED_EVENT',
            outcome: 'SUCCESS'
        });
        expect(writeSuccess).toBe(true);

        const records = await AuditLog.find({})
            .select('+previousSeal +integritySeal sequence action')
            .sort({ sequence: 1 })
            .lean();

        expect(records.length).toBe(1);
        expect(records[0].sequence).toBe(1);
        expect(records[0].previousSeal).toBe('GENESIS');
        expect(records[0].action).toBe('FIRST_COMMITTED_EVENT');

        const state = await AuditLogIntegrityState.findById('global')
            .select('+lastRecordHmac +integritySeal')
            .lean();
        expect(state?.lastSequence).toBe(1);
        expect(state?.lastRecordHmac).toBe(records[0].integritySeal);

        const result = await auditIntegrityService.verifyAuditTrail();
        expect(result.status).toBe('INTACT');
        expect(result.valid).toBe(true);
    });

    it('does not mistake an active in-flight write on another instance for an orphan during recovery', async () => {
        const actor = await createActor();

        // 1. Initial valid committed record (sequence 1)
        await writeAuditLog({
            user: actor._id.toString(),
            action: 'INITIAL_COMMITTED_EVENT',
            outcome: 'SUCCESS'
        });

        const initialResult = await auditIntegrityService.verifyAuditTrail();
        expect(initialResult.status).toBe('INTACT');
        expect(initialResult.checkedRecords).toBe(1);

        // 2. Instance 1 allocates sequence 2 with an active lease (valid for 5 seconds),
        // but pauses before inserting the AuditLog document.
        const instance1Token = crypto.randomUUID();
        const activeLeaseExpiry = new Date(Date.now() + 5000);
        const record2CreatedAt = new Date();

        const initialRecord = await AuditLog.findOne({ sequence: 1 }).select('+integritySeal').lean();
        const seal2 = createAuditIntegritySeal({
            user: actor._id.toString(),
            action: 'ACTIVE_INSTANCE_EVENT',
            outcome: 'SUCCESS',
            details: { instance: 'instance-1' },
            createdAt: record2CreatedAt,
            sequence: 2,
            previousSeal: initialRecord!.integritySeal
        }, 2);

        const stateSeal2 = createAuditIntegrityStateSeal(2, seal2.hmac, 1);

        await AuditLogIntegrityState.updateOne(
            { _id: 'global' },
            {
                $set: {
                    lastSequence: 2,
                    lastRecordHmac: seal2.hmac,
                    cutoverSequence: 1,
                    integritySeal: stateSeal2.hmac,
                    integrityKeyId: stateSeal2.keyId,
                    lastAllocatedAt: new Date(),
                    leaseExpiresAt: activeLeaseExpiry,
                    allocationToken: instance1Token
                }
            }
        );

        // Sequence 2 does NOT exist yet in AuditLog (Instance 1 is paused)
        expect(await AuditLog.exists({ sequence: 2 })).toBeNull();

        // 3. Instance 2 attempts recovery while Instance 1 is paused
        const stateBefore = await AuditLogIntegrityState.findById('global').lean();
        expect(stateBefore?.lastSequence).toBe(2);

        // Instance 2 executes recovery check
        const recoveredState = await reconcileOrphanedIntegrityState(stateBefore!, { maxWaitMs: 0 });

        // VERIFY: The active write was NOT mistaken for an orphan!
        // lastSequence was NOT rolled back to 1
        expect(recoveredState.lastSequence).toBe(2);

        const stateAfterAttempt = await AuditLogIntegrityState.findById('global').lean();
        expect(stateAfterAttempt?.lastSequence).toBe(2);
        expect(stateAfterAttempt?.lastRecordHmac).toBe(seal2.hmac);

        // 4. Instance 1 unpauses and completes persisting record 2
        await AuditLog.collection.insertOne({
            user: actor._id,
            action: 'ACTIVE_INSTANCE_EVENT',
            outcome: 'SUCCESS',
            details: { instance: 'instance-1' },
            sequence: 2,
            previousSeal: initialRecord!.integritySeal,
            integritySeal: seal2.hmac,
            integrityKeyId: seal2.keyId,
            createdAt: record2CreatedAt
        });

        expect(await AuditLog.exists({ sequence: 2 })).not.toBeNull();

        // 5. Subsequent write by Instance 2 (sequence 3)
        const write3 = await writeAuditLog({
            user: actor._id.toString(),
            action: 'SUBSEQUENT_EVENT',
            outcome: 'SUCCESS',
            details: { instance: 'instance-2' }
        });
        expect(write3).toBe(true);

        // 6. Verify final sequence and cryptographic hash chain are completely intact
        const records = await AuditLog.find({})
            .select('+previousSeal +integritySeal sequence action')
            .sort({ sequence: 1 })
            .lean();

        expect(records.length).toBe(3);
        expect(records[0].sequence).toBe(1);
        expect(records[1].sequence).toBe(2);
        expect(records[2].sequence).toBe(3);

        expect(records[1].previousSeal).toBe(records[0].integritySeal);
        expect(records[2].previousSeal).toBe(records[1].integritySeal);

        const finalResult = await auditIntegrityService.verifyAuditTrail();
        expect(finalResult.status).toBe('INTACT');
        expect(finalResult.valid).toBe(true);
        expect(finalResult.checkedRecords).toBe(3);
        expect(finalResult.sealedRecords).toBe(3);
        expect(finalResult.invalidSeals).toBe(0);
        expect(finalResult.missingSequences).toBe(0);
    });

    it('fences and rejects a stale writer whose allocation lease expired after another instance recovered', async () => {
        const actor = await createActor();

        // Initial committed record (sequence 1)
        await writeAuditLog({
            user: actor._id.toString(),
            action: 'INITIAL_EVENT',
            outcome: 'SUCCESS'
        });

        // 1. Instance 1 allocates a sequence and pauses
        const instance1Allocation = await allocateAuditSequence({
            user: actor._id.toString(),
            action: 'STALE_EVENT_INSTANCE_1',
            outcome: 'SUCCESS'
        }, { leaseDurationMs: 60 });

        expect(instance1Allocation.sequence).toBe(2);
        expect(instance1Allocation.allocationToken).toBeDefined();

        // 2. Instance 1's lease expires
        await new Promise(resolve => setTimeout(resolve, 90));

        // 3. Instance 2 recovers and performs the next valid allocation/write
        const write2 = await writeAuditLog({
            user: actor._id.toString(),
            action: 'RECOVERED_EVENT_INSTANCE_2',
            outcome: 'SUCCESS'
        });
        expect(write2).toBe(true);

        const record2 = await AuditLog.findOne({ sequence: 2 }).lean();
        expect(record2?.action).toBe('RECOVERED_EVENT_INSTANCE_2');

        // 4. Instance 1 resumes and attempts its stale write
        const staleDoc = new AuditLog({
            user: actor._id,
            action: 'STALE_EVENT_INSTANCE_1',
            outcome: 'SUCCESS',
            sequence: instance1Allocation.sequence,
            previousSeal: instance1Allocation.previousSeal,
            integritySeal: instance1Allocation.integritySeal,
            integrityKeyId: instance1Allocation.integrityKeyId,
            allocationToken: instance1Allocation.allocationToken,
            createdAt: instance1Allocation.createdAt
        });

        await expect(staleDoc.save()).rejects.toThrow(/Stale write rejected/);

        // 5. Verify the stale write is rejected and the final audit trail remains INTACT,
        // with no duplicate sequences or broken HMAC links.
        const records = await AuditLog.find({})
            .select('+previousSeal +integritySeal sequence action')
            .sort({ sequence: 1 })
            .lean();

        expect(records.length).toBe(2);
        expect(records[0].sequence).toBe(1);
        expect(records[0].action).toBe('INITIAL_EVENT');
        expect(records[1].sequence).toBe(2);
        expect(records[1].action).toBe('RECOVERED_EVENT_INSTANCE_2');
        expect(records[1].previousSeal).toBe(records[0].integritySeal);

        const trail = await auditIntegrityService.verifyAuditTrail();
        expect(trail.status).toBe('INTACT');
        expect(trail.valid).toBe(true);
        expect(trail.checkedRecords).toBe(2);
        expect(trail.sealedRecords).toBe(2);
        expect(trail.invalidSeals).toBe(0);
        expect(trail.missingSequences).toBe(0);
    });

    it('restricts verification endpoint strictly to ADMIN role', async () => {
        const admin = await createActor(UserRole.ADMIN);
        mockSessionUser = { id: admin._id.toString(), role: UserRole.ADMIN };
        const allowed = await verifyRoute();
        expect(allowed.status).toBe(200);
        expect((await allowed.json()).data.status).toBe('INTACT');

        const professor = await createActor(UserRole.PROFESSOR);
        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };
        const deniedProf = await verifyRoute();
        expect(deniedProf.status).toBe(403);

        const ta = await createActor(UserRole.TA);
        mockSessionUser = { id: ta._id.toString(), role: UserRole.TA };
        const deniedTa = await verifyRoute();
        expect(deniedTa.status).toBe(403);
    });
});
