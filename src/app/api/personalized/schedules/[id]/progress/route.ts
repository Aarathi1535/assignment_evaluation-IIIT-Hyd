import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../lib/db';
import personalizedAssessmentService from '../../../../../../services/PersonalizedAssessmentService';
import { requireAuth } from '../../../../../../lib/apiAuth';
import { HttpError } from '../../../../../../lib/errors';

export async function GET(
    _req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
        return NextResponse.json(
            {
                success: false,
                message: 'Forbidden: Only professors or admins can view schedule progress',
                data: null
            },
            { status: 403 }
        );
    }

    try {
        await connectDB();
        const { id } = await context.params;
        if (!id || !mongoose.Types.ObjectId.isValid(id)) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Invalid schedule ID format',
                    error: { code: 'VALIDATION_FAILED', message: 'Invalid schedule ID format' },
                    data: null
                },
                { status: 400 }
            );
        }

        const progress = await personalizedAssessmentService.getScheduleProgress(
            id,
            auth.user.id,
            auth.user.role
        );

        return NextResponse.json(
            {
                success: true,
                message: 'Schedule progress retrieved successfully',
                data: progress
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        console.error('[DIAG] GET /api/personalized/schedules/[id]/progress ERROR:', error);
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
