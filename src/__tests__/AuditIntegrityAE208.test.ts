import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import AuditLog from '../models/AuditLog';
import AuditLogIntegrityState from '../models/AuditLogIntegrityState';
import User, { UserRole } from '../models/User';
import { writeAuditLog } from '../lib/audit';
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

    it('keeps concurrent audit writes in a verifiable sequence', async () => {
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
        expect(result.checkedRecords).toBe(8);
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
    });

    it('exposes read-only verification only to authorized audit viewers', async () => {
        const professor = await createActor();
        mockSessionUser = { id: professor._id.toString(), role: UserRole.PROFESSOR };
        const response = await verifyRoute();
        expect(response.status).toBe(200);
        expect((await response.json()).data.status).toBe('INTACT');

        const ta = await createActor(UserRole.TA);
        mockSessionUser = { id: ta._id.toString(), role: UserRole.TA };
        const denied = await verifyRoute();
        expect(denied.status).toBe(403);
    });
});
