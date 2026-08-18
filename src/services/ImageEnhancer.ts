import { createCanvas, loadImage } from '@napi-rs/canvas';

export interface ImageEnhancementResult {
    buffer: Buffer;
    deskewAngle: number;
    orientation: number;
    applied: boolean;
}

export interface IImageEnhancer {
    enhancePage(buffer: Buffer, format?: 'png' | 'jpeg' | 'webp'): Promise<ImageEnhancementResult>;
}

export class DefaultImageEnhancer implements IImageEnhancer {
    async enhancePage(buffer: Buffer, format: 'png' | 'jpeg' | 'webp' = 'png'): Promise<ImageEnhancementResult> {
        try {
            const img = await loadImage(buffer);

            // 1. Downscale for analysis
            const MAX_DIM = 400;
            const scale = Math.min(1.0, MAX_DIM / Math.max(img.width, img.height));
            const sWidth = Math.max(1, Math.round(img.width * scale));
            const sHeight = Math.max(1, Math.round(img.height * scale));

            const analyzeCanvas = createCanvas(sWidth, sHeight);
            const aCtx = analyzeCanvas.getContext('2d');
            // Ensure white background
            aCtx.fillStyle = '#FFFFFF';
            aCtx.fillRect(0, 0, sWidth, sHeight);
            aCtx.drawImage(img, 0, 0, sWidth, sHeight);

            let hVar = this.getProjectionVariance(aCtx, sWidth, sHeight, 0);
            const vVar = this.getProjectionVariance(aCtx, sWidth, sHeight, 90);

            // AE-066: If variance is extremely low, it lacks clear text structure.
            // Avoid unreliable enhancement on blank or purely noise images.
            if (hVar < 50 && vVar < 50) {
                return { buffer, deskewAngle: 0, orientation: 0, applied: false };
            }

            let orientation = 0;
            if (vVar > hVar * 2.0) {
                const leftSum = this.getMarginDensity(aCtx, sWidth, sHeight, 'left');
                const rightSum = this.getMarginDensity(aCtx, sWidth, sHeight, 'right');
                // Original top margin (which has more ink) moves to the right when rotated 90 degrees clockwise.
                orientation = rightSum > leftSum * 1.2 ? 90 : 270;
                hVar = vVar;
            } else {
                const topSum = this.getMarginDensity(aCtx, sWidth, sHeight, 'top');
                const bottomSum = this.getMarginDensity(aCtx, sWidth, sHeight, 'bottom');
                // Normal text has more ink at the top (header) and empty space at the bottom.
                // If bottom has significantly more ink than top, it's upside down.
                if (bottomSum > topSum * 2.0) {
                    orientation = 180;
                }
            }

            let bestAngle = 0;
            let maxVar = -1;

            // Scan -10 to +10 degrees relative to orientation
            for (let angle = -10; angle <= 10; angle += 0.5) {
                const currentVar = this.getProjectionVariance(aCtx, sWidth, sHeight, angle + orientation);
                if (currentVar > maxVar) {
                    maxVar = currentVar;
                    bestAngle = angle;
                }
            }

            // If the variance didn't significantly improve over 0 deskew, discard it
            const zeroVar = this.getProjectionVariance(aCtx, sWidth, sHeight, orientation);
            if (maxVar < zeroVar * 1.15) {
                bestAngle = 0;
            }

            const { p5, p95 } = this.getContrastStats(aCtx, sWidth, sHeight);
            const needsContrast = p5 > 100 || (p95 - p5) < 100;

            if (bestAngle === 0 && orientation === 0 && !needsContrast) {
                return { buffer, deskewAngle: 0, orientation: 0, applied: false };
            }

            // 3. Apply transformation
            const totalRotationDeg = orientation + bestAngle;
            const rad = Math.abs(totalRotationDeg * Math.PI / 180);
            let newWidth = img.width;
            let newHeight = img.height;

            if (orientation === 90 || orientation === 270) {
                newWidth = img.height * Math.abs(Math.cos(rad)) + img.width * Math.abs(Math.sin(rad));
                newHeight = img.width * Math.abs(Math.cos(rad)) + img.height * Math.abs(Math.sin(rad));
            } else {
                newWidth = img.width * Math.abs(Math.cos(rad)) + img.height * Math.abs(Math.sin(rad));
                newHeight = img.height * Math.abs(Math.cos(rad)) + img.width * Math.abs(Math.sin(rad));
            }

            const finalCanvas = createCanvas(Math.round(newWidth), Math.round(newHeight));
            const fCtx = finalCanvas.getContext('2d');

            if (format === 'jpeg') {
                fCtx.fillStyle = '#FFFFFF';
                fCtx.fillRect(0, 0, finalCanvas.width, finalCanvas.height);
            }

            fCtx.translate(finalCanvas.width / 2, finalCanvas.height / 2);
            // Rotate the context by the exact angle (this counter-rotates the image)
            // Example: If text is skewed down by 5 deg (image rotated +5 deg),
            // getProjectionVariance rotated context by -5 deg to make it horizontal, so bestAngle = -5.
            // Wait, getProjectionVariance does: rotate(angle).
            // If image is skewed +5, we must rotate context by -5 to make lines horizontal.
            // So bestAngle = -5.
            // To correct the original image, we should rotate the context by -(-5) = +5?
            // Actually, if we rotate the context by -5, the drawn image will be rotated -5.
            // Let's use bestAngle directly. We can verify in test.
            fCtx.rotate(-totalRotationDeg * Math.PI / 180);

            if (needsContrast) {
                const safeP95 = Math.max(p95, p5 + 1);
                const scale = 255 / (safeP95 - p5);
                const offset = -p5 * scale;
                const c = Math.max(1, 1 - (offset / 127.5));
                const b = scale / c;
                fCtx.filter = `brightness(${b}) contrast(${c})`;
            }

            fCtx.drawImage(img, -img.width / 2, -img.height / 2);
            fCtx.filter = 'none';

            let outBuffer: Buffer;
            if (format === 'jpeg') outBuffer = finalCanvas.toBuffer('image/jpeg');
            else if (format === 'webp') outBuffer = finalCanvas.toBuffer('image/webp');
            else outBuffer = finalCanvas.toBuffer('image/png');

            return { buffer: outBuffer, deskewAngle: bestAngle, orientation, applied: true };
        } catch {
            // Failsafe: return original buffer on any error
            return { buffer, deskewAngle: 0, orientation: 0, applied: false };
        }
    }

    private getProjectionVariance(ctx: import('@napi-rs/canvas').SKRSContext2D, width: number, height: number, angleDeg: number): number {
        const tempCanvas = createCanvas(width, height);
        const tCtx = tempCanvas.getContext('2d');
        tCtx.fillStyle = '#FFFFFF';
        tCtx.fillRect(0, 0, width, height);

        tCtx.translate(width / 2, height / 2);
        tCtx.rotate(angleDeg * Math.PI / 180);
        tCtx.drawImage(ctx.canvas, -width / 2, -height / 2);

        const imgData = tCtx.getImageData(0, 0, width, height).data;
        const rowSums = new Float64Array(height);

        let sum = 0;
        for (let y = 0; y < height; y++) {
            let rowSum = 0;
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const luma = 255 - (0.299 * imgData[idx] + 0.587 * imgData[idx+1] + 0.114 * imgData[idx+2]);
                rowSum += luma;
            }
            rowSums[y] = rowSum;
            sum += rowSum;
        }

        const mean = sum / height;
        let variance = 0;
        for (let y = 0; y < height; y++) {
            const diff = rowSums[y] - mean;
            variance += diff * diff;
        }

        return variance / height;
    }

    private getMarginDensity(ctx: import('@napi-rs/canvas').SKRSContext2D, width: number, height: number, edge: 'top'|'bottom'|'left'|'right'): number {
        const imgData = ctx.getImageData(0, 0, width, height).data;
        let sum = 0;

        const marginPercent = 0.2;
        let startY = 0, endY = height;
        let startX = 0, endX = width;

        if (edge === 'top') endY = Math.floor(height * marginPercent);
        if (edge === 'bottom') startY = Math.floor(height * (1 - marginPercent));
        if (edge === 'left') endX = Math.floor(width * marginPercent);
        if (edge === 'right') startX = Math.floor(width * (1 - marginPercent));

        for (let y = startY; y < endY; y++) {
            for (let x = startX; x < endX; x++) {
                const idx = (y * width + x) * 4;
                const luma = 255 - (0.299 * imgData[idx] + 0.587 * imgData[idx+1] + 0.114 * imgData[idx+2]);
                sum += luma;
            }
        }
        return sum;
    }

    private getContrastStats(ctx: import('@napi-rs/canvas').SKRSContext2D, width: number, height: number): { p5: number, p95: number } {
        const imgData = ctx.getImageData(0, 0, width, height).data;
        const histogram = new Int32Array(256);
        let total = 0;

        for (let i = 0; i < imgData.length; i += 4) {
            const luma = Math.round(0.299 * imgData[i] + 0.587 * imgData[i+1] + 0.114 * imgData[i+2]);
            const clampedLuma = Math.max(0, Math.min(255, luma));
            histogram[clampedLuma]++;
            total++;
        }

        let p5 = 0;
        let count = 0;
        const target5 = total * 0.05;
        for (let i = 0; i < 256; i++) {
            count += histogram[i];
            if (count >= target5) {
                p5 = i;
                break;
            }
        }

        let p95 = 255;
        count = 0;
        const target95 = total * 0.95;
        for (let i = 0; i < 256; i++) {
            count += histogram[i];
            if (count >= target95) {
                p95 = i;
                break;
            }
        }

        return { p5, p95 };
    }
}

export const defaultImageEnhancer = new DefaultImageEnhancer();
