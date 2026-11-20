import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import questionOrganizerService from '../../../../../services/QuestionOrganizerService';
import Course from '../../../../../models/Course';
import { requireAuth, requireFeature } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';

export async function POST(req: NextRequest) {
    const featureCheck = requireFeature('PERSONALIZED_ASSESSMENT');
    if (!featureCheck.authorized) {
        return (
            featureCheck.response ??
            NextResponse.json(
                { success: false, message: 'Personalized assessment feature is disabled', data: null },
                { status: 404 }
            )
        );
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
        return NextResponse.json(
            { success: false, message: 'Forbidden: Only professors or admins can organize questions', data: null },
            { status: 403 }
        );
    }

    try {
        await connectDB();
        const body = await req.json();

        if (!body.courseId) {
            return NextResponse.json(
                { success: false, message: 'courseId is required', data: null },
                { status: 400 }
            );
        }

        // Verify course existence and authorization
        const course = await Course.findById(body.courseId);
        if (!course) {
            return NextResponse.json(
                { success: false, message: 'Course not found', data: null },
                { status: 404 }
            );
        }

        if (auth.user.role === 'PROFESSOR') {
            const isOwner = course.professor && course.professor.toString() === auth.user.id;
            const isTA = Array.isArray(course.teachingAssistants) && course.teachingAssistants.some((ta) => ta.toString() === auth.user.id);
            if (!isOwner && !isTA) {
                return NextResponse.json(
                    { success: false, message: 'Forbidden: You are not authorized to organize this course', data: null },
                    { status: 403 }
                );
            }
        }

        const result = await questionOrganizerService.organizeCourseQuestions(body.courseId, {
            forceReorganize: Boolean(body.forceReorganize),
            questionIds: Array.isArray(body.questionIds) ? body.questionIds : undefined
        });

        return NextResponse.json(
            {
                success: true,
                message: `Successfully organized ${result.organizedCount} questions with AI taxonomy and concepts`,
                data: {
                    totalProcessed: result.totalProcessed,
                    organizedCount: result.organizedCount,
                    failures: result.failures,
                    questions: result.questions
                }
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        console.error('[POST /api/personalized/questions/organize]', error);
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json(
            { success: false, message, data: null },
            { status }
        );
    }
}
