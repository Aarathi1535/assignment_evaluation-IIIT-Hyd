import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import BatchRepository from '../repositories/BatchRepository';
import { IngestionStatus, IIngestionJob } from '../models/IngestionJob';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import defaultPageIngestionService, { PageIngestionService } from './PageIngestionService';
import { sanitizeFailureReason } from '../validations/ingestionValidation';
import { writeAuditLog } from '../lib/audit';

export interface ProcessJobResult {
    processed: boolean;
    jobId?: string;
    batchId?: string;
    status?: IngestionStatus;
    processedPages?: number;
    failedPages?: number;
    failureReason?: string;
}

export class IngestionWorker {
    public workerId: string;
    private pollIntervalMs: number;
    private staleTimeoutMs: number;
    private isRunning: boolean = false;
    private intervalHandle?: NodeJS.Timeout;
    private pageIngestionService: PageIngestionService;

    constructor(options?: {
        workerId?: string;
        pollIntervalMs?: number;
        staleTimeoutMs?: number;
        pageIngestionService?: PageIngestionService;
    }) {
        this.workerId = options?.workerId || `worker-${crypto.randomUUID()}`;
        this.pollIntervalMs = options?.pollIntervalMs || 2000;
        this.staleTimeoutMs = options?.staleTimeoutMs || 60000;
        this.pageIngestionService = options?.pageIngestionService || defaultPageIngestionService;
    }

    /**
     * Starts the background worker polling loop.
     */
    start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.intervalHandle = setInterval(() => {
            this.processNextJob().catch((err) => {
                console.error(`[IngestionWorker ${this.workerId}] Error processing job:`, err);
            });
        }, this.pollIntervalMs);
    }

    /**
     * Stops the background worker polling loop.
     */
    stop(): void {
        this.isRunning = false;
        if (this.intervalHandle) {
            clearInterval(this.intervalHandle);
            this.intervalHandle = undefined;
        }
    }

    /**
     * Claims and processes a single queued or stale ingestion job.
     */
    async processNextJob(options?: {
        pageTimeoutMs?: number;
    }): Promise<ProcessJobResult> {
        // Step 1: Atomically claim one job from queue
        const job = await BatchRepository.claimNextQueuedJob(this.workerId, this.staleTimeoutMs);
        if (!job) {
            return { processed: false };
        }

        // Sync batch status to processing
        await Batch.updateOne(
            { batchId: job.batchId },
            { $set: { status: BatchStatus.PROCESSING } }
        );

        const batch = await BatchRepository.getBatchByBatchIdInternal(job.batchId);
        if (!batch) {
            // Cannot find corresponding batch record
            job.status = IngestionStatus.FAILED;
            job.completedAt = new Date();
            job.failureReason = `Batch "${job.batchId}" not found for job`;
            await job.save();

            return {
                processed: true,
                jobId: job._id.toString(),
                batchId: job.batchId,
                status: IngestionStatus.FAILED,
                failureReason: job.failureReason
            };
        }

        const renderer = this.pageIngestionService.getRenderer();
        const storageRoot = process.env.ORIGINAL_STORAGE_PATH || path.join(process.cwd(), 'data', 'originals');

        // Step 2: Authoritative Page-Count Discovery & Reconciliation (AE-046 Step 5)
        let totalAuthoritativePages = 0;
        const fileBuffers: Map<string, Buffer> = new Map();

        for (const file of batch.files) {
            let fileBuffer: Buffer | undefined;
            if (file.storageKey) {
                try {
                    const relativePath = file.storageKey.replace(/^batches\//, '');
                    const diskPath = path.join(storageRoot, relativePath);
                    if (fs.existsSync(diskPath)) {
                        fileBuffer = await fs.promises.readFile(diskPath);
                        fileBuffers.set(file.fileId, fileBuffer);
                    }
                } catch {
                    // Handled below if buffer is missing
                }
            }

            let authoritativeCount = file.pageCount || 1;

            if (file.fileType === 'pdf') {
                if (!fileBuffer) {
                    const failureReason = `Cannot process batch ${job.batchId}: original file ${file.fileId} not found in storage`;
                    return await this.handleEarlyFailure(job, failureReason);
                }

                if (renderer.getPageCount) {
                    try {
                        authoritativeCount = await renderer.getPageCount(fileBuffer);
                    } catch (err) {
                        const rawReason = err instanceof Error ? err.message : 'Failed to determine authoritative PDF page count';
                        const sanitizedReason = sanitizeFailureReason(rawReason) || 'Failed to determine authoritative PDF page count';
                        return await this.handleEarlyFailure(job, sanitizedReason);
                    }
                }
            } else {
                // Standalone image inputs have an authoritative page count of exactly 1
                authoritativeCount = 1;
            }

            file.pageCount = authoritativeCount;
            totalAuthoritativePages += authoritativeCount;
        }

        // Reconcile totalPages in IngestionJob and Batch if renderer discovered different page count
        if (job.totalPages !== totalAuthoritativePages || batch.totalPageCount !== totalAuthoritativePages) {
            job.totalPages = totalAuthoritativePages;
            await job.save();

            batch.totalPageCount = totalAuthoritativePages;
            await Batch.updateOne(
                { batchId: job.batchId },
                { $set: { files: batch.files, totalPageCount: totalAuthoritativePages } }
            );
        }

        let lastFailureReason: string | undefined;

        // Step 3: Iterate over authoritative page count for every file in canonical fileIndex order
        const sortedFiles = [...batch.files].sort((a, b) => a.fileIndex - b.fileIndex);

        for (const file of sortedFiles) {
            const pageCount = file.pageCount || 1;
            const fileBuffer = fileBuffers.get(file.fileId);

            for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
                // Keep heartbeat alive during processing
                await BatchRepository.updateHeartbeat(job._id, this.workerId);

                const pageResult = await this.pageIngestionService.processPage({
                    batchId: job.batchId,
                    jobId: job._id,
                    fileId: file.fileId,
                    fileIndex: file.fileIndex,
                    storageKey: file.storageKey,
                    pageNumber: pageNum,
                    fileType: file.fileType,
                    fileBuffer,
                    timeoutMs: options?.pageTimeoutMs
                });

                if (!pageResult.success) {
                    lastFailureReason = pageResult.failureReason;
                }
            }
        }

        // Step 4: Count reconciled processed and failed pages
        const totalProcessed = await IngestionPage.countDocuments({
            batchId: job.batchId,
            status: PageProcessingStatus.PROCESSED
        });

        const totalFailed = await IngestionPage.countDocuments({
            batchId: job.batchId,
            status: PageProcessingStatus.FAILED
        });

        job.processedPages = totalProcessed;
        job.failedPages = totalFailed;

        // Step 5: Determine job outcome using authoritative totalPages
        if (totalFailed === 0) {
            job.status = IngestionStatus.DONE;
            job.completedAt = new Date();
            job.failureReason = undefined;
            await job.save();

            await Batch.updateOne(
                { batchId: job.batchId },
                { $set: { status: BatchStatus.DONE } }
            );

            if (job.uploadedBy) {
                await writeAuditLog({
                    user: job.uploadedBy.toString(),
                    action: 'INGESTION_JOB_COMPLETED',
                    outcome: 'SUCCESS',
                    entityType: 'IngestionJob',
                    details: {
                        batchId: job.batchId,
                        jobId: job._id.toString(),
                        totalPages: job.totalPages,
                        processedPages: totalProcessed
                    }
                });
            }

            return {
                processed: true,
                jobId: job._id.toString(),
                batchId: job.batchId,
                status: IngestionStatus.DONE,
                processedPages: totalProcessed,
                failedPages: 0
            };
        } else {
            // Check if attempts reached maxRetries
            if (job.attempts >= job.maxRetries) {
                // Permanently failed
                job.status = IngestionStatus.FAILED;
                job.completedAt = new Date();
                job.failureReason = lastFailureReason || 'One or more pages failed during ingestion';
                await job.save();

                await Batch.updateOne(
                    { batchId: job.batchId },
                    { $set: { status: BatchStatus.FAILED } }
                );

                if (job.uploadedBy) {
                    await writeAuditLog({
                        user: job.uploadedBy.toString(),
                        action: 'INGESTION_JOB_COMPLETED',
                        outcome: 'FAILURE',
                        entityType: 'IngestionJob',
                        details: {
                            batchId: job.batchId,
                            jobId: job._id.toString(),
                            totalPages: job.totalPages,
                            processedPages: totalProcessed,
                            failedPages: totalFailed,
                            attempts: job.attempts,
                            failureReason: job.failureReason
                        }
                    });
                }

                return {
                    processed: true,
                    jobId: job._id.toString(),
                    batchId: job.batchId,
                    status: IngestionStatus.FAILED,
                    processedPages: totalProcessed,
                    failedPages: totalFailed,
                    failureReason: job.failureReason
                };
            } else {
                // Transient failure: return to QUEUED state for retry
                job.status = IngestionStatus.QUEUED;
                job.failureReason = lastFailureReason || 'Transient failure during page ingestion';
                await job.save();

                await Batch.updateOne(
                    { batchId: job.batchId },
                    { $set: { status: BatchStatus.QUEUED } }
                );

                return {
                    processed: true,
                    jobId: job._id.toString(),
                    batchId: job.batchId,
                    status: IngestionStatus.QUEUED,
                    processedPages: totalProcessed,
                    failedPages: totalFailed,
                    failureReason: job.failureReason
                };
            }
        }
    }

    private async handleEarlyFailure(
        job: IIngestionJob,
        failureReason: string
    ): Promise<ProcessJobResult> {
        if (job.attempts >= job.maxRetries) {
            job.status = IngestionStatus.FAILED;
            job.completedAt = new Date();
            job.failureReason = failureReason;
            await job.save();

            await Batch.updateOne(
                { batchId: job.batchId },
                { $set: { status: BatchStatus.FAILED } }
            );

            return {
                processed: true,
                jobId: job._id.toString(),
                batchId: job.batchId,
                status: IngestionStatus.FAILED,
                failureReason
            };
        } else {
            job.status = IngestionStatus.QUEUED;
            job.failureReason = failureReason;
            await job.save();

            await Batch.updateOne(
                { batchId: job.batchId },
                { $set: { status: BatchStatus.QUEUED } }
            );

            return {
                processed: true,
                jobId: job._id.toString(),
                batchId: job.batchId,
                status: IngestionStatus.QUEUED,
                failureReason
            };
        }
    }
}

const ingestionWorker = new IngestionWorker();
export default ingestionWorker;
