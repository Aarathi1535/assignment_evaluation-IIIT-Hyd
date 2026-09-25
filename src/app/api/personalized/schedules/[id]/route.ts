import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import personalizedAssessmentService from '../../../../../services/PersonalizedAssessmentService';
import { requireAuth } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';

export async function GET(
    _req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        await connectDB();
        const { id } = await context.params;
        const schedule = await personalizedAssessmentService.getScheduleById(
            id,
            auth.user.id,
            auth.user.role
        );

        return NextResponse.json(
            {
                success: true,
                message: 'Schedule retrieved successfully',
                data: schedule
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
