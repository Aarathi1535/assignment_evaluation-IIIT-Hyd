import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../../lib/db';
import { requireAuth } from '../../../../../../lib/apiAuth';
import { HttpError } from '../../../../../../lib/errors';
import ScriptFlagService from '../../../../../../services/ScriptFlagService';

/**
 * POST /api/professor/flags/[id]/resolve
 *
 * Resolves a flagged script/question (AE-164).
 * Supports actions: OVERRIDE, CLEAR, ESCALATE.
 * Accessible only by the exam-owner PROFESSOR or ADMIN.
 */
export async function POST(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }
    const user = auth.user;

    const { id } = await context.params;

    try {
        await connectDB();

        const body = await req.json().catch(() => ({}));
        const { action, notes, newScore, criterionOverrides } = body;

        const ipAddress = req.headers.get('x-forwarded-for') || undefined;

        const resolvedFlag = await ScriptFlagService.resolveFlag({
            flagId: id,
            action,
            notes,
            newScore,
            criterionOverrides,
            userId: user.id,
            userRole: user.role,
            ipAddress
        });

        return NextResponse.json(
            {
                success: true,
                message: `Flag successfully ${action === 'ESCALATE' ? 'escalated' : 'resolved'}`,
                data: resolvedFlag
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
