import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../lib/db';
import BatchService from '../../../../services/BatchService';
import BatchRepository from '../../../../repositories/BatchRepository';
import { requirePermission } from '../../../../lib/apiAuth';
import { Permission } from '../../../../constants/permissions';
import { HttpError } from '../../../../lib/errors';
import AnswerScript from '../../../../models/AnswerScript';
import Exam, { IngestionApprovalStatus } from '../../../../models/Exam';


export async function GET(
    req: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission(Permission.VIEW_BATCH);
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
        const batch = await BatchRepository.getBatchById(id, auth.user.id, auth.user.role);

        const scriptCount = await AnswerScript.countDocuments({ batchId: job.batchId, isActive: true });

        // Resolve exam approval state if batch is exam-linked
        let examId: string | null = null;
        let ingestionApprovalStatus: IngestionApprovalStatus = IngestionApprovalStatus.PENDING_REVIEW;
        let approvedBy: string | null = null;
        let approvedAt: string | null = null;

        if (batch?.exam) {
            examId = batch.exam.toString();
            const exam = await Exam.findOne({ _id: examId, isActive: true }).lean();
            if (exam) {
                ingestionApprovalStatus = exam.ingestionApprovalStatus ?? IngestionApprovalStatus.PENDING_REVIEW;
                approvedBy = exam.approvedBy?.toString() ?? null;
                approvedAt = exam.approvedAt?.toISOString() ?? null;
            }
        }

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
                    scriptCount,
                    startedAt: job.startedAt || null,
                    completedAt: job.completedAt || null,
                    createdAt: job.createdAt,
                    updatedAt: job.updatedAt,
                    failureReason: job.failureReason || null,
                    examId,
                    ingestionApprovalStatus,
                    approvedBy,
                    approvedAt
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
