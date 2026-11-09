import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { Permission, UserRole } from '../../../../../../../constants/permissions';
import { requirePermission } from '../../../../../../../lib/apiAuth';
import { connectDB } from '../../../../../../../lib/db';
import { HttpError } from '../../../../../../../lib/errors';
import {
    LtiGradePassbackOptions,
    ltiGradePassbackService
} from '../../../../../../../services/LtiGradePassbackService';

export const dynamic = 'force-dynamic';

const SECURITY_HEADERS = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
} as const;

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission(Permission.VIEW_ALL_SUBMISSIONS);
    if (!auth.authorized) {
        return auth.response;
    }
    if (auth.user.role !== UserRole.ADMIN && auth.user.role !== UserRole.PROFESSOR) {
        return NextResponse.json(
            { success: false, message: 'Forbidden', data: null },
            { status: 403, headers: SECURITY_HEADERS }
        );
    }

    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json(
            { success: false, message: 'Invalid exam ID', data: null },
            { status: 400, headers: SECURITY_HEADERS }
        );
    }

    return NextResponse.json(
        {
            success: true,
            stubMode: true,
            message: 'LTI 1.3 Assignment and Grade Services (AGS 2.0) passback endpoint is in safe stub mode.',
            examId: id,
            supportedMethods: ['GET', 'POST'],
            documentation: 'docs/LTI_1_3_GRADE_PASSBACK.md'
        },
        { status: 200, headers: SECURITY_HEADERS }
    );
}

export async function POST(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission(Permission.VIEW_ALL_SUBMISSIONS);
    if (!auth.authorized) {
        return auth.response;
    }
    if (auth.user.role !== UserRole.ADMIN && auth.user.role !== UserRole.PROFESSOR) {
        return NextResponse.json(
            { success: false, message: 'Forbidden', data: null },
            { status: 403, headers: SECURITY_HEADERS }
        );
    }

    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json(
            { success: false, message: 'Invalid exam ID', data: null },
            { status: 400, headers: SECURITY_HEADERS }
        );
    }

    let options: LtiGradePassbackOptions = {};
    try {
        const text = await request.text();
        if (text.trim().length > 0) {
            const parsed = JSON.parse(text);
            if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
                options = parsed as LtiGradePassbackOptions;
            } else {
                return NextResponse.json(
                    { success: false, message: 'Request body must be a valid JSON object', data: null },
                    { status: 400, headers: SECURITY_HEADERS }
                );
            }
        }
    } catch {
        return NextResponse.json(
            { success: false, message: 'Invalid JSON payload in request body', data: null },
            { status: 400, headers: SECURITY_HEADERS }
        );
    }

    if (options.students !== undefined) {
        if (!Array.isArray(options.students)) {
            return NextResponse.json(
                { success: false, message: 'The "students" field must be an array', data: null },
                { status: 400, headers: SECURITY_HEADERS }
            );
        }
        if (options.students.length > 2000) {
            return NextResponse.json(
                { success: false, message: 'The students array exceeds the maximum limit of 2000 entries', data: null },
                { status: 400, headers: SECURITY_HEADERS }
            );
        }
        if (options.students.some(s => !s || typeof s !== 'object')) {
            return NextResponse.json(
                { success: false, message: 'Students array cannot contain null or non-object entries', data: null },
                { status: 400, headers: SECURITY_HEADERS }
            );
        }
    }

    if (options.comment !== undefined) {
        if (typeof options.comment !== 'string' || options.comment.length > 1000) {
            return NextResponse.json(
                { success: false, message: 'The "comment" field must be a string up to 1000 characters', data: null },
                { status: 400, headers: SECURITY_HEADERS }
            );
        }
    }

    try {
        await connectDB();
        const result = await ltiGradePassbackService.executeGradePassback(
            id,
            options,
            auth.user.id,
            auth.user.role
        );

        return NextResponse.json(
            {
                success: true,
                stubMode: true,
                data: result
            },
            { status: 200, headers: SECURITY_HEADERS }
        );
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return NextResponse.json(
                { success: false, message: error.message, data: null },
                { status: error.statusCode || 500, headers: SECURITY_HEADERS }
            );
        }

        console.error('Failed while executing LTI 1.3 grade passback stub:', error);
        return NextResponse.json(
            { success: false, message: 'Could not process LTI grade passback', data: null },
            { status: 500, headers: SECURITY_HEADERS }
        );
    }
}

