import crypto from 'crypto';
import BatchRepository from '../repositories/BatchRepository';
import { IngestionStatus } from '../models/IngestionJob';
import Batch, { BatchStatus } from '../models/Batch';
import IngestionPage, { PageProcessingStatus } from '../models/IngestionPage';
import PageIngestionService from './PageIngestionService';
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

    constructor(options?: { workerId?: string; pollIntervalMs?: number; staleTimeoutMs?: number }) {
        this.workerId = options?.workerId || `worker-${crypto.randomUUID()}`;
        this.pollIntervalMs = options?.pollIntervalMs || 2000;
        this.staleTimeoutMs = options?.staleTimeoutMs || 60000;
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
        simulateHungPage?: boolean;
        simulatePageFailure?: boolean;
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

        let lastFailureReason: string | undefined;

        // Step 2: Iterate over each file and page in the batch
        for (const file of batch.files) {
            const pageCount = file.pageCount || 1;

            for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
                // Keep heartbeat alive during processing
                await BatchRepository.updateHeartbeat(job._id, this.workerId);

                const pageResult = await PageIngestionService.processPage({
                    batchId: job.batchId,
                    jobId: job._id,
                    fileId: file.fileId,
                    storageKey: file.storageKey,
                    pageNumber: pageNum,
                    fileType: file.fileType,
                    timeoutMs: options?.pageTimeoutMs,
                    simulateHungPage: options?.simulateHungPage,
                    simulatePageFailure: options?.simulatePageFailure
                });

                if (!pageResult.success) {
                    lastFailureReason = pageResult.failureReason;
                }
            }
        }

        // Step 3: Count reconciled processed and failed pages
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

        // Step 4: Determine job outcome
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
}

const ingestionWorker = new IngestionWorker();
export default ingestionWorker;
