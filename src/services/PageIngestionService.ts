import mongoose from 'mongoose';
import IngestionPage, { PageProcessingStatus, IIngestionPage } from '../models/IngestionPage';
import { sanitizeFailureReason } from '../validations/ingestionValidation';

export interface ProcessPageInput {
    batchId: string;
    jobId: mongoose.Types.ObjectId;
    fileId: string;
    storageKey: string;
    pageNumber: number;
    fileType: string;
    fileBuffer?: Buffer;
    timeoutMs?: number;
    simulateHungPage?: boolean;
    simulatePageFailure?: boolean;
}

export interface PageProcessResult {
    success: boolean;
    pageNumber: number;
    fileId: string;
    isDuplicateOrAlreadyProcessed?: boolean;
    failureReason?: string;
    pageRecord?: IIngestionPage;
}

export class PageIngestionService {
    private defaultPageTimeoutMs = 5000;

    /**
     * Processes a single page of an uploaded original file with timeout, error sanitization,
     * and idempotent reconciliation against existing IngestionPage records.
     */
    async processPage(input: ProcessPageInput): Promise<PageProcessResult> {
        const {
            batchId,
            jobId,
            fileId,
            storageKey,
            pageNumber,
            fileType,
            timeoutMs = this.defaultPageTimeoutMs,
            simulateHungPage,
            simulatePageFailure
        } = input;

        // Idempotency check: If this exact page was already successfully processed, reuse it
        const existingPage = await IngestionPage.findOne({
            batchId,
            fileId,
            pageNumber
        });

        if (existingPage && existingPage.status === PageProcessingStatus.PROCESSED) {
            return {
                success: true,
                pageNumber,
                fileId,
                isDuplicateOrAlreadyProcessed: true,
                pageRecord: existingPage
            };
        }

        try {
            // Execute actual page processing with timeout protection
            await this.executeWithTimeout(
                async () => {
                    if (simulateHungPage) {
                        // Simulate an unresolving/hung worker task
                        await new Promise((resolve) => setTimeout(resolve, timeoutMs + 2000));
                    }

                    if (simulatePageFailure) {
                        throw new Error(`Corrupted page data on page ${pageNumber}\n at PageRenderer.render (/app/renderer.ts:40)`);
                    }

                    // Perform lightweight internal page extraction / inspection
                    return {
                        pageNumber,
                        fileType,
                        extractedAt: new Date().toISOString()
                    };
                },
                timeoutMs,
                `Page ${pageNumber} processing timed out after ${timeoutMs}ms`
            );

            // Persist or update page record as PROCESSED
            const pageRecord = await IngestionPage.findOneAndUpdate(
                { batchId, fileId, pageNumber },
                {
                    batchId,
                    job: jobId,
                    fileId,
                    storageKey,
                    pageNumber,
                    status: PageProcessingStatus.PROCESSED,
                    processedAt: new Date(),
                    failureReason: undefined,
                    metadata: { fileType, pageNumber }
                },
                { upsert: true, new: true, runValidators: true }
            );

            return {
                success: true,
                pageNumber,
                fileId,
                pageRecord
            };
        } catch (error) {
            const rawMessage = error instanceof Error ? error.message : 'Unknown page processing error';
            const sanitizedReason = sanitizeFailureReason(rawMessage);

            const pageRecord = await IngestionPage.findOneAndUpdate(
                { batchId, fileId, pageNumber },
                {
                    batchId,
                    job: jobId,
                    fileId,
                    storageKey,
                    pageNumber,
                    status: PageProcessingStatus.FAILED,
                    processedAt: new Date(),
                    failureReason: sanitizedReason,
                    metadata: { fileType, pageNumber }
                },
                { upsert: true, new: true, runValidators: true }
            );

            return {
                success: false,
                pageNumber,
                fileId,
                failureReason: sanitizedReason,
                pageRecord
            };
        }
    }

    private async executeWithTimeout<T>(
        fn: () => Promise<T>,
        timeoutMs: number,
        timeoutMessage: string
    ): Promise<T> {
        let timeoutHandle: NodeJS.Timeout | undefined;

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
                reject(new Error(timeoutMessage));
            }, timeoutMs);
        });

        try {
            return await Promise.race([fn(), timeoutPromise]);
        } finally {
            if (timeoutHandle) {
                clearTimeout(timeoutHandle);
            }
        }
    }
}

const pageIngestionService = new PageIngestionService();
export default pageIngestionService;
