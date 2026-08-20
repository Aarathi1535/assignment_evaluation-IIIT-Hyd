import mongoose from 'mongoose';
import Exam, { IngestionApprovalStatus } from '../models/Exam';
import ExamRepository from '../repositories/ExamRepository';
import { writeAuditLog } from '../lib/audit';
import { HttpError } from '../lib/errors';
import { generateHmacSeal, verifyHmacSeal } from '../utils/hmacStorage';

export interface IngestionApprovalAuditContext {
    actingUserId: string;
    actingUserRole: string;
    ipAddress?: string;
}

class IngestionApprovalService {
    /**
     * Builds the deterministic canonical representation of the approved assembly state.
     * Scripts are sorted lexicographically by their _id.
     * Pages of each script are sorted numerically by their pageNumber.
     */
    private async buildCanonicalAssemblyString(examId: string): Promise<string> {
        const AnswerScript = (await import('../models/AnswerScript')).default;
        const IngestionPage = (await import('../models/IngestionPage')).default;

        const scripts = await AnswerScript.find({ exam: new mongoose.Types.ObjectId(examId), isActive: true }).lean();

        // Sort scripts lexicographically by hex string of their _id to ensure stable ordering
        scripts.sort((a, b) => a._id.toString().localeCompare(b._id.toString()));

        let canonicalStr = `exam:${examId}\n`;

        for (const script of scripts) {
            const studentId = script.student ? script.student.toString() : 'null';
            const source = script.identificationSource || 'null';
            const needsManualId = script.needsManualId ?? false;
            const manualIdReason = script.manualIdReason || 'null';
            const hasConflict = script.hasIdentificationConflict ?? false;

            canonicalStr += `script:${script._id.toString()}|student:${studentId}|source:${source}|needsManualId:${needsManualId}|manualIdReason:${manualIdReason}|hasConflict:${hasConflict}\n`;

            // Query pages for this script, sorted by pageNumber ascending
            const pages = await IngestionPage.find({ answerScript: script._id }).sort({ pageNumber: 1 }).lean();

            for (const page of pages) {
                const duplicateOf = page.duplicateOf ? page.duplicateOf.toString() : 'null';
                const nearBlank = page.nearBlank ?? false;
                const isDuplicate = page.isDuplicate ?? false;
                canonicalStr += `  page:${page._id.toString()}|batch:${page.batchId}|file:${page.fileId}|num:${page.pageNumber}|nearBlank:${nearBlank}|isDuplicate:${isDuplicate}|duplicateOf:${duplicateOf}\n`;
            }
        }

        return canonicalStr;
    }

    /**
     * Approve ingestion for an exam.
     * Transition: PENDING_REVIEW → APPROVED
     * Persists approvedBy, approvedAt, and generates/persists the cryptographic assembly seal.
     * Idempotent: calling approve on an already-APPROVED exam returns a 409.
     */
    async approveIngestion(
        examId: string,
        context: IngestionApprovalAuditContext
    ): Promise<void> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }

        const exam = await ExamRepository.getExamById(examId, context.actingUserId, context.actingUserRole);
        if (!exam) {
            throw new HttpError('Exam not found or access denied', 404);
        }

        // Treat absent/null as PENDING_REVIEW for legacy documents
        const currentStatus = exam.ingestionApprovalStatus ?? IngestionApprovalStatus.PENDING_REVIEW;

        if (currentStatus === IngestionApprovalStatus.APPROVED) {
            throw new HttpError(
                'Ingestion is already approved. No transition needed.',
                409
            );
        }

        const now = new Date();

        // Step 1: Build the canonical assembly snapshot
        const assemblyString = await this.buildCanonicalAssemblyString(examId);

        // Step 2: Compute the assembly seal using existing HMAC infrastructure
        const metadata = {
            batchId: examId,
            sequenceNumber: 1,
            uploader: context.actingUserId,
            timestamp: now.getTime()
        };

        let sealResult;
        try {
            sealResult = generateHmacSeal(Buffer.from(assemblyString, 'utf-8'), metadata);
        } catch (err) {
            throw new HttpError(
                `Failed to generate assembly seal: ${err instanceof Error ? err.message : 'Unknown cryptographic error'}`,
                500
            );
        }

        // Step 3: Persist approval state and seal metadata consistently
        const updated = await ExamRepository.updateIngestionApproval(
            examId,
            {
                ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
                approvedBy: new mongoose.Types.ObjectId(context.actingUserId),
                approvedAt: now,
                assemblySeal: sealResult.hmac,
                assemblySealKeyId: sealResult.keyId,
                assemblySealAt: now,
                assemblySealBy: new mongoose.Types.ObjectId(context.actingUserId)
            },
            context.actingUserId,
            context.actingUserRole
        );

        if (!updated) {
            throw new HttpError('Failed to update exam approval state', 500);
        }

        // Step 4: Create the approval audit event (including seal metadata but not secret keys)
        await writeAuditLog({
            user: context.actingUserId,
            action: 'INGESTION_APPROVED',
            outcome: 'SUCCESS',
            entityId: new mongoose.Types.ObjectId(examId),
            entityType: 'Exam',
            details: {
                previousStatus: currentStatus,
                newStatus: IngestionApprovalStatus.APPROVED,
                approvedBy: context.actingUserId,
                approvedAt: now.toISOString(),
                assemblySeal: sealResult.hmac,
                assemblySealKeyId: sealResult.keyId,
                assemblySealAt: now.toISOString()
            },
            ipAddress: context.ipAddress
        });
    }

    /**
     * Revoke ingestion approval for an exam.
     * Transition: APPROVED → PENDING_REVIEW
     * Clears approvedBy, approvedAt, and all assembly seal metadata.
     */
    async revokeApproval(
        examId: string,
        context: IngestionApprovalAuditContext
    ): Promise<void> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }

        const exam = await ExamRepository.getExamById(examId, context.actingUserId, context.actingUserRole);
        if (!exam) {
            throw new HttpError('Exam not found or access denied', 404);
        }

        const currentStatus = exam.ingestionApprovalStatus ?? IngestionApprovalStatus.PENDING_REVIEW;

        if (currentStatus === IngestionApprovalStatus.PENDING_REVIEW) {
            throw new HttpError(
                'Ingestion approval is already in PENDING_REVIEW state. No transition needed.',
                409
            );
        }

        const previousApprovedBy = exam.approvedBy;

        const updated = await ExamRepository.updateIngestionApproval(
            examId,
            {
                ingestionApprovalStatus: IngestionApprovalStatus.PENDING_REVIEW,
                approvedBy: null,
                approvedAt: null,
                assemblySeal: null,
                assemblySealKeyId: null,
                assemblySealAt: null,
                assemblySealBy: null
            },
            context.actingUserId,
            context.actingUserRole
        );

        if (!updated) {
            throw new HttpError('Failed to update exam approval state', 500);
        }

        await writeAuditLog({
            user: context.actingUserId,
            action: 'INGESTION_APPROVAL_REVOKED',
            outcome: 'SUCCESS',
            entityId: new mongoose.Types.ObjectId(examId),
            entityType: 'Exam',
            details: {
                previousStatus: IngestionApprovalStatus.APPROVED,
                newStatus: IngestionApprovalStatus.PENDING_REVIEW,
                revokedBy: context.actingUserId,
                previousApprovedBy: previousApprovedBy?.toString() ?? null
            },
            ipAddress: context.ipAddress
        });
    }

    /**
     * Gate check: throws a 403 HttpError if the exam ingestion is not APPROVED.
     * Used by allocation and other downstream operations.
     */
    async requireApproved(examId: string): Promise<void> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }

        const exam = await Exam.findOne({ _id: examId, isActive: true }).lean();
        if (!exam) {
            throw new HttpError('Exam not found', 404);
        }

        const currentStatus = exam.ingestionApprovalStatus ?? IngestionApprovalStatus.PENDING_REVIEW;
        if (currentStatus !== IngestionApprovalStatus.APPROVED) {
            throw new HttpError(
                'Ingestion has not been approved for this exam. Approve ingestion before grading or allocation.',
                403
            );
        }
    }

    /**
     * Reset an exam's ingestion approval to PENDING_REVIEW when a new successful
     * batch is added. Only triggers a write if the exam is currently APPROVED.
     * Clears all assembly seal metadata.
     * Safe to call on any exam regardless of current state.
     */
    async resetToReview(
        examId: string,
        context: { actingUserId: string; actingUserRole: string; ipAddress?: string }
    ): Promise<void> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            return; // Non-fatal: exam ID invalid, skip reset
        }

        const exam = await Exam.findOne({ _id: examId, isActive: true }).lean();
        if (!exam) {
            return; // Exam not found; skip reset
        }

        const currentStatus = exam.ingestionApprovalStatus ?? IngestionApprovalStatus.PENDING_REVIEW;

        // Only write if currently APPROVED — avoids unnecessary DB writes
        if (currentStatus !== IngestionApprovalStatus.APPROVED) {
            return;
        }

        await Exam.updateOne(
            { _id: examId, isActive: true },
            {
                $set: {
                    ingestionApprovalStatus: IngestionApprovalStatus.PENDING_REVIEW,
                    approvedBy: null,
                    approvedAt: null,
                    assemblySeal: null,
                    assemblySealKeyId: null,
                    assemblySealAt: null,
                    assemblySealBy: null
                }
            }
        );

        await writeAuditLog({
            user: context.actingUserId,
            action: 'INGESTION_APPROVAL_RESET_BY_NEW_BATCH',
            outcome: 'SUCCESS',
            entityId: new mongoose.Types.ObjectId(examId),
            entityType: 'Exam',
            details: {
                previousStatus: IngestionApprovalStatus.APPROVED,
                newStatus: IngestionApprovalStatus.PENDING_REVIEW,
                reason: 'New batch successfully uploaded to exam'
            },
            ipAddress: context.ipAddress
        });
    }

    /**
     * Verifies the current ingestion assembly against the persisted approved seal.
     */
    async verifyAssembly(
        examId: string,
        context: IngestionApprovalAuditContext
    ): Promise<{
        valid: boolean;
        status: 'INTACT' | 'MISMATCH' | 'UNAPPROVED' | 'UNSEALED' | 'ERROR';
        reason?: string;
        timestamp: string;
    }> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid Exam ID format', 400);
        }

        const exam = await ExamRepository.getExamById(examId, context.actingUserId, context.actingUserRole);
        if (!exam) {
            throw new HttpError('Exam not found or access denied', 404);
        }

        const currentStatus = exam.ingestionApprovalStatus ?? IngestionApprovalStatus.PENDING_REVIEW;
        const nowStr = new Date().toISOString();

        if (currentStatus !== IngestionApprovalStatus.APPROVED) {
            return {
                valid: false,
                status: 'UNAPPROVED',
                reason: 'Ingestion has not been approved for this exam.',
                timestamp: nowStr
            };
        }

        if (!exam.assemblySeal || !exam.assemblySealKeyId || !exam.assemblySealAt || !exam.assemblySealBy) {
            return {
                valid: false,
                status: 'UNSEALED',
                reason: 'Exam is approved but no active assembly seal is stored.',
                timestamp: nowStr
            };
        }

        const metadata = {
            batchId: examId,
            sequenceNumber: 1,
            uploader: exam.assemblySealBy.toString(),
            timestamp: new Date(exam.assemblySealAt).getTime()
        };

        try {
            const currentAssemblyString = await this.buildCanonicalAssemblyString(examId);

            const verification = verifyHmacSeal(
                Buffer.from(currentAssemblyString, 'utf-8'),
                metadata,
                exam.assemblySeal,
                exam.assemblySealKeyId
            );

            let status: 'INTACT' | 'MISMATCH' | 'ERROR' = 'MISMATCH';
            if (verification.valid) {
                status = 'INTACT';
            } else if (
                verification.reason?.includes('HMAC secret') ||
                verification.reason?.includes('not configured') ||
                verification.reason?.includes('unavailable')
            ) {
                status = 'ERROR';
            }

            await writeAuditLog({
                user: context.actingUserId,
                action: 'INGESTION_ASSEMBLY_VERIFIED',
                outcome: (verification.valid) ? 'SUCCESS' : 'FAILURE',
                entityId: new mongoose.Types.ObjectId(examId),
                entityType: 'Exam',
                details: {
                    verifiedBy: context.actingUserId,
                    status,
                    reason: verification.reason || null
                },
                ipAddress: context.ipAddress
            });

            return {
                valid: verification.valid,
                status,
                reason: verification.reason || undefined,
                timestamp: nowStr
            };

        } catch (err) {
            await writeAuditLog({
                user: context.actingUserId,
                action: 'INGESTION_ASSEMBLY_VERIFIED',
                outcome: 'FAILURE',
                entityId: new mongoose.Types.ObjectId(examId),
                entityType: 'Exam',
                details: {
                    verifiedBy: context.actingUserId,
                    status: 'ERROR',
                    reason: err instanceof Error ? err.message : 'Unknown verification error'
                },
                ipAddress: context.ipAddress
            });

            return {
                valid: false,
                status: 'ERROR',
                reason: err instanceof Error ? err.message : 'Unknown verification error',
                timestamp: nowStr
            };
        }
    }
}

const ingestionApprovalService = new IngestionApprovalService();
export default ingestionApprovalService;
