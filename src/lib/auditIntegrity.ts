import mongoose from 'mongoose';
import { generateHmacSeal, verifyHmacSeal, type HmacSealResult } from '../utils/hmacStorage';

export interface AuditIntegrityRecord {
    user: mongoose.Types.ObjectId | string;
    action: string;
    outcome?: 'SUCCESS' | 'FAILURE';
    entityId?: mongoose.Types.ObjectId | string;
    entityType?: string;
    details?: unknown;
    ipAddress?: string;
    createdAt: Date;
    sequence?: number;
    previousSeal?: string;
    integritySeal?: string;
    integrityKeyId?: string;
}

export interface AuditIntegrityState {
    lastSequence: number;
    cutoverSequence?: number;
    lastRecordHmac?: string;
    integritySeal?: string;
    integrityKeyId?: string;
    cutoverDate?: Date;
    stateSealVersion?: number;
    lastAllocatedAt?: Date;
}

function canonicalize(value: unknown): unknown {
    if (value instanceof mongoose.Types.ObjectId) {
        return value.toString();
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (Buffer.isBuffer(value)) {
        return { binary: value.toString('base64') };
    }
    if (Array.isArray(value)) {
        return value.map(canonicalize);
    }
    if (value && typeof value === 'object') {
        const source = typeof (value as { toObject?: () => unknown }).toObject === 'function'
            ? (value as { toObject: () => unknown }).toObject()
            : value;
        if (!source || typeof source !== 'object') {
            return source;
        }
        return Object.fromEntries(
            Object.entries(source as Record<string, unknown>)
                .filter(([key]) => key !== '__v' && !key.startsWith('$'))
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, item]) => [key, canonicalize(item)])
        );
    }
    return value;
}

function auditRecordBytes(
    record: AuditIntegrityRecord,
    sequence: number,
    keyId: string,
    version: number = 2
): Buffer {
    if (version === 1) {
        return Buffer.from(JSON.stringify({
            version: 1,
            sequence,
            keyId,
            user: record.user.toString(),
            action: record.action,
            outcome: record.outcome || null,
            entityId: record.entityId?.toString() || null,
            entityType: record.entityType || null,
            details: canonicalize(record.details ?? null),
            ipAddress: record.ipAddress || null,
            createdAt: record.createdAt.toISOString()
        }), 'utf8');
    }
    return Buffer.from(JSON.stringify({
        version: 2,
        sequence,
        keyId,
        previousSeal: record.previousSeal || (sequence === 1 ? 'GENESIS' : null),
        user: record.user.toString(),
        action: record.action,
        outcome: record.outcome || null,
        entityId: record.entityId?.toString() || null,
        entityType: record.entityType || null,
        details: canonicalize(record.details ?? null),
        ipAddress: record.ipAddress || null,
        createdAt: record.createdAt.toISOString()
    }), 'utf8');
}

export function createAuditIntegritySeal(
    record: AuditIntegrityRecord,
    sequence: number
): Pick<HmacSealResult, 'hmac' | 'keyId'> {
    const keyId = process.env.ORIGINAL_STORAGE_KEY_ID || 'v1';
    const metadata = {
        batchId: 'audit-log',
        sequenceNumber: sequence,
        uploader: record.user.toString(),
        timestamp: record.createdAt.getTime()
    };
    const seal = generateHmacSeal(auditRecordBytes(record, sequence, keyId, 2), metadata, keyId);
    return { hmac: seal.hmac, keyId: seal.keyId };
}

export function verifyAuditIntegritySeal(
    record: AuditIntegrityRecord,
    cutoverSequence: number = 1
): { valid: boolean } {
    if (!record.integritySeal || !record.integrityKeyId ||
        !Number.isSafeInteger(record.sequence) || !record.sequence || record.sequence < 1) {
        return { valid: false };
    }
    if (!(record.createdAt instanceof Date) || !Number.isFinite(record.createdAt.getTime()) ||
        !record.user || typeof record.user.toString !== 'function') {
        return { valid: false };
    }
    const metadata = {
        batchId: 'audit-log',
        sequenceNumber: record.sequence,
        uploader: record.user.toString(),
        timestamp: record.createdAt.getTime()
    };

    // Try version 2 (with previousSeal chaining)
    const v2Result = verifyHmacSeal(
        auditRecordBytes(record, record.sequence, record.integrityKeyId, 2),
        metadata,
        record.integritySeal,
        record.integrityKeyId
    );
    if (v2Result.valid) {
        return { valid: true };
    }

    // Fallback to version 1 for legacy seals ONLY strictly below cutoverSequence
    if (record.sequence < cutoverSequence) {
        const v1Result = verifyHmacSeal(
            auditRecordBytes(record, record.sequence, record.integrityKeyId, 1),
            metadata,
            record.integritySeal,
            record.integrityKeyId
        );
        return { valid: v1Result.valid };
    }

    return { valid: false };
}

function integrityStateBytes(
    lastSequence: number,
    keyId: string,
    lastRecordHmac?: string,
    cutoverSequence: number = 1,
    cutoverDate?: Date | string | number | null,
    version: number = 3
): Buffer {
    if (version === 3) {
        const isoDate = cutoverDate ? new Date(cutoverDate).toISOString() : null;
        return Buffer.from(JSON.stringify({
            version: 3,
            lastSequence,
            cutoverSequence,
            cutoverDate: isoDate,
            lastRecordHmac: lastRecordHmac || null,
            keyId
        }), 'utf8');
    }
    if (version === 2) {
        return Buffer.from(JSON.stringify({
            version: 2,
            lastSequence,
            cutoverSequence,
            lastRecordHmac: lastRecordHmac || null,
            keyId
        }), 'utf8');
    }
    return Buffer.from(JSON.stringify({
        version: 1,
        lastSequence,
        keyId
    }), 'utf8');
}

export function createAuditIntegrityStateSeal(
    lastSequence: number,
    lastRecordHmac?: string,
    cutoverSequence: number = 1,
    cutoverDate?: Date | string | number | null
): Pick<HmacSealResult, 'hmac' | 'keyId'> {
    const keyId = process.env.ORIGINAL_STORAGE_KEY_ID || 'v1';
    const metadata = {
        batchId: 'audit-log-integrity-state',
        sequenceNumber: lastSequence,
        uploader: 'audit-integrity-service',
        timestamp: 0
    };
    const seal = generateHmacSeal(
        integrityStateBytes(lastSequence, keyId, lastRecordHmac, cutoverSequence, cutoverDate, 3),
        metadata,
        keyId
    );
    return { hmac: seal.hmac, keyId: seal.keyId };
}

export function verifyAuditIntegrityStateSeal(state: AuditIntegrityState): boolean {
    if (!Number.isSafeInteger(state.lastSequence) || state.lastSequence < 1 ||
        !state.integritySeal || !state.integrityKeyId) {
        return false;
    }
    const metadata = {
        batchId: 'audit-log-integrity-state',
        sequenceNumber: state.lastSequence,
        uploader: 'audit-integrity-service',
        timestamp: 0
    };

    const cutover = state.cutoverSequence ?? 1;

    // 1. Try version 3 (canonical payload binding cutoverDate)
    const v3Result = verifyHmacSeal(
        integrityStateBytes(state.lastSequence, state.integrityKeyId, state.lastRecordHmac, cutover, state.cutoverDate, 3),
        metadata,
        state.integritySeal,
        state.integrityKeyId
    );
    if (v3Result.valid) {
        return true;
    }

    // 2. Backward compatibility: if state is legacy version 2 (or unversioned legacy state document),
    // verify against version 2 (which did not bind cutoverDate).
    if (state.stateSealVersion === undefined || state.stateSealVersion === 2) {
        const v2Result = verifyHmacSeal(
            integrityStateBytes(state.lastSequence, state.integrityKeyId, state.lastRecordHmac, cutover, undefined, 2),
            metadata,
            state.integritySeal,
            state.integrityKeyId
        );
        if (v2Result.valid) {
            return true;
        }
    }

    // 3. Fallback to version 1 ONLY strictly below cutoverSequence for legacy unversioned/pre-cutover states
    if (state.lastSequence < cutover && (state.stateSealVersion === undefined || state.stateSealVersion === 1)) {
        return verifyHmacSeal(
            integrityStateBytes(state.lastSequence, state.integrityKeyId, undefined, cutover, undefined, 1),
            metadata,
            state.integritySeal,
            state.integrityKeyId
        ).valid;
    }

    return false;
}
