import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import personalizedQuestionGenerationService from '../../../../../services/PersonalizedQuestionGenerationService';
import { generateQuestionsSchema } from '../../../../../validations/personalizedAssessmentValidation';
import { requireAuth } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';

export async function POST(req: NextRequest) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
        return NextResponse.json(
            {
                success: false,
                message: 'Forbidden: Only professors or admins can generate questions',
                error: { code: 'FORBIDDEN', message: 'Forbidden: Only professors or admins can generate questions' },
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
                    error: { code: 'VALIDATION_FAILED', message: 'Invalid JSON request body' },
                    data: null
                },
                { status: 400 }
            );
        }

        const validation = generateQuestionsSchema.safeParse(body);
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

        const result = await personalizedQuestionGenerationService.generateQuestionBank({
            courseId: validation.data.courseId,
            targetCount: validation.data.targetCount,
            difficultyDistribution: validation.data.difficultyDistribution,
            selectedTopics: validation.data.selectedTopics,
            userId: auth.user.id
        });

        return NextResponse.json(
            {
                success: true,
                message: `Successfully generated ${result.totalGenerated} syllabus-grounded questions. Total in course pool: ${result.totalInPool}`,
                data: result
            },
            { status: 201 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        const code = status === 503 ? 'AI_NOT_CONFIGURED' : status === 400 ? 'VALIDATION_FAILED' : 'INTERNAL_ERROR';

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
