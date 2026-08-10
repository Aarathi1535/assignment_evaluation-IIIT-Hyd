import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../lib/db';
import BatchService from '../../../../services/BatchService';
import { requireAuth } from '../../../../lib/apiAuth';
import { HttpError } from '../../../../lib/errors';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    const { id } = await context.params;

    if (!id || typeof id !== 'string') {
        return NextResponse.json(
            {
                success: false,
                message: 'Invalid batch ID',
                data: null
            },
            { status: 400 }
        );
    }

    try {
        await connectDB();
        const job = await BatchService.getIngestionStatus(id, auth.user.id, auth.user.role);

        return NextResponse.json(
            {
                success: true,
                message: 'Ingestion status retrieved successfully',
                data: {
                    batchId: job.batchId,
                    status: job.status,
                    totalPages: job.totalPages,
                    processedPages: job.processedPages,
                    failedPages: job.failedPages,
                    startedAt: job.startedAt || null,
                    completedAt: job.completedAt || null,
                    createdAt: job.createdAt,
                    updatedAt: job.updatedAt,
                    failureReason: job.failureReason || null
                }
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json(
            {
                success: false,
                message,
                data: null
            },
            { status }
        );
    }
}
