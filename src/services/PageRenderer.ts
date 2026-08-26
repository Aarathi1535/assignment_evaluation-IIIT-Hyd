import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import path from 'path';

/**
 * Canonical Page Image Format supported for normalized ingestion assets.
 */
export type CanonicalImageFormat = 'png' | 'webp' | 'jpeg';

/**
 * Standard configuration constraints for normalized page rendering.
 * Reusable by AE-046 (PDF page rendering) and AE-048 (direct image normalization).
 */
export interface PageRenderingConfig {
    /** Target resolution in dots per inch (default: 150 DPI) */
    targetDpi: number;
    /** Maximum allowed long-edge in pixels to bound memory and processing cost (default: 2048px) */
    maxLongEdge: number;
    /** Hard ceiling on total output pixels (width * height) per page (default: 16,777,216 = 4096x4096) */
    maxPixels: number;
    /** Canonical image output format (default: 'png') */
    outputFormat: CanonicalImageFormat;
}

export const DEFAULT_PAGE_RENDERING_CONFIG: PageRenderingConfig = {
    targetDpi: 150,
    maxLongEdge: 2048,
    maxPixels: 4096 * 4096,
    outputFormat: 'png'
};

/**
 * Calculates the safe rendering scale and dimensions for a given natural page size
 * enforcing target DPI, maxLongEdge, and maxPixels constraints before canvas allocation.
 */
export function calculateSafeRenderDimensions(
    naturalWidth: number,
    naturalHeight: number,
    config: PageRenderingConfig
): { scale: number; width: number; height: number; effectiveDpi: number } {
    const baseScale = config.targetDpi / 72;

    // Scale constraint from max long-edge (preserves aspect ratio)
    const maxDimension = Math.max(naturalWidth, naturalHeight);
    const longEdgeScale = maxDimension > 0 ? Math.min(baseScale, config.maxLongEdge / maxDimension) : baseScale;

    // Scale constraint from max total pixels (preserves aspect ratio)
    const totalNaturalPixels = naturalWidth * naturalHeight;
    const maxPixelsScale =
        totalNaturalPixels > 0 ? Math.min(baseScale, Math.sqrt(config.maxPixels / totalNaturalPixels)) : baseScale;

    // Final scale is the minimum of all constraints (never exceeding baseScale)
    const scale = Math.min(baseScale, longEdgeScale, maxPixelsScale);

    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const effectiveDpi = Math.round(scale * 72);

    return { scale, width, height, effectiveDpi };
}

/**
 * Canonical representation of a rendered/normalized page image.
 * This contract is established in AE-046 and reused directly by AE-048 for direct image inputs.
 */
export interface RenderedPageImage {
    buffer: Buffer;
    format: CanonicalImageFormat;
    width: number;
    height: number;
    dpi: number;
    pageNumber: number;
    sizeBytes: number;
}

/**
 * Input options passed to a page renderer.
 */
export interface RenderPageInput {
    batchId: string;
    fileId: string;
    pageNumber: number;
    fileType: string;
    storageKey?: string;
    fileBuffer?: Buffer;
    config?: Partial<PageRenderingConfig>;
}

/**
 * Result returned by the page renderer.
 */
export interface RenderPageResult {
    success: boolean;
    pageNumber: number;
    image?: RenderedPageImage;
    metadata?: Record<string, unknown>;
    failureReason?: string;
}

/**
 * Abstract injectable page renderer interface.
 * PageIngestionService depends on this abstraction, allowing tests and alternative
 * rendering engines (e.g. pdfjs-dist, mock/stub renderers) to be injected without production-only flags.
 */
export interface IPageRenderer {
    /**
     * Renders a specific page of a file into a canonical normalized page image.
     */
    renderPage(input: RenderPageInput): Promise<RenderPageResult>;

    /**
     * Authoritative page count discovery from the underlying renderer.
     */
    getPageCount?(buffer: Buffer): Promise<number>;
}

/**
 * Real PDF renderer implementation using Mozilla's pdfjs-dist and @napi-rs/canvas.
 * Decodes PDF streams, enforces maxLongEdge and maxPixels limits before allocation,
 * renders target page onto 2D canvas at target DPI, and encodes normalized PNG/raster image buffers.
 */
export class DefaultPdfRenderer implements IPageRenderer {
    private config: PageRenderingConfig;

    constructor(config: Partial<PageRenderingConfig> = {}) {
        this.config = { ...DEFAULT_PAGE_RENDERING_CONFIG, ...config };
    }

    /**
     * Authoritative page count discovery using pdfjs-dist.
     */
    async getPageCount(fileBuffer: Buffer): Promise<number> {
        if (!fileBuffer || fileBuffer.length === 0) {
            throw new Error('PDF buffer is empty or missing');
        }

        const data = new Uint8Array(fileBuffer);
        const loadingTask = pdfjsLib.getDocument({
            data,
            isEvalSupported: false,
            useSystemFonts: false,
            disableFontFace: true,
            standardFontDataUrl: path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/'
        });

        const doc = await loadingTask.promise;
        try {
            return doc.numPages;
        } finally {
            await doc.destroy();
        }
    }

    /**
     * Renders a specific page of a PDF document to an actual raster PNG buffer with enforced safety limits.
     */
    async renderPage(input: RenderPageInput): Promise<RenderPageResult> {
        const { pageNumber, fileBuffer, fileType, config } = input;

        if (!fileBuffer || fileBuffer.length === 0) {
            return {
                success: false,
                pageNumber,
                failureReason: `Cannot render page ${pageNumber}: PDF buffer is missing or empty`
            };
        }

        let doc: pdfjsLib.PDFDocumentProxy | null = null;
        let page: pdfjsLib.PDFPageProxy | null = null;

        try {
            const data = new Uint8Array(fileBuffer);
            const loadingTask = pdfjsLib.getDocument({
                data,
                isEvalSupported: false,
                useSystemFonts: false,
                disableFontFace: true,
                standardFontDataUrl: path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/'
            });

            doc = await loadingTask.promise;
            const totalPages = doc.numPages;

            if (pageNumber < 1 || pageNumber > totalPages) {
                return {
                    success: false,
                    pageNumber,
                    failureReason: `Requested page ${pageNumber} is out of bounds (document has ${totalPages} pages)`
                };
            }

            page = await doc.getPage(pageNumber);

            const activeConfig: PageRenderingConfig = {
                targetDpi: config?.targetDpi ?? this.config.targetDpi,
                maxLongEdge: config?.maxLongEdge ?? this.config.maxLongEdge,
                maxPixels: config?.maxPixels ?? this.config.maxPixels,
                outputFormat: config?.outputFormat ?? this.config.outputFormat
            };

            // Natural unscaled viewport at 72 DPI (scale: 1.0)
            const unscaledViewport = page.getViewport({ scale: 1.0 });

            // Enforce maxLongEdge and maxPixels before canvas allocation
            const { scale: finalScale, width, height, effectiveDpi } = calculateSafeRenderDimensions(
                unscaledViewport.width,
                unscaledViewport.height,
                activeConfig
            );

            const viewport = page.getViewport({ scale: finalScale });

            const canvas = createCanvas(width, height);
            const context = canvas.getContext('2d');

            // Render PDF page into 2D canvas context
            const renderContext = {
                canvasContext: context as unknown as CanvasRenderingContext2D,
                viewport
            };

            await page.render(renderContext).promise;

            const format = activeConfig.outputFormat;
            let imageBuffer: Buffer;
            if (format === 'jpeg') {
                imageBuffer = canvas.toBuffer('image/jpeg');
            } else if (format === 'webp') {
                imageBuffer = canvas.toBuffer('image/webp');
            } else {
                imageBuffer = canvas.toBuffer('image/png');
            }

            const renderedImage: RenderedPageImage = {
                buffer: imageBuffer,
                format,
                width,
                height,
                dpi: effectiveDpi,
                pageNumber,
                sizeBytes: imageBuffer.length
            };

            return {
                success: true,
                pageNumber,
                image: renderedImage,
                metadata: {
                    fileType: fileType || 'pdf',
                    pageNumber,
                    totalPages,
                    width,
                    height,
                    dpi: effectiveDpi,
                    format,
                    renderedAt: new Date().toISOString(),
                    sizeBytes: imageBuffer.length
                }
            };
        } catch (error) {
            const rawMessage = error instanceof Error ? error.message : 'PDF rendering failed';
            return {
                success: false,
                pageNumber,
                failureReason: rawMessage
            };
        } finally {
            if (page) {
                page.cleanup();
            }
            if (doc) {
                await doc.destroy();
            }
        }
    }
}

/**
 * Canonical Image renderer and normalizer implementation using @napi-rs/canvas.
 * Decodes standalone images (JPEG, PNG, WebP, TIFF, GIF), enforces maxLongEdge
 * and maxPixels safety limits, normalizes into the canonical RenderedPageImage contract
 * with lossless PNG output by default (or configured format), and guarantees single-page semantics (pageNumber = 1).
 */
export class DefaultImageRenderer implements IPageRenderer {
    private config: PageRenderingConfig;

    constructor(config: Partial<PageRenderingConfig> = {}) {
        this.config = { ...DEFAULT_PAGE_RENDERING_CONFIG, ...config };
    }

    /**
     * Authoritative page count discovery for standalone images is always exactly 1.
     */
    async getPageCount(_fileBuffer?: Buffer): Promise<number> {
        void _fileBuffer;
        return 1;
    }

    /**
     * Normalizes a standalone image into a canonical RenderedPageImage with enforced safety limits.
     */
    async renderPage(input: RenderPageInput): Promise<RenderPageResult> {
        const { pageNumber, fileBuffer, fileType, config } = input;

        if (pageNumber !== 1) {
            return {
                success: false,
                pageNumber,
                failureReason: `Requested page ${pageNumber} is out of bounds for standalone image (standalone image has exactly 1 page)`
            };
        }

        if (!fileBuffer || fileBuffer.length === 0) {
            return {
                success: false,
                pageNumber,
                failureReason: 'Cannot render image: image buffer is missing or empty'
            };
        }

        try {
            const img = await loadImage(fileBuffer);
            const naturalWidth = img.width;
            const naturalHeight = img.height;

            if (naturalWidth <= 0 || naturalHeight <= 0) {
                return {
                    success: false,
                    pageNumber,
                    failureReason: 'Cannot render image: invalid image dimensions'
                };
            }

            const activeConfig: PageRenderingConfig = {
                targetDpi: config?.targetDpi ?? this.config.targetDpi,
                maxLongEdge: config?.maxLongEdge ?? this.config.maxLongEdge,
                maxPixels: config?.maxPixels ?? this.config.maxPixels,
                outputFormat: config?.outputFormat ?? this.config.outputFormat
            };

            // Enforce maxLongEdge and maxPixels safety constraints preserving aspect ratio
            const maxDim = Math.max(naturalWidth, naturalHeight);
            const longEdgeScale = maxDim > activeConfig.maxLongEdge ? activeConfig.maxLongEdge / maxDim : 1.0;
            const totalPixels = naturalWidth * naturalHeight;
            const maxPixelsScale =
                totalPixels > activeConfig.maxPixels ? Math.sqrt(activeConfig.maxPixels / totalPixels) : 1.0;
            const scale = Math.min(1.0, longEdgeScale, maxPixelsScale);

            const width = Math.max(1, Math.round(naturalWidth * scale));
            const height = Math.max(1, Math.round(naturalHeight * scale));
            const effectiveDpi = activeConfig.targetDpi;

            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');

            // White matte background if converting to JPEG
            if (activeConfig.outputFormat === 'jpeg') {
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
            }

            ctx.drawImage(img, 0, 0, width, height);

            const format = activeConfig.outputFormat;
            let imageBuffer: Buffer;
            if (format === 'jpeg') {
                imageBuffer = canvas.toBuffer('image/jpeg');
            } else if (format === 'webp') {
                imageBuffer = canvas.toBuffer('image/webp');
            } else {
                imageBuffer = canvas.toBuffer('image/png');
            }

            const renderedImage: RenderedPageImage = {
                buffer: imageBuffer,
                format,
                width,
                height,
                dpi: effectiveDpi,
                pageNumber: 1,
                sizeBytes: imageBuffer.length
            };

            return {
                success: true,
                pageNumber: 1,
                image: renderedImage,
                metadata: {
                    fileType: fileType || 'image',
                    pageNumber: 1,
                    totalPages: 1,
                    width,
                    height,
                    dpi: effectiveDpi,
                    format,
                    renderedAt: new Date().toISOString(),
                    sizeBytes: imageBuffer.length
                }
            };
        } catch (error) {
            const rawMessage = error instanceof Error ? error.message : 'Image rendering failed';
            return {
                success: false,
                pageNumber: 1,
                failureReason: rawMessage
            };
        }
    }
}

export const defaultImageRenderer = new DefaultImageRenderer();
