import { NextRequest, NextResponse } from 'next/server';
import { Types as MongooseTypes } from 'mongoose';
import { connectDB } from '../../../../lib/db';
import personalizedAssessmentService from '../../../../services/PersonalizedAssessmentService';
import { createPersonalizedScheduleSchema } from '../../../../validations/personalizedAssessmentValidation';
import { requireAuth } from '../../../../lib/apiAuth';
import { HttpError } from '../../../../lib/errors';

export async function GET() {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
        return NextResponse.json(
            {
                success: false,
                message: 'Forbidden: Only professors or admins can list schedules',
                data: null
            },
            { status: 403 }
        );
    }

    if (!auth.user.id || !MongooseTypes.ObjectId.isValid(auth.user.id)) {
        return NextResponse.json(
            {
                success: false,
                message: 'Invalid authenticated user identity',
                error: { code: 'UNAUTHORIZED', message: 'Invalid authenticated user identity' },
                data: null
            },
            { status: 401 }
        );
    }

    try {
        await connectDB();
        const schedules = await personalizedAssessmentService.getSchedulesByProfessor(auth.user.id);
        return NextResponse.json(
            {
                success: true,
                message: 'Schedules retrieved successfully',
                data: schedules
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        console.error('[API /api/personalized/schedules GET Error]:', error);
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

export async function POST(req: NextRequest) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
        return NextResponse.json(
            {
                success: false,
                message: 'Forbidden: Only professors or admins can create schedules',
                data: null
            },
            { status: 403 }
        );
    }

    try {
        await connectDB();

        let body;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Invalid JSON request body',
                    data: null
                },
                { status: 400 }
            );
        }

        const validation = createPersonalizedScheduleSchema.safeParse(body);
        if (!validation.success) {
            const firstIssue = validation.error.issues[0];
            const fieldPath = firstIssue?.path?.length ? firstIssue.path.join('.') : 'unknown';
            const rawMessage = firstIssue?.message || 'Validation failed';
            const firstError = `Field '${fieldPath}': ${rawMessage}`;
            return NextResponse.json(
                {
                    success: false,
                    message: firstError,
                    error: { code: 'VALIDATION_FAILED', message: firstError, details: validation.error.format() },
                    data: null
                },
                { status: 400 }
            );
        }

        const auditCtx = {
            actingUserId: auth.user.id,
            actingUserRole: auth.user.role,
            ipAddress: req.headers.get('x-forwarded-for') || undefined
        };

        const schedule = await personalizedAssessmentService.createSchedule(
            validation.data,
            auth.user.id,
            auditCtx
        );

        return NextResponse.json(
            {
                success: true,
                message: 'Personalized assessment schedule created and activated successfully',
                data: schedule
            },
            { status: 201 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        const code = message.includes('insufficient') || message.includes('capacity')
            ? 'INSUFFICIENT_POOL'
            : status === 400
            ? 'VALIDATION_FAILED'
            : status === 403
            ? 'FORBIDDEN'
            : 'INTERNAL_ERROR';

        return NextResponse.json(
            {
                success: false,
                message,
                error: { code, message },
                data: null
            },
            { status }
        );
    }
}
