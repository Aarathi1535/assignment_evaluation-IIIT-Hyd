import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import { requireAuth } from '../../../../../lib/apiAuth';
import studentResultService from '../../../../../services/StudentResultService';
import { HttpError } from '../../../../../lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    const { scriptId } = await context.params;

    try {
        await connectDB();
        const result = await studentResultService.getItemizedStudentResult(
            scriptId,
            auth.user.id,
            auth.user.role
        );

        return NextResponse.json(result, {
            status: 200,
            headers: {
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        });
    } catch (error: unknown) {
        const status = error instanceof HttpError ? error.statusCode : 404;
        return NextResponse.json(
            { success: false, message: status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Not found' },
            {
                status,
                headers: {
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff',
                },
            }
        );
    }
}
