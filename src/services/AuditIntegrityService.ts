import AuditLog from '../models/AuditLog';
import AuditLogIntegrityState from '../models/AuditLogIntegrityState';
import {
    verifyAuditIntegritySeal,
    verifyAuditIntegrityStateSeal,
    type AuditIntegrityRecord,
    type AuditIntegrityState
} from '../lib/auditIntegrity';

const MAX_DIAGNOSTICS = 25;

export type AuditTrailIntegrityStatus = 'INTACT' | 'MISMATCH' | 'UNSEALED';

export interface AuditTrailIntegrityResult {
    status: AuditTrailIntegrityStatus;
    valid: boolean;
    checkedRecords: number;
    sealedRecords: number;
    unsealedRecords: number;
    invalidSeals: number;
    missingSequences: number;
    diagnostics: Array<{ code: string; sequence?: number; count?: number }>;
    omittedDiagnostics: number;
    verifiedAt: string;
}

export class AuditIntegrityService {
    async verifyAuditTrail(): Promise<AuditTrailIntegrityResult> {
        const integrityState = await AuditLogIntegrityState.findById('global')
            .select('lastSequence +integritySeal +integrityKeyId')
            .lean();
        const diagnostics: AuditTrailIntegrityResult['diagnostics'] = [];
        let omittedDiagnostics = 0;
        const addDiagnostic = (diagnostic: AuditTrailIntegrityResult['diagnostics'][number]) => {
            if (diagnostics.length < MAX_DIAGNOSTICS) {
                diagnostics.push(diagnostic);
            } else {
                omittedDiagnostics += 1;
            }
        };

        let checkedRecords = 0;
        let sealedRecords = 0;
        let unsealedRecords = 0;
        let invalidSeals = 0;
        let missingSequences = 0;
        let highestSequence = 0;
        let expectedSequence = 1;

        const cursor = AuditLog.find({})
            .select('+integritySeal +integrityKeyId')
            .sort({ sequence: 1, _id: 1 })
            .lean()
            .cursor();

        for await (const record of cursor) {
            checkedRecords += 1;
            const integrityRecord: AuditIntegrityRecord = record;
            const sequence = integrityRecord.sequence;

            if (!Number.isSafeInteger(sequence) || !sequence || sequence < 1) {
                unsealedRecords += 1;
                addDiagnostic({ code: 'UNSEALED_RECORD' });
                continue;
            }

            if (sequence > expectedSequence) {
                const gap = sequence - expectedSequence;
                missingSequences += gap;
                addDiagnostic({ code: 'SEQUENCE_GAP', sequence: expectedSequence, count: gap });
            } else if (sequence < expectedSequence) {
                invalidSeals += 1;
                addDiagnostic({ code: 'SEQUENCE_ORDER_INVALID', sequence });
            }
            expectedSequence = Math.max(expectedSequence, sequence + 1);
            highestSequence = Math.max(highestSequence, sequence);

            if (!integrityRecord.integritySeal || !integrityRecord.integrityKeyId) {
                unsealedRecords += 1;
                addDiagnostic({ code: 'UNSEALED_RECORD', sequence });
                continue;
            }
            if (verifyAuditIntegritySeal(integrityRecord).valid) {
                sealedRecords += 1;
            } else {
                invalidSeals += 1;
                addDiagnostic({ code: 'SEAL_INVALID', sequence });
            }
        }

        const recordedHighWater = integrityState?.lastSequence ?? 0;
        const integrityStateRecord: AuditIntegrityState | null = integrityState;
        if (integrityStateRecord && recordedHighWater > 0 &&
            !verifyAuditIntegrityStateSeal(integrityStateRecord)) {
            invalidSeals += 1;
            addDiagnostic({ code: 'INTEGRITY_STATE_INVALID' });
        } else if (!integrityState && highestSequence > 0) {
            invalidSeals += 1;
            addDiagnostic({ code: 'INTEGRITY_STATE_MISSING' });
        } else if (recordedHighWater > highestSequence) {
            const missingTail = recordedHighWater - highestSequence;
            missingSequences += missingTail;
            addDiagnostic({
                code: 'SEQUENCE_GAP',
                sequence: highestSequence + 1,
                count: missingTail
            });
        } else if (highestSequence > recordedHighWater) {
            invalidSeals += 1;
            addDiagnostic({ code: 'INTEGRITY_STATE_BEHIND', sequence: recordedHighWater });
        }

        const status = invalidSeals > 0 || missingSequences > 0
            ? 'MISMATCH'
            : unsealedRecords > 0
                ? 'UNSEALED'
                : 'INTACT';
        return {
            status,
            valid: status === 'INTACT',
            checkedRecords,
            sealedRecords,
            unsealedRecords,
            invalidSeals,
            missingSequences,
            diagnostics,
            omittedDiagnostics,
            verifiedAt: new Date().toISOString()
        };
    }
}

const auditIntegrityService = new AuditIntegrityService();
export default auditIntegrityService;
