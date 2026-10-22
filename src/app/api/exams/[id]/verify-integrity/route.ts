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

        const summary = await integrityVerificationService.verifyExamIntegrity(id, {
            actingUserId: auth.user.id,
            actingUserRole: auth.user.role,
            ipAddress
        });

        // Audit the integrity check; fail outcome if required checks failed
        await writeAuditLog({
            user: auth.user.id,
            action: 'INTEGRITY_VERIFIED',
            outcome: summary.valid ? 'SUCCESS' : 'FAILURE',
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

        return NextResponse.json(
            {
                success: true,
                message: summary.valid
                    ? 'Exam integrity verification completed successfully'
                    : 'Exam integrity verification completed with issues detected',
                data: summary
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
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
