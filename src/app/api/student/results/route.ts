import { NextResponse } from 'next/server';
import { connectDB } from '../../../../lib/db';
import { requireAuth } from '../../../../lib/apiAuth';
import studentResultService from '../../../../services/StudentResultService';
import { HttpError } from '../../../../lib/errors';

export const dynamic = 'force-dynamic';

export async function GET() {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        await connectDB();
        const results = await studentResultService.getStudentResults(auth.user.id, auth.user.role);
        return NextResponse.json({
            success: true,
            message: 'Student results retrieved successfully',
            data: results
        }, { status: 200 });
    } catch (error: unknown) {
        if (error instanceof HttpError) {
            return NextResponse.json({
                success: false,
                message: error.message,
                data: null
            }, { status: error.statusCode });
        }

        console.error('Unhandled error in student results route:', error);
        return NextResponse.json({
            success: false,
            message: 'An unexpected error occurred',
            data: null
        }, { status: 500 });
    }
}
