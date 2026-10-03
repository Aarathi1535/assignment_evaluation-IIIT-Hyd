import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../lib/db';
import { HttpError } from '../../../../../../lib/errors';
import { requireAuth, requireFeature } from '../../../../../../lib/apiAuth';
import personalizedAssessmentService from '../../../../../../services/PersonalizedAssessmentService';
import { assignPersonalizedStudentSchema } from '../../../../../../validations/personalizedAssessmentValidation';

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const featureCheck = requireFeature('PERSONALIZED_ASSESSMENT');
    if (!featureCheck.authorized) {
        return featureCheck.response ?? NextResponse.json(
            { success: false, message: 'Personalized assessment feature is disabled', data: null },
            { status: 404 }
        );
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }
    if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
        return NextResponse.json(
            { success: false, message: 'Forbidden: Only professors or admins can assign students', data: null },
            { status: 403 }
        );
    }

    const { id: scheduleId } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(scheduleId)) {
        return NextResponse.json(
            { success: false, message: 'Schedule not found', data: null },
            { status: 404 }
        );
    }

    try {
        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { success: false, message: 'Invalid JSON request body', data: null },
                { status: 400 }
            );
        }

        const validation = assignPersonalizedStudentSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: 'Student not found', data: null },
                { status: 400 }
            );
        }

        await connectDB();
        const result = await personalizedAssessmentService.manuallyAssignStudentToSchedule(
            scheduleId,
            validation.data.studentId,
            auth.user.id,
            auth.user.role
        );

        return NextResponse.json(
            { success: true, message: 'Student assigned successfully', data: result },
            { status: 201 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json(
            { success: false, message, data: null },
            { status }
        );
    }
}
