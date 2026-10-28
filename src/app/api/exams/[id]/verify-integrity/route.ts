import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import integrityVerificationService from '../../../../../services/IntegrityVerificationService';
import { writeAuditLog } from '../../../../../lib/audit';

/**
 * POST /api/exams/[id]/verify-integrity
 *
 * AE-188 Integrity Verification endpoint.
 * Performs comprehensive read-only verification across:
 * 1. Original uploaded files (HMAC tamper-evidence, binding metadata, historical keys)
 * 2. Derived page storage keys (deterministic shape, expected namespace, object presence)
 * 3. Exam assembly seal (canonical ordering, page membership, cryptographic seal)
 *
 * Scalability & Privacy:
 * - Returns summary counts and problem items only; does not echo full lists of valid pages.
 * - Error paths map to fixed safe reason codes without leaking infrastructure paths or keys.
 * - 500 responses return a safe fixed message ("Verification failed").
 *
 * Authorization: Requires APPROVE_INGESTION permission (same as verify-assembly).
 */
export async function POST(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission(Permission.APPROVE_INGESTION);
    if (!auth.authorized) {
        return auth.response;
    }

    const { id } = await context.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json(
            {
                success: false,
                message: 'Invalid ID format',
                data: null
            },
            { status: 400 }
        );
    }

    try {
        await connectDB();

        const ipAddress =
            (req as NextRequest & { ip?: string }).ip ||
            req.headers.get('x-forwarded-for') ||
            req.headers.get('x-real-ip') ||
            undefined;

        // Execute verification with bounded memory (includeAllItems: false)
        const summary = await integrityVerificationService.verifyExamIntegrity(
            id,
            {
                actingUserId: auth.user.id,
                actingUserRole: auth.user.role,
                ipAddress
            },
            { includeAllItems: false }
        );

        // Audit the integrity check; fail outcome on mismatch or error
        const isFailureOutcome = summary.status === 'MISMATCH' || summary.status === 'ERROR';
        await writeAuditLog({
            user: auth.user.id,
            action: 'INTEGRITY_VERIFIED',
            outcome: isFailureOutcome ? 'FAILURE' : 'SUCCESS',
            entityId: new mongoose.Types.ObjectId(id),
            entityType: 'Exam',
            details: {
                verifiedBy: auth.user.id,
                overallStatus: summary.status,
                overallOutcome: summary.outcome,
                originalFiles: {
                    total: summary.originalFiles.total,
                    intact: summary.originalFiles.intact,
                    mismatch: summary.originalFiles.mismatch,
                    unsealed: summary.originalFiles.unsealed,
                    error: summary.originalFiles.error
                },
                derivedPages: {
                    total: summary.derivedPages.total,
                    intact: summary.derivedPages.intact,
                    mismatch: summary.derivedPages.mismatch,
                    error: summary.derivedPages.error
                },
                assemblyStatus: summary.assembly.status,
                reason: summary.reason || null
            },
            ipAddress
        });

        let message = 'Exam integrity verification completed successfully';
        if (summary.status === 'NOT_APPLICABLE') {
            message = 'Exam integrity verification completed (assembly verification not applicable - exam not approved)';
        } else if (!summary.valid) {
            message = 'Exam integrity verification completed with issues detected';
        }

        return NextResponse.json(
            {
                success: true,
                message,
                data: summary
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        const isHttpError = error instanceof HttpError;
        const status = isHttpError ? error.statusCode : 500;
        const message = isHttpError ? error.message : 'Verification failed';
        return NextResponse.json(
            {
                success: false,
                message,
                data: null
            },
            { status }
        );
    }
}
