import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import { requireAuth } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';
import ScriptFlagService from '../../../../../services/ScriptFlagService';

/**
 * POST /api/scripts/[id]/flags
 *
 * Flags an answer script or a specific question for professor review (AE-162).
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
        const { question, reason, note } = body;

        const ipAddress = req.headers.get('x-forwarded-for') || undefined;

        const flag = await ScriptFlagService.createFlag({
            scriptId: id,
            question,
            reason,
            note,
            userId: user.id,
            userRole: user.role,
            ipAddress
        });

        return NextResponse.json(
            {
                success: true,
                message: 'Script flagged for professor review successfully',
                data: flag
            },
            { status: 201 }
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

/**
 * GET /api/scripts/[id]/flags
 *
 * Retrieves flags for an answer script with visibility control (AE-162).
 */
export async function GET(
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

        const flags = await ScriptFlagService.getFlagsForScript({
            scriptId: id,
            userId: user.id,
            userRole: user.role
        });

        return NextResponse.json(
            {
                success: true,
                message: 'Flags retrieved successfully',
                data: flags
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
