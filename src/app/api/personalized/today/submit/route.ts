import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import personalizedAssessmentService from '../../../../../services/PersonalizedAssessmentService';
import { submitStudentAssignmentSchema } from '../../../../../validations/personalizedAssessmentValidation';
import { requireAuth, requireFeature } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';

export async function POST(req: NextRequest) {
    const featureCheck = requireFeature('PERSONALIZED_ASSESSMENT');
    if (!featureCheck.authorized) {
        return featureCheck.response ?? NextResponse.json({ success: false, message: 'Personalized assessment feature is disabled', data: null }, { status: 404 });
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        await connectDB();

        const auditCtx = {
            actingUserId: auth.user.id,
            actingUserRole: auth.user.role,
            ipAddress: req.headers.get('x-forwarded-for') || undefined
        };

        const contentType = req.headers.get('content-type') || '';

        // 1. Multipart form-data: photo upload support (or text+photo)
        if (contentType.includes('multipart/form-data')) {
            const formData = await req.formData();
            let assignmentId = (formData.get('assignmentId') as string | null) || undefined;
            const file = formData.get('file') as File | null;
            const answer = (formData.get('answer') as string | null) || undefined;

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

            if (!file && (!answer || answer.trim().length === 0)) {
                return NextResponse.json(
                    {
                        success: false,
                        message: 'Either answer text or photo file is required for submission',
                        data: null
                    },
                    { status: 400 }
                );
            }

            if (file) {
                const arrayBuffer = await file.arrayBuffer();
                const fileBuffer = Buffer.from(new Uint8Array(arrayBuffer));

                const submitted = await personalizedAssessmentService.submitTodayPhotoAssignment({
                    studentId: auth.user.id,
                    assignmentId,
                    fileBuffer,
                    originalFilename: file.name || 'answer.png',
                    mimeType: file.type || 'image/png',
                    answerText: answer,
                    referenceNow: new Date(),
                    auditCtx,
                    isRealStudentData: auth.user.role === 'STUDENT'
                });

                return NextResponse.json(
                    {
                        success: true,
                        message: 'Personalized answer photo evaluated and submitted successfully',
                        data: submitted
                    },
                    { status: 200 }
                );
            }

            // Multipart text-only answer
            const submitted = await personalizedAssessmentService.submitTodayAssignment(
                auth.user.id,
                assignmentId,
                answer!.trim(),
                new Date(),
                auditCtx,
                auth.user.role === 'STUDENT'
            );

            return NextResponse.json(
                {
                    success: true,
                    message: 'Assignment submitted successfully',
                    data: submitted
                },
                { status: 200 }
            );
        }

        // 2. Application/JSON: preserved text-only submission path
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

        const submitted = await personalizedAssessmentService.submitTodayAssignment(
            auth.user.id,
            assignmentId,
            validation.data.answer,
            new Date(),
            auditCtx,
            auth.user.role === 'STUDENT'
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
