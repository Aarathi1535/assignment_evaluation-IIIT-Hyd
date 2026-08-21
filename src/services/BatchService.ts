import BatchRepository from '../repositories/BatchRepository';
import ExamRepository from '../repositories/ExamRepository';
import ImmutableStorageService from './ImmutableStorageService';
import { IBatch, IBatchFile, BatchStatus } from '../models/Batch';
import { IIngestionJob, IngestionStatus } from '../models/IngestionJob';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { writeAuditLog } from '../lib/audit';
import { HttpError } from '../lib/errors';
import {
    detectFileTypeByMagicBytes,
    isPdfEncrypted,
    getPdfPageCount,
    sanitizeDisplayFilename,
    MAX_SINGLE_FILE_SIZE,
    MAX_FILES_PER_BATCH,
    MAX_TOTAL_REQUEST_SIZE,
    MAX_PDF_PAGE_COUNT
} from '../utils/fileValidation';

export interface AuditContext {
    actingUserId?: string;
    actingUserRole?: string;
    ipAddress?: string;
}

export interface UploadFileInput {
    name: string;
    buffer: Buffer;
    size: number;
}

export interface CreateBatchResult {
    batch: IBatch;
    job: IIngestionJob;
}

class BatchService {
    async createBatch(
        files: UploadFileInput[],
        examId?: string,
        context?: AuditContext
    ): Promise<CreateBatchResult> {
        if (!context?.actingUserId || !context?.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        if (context.actingUserRole !== 'ADMIN' && context.actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden', 403);
        }

        const batchId = crypto.randomUUID();

        try {
            // Validate batch presence
            if (!files || files.length === 0) {
                throw new HttpError('At least one file is required for batch upload', 400);
            }

            // Enforce maximum files per batch limit (HTTP 413)
            if (files.length > MAX_FILES_PER_BATCH) {
                throw new HttpError(
                    `Maximum files per batch limit exceeded. Configured limit is ${MAX_FILES_PER_BATCH} files, but received ${files.length}.`,
                    413
                );
            }

            // Enforce total request size limit (HTTP 413)
            const totalSize = files.reduce((acc, f) => acc + (f.size || f.buffer.length), 0);
            if (totalSize > MAX_TOTAL_REQUEST_SIZE) {
                throw new HttpError(
                    `Total batch size limit exceeded. Configured limit is ${MAX_TOTAL_REQUEST_SIZE / (1024 * 1024)} MB, but received ${(totalSize / (1024 * 1024)).toFixed(2)} MB.`,
                    413
                );
            }

            // If exam ID is provided, verify exam exists and owner has access
            let examObjectId: mongoose.Types.ObjectId | undefined;
            if (examId) {
                if (!mongoose.Types.ObjectId.isValid(examId)) {
                    throw new HttpError('Invalid Exam ID', 400);
                }
                const exam = await ExamRepository.getExamById(examId, context.actingUserId, context.actingUserRole);
                if (!exam) {
                    throw new HttpError('Exam not found or access denied', 404);
                }
                examObjectId = new mongoose.Types.ObjectId(examId);
            }

            const batchFiles: IBatchFile[] = [];
            let totalPageCount = 0;
            // Process and validate each file
            for (const file of files) {
                const fileSize = file.size || file.buffer.length;

                // Enforce single-file size limit (HTTP 413)
                if (fileSize > MAX_SINGLE_FILE_SIZE) {
                    throw new HttpError(
                        `Single-file size limit exceeded for "${sanitizeDisplayFilename(file.name)}". Configured limit is ${MAX_SINGLE_FILE_SIZE / (1024 * 1024)} MB.`,
                        413
                    );
                }

                // Verify file type using magic bytes (do not trust Content-Type or extension)
                const detected = detectFileTypeByMagicBytes(file.buffer);
                if (!detected) {
                    throw new HttpError(
                        `Unsupported or invalid file content for "${sanitizeDisplayFilename(file.name)}". Only valid PDF and image files are accepted.`,
                        400
                    );
                }

                let pageCount = 1;
                if (detected.category === 'pdf') {
                    // Check for encrypted/password-protected PDFs
                    if (isPdfEncrypted(file.buffer)) {
                        throw new HttpError(
                            `Encrypted or password-protected PDF "${sanitizeDisplayFilename(file.name)}" cannot be processed.`,
                            400
                        );
                    }

                    // Count PDF pages
                    pageCount = getPdfPageCount(file.buffer);

                    // Enforce per-PDF page count limit (HTTP 413)
                    if (pageCount > MAX_PDF_PAGE_COUNT) {
                        throw new HttpError(
                            `PDF page count limit exceeded for "${sanitizeDisplayFilename(file.name)}". Maximum allowed is ${MAX_PDF_PAGE_COUNT} pages, but file contains ${pageCount} pages.`,
                            413
                        );
                    }
                }

                totalPageCount += pageCount;

                // Generate server-side identifiers
                const fileId = crypto.randomUUID();
                const fileIndex = batchFiles.length;
                const sequenceNumber = fileIndex + 1;
                const originalFilename = sanitizeDisplayFilename(file.name);

                // Write through immutable storage layer and generate HMAC seal
                const stored = await ImmutableStorageService.storeOriginal({
                    batchId,
                    fileId,
                    sequenceNumber,
                    uploader: context.actingUserId,
                    buffer: file.buffer,
                    originalFilename,
                    fileExtension: detected.extension,
                    context
                });

                batchFiles.push({
                    fileId,
                    fileIndex,
                    originalFilename,
                    fileType: detected.category,
                    mimeType: detected.mimeType,
                    size: fileSize,
                    pageCount,
                    storageKey: stored.storageKey,
                    hmac: stored.hmac,
                    keyId: stored.keyId,
                    sequenceNumber: stored.sequenceNumber,
                    integrityMetadata: stored.integrityMetadata
                });
            }

            // Derive ownership strictly from authenticated session
            const uploadedBy = new mongoose.Types.ObjectId(context.actingUserId);

            // Create Batch record in queued state
            const newBatch = await BatchRepository.createBatch({
                batchId,
                uploadedBy,
                exam: examObjectId,
                files: batchFiles,
                totalFiles: batchFiles.length,
                totalSize,
                totalPageCount,
                status: BatchStatus.QUEUED,
                isActive: true
            });

            // Create initial IngestionJob record in queued state
            const newJob = await BatchRepository.createIngestionJob({
                batchId,
                batch: newBatch._id as mongoose.Types.ObjectId,
                uploadedBy,
                status: IngestionStatus.QUEUED,
                totalPages: totalPageCount,
                processedPages: 0,
                failedPages: 0
            });

            // Audit log success
            await writeAuditLog({
                user: context.actingUserId,
                action: 'BATCH_CREATED',
                outcome: 'SUCCESS',
                entityId: newBatch._id as mongoose.Types.ObjectId,
                entityType: 'Batch',
                details: {
                    batchId: newBatch.batchId,
                    totalFiles: newBatch.totalFiles,
                    totalSize: newBatch.totalSize,
                    totalPageCount: newBatch.totalPageCount,
                    examId: examId || undefined
                },
                ipAddress: context.ipAddress
            });

            // If this batch is linked to an exam, reset the exam's ingestion
            // approval to PENDING_REVIEW. A new batch changes the ingestion
            // assembly state and requires a reviewer to re-approve.
            if (examId) {
                const { default: IngestionApprovalService } = await import('./IngestionApprovalService');
                await IngestionApprovalService.resetToReview(examId, {
                    actingUserId: context.actingUserId,
                    actingUserRole: context.actingUserRole ?? '',
                    ipAddress: context.ipAddress
                });
            }

            return { batch: newBatch, job: newJob };

        } catch (error) {
            // Clean up any files stored on disk for this batch
            await ImmutableStorageService.cleanupBatch(batchId).catch(() => { });

            // Audit log failure
            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'BATCH_CREATED',
                    outcome: 'FAILURE',
                    entityType: 'Batch',
                    details: {
                        error: error instanceof Error ? error.message : 'Unknown error',
                        batchId,
                        examId: examId || undefined
                    },
                    ipAddress: context.ipAddress
                });
            }
            throw error;
        }
    }

    async getBatchById(id: string, actingUserId?: string, actingUserRole?: string): Promise<IBatch | null> {
        return await BatchRepository.getBatchById(id, actingUserId, actingUserRole);
    }

    async getIngestionJobByBatchId(batchId: string, actingUserId?: string, actingUserRole?: string): Promise<IIngestionJob | null> {
        return await BatchRepository.getIngestionJobByBatchId(batchId, actingUserId, actingUserRole);
    }

    async getIngestionStatus(id: string, actingUserId?: string, actingUserRole?: string): Promise<IIngestionJob> {
        const job = await BatchRepository.getIngestionJobByBatchId(id, actingUserId, actingUserRole);
        if (!job) {
            throw new HttpError('Batch not found or access denied', 404);
        }
        return job;
    }

    async updateIngestionStatus(
        batchId: string,
        data: {
            status?: IngestionStatus;
            processedPages?: number;
            failedPages?: number;
            failureReason?: string;
        },
        actingUserId?: string,
        actingUserRole?: string
    ): Promise<IIngestionJob> {
        const jobBefore = await BatchRepository.getIngestionJobByBatchId(batchId, actingUserId, actingUserRole);
        if (!jobBefore) {
            throw new HttpError('Batch not found or access denied', 404);
        }

        // Validate status transition
        if (data.status !== undefined && data.status !== jobBefore.status) {
            const { isValidIngestionTransition } = await import('../validations/ingestionValidation');
            if (!isValidIngestionTransition(jobBefore.status, data.status)) {
                throw new HttpError(`Invalid status transition from ${jobBefore.status} to ${data.status}`, 400);
            }
        }

        const updateData: Partial<IIngestionJob> = { ...data };

        // Record startedAt when transitioning to processing
        if (data.status === IngestionStatus.PROCESSING && !jobBefore.startedAt) {
            updateData.startedAt = new Date();
        }

        // Record completedAt when transitioning to done or failed
        if ((data.status === IngestionStatus.DONE || data.status === IngestionStatus.FAILED) && !jobBefore.completedAt) {
            updateData.completedAt = new Date();
        }

        // Sanitize failure reason
        if (data.failureReason !== undefined) {
            const { sanitizeFailureReason } = await import('../validations/ingestionValidation');
            updateData.failureReason = sanitizeFailureReason(data.failureReason);
        }

        const updatedJob = await BatchRepository.updateIngestionJob(batchId, updateData, actingUserId, actingUserRole);
        if (!updatedJob) {
            throw new HttpError('Batch not found or access denied', 404);
        }

        if (data.status !== undefined) {
            await BatchRepository.updateBatch(
                batchId,
                { status: data.status as unknown as BatchStatus },
                actingUserId,
                actingUserRole
            );
        }

        return updatedJob;
    }

    async getBatches(actingUserId?: string, actingUserRole?: string): Promise<IBatch[]> {
        return await BatchRepository.getBatches(actingUserId, actingUserRole);
    }
}

const batchService = new BatchService();
export default batchService;
