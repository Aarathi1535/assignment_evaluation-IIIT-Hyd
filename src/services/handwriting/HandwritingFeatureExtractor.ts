import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
    IBoundingBox,
    IHandwritingFeatures,
    ISampleQuality,
    SampleExtractionStatus
} from '../../models/HandwritingConsistency';

export interface FeatureExtractionResult {
    status: SampleExtractionStatus;
    features?: IHandwritingFeatures;
    disqualificationReason?: string;
}

/**
 * Deterministic handwriting-specific document analysis feature extractor.
 * Extracts ink density, projection profiles, line spacing, stroke width proxy,
 * stroke slant angle, and connected-component statistics using canvas pixel analysis.
 *
 * NOTE: Stroke width is measured as an observational geometric proxy for pen nib
 * geometry and writing weight; it is NOT a direct transducer pen-pressure sensor.
 */
export class HandwritingFeatureExtractor {
    private static readonly MIN_INK_DENSITY = 0.003;
    private static readonly MIN_STROKE_COUNT = 3;
    private static readonly MIN_INK_PIXELS = 80;
    private static readonly MAX_DIAGRAM_COMPONENT_RATIO = 0.40;

    /**
     * Extracts handwriting features from an image buffer with optional normalized bounding box.
     */
    public async extractFeatures(
        imageBuffer: Buffer,
        boundingBox?: IBoundingBox
    ): Promise<FeatureExtractionResult> {
        if (!imageBuffer || imageBuffer.length === 0) {
            return {
                status: SampleExtractionStatus.BLANK,
                disqualificationReason: 'Empty image buffer provided'
            };
        }

        let image;
        try {
            image = await loadImage(imageBuffer);
        } catch {
            return {
                status: SampleExtractionStatus.ERROR,
                disqualificationReason: 'Failed to decode image buffer'
            };
        }

        if (image.width <= 0 || image.height <= 0) {
            return {
                status: SampleExtractionStatus.ERROR,
                disqualificationReason: 'Invalid image dimensions'
            };
        }

        // 1. Resolve normalized crop coordinates
        let cropX = 0;
        let cropY = 0;
        let cropW = image.width;
        let cropH = image.height;

        if (boundingBox) {
            const bx = Math.max(0, Math.min(1, boundingBox.x));
            const by = Math.max(0, Math.min(1, boundingBox.y));
            const bw = Math.max(0, Math.min(1 - bx, boundingBox.width));
            const bh = Math.max(0, Math.min(1 - by, boundingBox.height));

            cropX = Math.floor(bx * image.width);
            cropY = Math.floor(by * image.height);
            cropW = Math.max(1, Math.floor(bw * image.width));
            cropH = Math.max(1, Math.floor(bh * image.height));
        }

        const canvas = createCanvas(cropW, cropH);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

        const imgData = ctx.getImageData(0, 0, cropW, cropH);
        const data = imgData.data;
        const totalPixels = cropW * cropH;

        // 2. Grayscale conversion & basic luminance statistics
        const gray = new Uint8Array(totalPixels);
        let lumSum = 0;
        let lumSqSum = 0;
        const hist = new Int32Array(256);

        for (let i = 0; i < totalPixels; i++) {
            const idx = i * 4;
            // Standard luminance: 0.299 R + 0.587 G + 0.114 B
            const l = Math.round(0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2]);
            gray[i] = l;
            hist[l]++;
            lumSum += l;
            lumSqSum += l * l;
        }

        const lumMean = lumSum / totalPixels;
        const lumVariance = (lumSqSum / totalPixels) - (lumMean * lumMean);
        const lumStdDev = Math.sqrt(Math.max(0, lumVariance));
        const contrast = Math.min(1.0, lumStdDev / 128.0);

        // 3. Otsu binarization with plateau midpoint selection
        let sumB = 0;
        let wB = 0;
        let varMax = 0;
        let bestTStart = -1;
        let bestTEnd = -1;

        for (let t = 0; t < 256; t++) {
            wB += hist[t];
            if (wB === 0) continue;
            const wF = totalPixels - wB;
            if (wF === 0) break;
            sumB += t * hist[t];
            const mB = sumB / wB;
            const mF = (lumSum - sumB) / wF;
            const varBetween = wB * wF * (mB - mF) * (mB - mF);
            if (varBetween > varMax) {
                varMax = varBetween;
                bestTStart = t;
                bestTEnd = t;
            } else if (varBetween === varMax && varMax > 0) {
                bestTEnd = t;
            }
        }

        const otsuThreshold = bestTStart >= 0 ? Math.floor((bestTStart + bestTEnd) / 2) : 128;

        // Clamp threshold to avoid binarizing uniform/blank background
        const effectiveThreshold = lumStdDev < 6 ? Math.min(otsuThreshold, 180) : Math.min(otsuThreshold, 215);

        // Binary ink mask: true = ink (dark foreground), false = background (light paper)
        const binary = new Uint8Array(totalPixels);
        let inkPixels = 0;

        for (let i = 0; i < totalPixels; i++) {
            if (gray[i] < effectiveThreshold) {
                binary[i] = 1;
                inkPixels++;
            }
        }

        const inkDensity = totalPixels > 0 ? inkPixels / totalPixels : 0;

        // 4. Blank & Near-blank Detection (less than 30 ink pixels or negligible ink density)
        if (inkDensity < 0.0005 || inkPixels < 30) {
            return {
                status: SampleExtractionStatus.BLANK,
                disqualificationReason: 'Region is blank or contains negligible ink markings'
            };
        }

        // 5. Connected Component Analysis (8-connectivity BFS)
        const labels = new Int32Array(totalPixels);
        let currentLabel = 0;
        interface ComponentInfo {
            area: number;
            minX: number;
            maxX: number;
            minY: number;
            maxY: number;
        }
        const components: ComponentInfo[] = [];

        const queue = new Int32Array(totalPixels);

        for (let y = 0; y < cropH; y++) {
            for (let x = 0; x < cropW; x++) {
                const idx = y * cropW + x;
                if (binary[idx] === 1 && labels[idx] === 0) {
                    currentLabel++;
                    labels[idx] = currentLabel;
                    let head = 0;
                    let tail = 0;
                    queue[tail++] = idx;

                    let area = 0;
                    let minX = x;
                    let maxX = x;
                    let minY = y;
                    let maxY = y;

                    while (head < tail) {
                        const curr = queue[head++];
                        area++;
                        const cy = Math.floor(curr / cropW);
                        const cx = curr % cropW;

                        if (cx < minX) minX = cx;
                        if (cx > maxX) maxX = cx;
                        if (cy < minY) minY = cy;
                        if (cy > maxY) maxY = cy;

                        // 8-neighborhood
                        for (let dy = -1; dy <= 1; dy++) {
                            const ny = cy + dy;
                            if (ny < 0 || ny >= cropH) continue;
                            for (let dx = -1; dx <= 1; dx++) {
                                const nx = cx + dx;
                                if (nx < 0 || nx >= cropW) continue;
                                const nidx = ny * cropW + nx;
                                if (binary[nidx] === 1 && labels[nidx] === 0) {
                                    labels[nidx] = currentLabel;
                                    queue[tail++] = nidx;
                                }
                            }
                        }
                    }

                    components.push({ area, minX, maxX, minY, maxY });
                }
            }
        }

        // Noise filtering: components with area <= 2 pixels
        const tinyNoiseComponents = components.filter(c => c.area <= 2);
        const validComponents = components.filter(c => c.area > 2);
        const noiseRatio = inkPixels > 0
            ? Math.min(1.0, (tinyNoiseComponents.reduce((acc, c) => acc + c.area, 0)) / inkPixels)
            : 0;

        // 6. Diagram-heavy & Non-text Detection
        // Evaluated before insufficient stroke count: a diagram may have huge ink content but few/massive shapes.
        let maxComponentArea = 0;
        for (const comp of components) {
            if (comp.area > maxComponentArea) {
                maxComponentArea = comp.area;
            }
        }

        const maxComponentRatio = inkPixels > 0 ? maxComponentArea / inkPixels : 0;
        const largestComp = components.reduce(
            (prev, curr) => (curr.area > prev.area ? curr : prev),
            components[0] || { area: 0, minX: 0, maxX: 0, minY: 0, maxY: 0 }
        );
        const largestBBoxArea = (largestComp.maxX - largestComp.minX + 1) * (largestComp.maxY - largestComp.minY + 1);

        const isSingleMassiveShape = maxComponentArea > 500 && maxComponentRatio > 0.35 && validComponents.length <= 15;
        const isDiagramBBox = largestComp.area > 500 && largestBBoxArea > (totalPixels * 0.15) && validComponents.length <= 15;

        if (isSingleMassiveShape || isDiagramBBox) {
            return {
                status: SampleExtractionStatus.DIAGRAM_REJECTED,
                disqualificationReason: 'Region contains geometric shapes, non-text illustrations, or diagram fills'
            };
        }

        // 7. Insufficient Content Detection
        if (validComponents.length < HandwritingFeatureExtractor.MIN_STROKE_COUNT || inkPixels < HandwritingFeatureExtractor.MIN_INK_PIXELS) {
            return {
                status: SampleExtractionStatus.INSUFFICIENT_SAMPLE,
                disqualificationReason: `Insufficient handwriting strokes detected (${validComponents.length} components, ${inkPixels} ink pixels)`
            };
        }

        // 8. Horizontal Projection Profile (Text Lines & Spacing)
        const hProfile = new Float64Array(cropH);
        for (let y = 0; y < cropH; y++) {
            let rowInk = 0;
            const rowOffset = y * cropW;
            for (let x = 0; x < cropW; x++) {
                if (binary[rowOffset + x] === 1) rowInk++;
            }
            hProfile[y] = cropW > 0 ? rowInk / cropW : 0;
        }

        let hSum = 0;
        let hSqSum = 0;
        for (let y = 0; y < cropH; y++) {
            hSum += hProfile[y];
            hSqSum += hProfile[y] * hProfile[y];
        }
        const hMean = hSum / cropH;
        const hVariance = Math.max(0, (hSqSum / cropH) - (hMean * hMean));

        // Peak detection on smoothed horizontal profile
        const hSmooth = new Float64Array(cropH);
        const win = 2;
        for (let y = 0; y < cropH; y++) {
            let winSum = 0;
            let count = 0;
            for (let dy = -win; dy <= win; dy++) {
                const py = y + dy;
                if (py >= 0 && py < cropH) {
                    winSum += hProfile[py];
                    count++;
                }
            }
            hSmooth[y] = count > 0 ? winSum / count : 0;
        }

        const peaks: number[] = [];
        const minPeakHeight = Math.max(0.015, hMean * 0.75);
        for (let y = 1; y < cropH - 1; y++) {
            if (hSmooth[y] > minPeakHeight && hSmooth[y] >= hSmooth[y - 1] && hSmooth[y] >= hSmooth[y + 1]) {
                if (peaks.length === 0 || (y - peaks[peaks.length - 1]) >= 8) {
                    peaks.push(y);
                }
            }
        }

        let estimatedLineSpacing = 0;
        if (peaks.length >= 2) {
            let spacingSum = 0;
            for (let p = 1; p < peaks.length; p++) {
                spacingSum += (peaks[p] - peaks[p - 1]);
            }
            estimatedLineSpacing = spacingSum / (peaks.length - 1);
        }

        // 9. Vertical Projection Profile
        const vProfile = new Float64Array(cropW);
        for (let x = 0; x < cropW; x++) {
            let colInk = 0;
            for (let y = 0; y < cropH; y++) {
                if (binary[y * cropW + x] === 1) colInk++;
            }
            vProfile[x] = cropH > 0 ? colInk / cropH : 0;
        }

        let vSum = 0;
        let vSqSum = 0;
        for (let x = 0; x < cropW; x++) {
            vSum += vProfile[x];
            vSqSum += vProfile[x] * vProfile[x];
        }
        const vMean = vSum / cropW;
        const vVariance = Math.max(0, (vSqSum / cropW) - (vMean * vMean));

        // 10. Estimated Stroke-Width Statistics (Proxy for pen nib & writing weight)
        // Measure horizontal run-lengths of ink strokes across the text lines
        const runLengths: number[] = [];
        for (let y = 0; y < cropH; y += 2) {
            let currentRun = 0;
            const offset = y * cropW;
            for (let x = 0; x < cropW; x++) {
                if (binary[offset + x] === 1) {
                    currentRun++;
                } else {
                    if (currentRun > 0 && currentRun <= 40) {
                        runLengths.push(currentRun);
                    }
                    currentRun = 0;
                }
            }
            if (currentRun > 0 && currentRun <= 40) {
                runLengths.push(currentRun);
            }
        }

        let swMean = 1.0;
        let swVariance = 0.0;
        let swMedian = 1.0;

        if (runLengths.length > 0) {
            runLengths.sort((a, b) => a - b);
            let rSum = 0;
            let rSqSum = 0;
            for (const r of runLengths) {
                rSum += r;
                rSqSum += r * r;
            }
            swMean = rSum / runLengths.length;
            swVariance = Math.max(0, (rSqSum / runLengths.length) - (swMean * swMean));
            const mid = Math.floor(runLengths.length / 2);
            swMedian = runLengths.length % 2 !== 0 ? runLengths[mid] : (runLengths[mid - 1] + runLengths[mid]) / 2;
        }

        // 11. Dominant Stroke Slant Angle Estimation (-45° to +45°)
        // Sobel gradient operator on gray levels
        let slantSum = 0;
        let slantWeight = 0;
        let gradMagSum = 0;
        let edgePixelCount = 0;

        for (let y = 1; y < cropH - 1; y++) {
            const ym1 = (y - 1) * cropW;
            const y0 = y * cropW;
            const yp1 = (y + 1) * cropW;

            for (let x = 1; x < cropW - 1; x++) {
                // Only consider pixels near ink boundaries
                if (binary[y0 + x] === 1) {
                    const gx = (gray[ym1 + x + 1] + 2 * gray[y0 + x + 1] + gray[yp1 + x + 1])
                             - (gray[ym1 + x - 1] + 2 * gray[y0 + x - 1] + gray[yp1 + x - 1]);
                    const gy = (gray[yp1 + x - 1] + 2 * gray[yp1 + x] + gray[yp1 + x + 1])
                             - (gray[ym1 + x - 1] + 2 * gray[ym1 + x] + gray[ym1 + x + 1]);

                    const mag = Math.hypot(gx, gy);
                    gradMagSum += mag;
                    edgePixelCount++;

                    // For near-vertical strokes, gx represents horizontal gradient across the stroke
                    if (mag > 40 && Math.abs(gx) > 10) {
                        // Angle relative to vertical: angle = atan(-gy / gx) or atan(gx / gy)
                        // In image coords: rightward tilt corresponds to positive angle
                        const angleRad = Math.atan2(gx, -gy);
                        const angleDeg = (angleRad * 180) / Math.PI;

                        // Focus on strokes within [-45°, 45°] of vertical
                        if (angleDeg >= -45 && angleDeg <= 45) {
                            slantSum += angleDeg * mag;
                            slantWeight += mag;
                        }
                    }
                }
            }
        }

        const dominantSlantAngle = slantWeight > 0 ? slantSum / slantWeight : 0.0;
        const sharpnessScore = edgePixelCount > 0 ? Math.min(1.0, (gradMagSum / edgePixelCount) / 255.0) : 0.0;

        // 12. Connected Components Statistics
        let totalCompArea = 0;
        let totalAspectRatio = 0;
        for (const comp of validComponents) {
            totalCompArea += comp.area;
            const w = comp.maxX - comp.minX + 1;
            const h = comp.maxY - comp.minY + 1;
            totalAspectRatio += (w / (h > 0 ? h : 1));
        }

        const ccMeanArea = validComponents.length > 0 ? totalCompArea / validComponents.length : 0;
        const ccMeanAspectRatio = validComponents.length > 0 ? totalAspectRatio / validComponents.length : 0;

        // 13. Assemble Sample Quality
        const quality: ISampleQuality = {
            contrast: Number(contrast.toFixed(4)),
            sharpnessScore: Number(sharpnessScore.toFixed(4)),
            noiseRatio: Number(noiseRatio.toFixed(4)),
            strokeCount: validComponents.length,
            isSufficient: true,
            isBlank: false,
            isDiagramHeavy: false
        };

        // 14. Normalized 8-element Raw Vector for downstream similarity distance
        // Vector components: [inkDensity, hVarianceNorm, vVarianceNorm, lineSpacingNorm, strokeWidthMeanNorm, strokeWidthVarNorm, slantNorm, ccAspectMeanNorm]
        const rawVector: number[] = [
            Number(Math.min(1.0, inkDensity * 10).toFixed(4)),                        // 0.0 to 1.0 (typical density ~0.05-0.10)
            Number(Math.min(1.0, hVariance * 50).toFixed(4)),                         // Normalized horizontal line structure
            Number(Math.min(1.0, vVariance * 50).toFixed(4)),                         // Normalized vertical grouping
            Number(Math.min(1.0, estimatedLineSpacing / (cropH > 0 ? cropH : 100)).toFixed(4)),
            Number(Math.min(1.0, swMean / 15.0).toFixed(4)),                          // Stroke width proxy mean
            Number(Math.min(1.0, swVariance / 10.0).toFixed(4)),                      // Stroke width proxy variance
            Number(((dominantSlantAngle + 45.0) / 90.0).toFixed(4)),                  // Slant normalized (-45..+45 -> 0..1)
            Number(Math.min(1.0, ccMeanAspectRatio / 3.0).toFixed(4))                // Connected component aspect ratio
        ];

        const features: IHandwritingFeatures = {
            inkDensity: Number(inkDensity.toFixed(4)),
            horizontalProjection: {
                mean: Number(hMean.toFixed(4)),
                variance: Number(hVariance.toFixed(6)),
                peakCount: peaks.length
            },
            verticalProjection: {
                mean: Number(vMean.toFixed(4)),
                variance: Number(vVariance.toFixed(6))
            },
            estimatedLineSpacing: Number(estimatedLineSpacing.toFixed(2)),
            strokeWidthProxy: {
                mean: Number(swMean.toFixed(2)),
                variance: Number(swVariance.toFixed(4)),
                median: Number(swMedian.toFixed(2))
            },
            slantAngle: Number(dominantSlantAngle.toFixed(2)),
            connectedComponents: {
                count: validComponents.length,
                meanArea: Number(ccMeanArea.toFixed(2)),
                meanAspectRatio: Number(ccMeanAspectRatio.toFixed(2))
            },
            normalizedDimensions: {
                width: Number((cropW / image.width).toFixed(4)),
                height: Number((cropH / image.height).toFixed(4))
            },
            quality,
            rawVector
        };

        return {
            status: SampleExtractionStatus.VALID,
            features
        };
    }
}
