import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import personalizedAssessmentService from '../../../../../services/PersonalizedAssessmentService';
import { submitStudentAssignmentSchema } from '../../../../../validations/personalizedAssessmentValidation';
import { requireAuth } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';

export async function POST(req: NextRequest) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
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

        const validation = submitStudentAssignmentSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Validation failed',
                    data: validation.error.format()
                },
                { status: 400 }
            );
        }

        let assignmentId = body.assignmentId;
        if (!assignmentId) {
            const todayData = await personalizedAssessmentService.getTodayAssignment(auth.user.id);
            if (!todayData?.assignment) {
                return NextResponse.json(
                    {
                        success: false,
                        message: 'No active assessment found for today to submit',
                        data: null
                    },
                    { status: 404 }
                );
            }
            assignmentId = todayData.assignment._id.toString();
        }

        const auditCtx = {
            actingUserId: auth.user.id,
            actingUserRole: auth.user.role,
            ipAddress: req.headers.get('x-forwarded-for') || undefined
        };

        const submitted = await personalizedAssessmentService.submitTodayAssignment(
            auth.user.id,
            assignmentId,
            validation.data.answer,
            new Date(),
            auditCtx
        );

        return NextResponse.json(
            {
                success: true,
                message: 'Assignment submitted successfully',
                data: submitted
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
