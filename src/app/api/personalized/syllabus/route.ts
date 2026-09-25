import { NextRequest, NextResponse } from 'next/server';
import { Types as MongooseTypes, Error as MongooseError } from 'mongoose';
import { connectDB } from '../../../../lib/db';
import syllabusProcessingService from '../../../../services/SyllabusProcessingService';
import { uploadSyllabusSchema } from '../../../../validations/personalizedAssessmentValidation';
import { requireAuth } from '../../../../lib/apiAuth';
import { HttpError } from '../../../../lib/errors';

export async function GET(req: NextRequest) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return NextResponse.json(
            {
                success: false,
                message: 'Authentication required. Please log in to view course syllabi.',
                error: { code: 'UNAUTHORIZED', message: 'Authentication required. Please log in to view course syllabi.' },
                data: null
            },
            { status: 401 }
        );
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

        const syllabus = await syllabusProcessingService.getSyllabus(courseId);
        return NextResponse.json(
            {
                success: true,
                message: syllabus ? 'Syllabus retrieved successfully' : 'No syllabus found for course',
                data: syllabus
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        console.error('[DIAG] GET /api/personalized/syllabus ERROR:', error);
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        let code = 'INTERNAL_ERROR';
        if (error instanceof HttpError) {
            if (status === 400) code = 'VALIDATION_FAILED';
            else if (status === 401) code = 'UNAUTHORIZED';
            else if (status === 403) code = 'FORBIDDEN';
            else if (status === 404) code = 'NOT_FOUND';
        } else if (error instanceof MongooseError) {
            code = 'DATABASE_ERROR';
        }

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

export async function POST(req: NextRequest) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return NextResponse.json(
            {
                success: false,
                message: 'Authentication required. Please log in to upload syllabus.',
                error: { code: 'UNAUTHORIZED', message: 'Authentication required. Please log in to upload syllabus.' },
                data: null
            },
            { status: 401 }
        );
    }

    if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
        return NextResponse.json(
            {
                success: false,
                message: 'Forbidden: Only professors or admins can upload course syllabi',
                error: { code: 'FORBIDDEN', message: 'Forbidden: Only professors or admins can upload course syllabi' },
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

        const validation = uploadSyllabusSchema.safeParse(body);
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

        const syllabus = await syllabusProcessingService.processSyllabus(
            validation.data.courseId,
            validation.data.syllabusText,
            auth.user.id,
            { userRole: auth.user.role }
        );

        return NextResponse.json(
            {
                success: true,
                message: `Successfully processed syllabus: ${syllabus.units.length} units and ${syllabus.extractedTopics.length} topics extracted`,
                data: syllabus
            },
            { status: 201 }
        );
    } catch (error: unknown) {
        console.error('[API /api/personalized/syllabus POST Error]:', error);
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        let code = 'INTERNAL_ERROR';
        if (error instanceof HttpError) {
            if (status === 400) code = 'VALIDATION_FAILED';
            else if (status === 401) code = 'UNAUTHORIZED';
            else if (status === 403) code = 'FORBIDDEN';
            else if (status === 404) code = 'NOT_FOUND';
            else if (status === 503) code = 'AI_NOT_CONFIGURED';
        } else if (error instanceof MongooseError) {
            code = 'DATABASE_ERROR';
        }

        return NextResponse.json(
            {
                success: false,
                message,
                error: {
                    code,
                    message,
                    stack: process.env.NODE_ENV !== 'production' && error instanceof Error ? error.stack : undefined
                },
                data: null
            },
            { status }
        );
    }
}


