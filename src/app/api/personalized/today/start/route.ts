import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import personalizedAssessmentService from '../../../../../services/PersonalizedAssessmentService';
import { requireAuth } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';

export async function POST(req: NextRequest) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        await connectDB();

        let body: { assignmentId?: string } = {};
        try {
            body = await req.json();
        } catch {
            // empty body is fine if we locate assignment by student's today
        }

        let assignmentId = body.assignmentId;
        if (!assignmentId) {
            const todayData = await personalizedAssessmentService.getTodayAssignment(auth.user.id);
            if (!todayData?.assignment) {
                return NextResponse.json(
                    {
                        success: false,
                        message: 'No active assessment found to start for today',
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

        const started = await personalizedAssessmentService.startTodayAssignment(
            auth.user.id,
            assignmentId,
            new Date(),
            auditCtx
        );

        return NextResponse.json(
            {
                success: true,
                message: 'Assignment started successfully',
                data: started
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
