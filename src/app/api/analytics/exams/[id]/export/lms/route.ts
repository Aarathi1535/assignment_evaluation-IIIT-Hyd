import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { Permission, UserRole } from '../../../../../../../constants/permissions';
import { canManageExam, requirePermission } from '../../../../../../../lib/apiAuth';
import { connectDB } from '../../../../../../../lib/db';
import { HttpError } from '../../../../../../../lib/errors';
import { ExamStatus } from '../../../../../../../models/Exam';
import {
    buildLmsCsv,
    LmsStudentInput,
    mapLmsStudentIdsToGrades
} from '../../../../../../../lib/lmsMapping';

export const dynamic = 'force-dynamic';

const SECURITY_HEADERS = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff'
} as const;

export async function GET(
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

    const formatParam = request.nextUrl.searchParams.get('format') || 'standard';
    const format = formatParam.toLowerCase() === 'canvas' ? 'canvas' : 'standard';

    try {
        await connectDB();
        const manage = await canManageExam(auth.user, id);
        if (!manage.canManage || !manage.exam) {
            return NextResponse.json(
                { success: false, message: manage.errorMessage || 'Exam not found', data: null },
                { status: manage.errorStatus === 200 ? 404 : manage.errorStatus, headers: SECURITY_HEADERS }
            );
        }
        const exam = manage.exam;

        if (!exam.isActive || exam.status !== ExamStatus.PUBLISHED) {
            return NextResponse.json(
                { success: false, message: 'LMS grade export is available only for published exams', data: null },
                { status: 409, headers: SECURITY_HEADERS }
            );
        }

        const mappingResult = await mapLmsStudentIdsToGrades(exam);
        const csvContent = buildLmsCsv(mappingResult, format);

        return new NextResponse(csvContent, {
            status: 200,
            headers: {
                ...SECURITY_HEADERS,
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="exam-${id}-lms-${format}.csv"`
            }
        });
    } catch (error: unknown) {
        console.error('Failed to export LMS grade mapping:', error);
        return NextResponse.json(
            { success: false, message: 'Could not export LMS grade mapping', data: null },
            { status: 500, headers: SECURITY_HEADERS }
        );
    }
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

    let body: unknown;
    try {
        const text = await request.text();
        if (!text.trim()) {
            return NextResponse.json(
                { success: false, message: 'Request body cannot be empty', data: null },
                { status: 400, headers: SECURITY_HEADERS }
            );
        }
        body = JSON.parse(text);
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
            return NextResponse.json(
                { success: false, message: 'Request body must be a valid JSON object', data: null },
                { status: 400, headers: SECURITY_HEADERS }
            );
        }
    } catch {
        return NextResponse.json(
            { success: false, message: 'Invalid JSON payload in request body', data: null },
            { status: 400, headers: SECURITY_HEADERS }
        );
    }

    const { students, format = 'standard' } = body as {
        students?: LmsStudentInput[];
        format?: 'canvas' | 'standard';
    };

    if (!Array.isArray(students)) {
        return NextResponse.json(
            { success: false, message: 'A "students" array is required in request body', data: null },
            { status: 400, headers: SECURITY_HEADERS }
        );
    }

    if (students.length > 2000) {
        return NextResponse.json(
            { success: false, message: 'The students array exceeds the maximum limit of 2000 entries', data: null },
            { status: 400, headers: SECURITY_HEADERS }
        );
    }

    if (students.some(s => !s || typeof s !== 'object')) {
        return NextResponse.json(
            { success: false, message: 'Students array cannot contain null or non-object entries', data: null },
            { status: 400, headers: SECURITY_HEADERS }
        );
    }

    try {
        await connectDB();
        const manage = await canManageExam(auth.user, id);
        if (!manage.canManage || !manage.exam) {
            return NextResponse.json(
                { success: false, message: manage.errorMessage || 'Exam not found', data: null },
                { status: manage.errorStatus === 200 ? 404 : manage.errorStatus, headers: SECURITY_HEADERS }
            );
        }
        const exam = manage.exam;

        if (!exam.isActive || exam.status !== ExamStatus.PUBLISHED) {
            return NextResponse.json(
                { success: false, message: 'LMS grade mapping is available only for published exams', data: null },
                { status: 409, headers: SECURITY_HEADERS }
            );
        }

        const mappingResult = await mapLmsStudentIdsToGrades(exam, students);

        const wantsDownload = request.nextUrl.searchParams.get('download') === 'true' ||
            request.headers.get('accept')?.includes('text/csv');

        if (wantsDownload) {
            const csvFormat = format === 'canvas' ? 'canvas' : 'standard';
            const csvContent = buildLmsCsv(mappingResult, csvFormat);
            return new NextResponse(csvContent, {
                status: 200,
                headers: {
                    ...SECURITY_HEADERS,
                    'Content-Type': 'text/csv; charset=utf-8',
                    'Content-Disposition': `attachment; filename="exam-${id}-lms-mapped.csv"`
                }
            });
        }

        return NextResponse.json(
            { success: true, data: mappingResult },
            { status: 200, headers: SECURITY_HEADERS }
        );
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return NextResponse.json(
                { success: false, message: error.message, data: null },
                { status: error.statusCode || 500, headers: SECURITY_HEADERS }
            );
        }
        console.error('Failed to process LMS grade mapping:', error);
        return NextResponse.json(
            { success: false, message: 'Could not process LMS grade mapping', data: null },
            { status: 500, headers: SECURITY_HEADERS }
        );
    }
}

