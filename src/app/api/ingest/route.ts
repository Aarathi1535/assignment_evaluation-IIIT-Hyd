import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../lib/db';
import BatchService, { UploadFileInput } from '../../../services/BatchService';
import { requirePermission } from '../../../lib/apiAuth';
import { IBatch } from '../../../models/Batch';
import { IExam } from '../../../models/Exam';

interface PopulatedBatch extends Omit<IBatch, 'exam'> {
  exam?: IExam | null;
}
import { Permission } from '../../../constants/permissions';
import { HttpError } from '../../../lib/errors';
import {
    MAX_SINGLE_FILE_SIZE,
    MAX_TOTAL_REQUEST_SIZE
} from '../../../utils/fileValidation';

export async function POST(req: NextRequest) {
    const auth = await requirePermission(Permission.CREATE_BATCH);
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        await connectDB();

        const contentType = req.headers.get('content-type') || '';
        if (!contentType.includes('multipart/form-data')) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Content type must be multipart/form-data',
                    data: null
                },
                { status: 400 }
            );
        }

        let formData: FormData;
        try {
            formData = await req.formData();
        } catch {
            return NextResponse.json(
                {
                    success: false,
                    message: 'Failed to parse multipart form data',
                    data: null
                },
                { status: 400 }
            );
        }

        // Collect all uploaded files from form data
        const files: UploadFileInput[] = [];
        const examId = (formData.get('examId') || formData.get('exam') || undefined) as string | undefined;
        let runningTotalSize = 0;

        // Iterate over form data entries
        for (const [key, value] of formData.entries()) {
            if (value && typeof value === 'object' && 'arrayBuffer' in value && typeof value.arrayBuffer === 'function') {
                const file = value as File;
                const fileSize = file.size || 0;

                if (fileSize > MAX_SINGLE_FILE_SIZE) {
                    throw new HttpError(
                        `File "${file.name || key}" size (${fileSize} bytes) exceeds maximum single-file size limit of ${MAX_SINGLE_FILE_SIZE} bytes (50 MB)`,
                        413
                    );
                }

                if (runningTotalSize + fileSize > MAX_TOTAL_REQUEST_SIZE) {
                    throw new HttpError(
                        `Total upload batch size (${runningTotalSize + fileSize} bytes) exceeds maximum allowed total request size limit of ${MAX_TOTAL_REQUEST_SIZE} bytes (200 MB)`,
                        413
                    );
                }

                runningTotalSize += fileSize;

                const arrayBuffer = await file.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                files.push({
                    name: file.name || key,
                    buffer,
                    size: fileSize || buffer.length
                });
            }
        }

        if (files.length === 0) {
            return NextResponse.json(
                {
                    success: false,
                    message: 'No files provided in upload request',
                    data: null
                },
                { status: 400 }
            );
        }

        const context = {
            actingUserId: auth.user.id,
            actingUserRole: auth.user.role,
            ipAddress:
                (req as NextRequest & { ip?: string }).ip ||
                req.headers.get('x-forwarded-for') ||
                req.headers.get('x-real-ip') ||
                undefined
        };

        const result = await BatchService.createBatch(files, examId, context);

        return NextResponse.json(
            {
                success: true,
                message: 'Batch uploaded successfully',
                data: {
                    batchId: result.batch.batchId,
                    status: result.batch.status,
                    totalFiles: result.batch.totalFiles,
                    totalSize: result.batch.totalSize,
                    totalPageCount: result.batch.totalPageCount,
                    files: result.batch.files,
                    job: {
                        id: result.job._id,
                        batchId: result.job.batchId,
                        status: result.job.status,
                        totalPages: result.job.totalPages,
                        processedPages: result.job.processedPages,
                        failedPages: result.job.failedPages
                    }
                }
            },
            { status: 201 }
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

export async function GET() {
    const auth = await requirePermission(Permission.VIEW_BATCH);
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        await connectDB();
        const batches = (await BatchService.getBatches(auth.user.id, auth.user.role)) as unknown as PopulatedBatch[];

        const result = batches.map(b => ({
            batchId: b.batchId,
            examId: b.exam ? b.exam._id.toString() : null,
            examTitle: b.exam ? b.exam.title : 'No Exam Linked',
            status: b.status,
            totalFiles: b.totalFiles,
            totalSize: b.totalSize,
            totalPageCount: b.totalPageCount,
            createdAt: b.createdAt,
            updatedAt: b.updatedAt
        }));

        return NextResponse.json(
            {
                success: true,
                message: 'Batches retrieved successfully',
                data: result
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
