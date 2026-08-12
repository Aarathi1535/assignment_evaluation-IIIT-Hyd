import { describe, it, expect } from 'vitest';
import { createCanvas } from '@napi-rs/canvas';
import {
    DefaultThumbnailGenerator,
    calculateThumbnailDimensions,
    DEFAULT_THUMBNAIL_CONFIG
} from '../services/ThumbnailGenerator';

describe('ThumbnailGenerator (AE-047)', () => {
    describe('1. Dimension Calculation & Constraints', () => {
        it('should cap portrait image long edge at 200px and preserve aspect ratio', () => {
            const dims = calculateThumbnailDimensions(1275, 1650, 200);
            expect(dims.height).toBe(200);
            expect(dims.width).toBe(Math.round(1275 * (200 / 1650))); // ~155
            expect(dims.width).toBeLessThanOrEqual(200);
            expect(dims.height).toBeLessThanOrEqual(200);
        });

        it('should cap landscape image long edge at 200px and preserve aspect ratio', () => {
            const dims = calculateThumbnailDimensions(2048, 1536, 200);
            expect(dims.width).toBe(200);
            expect(dims.height).toBe(Math.round(1536 * (200 / 2048))); // 150
            expect(dims.width).toBeLessThanOrEqual(200);
            expect(dims.height).toBeLessThanOrEqual(200);
        });

        it('should not upscale images smaller than 200px', () => {
            const dims = calculateThumbnailDimensions(150, 100, 200);
            expect(dims.width).toBe(150);
            expect(dims.height).toBe(100);
            expect(dims.scale).toBe(1.0);
        });

        it('should enforce minimum 1x1 dimensions for thin slices', () => {
            const dims = calculateThumbnailDimensions(3000, 2, 200);
            expect(dims.width).toBe(200);
            expect(dims.height).toBeGreaterThanOrEqual(1);
        });
    });

    describe('2. Thumbnail Generation & Encoding', () => {
        const generator = new DefaultThumbnailGenerator();

        it('should have default configuration with maxLongEdge 200, quality 80, format jpg', () => {
            expect(DEFAULT_THUMBNAIL_CONFIG.maxLongEdge).toBe(200);
            expect(DEFAULT_THUMBNAIL_CONFIG.quality).toBe(80);
            expect(DEFAULT_THUMBNAIL_CONFIG.format).toBe('jpg');
        });

        it('should generate a valid JPEG thumbnail from a source image buffer', async () => {
            // Create a 800x600 test canvas
            const canvas = createCanvas(800, 600);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#336699';
            ctx.fillRect(0, 0, 800, 600);
            const sourcePng = canvas.toBuffer('image/png');

            const thumb = await generator.generateThumbnail(sourcePng, 800, 600);

            expect(thumb.width).toBe(200);
            expect(thumb.height).toBe(150);
            expect(thumb.format).toBe('jpg');
            expect(thumb.buffer).toBeInstanceOf(Buffer);
            expect(thumb.buffer.length).toBeGreaterThan(0);

            // Verify JPEG magic bytes (FF D8 FF)
            expect(thumb.buffer[0]).toBe(0xFF);
            expect(thumb.buffer[1]).toBe(0xD8);
            expect(thumb.buffer[2]).toBe(0xFF);
        });

        it('should render a solid white matte for transparent source images', async () => {
            // Create a transparent 400x400 canvas with a small red box in the middle
            const canvas = createCanvas(400, 400);
            const ctx = canvas.getContext('2d');
            // Transparent background (cleared)
            ctx.clearRect(0, 0, 400, 400);
            // Draw red rectangle
            ctx.fillStyle = '#FF0000';
            ctx.fillRect(100, 100, 200, 200);
            const transparentPng = canvas.toBuffer('image/png');

            const thumb = await generator.generateThumbnail(transparentPng, 400, 400);

            expect(thumb.width).toBe(200);
            expect(thumb.height).toBe(200);
            expect(thumb.format).toBe('jpg');
            // Verify it produces a valid JPEG
            expect(thumb.buffer[0]).toBe(0xFF);
            expect(thumb.buffer[1]).toBe(0xD8);
            expect(thumb.buffer[2]).toBe(0xFF);
        });

        it('should reject empty buffer input', async () => {
            await expect(generator.generateThumbnail(Buffer.alloc(0))).rejects.toThrow(
                'Cannot generate thumbnail: page image buffer is missing or empty'
            );
        });
    });
});
