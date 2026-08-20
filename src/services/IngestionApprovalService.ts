import mongoose from 'mongoose';
import Exam, { IngestionApprovalStatus } from '../models/Exam';
import ExamRepository from '../repositories/ExamRepository';
import { writeAuditLog } from '../lib/audit';
import { HttpError } from '../lib/errors';

export interface IngestionApprovalAuditContext {
    actingUserId: string;
    actingUserRole: string;
    ipAddress?: string;
}

class IngestionApprovalService {
    /**
     * Approve ingestion for an exam.
     * Transition: PENDING_REVIEW → APPROVED
     * Persists approvedBy and approvedAt.
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
        const updated = await ExamRepository.updateIngestionApproval(
            examId,
            {
                ingestionApprovalStatus: IngestionApprovalStatus.APPROVED,
                approvedBy: new mongoose.Types.ObjectId(context.actingUserId),
                approvedAt: now
            },
            context.actingUserId,
            context.actingUserRole
        );

        if (!updated) {
            throw new HttpError('Failed to update exam approval state', 500);
        }

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
                approvedAt: now.toISOString()
            },
            ipAddress: context.ipAddress
        });
    }

    /**
     * Revoke ingestion approval for an exam.
     * Transition: APPROVED → PENDING_REVIEW
     * Clears approvedBy and approvedAt.
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
                approvedAt: null
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
                    approvedAt: null
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
}

const ingestionApprovalService = new IngestionApprovalService();
export default ingestionApprovalService;
