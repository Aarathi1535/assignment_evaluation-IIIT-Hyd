import { NextResponse } from 'next/server';
import { Permission, UserRole } from '../../../../constants/permissions';
import { requirePermission } from '../../../../lib/apiAuth';
import { connectDB } from '../../../../lib/db';
import auditIntegrityService from '../../../../services/AuditIntegrityService';

export async function POST() {
    const auth = await requirePermission(Permission.VIEW_ALL_SUBMISSIONS);
    if (!auth.authorized) {
        return auth.response;
    }
    if (auth.user.role !== UserRole.ADMIN && auth.user.role !== UserRole.PROFESSOR) {
        return NextResponse.json(
            { success: false, message: 'Forbidden', data: null },
            { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }

    try {
        await connectDB();
        const verification = await auditIntegrityService.verifyAuditTrail();
        return NextResponse.json(
            { success: true, data: verification },
            { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
        );
    } catch (error: unknown) {
        console.error('Failed to verify audit trail integrity:', error);
        return NextResponse.json(
            { success: false, message: 'Audit trail verification failed', data: null },
            { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }
}
