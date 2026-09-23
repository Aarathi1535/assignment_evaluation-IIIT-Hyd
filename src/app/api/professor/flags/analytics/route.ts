import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import { requireAuth } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';
import ScriptFlagService from '../../../../../services/ScriptFlagService';

/**
 * GET /api/professor/flags/analytics
 *
 * Retrieves aggregated ScriptFlag analytics and counts (AE-165).
 * Protected for Professor (exam owner) and Admin roles only.
 * TAs and Students are rejected with 403 Forbidden.
 *
 * Query Params:
 * - examId (optional): target Exam ObjectId to filter analytics for a single exam.
 */
export async function GET(req: NextRequest) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }
    const user = auth.user;

    const { searchParams } = new URL(req.url);
    const examId = searchParams.get('examId') || searchParams.get('exam') || undefined;

    try {
        await connectDB();

        const analytics = await ScriptFlagService.getFlagAnalytics({
            userId: user.id,
            userRole: user.role,
            examId
        });

        return NextResponse.json(
            {
                success: true,
                message: 'Flag analytics retrieved successfully',
                data: analytics
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
