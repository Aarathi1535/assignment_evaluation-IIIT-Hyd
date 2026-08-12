import { createCanvas, loadImage } from '@napi-rs/canvas';

export interface ThumbnailConfig {
    /** Maximum allowed long-edge in pixels for thumbnails (default: 200px) */
    maxLongEdge: number;
    /** Output JPEG quality (0-100, default: 80) */
    quality: number;
    /** Canonical thumbnail image format (default: 'jpg') */
    format: 'jpg' | 'jpeg';
}

export const DEFAULT_THUMBNAIL_CONFIG: ThumbnailConfig = {
    maxLongEdge: 200,
    quality: 80,
    format: 'jpg'
};

export interface GeneratedThumbnail {
    buffer: Buffer;
    format: 'jpg' | 'jpeg';
    width: number;
    height: number;
    sizeBytes: number;
}

/**
 * Calculates thumbnail dimensions preserving source aspect ratio with long edge capped at maxLongEdge.
 */
export function calculateThumbnailDimensions(
    sourceWidth: number,
    sourceHeight: number,
    maxLongEdge = 200
): { width: number; height: number; scale: number } {
    if (sourceWidth <= 0 || sourceHeight <= 0) {
        return { width: 1, height: 1, scale: 1.0 };
    }

    const maxDim = Math.max(sourceWidth, sourceHeight);
    const scale = maxDim > maxLongEdge ? maxLongEdge / maxDim : 1.0;

    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    return { width, height, scale };
}

export interface IThumbnailGenerator {
    generateThumbnail(
        pageImageBuffer: Buffer,
        sourceWidth?: number,
        sourceHeight?: number,
        config?: Partial<ThumbnailConfig>
    ): Promise<GeneratedThumbnail>;
}

export class DefaultThumbnailGenerator implements IThumbnailGenerator {
    private config: ThumbnailConfig;

    constructor(config: Partial<ThumbnailConfig> = {}) {
        this.config = { ...DEFAULT_THUMBNAIL_CONFIG, ...config };
    }

    /**
     * Generates a canonical JPEG thumbnail from a normalized page image buffer:
     * - Bounded to 200px max long edge
     * - Preserves aspect ratio
     * - Renders white matte background for transparent inputs
     * - Encodes as JPEG at quality 80
     */
    async generateThumbnail(
        pageImageBuffer: Buffer,
        sourceWidth?: number,
        sourceHeight?: number,
        config?: Partial<ThumbnailConfig>
    ): Promise<GeneratedThumbnail> {
        if (!pageImageBuffer || pageImageBuffer.length === 0) {
            throw new Error('Cannot generate thumbnail: page image buffer is missing or empty');
        }

        const activeConfig: ThumbnailConfig = { ...this.config, ...config };
        const img = await loadImage(pageImageBuffer);

        const srcWidth = sourceWidth && sourceWidth > 0 ? sourceWidth : img.width;
        const srcHeight = sourceHeight && sourceHeight > 0 ? sourceHeight : img.height;

        const { width: thumbWidth, height: thumbHeight } = calculateThumbnailDimensions(
            srcWidth,
            srcHeight,
            activeConfig.maxLongEdge
        );

        const canvas = createCanvas(thumbWidth, thumbHeight);
        const ctx = canvas.getContext('2d');

        // Render white matte / solid background to handle transparent PNGs cleanly in JPEG
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, thumbWidth, thumbHeight);

        // Draw scaled source image on top of white matte
        ctx.drawImage(img, 0, 0, thumbWidth, thumbHeight);

        const jpegBuffer = canvas.toBuffer('image/jpeg', activeConfig.quality);

        return {
            buffer: jpegBuffer,
            format: activeConfig.format,
            width: thumbWidth,
            height: thumbHeight,
            sizeBytes: jpegBuffer.length
        };
    }
}

const defaultThumbnailGenerator = new DefaultThumbnailGenerator();
export default defaultThumbnailGenerator;
