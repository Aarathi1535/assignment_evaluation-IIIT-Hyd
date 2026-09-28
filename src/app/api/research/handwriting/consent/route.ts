import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import { requireAuth } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';
import { handwritingConsentRepository } from '../../../../../repositories/HandwritingConsentRepository';
import { UserRole } from '../../../../../constants/permissions';

/**
 * GET /api/research/handwriting/consent
 *
 * Retrieves consent and retention information for a student.
 * - Students can only query their own consent.
 * - Professors, Admins, and TAs may query by ?studentId=...
 */
export async function GET(req: NextRequest) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }
    const currentUser = auth.user;

    const { searchParams } = new URL(req.url);
    const requestedStudentId = searchParams.get('studentId') || currentUser.id;

    const isStaff = [UserRole.ADMIN, UserRole.PROFESSOR, UserRole.TA].includes(currentUser.role);
    if (!isStaff && requestedStudentId !== currentUser.id) {
        return NextResponse.json(
            { success: false, message: 'Unauthorized: students may only view their own consent status', data: null },
            { status: 403 }
        );
    }

    try {
        await connectDB();
        const consent = await handwritingConsentRepository.findByStudent(requestedStudentId);

        return NextResponse.json(
            {
                success: true,
                message: 'Handwriting consent details retrieved',
                data: consent
                    ? {
                        studentId: requestedStudentId,
                        hasConsented: consent.hasConsented,
                        consentedAt: consent.consentedAt,
                        revokedAt: consent.revokedAt,
                        retentionDays: consent.retentionDays,
                        retentionExpiresAt: consent.retentionExpiresAt,
                        consentVersion: consent.consentVersion
                    }
                    : {
                        studentId: requestedStudentId,
                        hasConsented: false,
                        consentedAt: null,
                        revokedAt: null,
                        retentionDays: 365,
                        retentionExpiresAt: null,
                        consentVersion: '1.0'
                    }
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json({ success: false, message, data: null }, { status });
    }
}

/**
 * POST /api/research/handwriting/consent
 *
 * Grants or revokes consent for handwriting consistency evaluation.
 * Body: { studentId?: string, hasConsented: boolean, retentionDays?: number, notes?: string }
 */
export async function POST(req: NextRequest) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }
    const currentUser = auth.user;

    try {
        const body = await req.json();
        const { studentId, hasConsented, retentionDays, notes } = body;

        const targetStudentId = studentId || currentUser.id;

        const isStaff = [UserRole.ADMIN, UserRole.PROFESSOR].includes(currentUser.role);
        if (!isStaff && targetStudentId !== currentUser.id) {
            return NextResponse.json(
                { success: false, message: 'Unauthorized: students may only manage their own consent', data: null },
                { status: 403 }
            );
        }

        if (typeof hasConsented !== 'boolean') {
            return NextResponse.json(
                { success: false, message: 'Invalid payload: hasConsented boolean is required', data: null },
                { status: 400 }
            );
        }

        await connectDB();
        const updated = await handwritingConsentRepository.setConsent(
            targetStudentId,
            hasConsented,
            { retentionDays, notes }
        );

        return NextResponse.json(
            {
                success: true,
                message: hasConsented ? 'Handwriting consent granted' : 'Handwriting consent revoked',
                data: {
                    studentId: targetStudentId,
                    hasConsented: updated.hasConsented,
                    consentedAt: updated.consentedAt,
                    revokedAt: updated.revokedAt,
                    retentionDays: updated.retentionDays,
                    retentionExpiresAt: updated.retentionExpiresAt,
                    consentVersion: updated.consentVersion
                }
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json({ success: false, message, data: null }, { status });
    }
}
