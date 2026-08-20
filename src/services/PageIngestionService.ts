import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import IngestionPage, { PageProcessingStatus, IIngestionPage } from '../models/IngestionPage';
import { sanitizeFailureReason } from '../validations/ingestionValidation';
import { IPageRenderer, DefaultPdfRenderer, DefaultImageRenderer, RenderPageResult } from './PageRenderer';
import defaultDerivedStorageService, { IDerivedStorageService } from './DerivedStorageService';
import defaultThumbnailGenerator, { IThumbnailGenerator } from './ThumbnailGenerator';
import defaultCoverSheetDetector, { ICoverSheetDetector } from './CoverSheetDetector';
import { writeAuditLog } from '../lib/audit';
import { defaultImageEnhancer, IImageEnhancer, EnhancementParams } from './ImageEnhancer';
import { createCanvas, loadImage } from '@napi-rs/canvas';

export interface ProcessPageInput {
    batchId: string;
    jobId: mongoose.Types.ObjectId;
    fileId: string;
    fileIndex: number;
    storageKey: string;
    pageNumber: number;
    fileType: string;
    fileBuffer?: Buffer;
    timeoutMs?: number;
    renderer?: IPageRenderer;
    derivedStorage?: IDerivedStorageService;
    thumbnailGenerator?: IThumbnailGenerator;
    coverSheetDetector?: ICoverSheetDetector;
    imageEnhancer?: IImageEnhancer;
    qrStudentId?: string | null;
    qrDecodeOutcome?: 'found' | 'not_found' | 'multiple' | null;
    omrStudentId?: string | null;
    omrDecodeOutcome?: 'found' | 'not_found' | 'multiple' | null;
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
    static readonly LUMINANCE_THRESHOLD = 240;
    static readonly NON_WHITE_PERCENT_THRESHOLD = 0.5;
    static readonly BORDER_MARGIN_PERCENT = 0.05;
    static readonly HAMMING_DISTANCE_THRESHOLD = 10;

    private renderer: IPageRenderer;
    private imageRenderer: IPageRenderer;
    private derivedStorage: IDerivedStorageService;
    private thumbnailGenerator: IThumbnailGenerator;
    private coverSheetDetector: ICoverSheetDetector;
    private imageEnhancer: IImageEnhancer;
    private defaultPageTimeoutMs = 5000;

    constructor(
        renderer?: IPageRenderer,
        derivedStorage?: IDerivedStorageService,
        thumbnailGenerator?: IThumbnailGenerator,
        imageRenderer?: IPageRenderer,
        coverSheetDetector?: ICoverSheetDetector,
        imageEnhancer?: IImageEnhancer
    ) {
        this.renderer = renderer || new DefaultPdfRenderer();
        this.imageRenderer = imageRenderer || new DefaultImageRenderer();
        this.derivedStorage = derivedStorage || defaultDerivedStorageService;
        this.thumbnailGenerator = thumbnailGenerator || defaultThumbnailGenerator;
        this.coverSheetDetector = coverSheetDetector || defaultCoverSheetDetector;
        this.imageEnhancer = imageEnhancer || defaultImageEnhancer;
    }

    setRenderer(renderer: IPageRenderer): void {
        this.renderer = renderer;
    }

    getRenderer(): IPageRenderer {
        return this.renderer;
    }

    setImageRenderer(imageRenderer: IPageRenderer): void {
        this.imageRenderer = imageRenderer;
    }

    getImageRenderer(): IPageRenderer {
        return this.imageRenderer;
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

    setCoverSheetDetector(coverSheetDetector: ICoverSheetDetector): void {
        this.coverSheetDetector = coverSheetDetector;
    }

    getCoverSheetDetector(): ICoverSheetDetector {
        return this.coverSheetDetector;
    }

    /**
     * Processes a single page of an uploaded original file with timeout, error sanitization,
     * normalized derived-asset persistence, thumbnail generation, cover sheet detection, and idempotent reconciliation.
     */
    async processPage(input: ProcessPageInput): Promise<PageProcessResult> {
        const {
            batchId,
            jobId,
            fileId,
            fileIndex,
            storageKey: originalStorageKey,
            pageNumber,
            fileType,
            fileBuffer,
            timeoutMs = this.defaultPageTimeoutMs,
            renderer,
            derivedStorage,
            thumbnailGenerator,
            coverSheetDetector
        } = input;

        const isImage =
            fileType === 'image' ||
            fileType === 'jpg' ||
            fileType === 'jpeg' ||
            fileType === 'png' ||
            fileType === 'webp' ||
            fileType?.startsWith('image/');
        const defaultRenderer = isImage ? this.imageRenderer : this.renderer;
        const activeRenderer = renderer || defaultRenderer;
        const activeDerivedStorage = derivedStorage || this.derivedStorage;
        const activeThumbnailGenerator = thumbnailGenerator || this.thumbnailGenerator;
        const activeCoverSheetDetector = coverSheetDetector || this.coverSheetDetector;
        const activeImageEnhancer = input.imageEnhancer || this.imageEnhancer;

        // Idempotency check: If this exact page was already successfully processed, reuse it
        const existingPage = await IngestionPage.findOne({
            batchId,
            fileIndex,
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
                const isCoverPage = pageNumber === 1;

                const pageRecord = await IngestionPage.findOneAndUpdate(
                    { batchId, fileIndex, pageNumber },
                    {
                        batchId,
                        job: jobId,
                        fileId,
                        fileIndex,
                        storageKey: originalStorageKey,
                        thumbnailKey: null,
                        pageNumber,
                        status: PageProcessingStatus.FAILED,
                        processedAt: new Date(),
                        failureReason: sanitizedReason,
                        isCoverPage,
                        candidateStudentId: null,
                        decodeOutcome: isCoverPage ? 'not_found' : null,
                        qrStudentId: null,
                        qrDecodeOutcome: isCoverPage ? 'not_found' : null,
                        omrStudentId: null,
                        omrDecodeOutcome: null,
                        metadata: {
                            fileType,
                            fileIndex,
                            pageNumber,
                            isCoverPage,
                            decodeOutcome: isCoverPage ? 'not_found' : null,
                            qrDecodeOutcome: isCoverPage ? 'not_found' : null,
                            omrDecodeOutcome: null,
                            ...renderResult.metadata
                        }
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

            // If image is present on render result, enhance and store as mutable derived asset
            let pageStorageKey = originalStorageKey;
            let pageWidth = renderResult.image?.width;
            let pageHeight = renderResult.image?.height;
            let enhancementApplied = false;
            let deskewAngle = 0;
            let orientation = 0;

            let enhancementParams: Record<string, number> | undefined = undefined;

            if (renderResult.image && renderResult.image.buffer) {
                // AE-066: Auto-enhance (Deskew & Rotate)
                try {
                    const enhancement = await activeImageEnhancer.enhancePage(renderResult.image.buffer, renderResult.image.format);
                    if (enhancement.applied) {
                        renderResult.image.buffer = enhancement.buffer;
                        enhancementApplied = true;
                        deskewAngle = enhancement.deskewAngle;
                        orientation = enhancement.orientation;
                        enhancementParams = {
                            deskewAngle: enhancement.deskewAngle,
                            orientation: enhancement.orientation
                        };
                        if (enhancement.brightness !== undefined) {
                            enhancementParams.brightness = enhancement.brightness;
                        }
                        if (enhancement.contrast !== undefined) {
                            enhancementParams.contrast = enhancement.contrast;
                        }
                        // The buffer dimensions might have changed after rotation
                        // For exact dimensions, we would read it, but typically it swaps on 90/270
                        if (orientation === 90 || orientation === 270) {
                            pageWidth = renderResult.image.height;
                            pageHeight = renderResult.image.width;
                        }
                    }
                } catch (e) {
                    // Safe fallback: ingestion continues without enhancement
                    console.error(`Enhancement failed on page ${pageNumber}:`, e);
                }

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

            // AE-050: Cover-Sheet QR/Barcode Detection (Only on pageNumber === 1 from canonical normalized image)
            const isCoverPage = pageNumber === 1;
            let candidateStudentId: string | null = null;
            let decodeOutcome: 'found' | 'not_found' | 'multiple' | null = null;

            if (isCoverPage && renderResult.image && renderResult.image.buffer) {
                try {
                    const detectionResult = await activeCoverSheetDetector.detectCoverSheet(
                        renderResult.image.buffer,
                        pageNumber
                    );
                    candidateStudentId = detectionResult.candidateStudentId || null;
                    decodeOutcome = detectionResult.decodeOutcome || 'not_found';
                } catch {
                    candidateStudentId = null;
                    decodeOutcome = 'not_found';
                }
            }

            // AE-065: Blank Page and Duplicate Detection
            let nearBlank = false;
            let isDuplicate = false;
            let duplicateOf: mongoose.Types.ObjectId | null = null;
            let perceptualHash: string | null = null;

            if (renderResult.image && renderResult.image.buffer) {
                try {
                    const detection = await this.detectBlankAndHash({
                        buffer: renderResult.image.buffer,
                        batchId,
                        fileIndex,
                        pageNumber
                    });
                    nearBlank = detection.nearBlank;
                    perceptualHash = detection.perceptualHash;
                    isDuplicate = detection.isDuplicate;
                    duplicateOf = detection.duplicateOf;
                } catch (err) {
                    console.error(`Detection failure on batch ${batchId} page ${pageNumber}:`, err);
                    // Safe fallback: do not crash page ingestion on detection/perceptual hashing failures
                    nearBlank = false;
                    perceptualHash = null;
                    isDuplicate = false;
                    duplicateOf = null;
                }
            }

            // Persist or update page record as PROCESSED pointing to derived storageKey, thumbnailKey, and detection metadata
            const pageRecord = await IngestionPage.findOneAndUpdate(
                { batchId, fileIndex, pageNumber },
                {
                    batchId,
                    job: jobId,
                    fileId,
                    fileIndex,
                    storageKey: pageStorageKey,
                    thumbnailKey: thumbnailKey,
                    width: pageWidth,
                    height: pageHeight,
                    pageNumber,
                    status: PageProcessingStatus.PROCESSED,
                    processedAt: new Date(),
                    failureReason: undefined,
                    isCoverPage,
                    candidateStudentId,
                    decodeOutcome,
                    qrStudentId: input.qrStudentId !== undefined ? input.qrStudentId : (isCoverPage ? candidateStudentId : null),
                    qrDecodeOutcome: input.qrDecodeOutcome !== undefined ? input.qrDecodeOutcome : (isCoverPage ? decodeOutcome : null),
                    omrStudentId: input.omrStudentId !== undefined ? input.omrStudentId : null,
                    omrDecodeOutcome: input.omrDecodeOutcome !== undefined ? input.omrDecodeOutcome : null,
                    nearBlank,
                    isDuplicate,
                    duplicateOf,
                    perceptualHash,
                    enhancementParams,
                    metadata: {
                        fileType,
                        fileIndex,
                        pageNumber,
                        originalStorageKey,
                        derivedStorageKey: pageStorageKey,
                        thumbnailKey,
                        width: pageWidth,
                        height: pageHeight,
                        dpi: renderResult.image?.dpi,
                        format: renderResult.image?.format,
                        sizeBytes: renderResult.image?.sizeBytes,
                        isCoverPage,
                        candidateStudentId,
                        decodeOutcome,
                        qrStudentId: input.qrStudentId !== undefined ? input.qrStudentId : (isCoverPage ? candidateStudentId : null),
                        qrDecodeOutcome: input.qrDecodeOutcome !== undefined ? input.qrDecodeOutcome : (isCoverPage ? decodeOutcome : null),
                        omrStudentId: input.omrStudentId !== undefined ? input.omrStudentId : null,
                        omrDecodeOutcome: input.omrDecodeOutcome !== undefined ? input.omrDecodeOutcome : null,
                        nearBlank,
                        isDuplicate,
                        duplicateOf: duplicateOf ? duplicateOf.toString() : null,
                        perceptualHash,
                        enhancementApplied,
                        deskewAngle,
                        orientation,
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
            const isCoverPage = pageNumber === 1;

            const pageRecord = await IngestionPage.findOneAndUpdate(
                { batchId, fileIndex, pageNumber },
                {
                    batchId,
                    job: jobId,
                    fileId,
                    fileIndex,
                    storageKey: originalStorageKey,
                    thumbnailKey: null,
                    pageNumber,
                    status: PageProcessingStatus.FAILED,
                    processedAt: new Date(),
                    failureReason: sanitizedReason,
                    isCoverPage,
                    candidateStudentId: null,
                    decodeOutcome: isCoverPage ? 'not_found' : null,
                    qrStudentId: null,
                    qrDecodeOutcome: isCoverPage ? 'not_found' : null,
                    omrStudentId: null,
                    omrDecodeOutcome: null,
                    metadata: {
                        fileType,
                        fileIndex,
                        pageNumber,
                        isCoverPage,
                        decodeOutcome: isCoverPage ? 'not_found' : null,
                        qrDecodeOutcome: isCoverPage ? 'not_found' : null,
                        omrDecodeOutcome: null
                    }
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

    /**
     * AE-068: Re-enhances a previously processed page with explicit enhancement parameters.
     */
    async updateEnhancementParams(
        pageId: string | mongoose.Types.ObjectId,
        params: EnhancementParams,
        userId: string | mongoose.Types.ObjectId,
        ipAddress?: string
    ): Promise<PageProcessResult> {
        const page = await IngestionPage.findById(pageId);
        if (!page) {
            throw new Error('Page not found');
        }

        if (page.status !== PageProcessingStatus.PROCESSED) {
            throw new Error('Cannot update enhancement parameters for an unprocessed or failed page');
        }

        const originalStorageKey = page.metadata?.originalStorageKey as string;
        if (!originalStorageKey) {
            throw new Error('Original storage key not found in page metadata');
        }

        let bufferToProcess: Buffer | undefined = undefined;
        try {
            const storageRoot = process.env.ORIGINAL_STORAGE_PATH || path.join(process.cwd(), 'data', 'originals');
            const relativePath = originalStorageKey.replace(/^batches\//, '');
            const diskPath = path.join(storageRoot, relativePath);
            if (fs.existsSync(diskPath)) {
                bufferToProcess = await fs.promises.readFile(diskPath);
            }
        } catch {
            throw new Error('Could not read original immutable source file');
        }

        if (!bufferToProcess) {
            throw new Error('Original immutable source file missing or inaccessible');
        }

        const fileType = page.metadata?.fileType as string || 'png';
        const isImage =
            fileType === 'image' ||
            fileType === 'jpg' ||
            fileType === 'jpeg' ||
            fileType === 'png' ||
            fileType === 'webp' ||
            fileType?.startsWith('image/');
        const activeRenderer = isImage ? this.imageRenderer : this.renderer;

        // 1. Render from original buffer
        const renderResult: RenderPageResult = await this.executeWithTimeout(
            async () => {
                return await activeRenderer.renderPage({
                    batchId: page.batchId,
                    fileId: page.fileId,
                    pageNumber: page.pageNumber,
                    fileType,
                    storageKey: originalStorageKey,
                    fileBuffer: bufferToProcess
                });
            },
            this.defaultPageTimeoutMs,
            `Page ${page.pageNumber} processing timed out`
        );

        if (!renderResult.success || !renderResult.image || !renderResult.image.buffer) {
            throw new Error('Failed to re-render page from original source');
        }

        // 2. Enhance with explicit parameters
        const enhancement = await this.imageEnhancer.enhancePage(renderResult.image.buffer, renderResult.image.format, params);
        const enhancedBuffer = enhancement.applied ? enhancement.buffer : renderResult.image.buffer;
        let pageWidth = renderResult.image.width;
        let pageHeight = renderResult.image.height;
        const orientation = enhancement.orientation || 0;
        if (enhancement.applied && (orientation === 90 || orientation === 270)) {
            pageWidth = renderResult.image.height;
            pageHeight = renderResult.image.width;
        }

        // 3. Store new derived page
        const storedDerived = await this.derivedStorage.storeDerivedPage({
            batchId: page.batchId,
            fileId: page.fileId,
            pageNumber: page.pageNumber,
            buffer: enhancedBuffer,
            format: renderResult.image.format
        });
        const pageStorageKey = storedDerived.storageKey;

        // 4. Regenerate thumbnail
        let thumbnailKey: string | null = null;
        try {
            const thumb = await this.thumbnailGenerator.generateThumbnail(enhancedBuffer, pageWidth, pageHeight);
            const storedThumb = await this.derivedStorage.storeDerivedThumbnail({
                batchId: page.batchId,
                fileId: page.fileId,
                pageNumber: page.pageNumber,
                buffer: thumb.buffer,
                format: 'jpg'
            });
            thumbnailKey = storedThumb.storageKey;
        } catch {
            thumbnailKey = null; // Thumbnail failure doesn't crash the update
        }

        // 5. Update page record
        const enhancementParams = {
            deskewAngle: enhancement.deskewAngle,
            orientation: enhancement.orientation
        } as Record<string, number>;

        if (enhancement.brightness !== undefined) enhancementParams.brightness = enhancement.brightness;
        if (enhancement.contrast !== undefined) enhancementParams.contrast = enhancement.contrast;
        const updatedMetadata = {
            ...page.metadata,
            derivedStorageKey: pageStorageKey,
            thumbnailKey,
            width: pageWidth,
            height: pageHeight,
            enhancementApplied: enhancement.applied,
            deskewAngle: enhancement.deskewAngle,
            orientation: enhancement.orientation
        };

        const updatedPage = await IngestionPage.findByIdAndUpdate(
            pageId,
            {
                storageKey: pageStorageKey,
                thumbnailKey,
                width: pageWidth,
                height: pageHeight,
                enhancementParams,
                metadata: updatedMetadata
            },
            { new: true, runValidators: true }
        );

        // 6. Audit Log
        await writeAuditLog({
            user: userId,
            action: 'UPDATE_ENHANCEMENT_PARAMS',
            outcome: 'SUCCESS',
            entityId: pageId,
            entityType: 'IngestionPage',
            details: {
                batchId: page.batchId,
                pageNumber: page.pageNumber,
                oldParams: page.enhancementParams,
                newParams: enhancementParams
            },
            ipAddress
        });

        return {
            success: true,
            pageNumber: updatedPage!.pageNumber,
            fileId: updatedPage!.fileId,
            pageRecord: updatedPage || undefined
        };
    }

    /**
     * AE-065: Performs near-blank page detection and perceptual hashing (dHash) to flag duplicates.
     */
    async detectBlankAndHash(input: {
        buffer: Buffer;
        batchId: string;
        fileIndex: number;
        pageNumber: number;
    }): Promise<{
        nearBlank: boolean;
        perceptualHash: string | null;
        isDuplicate: boolean;
        duplicateOf: mongoose.Types.ObjectId | null;
    }> {
        try {
            const image = await loadImage(input.buffer);
            if (image.width <= 0 || image.height <= 0) {
                return { nearBlank: false, perceptualHash: null, isDuplicate: false, duplicateOf: null };
            }

            // 1. Near-Blank Detection using Canvas pixels (excluding border margins to ignore scanner edge shadow)
            const canvas = createCanvas(image.width, image.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0);
            const imgData = ctx.getImageData(0, 0, image.width, image.height);
            const data = imgData.data;

            const startX = Math.floor(image.width * PageIngestionService.BORDER_MARGIN_PERCENT);
            const endX = Math.floor(image.width * (1 - PageIngestionService.BORDER_MARGIN_PERCENT));
            const startY = Math.floor(image.height * PageIngestionService.BORDER_MARGIN_PERCENT);
            const endY = Math.floor(image.height * (1 - PageIngestionService.BORDER_MARGIN_PERCENT));

            let nonWhiteCount = 0;
            let scannedPixels = 0;

            for (let y = startY; y < endY; y++) {
                for (let x = startX; x < endX; x++) {
                    const index = (y * image.width + x) * 4;
                    const r = data[index];
                    const g = data[index + 1];
                    const b = data[index + 2];
                    const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
                    if (luminance < PageIngestionService.LUMINANCE_THRESHOLD) {
                        nonWhiteCount++;
                    }
                    scannedPixels++;
                }
            }

            const nonWhitePercent = scannedPixels > 0 ? (nonWhiteCount / scannedPixels) * 100 : 0;
            const nearBlank = nonWhitePercent < PageIngestionService.NON_WHITE_PERCENT_THRESHOLD;

            // 2. Perceptual dHash: resize to 9x8 and compare adjacent horizontal gradients
            const hashCanvas = createCanvas(9, 8);
            const hashCtx = hashCanvas.getContext('2d');
            hashCtx.drawImage(image, 0, 0, 9, 8);
            const hashData = hashCtx.getImageData(0, 0, 9, 8).data;

            const gray: number[] = [];
            for (let i = 0; i < hashData.length; i += 4) {
                const r = hashData[i];
                const g = hashData[i + 1];
                const b = hashData[i + 2];
                const val = 0.299 * r + 0.587 * g + 0.114 * b;
                gray.push(val);
            }

            let hashBits = '';
            for (let row = 0; row < 8; row++) {
                for (let col = 0; col < 8; col++) {
                    const left = gray[row * 9 + col];
                    const right = gray[row * 9 + col + 1];
                    hashBits += left > right ? '1' : '0';
                }
            }

            // 3. Duplicate Detection within the same batch (using Hamming distance <= 10)
            const siblingPages = await IngestionPage.find({
                batchId: input.batchId,
                status: PageProcessingStatus.PROCESSED,
                perceptualHash: { $ne: null }
            }).select('_id pageNumber perceptualHash');

            let isDuplicate = false;
            let duplicateOf: mongoose.Types.ObjectId | null = null;

            for (const sibling of siblingPages) {
                if (sibling.perceptualHash) {
                    let distance = 0;
                    for (let i = 0; i < 64; i++) {
                        if (hashBits[i] !== sibling.perceptualHash[i]) {
                            distance++;
                        }
                    }
                    if (distance <= PageIngestionService.HAMMING_DISTANCE_THRESHOLD) {
                        isDuplicate = true;
                        duplicateOf = sibling._id as mongoose.Types.ObjectId;
                        break;
                    }
                }
            }

            return {
                nearBlank,
                perceptualHash: hashBits,
                isDuplicate,
                duplicateOf
            };
        } catch (err) {
            console.error('Error in detectBlankAndHash:', err);
            throw err;
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
