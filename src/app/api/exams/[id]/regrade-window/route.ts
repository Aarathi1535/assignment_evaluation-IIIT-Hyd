import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { z } from 'zod';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import ExamService from '../../../../../services/ExamService';

export const dynamic = 'force-dynamic';

const timestampSchema = z.string().datetime({ offset: true }).nullable();
const regradeWindowSchema = z.object({
    regradeWindowOpensAt: timestampSchema,
    regradeWindowClosesAt: timestampSchema
}).strict().superRefine(({ regradeWindowOpensAt, regradeWindowClosesAt }, context) => {
    if ((regradeWindowOpensAt === null) !== (regradeWindowClosesAt === null)) {
        context.addIssue({
            code: 'custom',
            message: 'Both regrade window timestamps must be set or cleared together'
        });
        return;
    }

    if (
        regradeWindowOpensAt !== null
        && regradeWindowClosesAt !== null
        && Date.parse(regradeWindowOpensAt) >= Date.parse(regradeWindowClosesAt)
    ) {
        context.addIssue({
            code: 'custom',
            message: 'Regrade window opening time must be before its closing time'
        });
    }
});

export async function PUT(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission(Permission.EDIT_EXAM);
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

        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json({
                success: false,
                message: 'Invalid JSON request body',
                data: null
            }, { status: 400 });
        }

        const parsed = regradeWindowSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({
                success: false,
                message: 'Validation failed',
                data: parsed.error.issues.map(issue => issue.message)
            }, { status: 400 });
        }

        const ipAddress =
            (req as NextRequest & { ip?: string }).ip ||
            req.headers.get('x-forwarded-for') ||
            req.headers.get('x-real-ip') ||
            undefined;
        const updatedExam = await ExamService.updateRegradeWindow(
            id,
            parsed.data.regradeWindowOpensAt ? new Date(parsed.data.regradeWindowOpensAt) : null,
            parsed.data.regradeWindowClosesAt ? new Date(parsed.data.regradeWindowClosesAt) : null,
            auth.user.id,
            auth.user.role,
            { ipAddress }
        );

        return NextResponse.json({
            success: true,
            message: 'Regrade window updated successfully',
            data: updatedExam
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
