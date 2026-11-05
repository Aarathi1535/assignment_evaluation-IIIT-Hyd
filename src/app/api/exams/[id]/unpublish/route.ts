import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import ExamService from '../../../../../services/ExamService';

export const dynamic = 'force-dynamic';

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission(Permission.PUBLISH_GRADES);
    if (!auth.authorized) {
        return auth.response;
    }

    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json({
            success: false,
            message: 'Invalid ID format',
            data: null
        }, { status: 400 });
    }

    try {
        await connectDB();

        const ipAddress =
            (req as NextRequest & { ip?: string }).ip ||
            req.headers.get('x-forwarded-for') ||
            req.headers.get('x-real-ip') ||
            undefined;

        const exam = await ExamService.unpublishExam(
            id,
            auth.user.id,
            auth.user.role,
            { ipAddress }
        );

        return NextResponse.json({
            success: true,
            message: 'Exam results unpublished successfully',
            data: exam
        }, { status: 200 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json({
            success: false,
            message,
            data: null
        }, { status });
    }
}

