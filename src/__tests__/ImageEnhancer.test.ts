import { describe, it, expect } from 'vitest';
import { defaultImageEnhancer } from '../services/ImageEnhancer';
import { createCanvas } from '@napi-rs/canvas';

function createSyntheticTestImage(skewDeg: number, orientationDeg: number = 0, textColor: string = '#000000', bgColor: string = '#FFFFFF'): Buffer {
    // Generate a 800x1000 image with text lines
    const width = 800;
    const height = 1000;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Fill background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);

    // Draw text lines
    const drawTextLines = () => {
        ctx.fillStyle = textColor;
        ctx.font = '30px Arial';
        // Add left margin, draw multiple lines
        for (let i = 100; i < 750; i += 60) {
            ctx.fillText('This is a synthetic line of text for testing deskew and orientation algorithms.', 50, i);
            ctx.fillText('It simulates a scanned document page with a standard layout.', 50, i + 30);
        }
    };

    // We want to apply skew and orientation.
    // Order: first we skew, then we orient.
    // Wait, physically, a page has text. Then it might be skewed. Then the whole thing might be rotated 90/180/270.

    ctx.translate(width / 2, height / 2);
    ctx.rotate((orientationDeg + skewDeg) * Math.PI / 180);
    ctx.translate(-width / 2, -height / 2);

    drawTextLines();

    return canvas.toBuffer('image/png');
}

describe('ImageEnhancer', () => {
    it('should correctly detect and correct 0 degree skew (no change)', async () => {
        const buffer = createSyntheticTestImage(0, 0);
        const result = await defaultImageEnhancer.enhancePage(buffer);

        expect(result.orientation).toBe(0);
        // Depending on noise, could be a tiny angle, but synthetic text is perfect
        expect(Math.abs(result.deskewAngle)).toBeLessThanOrEqual(0.5);
    });

    it('should detect and correct a positive skew of 5 degrees', async () => {
        // Skew text by 5 degrees clockwise
        const buffer = createSyntheticTestImage(5, 0);
        const result = await defaultImageEnhancer.enhancePage(buffer);

        expect(result.orientation).toBe(0);
        // To correct a +5 skew, the enhancer should detect -5 or +5 depending on its sign convention.
        // We know it needs to rotate by roughly 5 degrees in magnitude.
        expect(Math.abs(result.deskewAngle)).toBeGreaterThanOrEqual(4.5);
        expect(Math.abs(result.deskewAngle)).toBeLessThanOrEqual(5.5);
        expect(result.applied).toBe(true);
    });

    it('should detect and correct a negative skew of -3.5 degrees', async () => {
        const buffer = createSyntheticTestImage(-3.5, 0);
        const result = await defaultImageEnhancer.enhancePage(buffer);

        expect(result.orientation).toBe(0);
        expect(Math.abs(result.deskewAngle)).toBeGreaterThanOrEqual(3.0);
        expect(Math.abs(result.deskewAngle)).toBeLessThanOrEqual(4.0);
        expect(result.applied).toBe(true);
    });

    it('should not apply unreliable deskew if angle is out of bounds', async () => {
        // Skew by 45 degrees, which is completely beyond our +-10 detection range.
        // There should be no spurious peaks in the [-10, 10] range, so it falls back to 0.
        const buffer = createSyntheticTestImage(45, 0);
        const result = await defaultImageEnhancer.enhancePage(buffer);

        // It should reject it and stick to 0
        expect(result.deskewAngle).toBe(0);
    });

    it('should detect 90 degree orientation', async () => {
        const buffer = createSyntheticTestImage(0, 90);
        const result = await defaultImageEnhancer.enhancePage(buffer);

        // Note: Our heuristic might confuse 90 and 270 depending on margin density logic.
        // Let's at least assert it detected it requires rotation.
        expect(result.orientation).toBe(90);
    });

    it('should detect 180 degree orientation', async () => {
        const buffer = createSyntheticTestImage(0, 180);
        const result = await defaultImageEnhancer.enhancePage(buffer);

        expect(result.orientation).toBe(180);
    });

    it('should correctly process combined orientation and skew', async () => {
        // 90 deg orientation with 2 deg skew
        const buffer = createSyntheticTestImage(2, 90);
        const result = await defaultImageEnhancer.enhancePage(buffer);

        expect(result.orientation).toBe(90);
        expect(Math.abs(result.deskewAngle)).toBeGreaterThanOrEqual(1.5);
        expect(Math.abs(result.deskewAngle)).toBeLessThanOrEqual(2.5);
    });

    it('should normalize faint and low-contrast images', async () => {
        // Light gray text on medium gray background
        const buffer = createSyntheticTestImage(0, 0, '#999999', '#CCCCCC');
        const result = await defaultImageEnhancer.enhancePage(buffer);

        expect(result.applied).toBe(true);
        // After normalization, the darkest pixel should be close to 0 (black) and brightest close to 255 (white)
        const { loadImage, createCanvas } = await import('@napi-rs/canvas');
        const img = await loadImage(result.buffer);
        const canvas = createCanvas(img.width, img.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        const data = ctx.getImageData(0, 0, img.width, img.height).data;
        let min = 255;
        let max = 0;
        for (let i = 0; i < data.length; i += 4) {
            const luma = Math.round(0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2]);
            if (luma < min) min = luma;
            if (luma > max) max = luma;
        }

        expect(min).toBeLessThan(50);
        expect(max).toBeGreaterThan(200);
    });

    it('should preserve already-good scans substantially unchanged', async () => {
        // Perfect black text on white background
        const buffer = createSyntheticTestImage(0, 0, '#000000', '#FFFFFF');
        const result = await defaultImageEnhancer.enhancePage(buffer);

        // Applied should be false because deskew=0, orientation=0, and contrast is already good
        expect(result.applied).toBe(false);
    });
});
