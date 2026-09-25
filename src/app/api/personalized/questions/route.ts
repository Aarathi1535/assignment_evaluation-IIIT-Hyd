import { NextRequest, NextResponse } from 'next/server';
import { Types as MongooseTypes } from 'mongoose';
import { connectDB } from '../../../../lib/db';
import personalizedAssessmentService from '../../../../services/PersonalizedAssessmentService';
import {
    createPersonalizedQuestionSchema,
    bulkCreatePersonalizedQuestionsSchema
} from '../../../../validations/personalizedAssessmentValidation';
import { requireAuth } from '../../../../lib/apiAuth';
import { HttpError } from '../../../../lib/errors';

export async function GET(req: NextRequest) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        await connectDB();
        const url = new URL(req.url);
        const courseId = url.searchParams.get('courseId');

        if (!courseId) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'courseId query parameter is required',
                    error: { code: 'VALIDATION_FAILED', message: 'courseId query parameter is required' },
                    data: null
                },
                { status: 400 }
            );
        }

        if (!MongooseTypes.ObjectId.isValid(courseId)) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Invalid courseId query parameter format',
                    error: { code: 'VALIDATION_FAILED', message: 'Invalid courseId query parameter format' },
                    data: null
                },
                { status: 400 }
            );
        }

        const questions = await personalizedAssessmentService.getQuestions(courseId);
        return NextResponse.json(
            {
                success: true,
                message: 'Questions retrieved successfully',
                data: questions
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        console.error('[DIAG] GET /api/personalized/questions ERROR:', error);
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json(
            {
                success: false,
                message,
                error: { code: status === 400 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR', message },
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
                message: 'Forbidden: Only professors or admins can create questions',
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

        const auditCtx = {
            actingUserId: auth.user.id,
            actingUserRole: auth.user.role,
            ipAddress: req.headers.get('x-forwarded-for') || undefined
        };

        // Check if bulk or single creation
        if (Array.isArray(body.questions)) {
            const validation = bulkCreatePersonalizedQuestionsSchema.safeParse(body);
            if (!validation.success) {
                const firstError = validation.error.issues[0]?.message || 'Validation failed';
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

            const created = await personalizedAssessmentService.bulkCreateQuestions(
                validation.data.course,
                validation.data.questions,
                auth.user.id,
                auditCtx
            );

            return NextResponse.json(
                {
                    success: true,
                    message: `Successfully created ${created.length} personalized questions`,
                    data: created
                },
                { status: 201 }
            );
        }

        // Single creation
        const validation = createPersonalizedQuestionSchema.safeParse(body);
        if (!validation.success) {
            const firstError = validation.error.issues[0]?.message || 'Validation failed';
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

        const created = await personalizedAssessmentService.createQuestion(
            validation.data,
            auth.user.id,
            auditCtx
        );

        return NextResponse.json(
            {
                success: true,
                message: 'Personalized question created successfully',
                data: created
            },
            { status: 201 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json(
            {
                success: false,
                message,
                error: { code: status === 400 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR', message },
                data: null
            },
            { status }
        );
    }
}
