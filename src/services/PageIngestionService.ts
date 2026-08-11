import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import IngestionPage, { PageProcessingStatus, IIngestionPage } from '../models/IngestionPage';
import { sanitizeFailureReason } from '../validations/ingestionValidation';
import { IPageRenderer, DefaultPdfRenderer, RenderPageResult } from './PageRenderer';
import defaultDerivedStorageService, { IDerivedStorageService } from './DerivedStorageService';
import defaultThumbnailGenerator, { IThumbnailGenerator } from './ThumbnailGenerator';

export interface ProcessPageInput {
    batchId: string;
    jobId: mongoose.Types.ObjectId;
    fileId: string;
    storageKey: string;
    pageNumber: number;
    fileType: string;
    fileBuffer?: Buffer;
    timeoutMs?: number;
    renderer?: IPageRenderer;
    derivedStorage?: IDerivedStorageService;
    thumbnailGenerator?: IThumbnailGenerator;
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
    private renderer: IPageRenderer;
    private derivedStorage: IDerivedStorageService;
    private thumbnailGenerator: IThumbnailGenerator;
    private defaultPageTimeoutMs = 5000;

    constructor(
        renderer?: IPageRenderer,
        derivedStorage?: IDerivedStorageService,
        thumbnailGenerator?: IThumbnailGenerator
    ) {
        this.renderer = renderer || new DefaultPdfRenderer();
        this.derivedStorage = derivedStorage || defaultDerivedStorageService;
        this.thumbnailGenerator = thumbnailGenerator || defaultThumbnailGenerator;
    }

    setRenderer(renderer: IPageRenderer): void {
        this.renderer = renderer;
    }

    getRenderer(): IPageRenderer {
        return this.renderer;
    }

    setDerivedStorage(derivedStorage: IDerivedStorageService): void {
        this.derivedStorage = derivedStorage;
    }

    getDerivedStorage(): IDerivedStorageService {
        return this.derivedStorage;
    }

    setThumbnailGenerator(thumbnailGenerator: IThumbnailGenerator): void {
        this.thumbnailGenerator = thumbnailGenerator;
    }

    getThumbnailGenerator(): IThumbnailGenerator {
        return this.thumbnailGenerator;
    }

    /**
     * Processes a single page of an uploaded original file with timeout, error sanitization,
     * normalized derived-asset persistence, thumbnail generation, and idempotent reconciliation.
     */
    async processPage(input: ProcessPageInput): Promise<PageProcessResult> {
        const {
            batchId,
            jobId,
            fileId,
            storageKey: originalStorageKey,
            pageNumber,
            fileType,
            fileBuffer,
            timeoutMs = this.defaultPageTimeoutMs,
            renderer,
            derivedStorage,
            thumbnailGenerator
        } = input;

        const activeRenderer = renderer || this.renderer;
        const activeDerivedStorage = derivedStorage || this.derivedStorage;
        const activeThumbnailGenerator = thumbnailGenerator || this.thumbnailGenerator;

        // Idempotency check: If this exact page was already successfully processed, reuse it
        const existingPage = await IngestionPage.findOne({
            batchId,
            fileId,
            pageNumber
        });

        if (existingPage && existingPage.status === PageProcessingStatus.PROCESSED) {
            // Reconcile missing thumbnail on retry if page is already PROCESSED but thumbnailKey is missing
            if (!existingPage.thumbnailKey && activeDerivedStorage.readDerivedPage) {
                try {
                    let pageImageBuffer = fileBuffer;
                    if (!pageImageBuffer && existingPage.storageKey) {
                        try {
                            pageImageBuffer = await activeDerivedStorage.readDerivedPage(existingPage.storageKey);
                        } catch {
                            // Fallback if derived file missing
                        }
                    }

                    if (pageImageBuffer) {
                        const thumb = await activeThumbnailGenerator.generateThumbnail(
                            pageImageBuffer,
                            existingPage.width,
                            existingPage.height
                        );
                        const storedThumb = await activeDerivedStorage.storeDerivedThumbnail({
                            batchId,
                            fileId,
                            pageNumber,
                            buffer: thumb.buffer,
                            format: 'jpg'
                        });
                        existingPage.thumbnailKey = storedThumb.storageKey;
                        if (existingPage.metadata) {
                            existingPage.metadata.thumbnailKey = storedThumb.storageKey;
                        }
                        await existingPage.save();
                    }
                } catch {
                    // Thumbnail reconciliation failure does not affect PROCESSED page status
                }
            }

            return {
                success: true,
                pageNumber,
                fileId,
                isDuplicateOrAlreadyProcessed: true,
                pageRecord: existingPage
            };
        }

        // Resolve file buffer from disk storage if not directly provided in input
        let bufferToProcess = fileBuffer;
        if (!bufferToProcess && originalStorageKey) {
            try {
                const storageRoot = process.env.ORIGINAL_STORAGE_PATH || path.join(process.cwd(), 'data', 'originals');
                const relativePath = originalStorageKey.replace(/^batches\//, '');
                const diskPath = path.join(storageRoot, relativePath);
                if (fs.existsSync(diskPath)) {
                    bufferToProcess = await fs.promises.readFile(diskPath);
                }
            } catch {
                // Disk read fallback - renderer will report missing buffer if needed
            }
        }

        try {
            // Execute actual page processing with timeout protection via injected renderer
            const renderResult: RenderPageResult = await this.executeWithTimeout(
                async () => {
                    return await activeRenderer.renderPage({
                        batchId,
                        fileId,
                        pageNumber,
                        fileType,
                        storageKey: originalStorageKey,
                        fileBuffer: bufferToProcess
                    });
                },
                timeoutMs,
                `Page ${pageNumber} processing timed out after ${timeoutMs}ms`
            );

            if (!renderResult.success) {
                const rawReason = renderResult.failureReason || `Rendering failed on page ${pageNumber}`;
                const sanitizedReason = sanitizeFailureReason(rawReason);

                const pageRecord = await IngestionPage.findOneAndUpdate(
                    { batchId, fileId, pageNumber },
                    {
                        batchId,
                        job: jobId,
                        fileId,
                        storageKey: originalStorageKey,
                        thumbnailKey: null,
                        pageNumber,
                        status: PageProcessingStatus.FAILED,
                        processedAt: new Date(),
                        failureReason: sanitizedReason,
                        metadata: { fileType, pageNumber, ...renderResult.metadata }
                    },
                    { upsert: true, returnDocument: 'after', runValidators: true }
                );

                return {
                    success: false,
                    pageNumber,
                    fileId,
                    failureReason: sanitizedReason,
                    pageRecord: pageRecord || undefined
                };
            }

            // If image is present on render result, store as mutable derived asset
            let pageStorageKey = originalStorageKey;
            const pageWidth = renderResult.image?.width;
            const pageHeight = renderResult.image?.height;

            if (renderResult.image && renderResult.image.buffer) {
                const storedDerived = await activeDerivedStorage.storeDerivedPage({
                    batchId,
                    fileId,
                    pageNumber,
                    buffer: renderResult.image.buffer,
                    format: renderResult.image.format
                });
                pageStorageKey = storedDerived.storageKey;
            }

            // AE-047: Generate and store deterministic thumbnail (Failure independent)
            let thumbnailKey: string | null = null;
            if (renderResult.image && renderResult.image.buffer) {
                try {
                    const thumb = await activeThumbnailGenerator.generateThumbnail(
                        renderResult.image.buffer,
                        pageWidth,
                        pageHeight
                    );
                    const storedThumb = await activeDerivedStorage.storeDerivedThumbnail({
                        batchId,
                        fileId,
                        pageNumber,
                        buffer: thumb.buffer,
                        format: 'jpg'
                    });
                    thumbnailKey = storedThumb.storageKey;
                } catch {
                    // Thumbnail failure independence: page image succeeds and page remains PROCESSED
                    thumbnailKey = null;
                }
            }

            // Persist or update page record as PROCESSED pointing to derived storageKey and thumbnailKey
            const pageRecord = await IngestionPage.findOneAndUpdate(
                { batchId, fileId, pageNumber },
                {
                    batchId,
                    job: jobId,
                    fileId,
                    storageKey: pageStorageKey,
                    thumbnailKey: thumbnailKey,
                    width: pageWidth,
                    height: pageHeight,
                    pageNumber,
                    status: PageProcessingStatus.PROCESSED,
                    processedAt: new Date(),
                    failureReason: undefined,
                    metadata: {
                        fileType,
                        pageNumber,
                        originalStorageKey,
                        derivedStorageKey: pageStorageKey,
                        thumbnailKey,
                        width: pageWidth,
                        height: pageHeight,
                        dpi: renderResult.image?.dpi,
                        format: renderResult.image?.format,
                        sizeBytes: renderResult.image?.sizeBytes,
                        ...renderResult.metadata
                    }
                },
                { upsert: true, returnDocument: 'after', runValidators: true }
            );

            return {
                success: true,
                pageNumber,
                fileId,
                pageRecord: pageRecord || undefined
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
                    storageKey: originalStorageKey,
                    thumbnailKey: null,
                    pageNumber,
                    status: PageProcessingStatus.FAILED,
                    processedAt: new Date(),
                    failureReason: sanitizedReason,
                    metadata: { fileType, pageNumber }
                },
                { upsert: true, returnDocument: 'after', runValidators: true }
            );

            return {
                success: false,
                pageNumber,
                fileId,
                failureReason: sanitizedReason,
                pageRecord: pageRecord || undefined
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
