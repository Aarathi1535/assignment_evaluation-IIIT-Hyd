import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../lib/db';
import { requireAuth } from '../../../../lib/apiAuth';
import { HttpError } from '../../../../lib/errors';
import ScriptFlagService from '../../../../services/ScriptFlagService';

/**
 * GET /api/professor/flags
 *
 * Retrieves the Professor Flag Review Queue (AE-163).
 * Protected for Professor (exam owner) and Admin roles only.
 * TAs and Students are denied access (403 Forbidden).
 */
export async function GET(req: NextRequest) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }
    const user = auth.user;

    const { searchParams } = new URL(req.url);
    const status = searchParams.get('status') || undefined;
    const examId = searchParams.get('examId') || undefined;
    const pageStr = searchParams.get('page');
    const limitStr = searchParams.get('limit');

    const page = pageStr ? parseInt(pageStr, 10) : undefined;
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;

    try {
        await connectDB();

        const result = await ScriptFlagService.getProfessorFlagQueue({
            userId: user.id,
            userRole: user.role,
            status,
            examId,
            page,
            limit
        });

        return NextResponse.json(
            {
                success: true,
                message: 'Flag review queue retrieved successfully',
                data: result
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
