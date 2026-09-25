import { NextResponse } from 'next/server';
import { connectDB } from '../../../../lib/db';
import personalizedAssessmentService from '../../../../services/PersonalizedAssessmentService';
import { requireAuth } from '../../../../lib/apiAuth';
import { HttpError } from '../../../../lib/errors';

export async function GET() {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        await connectDB();
        const scheduleData = await personalizedAssessmentService.getMySchedule(auth.user.id);
        return NextResponse.json(
            {
                success: true,
                message: 'Student schedule retrieved successfully',
                data: scheduleData
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
