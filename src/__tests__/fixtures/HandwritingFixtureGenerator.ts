import { createCanvas, SKRSContext2D } from '@napi-rs/canvas';

/**
 * Deterministic synthetic handwriting image fixture generator.
 * Produces strictly synthetic canvas-rendered handwriting-like patterns,
 * diagrams, blank pages, and noise scans for pipeline testing.
 *
 * NOTE: Contains ZERO real student data.
 */
export class HandwritingFixtureGenerator {
    public static readonly DEFAULT_WIDTH = 500;
    public static readonly DEFAULT_HEIGHT = 400;

    /**
     * Helper to render synthetic handwritten text lines
     */
    private static drawSyntheticHandwritingLines(
        ctx: SKRSContext2D,
        options: {
            width: number;
            height: number;
            lineCount?: number;
            lineSpacing?: number;
            lineWidth?: number;
            slantDegrees?: number;
            seed?: number;
        }
    ) {
        const {
            width,
            height,
            lineCount = 5,
            lineSpacing = 50,
            lineWidth = 2.0,
            slantDegrees = 0,
            seed = 1
        } = options;

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = '#111111';
        ctx.lineWidth = lineWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        // Simple deterministic PRNG
        let s = seed;
        const pseudoRandom = () => {
            s = (s * 9301 + 49297) % 233280;
            return s / 233280;
        };

        const slantRad = (slantDegrees * Math.PI) / 180;
        const shearX = Math.tan(slantRad);

        const startY = 60;
        for (let l = 0; l < lineCount; l++) {
            const baseY = startY + l * lineSpacing;
            if (baseY > height - 40) break;

            let curX = 40;
            while (curX < width - 60) {
                // Word length (3 to 6 characters/glyphs)
                const glyphCount = 3 + Math.floor(pseudoRandom() * 4);

                ctx.save();
                // Apply slant shear around base of the line
                ctx.translate(curX, baseY);
                ctx.transform(1, 0, shearX, 1, 0, 0);

                ctx.beginPath();
                let gx = 0;
                ctx.moveTo(0, 0);

                for (let g = 0; g < glyphCount; g++) {
                    const charH = 16 + pseudoRandom() * 12;
                    const charW = 10 + pseudoRandom() * 6;

                    // Draw loops and ascenders/descenders
                    const isAscender = pseudoRandom() > 0.7;
                    const topY = isAscender ? -charH * 1.5 : -charH;

                    // Upstroke
                    ctx.bezierCurveTo(
                        gx + charW * 0.3, -charH * 0.5,
                        gx + charW * 0.7, topY,
                        gx + charW, topY
                    );
                    // Downstroke
                    ctx.bezierCurveTo(
                        gx + charW * 0.9, topY * 0.5,
                        gx + charW * 0.8, 0,
                        gx + charW + 2, 0
                    );

                    gx += charW + 3;
                }
                ctx.stroke();
                ctx.restore();

                curX += (glyphCount * 14) + 18 + Math.floor(pseudoRandom() * 10);
            }
        }
    }

    /**
     * A. Consistent writer sample: deterministic cursive handwriting with controlled parameters.
     */
    public static createConsistentSample(
        seed: number = 42,
        width = HandwritingFixtureGenerator.DEFAULT_WIDTH,
        height = HandwritingFixtureGenerator.DEFAULT_HEIGHT
    ): Buffer {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        this.drawSyntheticHandwritingLines(ctx, {
            width,
            height,
            lineCount: 6,
            lineSpacing: 50,
            lineWidth: 2.2,
            slantDegrees: 12,
            seed
        });
        return canvas.toBuffer('image/png');
    }

    /**
     * B. Significantly different slant sample (e.g. -20° backward slant or +35° forward slant)
     */
    public static createSlantedSample(
        slantDegrees: number,
        width = HandwritingFixtureGenerator.DEFAULT_WIDTH,
        height = HandwritingFixtureGenerator.DEFAULT_HEIGHT
    ): Buffer {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        this.drawSyntheticHandwritingLines(ctx, {
            width,
            height,
            lineCount: 6,
            lineSpacing: 50,
            lineWidth: 2.2,
            slantDegrees,
            seed: 42
        });
        return canvas.toBuffer('image/png');
    }

    /**
     * C. Significantly different stroke width (e.g. 5.0 for thick felt pen vs 1.2 for thin ballpoint)
     */
    public static createThickStrokeSample(
        lineWidth: number,
        width = HandwritingFixtureGenerator.DEFAULT_WIDTH,
        height = HandwritingFixtureGenerator.DEFAULT_HEIGHT
    ): Buffer {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        this.drawSyntheticHandwritingLines(ctx, {
            width,
            height,
            lineCount: 6,
            lineSpacing: 50,
            lineWidth,
            slantDegrees: 12,
            seed: 42
        });
        return canvas.toBuffer('image/png');
    }

    /**
     * D. Insufficient strokes sample (only 1 or 2 small stray marks, e.g. a small checkmark)
     */
    public static createInsufficientSample(
        width = HandwritingFixtureGenerator.DEFAULT_WIDTH,
        height = HandwritingFixtureGenerator.DEFAULT_HEIGHT
    ): Buffer {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 2.5;
        // Small checkmark
        ctx.beginPath();
        ctx.moveTo(120, 150);
        ctx.lineTo(135, 170);
        ctx.lineTo(165, 130);
        ctx.stroke();

        return canvas.toBuffer('image/png');
    }

    /**
     * E. Blank image (pure white canvas with zero ink)
     */
    public static createBlankSample(
        width = HandwritingFixtureGenerator.DEFAULT_WIDTH,
        height = HandwritingFixtureGenerator.DEFAULT_HEIGHT
    ): Buffer {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        return canvas.toBuffer('image/png');
    }

    /**
     * F. Diagram-only image (large geometric shapes and solid fills, non-text)
     */
    public static createDiagramSample(
        width = HandwritingFixtureGenerator.DEFAULT_WIDTH,
        height = HandwritingFixtureGenerator.DEFAULT_HEIGHT
    ): Buffer {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = '#111111';
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 4.0;

        // Draw a massive solid geometric flowchart box / circuit block
        ctx.fillRect(80, 80, 240, 160);

        // Draw connecting bus lines
        ctx.beginPath();
        ctx.moveTo(320, 160);
        ctx.lineTo(440, 160);
        ctx.lineTo(440, 280);
        ctx.stroke();

        return canvas.toBuffer('image/png');
    }

    /**
     * G. Noisy scan sample (synthetic text with added salt-and-pepper noise)
     */
    public static createNoisySample(
        noiseRatio: number = 0.04,
        width = HandwritingFixtureGenerator.DEFAULT_WIDTH,
        height = HandwritingFixtureGenerator.DEFAULT_HEIGHT
    ): Buffer {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');
        this.drawSyntheticHandwritingLines(ctx, {
            width,
            height,
            lineCount: 5,
            lineSpacing: 50,
            lineWidth: 2.2,
            slantDegrees: 10,
            seed: 77
        });

        // Add isolated salt-and-pepper noise pixels
        const imgData = ctx.getImageData(0, 0, width, height);
        const data = imgData.data;
        const total = width * height;
        const noiseCount = Math.floor(total * noiseRatio);

        let seed = 999;
        const pseudoRandom = () => {
            seed = (seed * 16807) % 2147483647;
            return seed / 2147483647;
        };

        for (let i = 0; i < noiseCount; i++) {
            const px = Math.floor(pseudoRandom() * total) * 4;
            const isDark = pseudoRandom() > 0.5;
            const val = isDark ? 20 : 255;
            data[px] = val;
            data[px + 1] = val;
            data[px + 2] = val;
        }

        ctx.putImageData(imgData, 0, 0);
        return canvas.toBuffer('image/png');
    }

    /**
     * H. Slightly rotated sample
     */
    public static createRotatedSample(
        angleDegrees: number,
        width = HandwritingFixtureGenerator.DEFAULT_WIDTH,
        height = HandwritingFixtureGenerator.DEFAULT_HEIGHT
    ): Buffer {
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);

        ctx.save();
        ctx.translate(width / 2, height / 2);
        ctx.rotate((angleDegrees * Math.PI) / 180);
        ctx.translate(-width / 2, -height / 2);

        this.drawSyntheticHandwritingLines(ctx, {
            width,
            height,
            lineCount: 5,
            lineSpacing: 50,
            lineWidth: 2.2,
            slantDegrees: 12,
            seed: 42
        });

        ctx.restore();
        return canvas.toBuffer('image/png');
    }
}
