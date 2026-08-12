import { createCanvas, loadImage, SKRSContext2D } from '@napi-rs/canvas';
import * as zxing from '@zxing/library';
import { DecodeOutcome } from '../models/IngestionPage';

export interface CoverSheetDetectionResult {
    isCoverPage: boolean;
    decodeOutcome: DecodeOutcome | null;
    candidateStudentId: string | null;
    metadata?: Record<string, unknown>;
}

export interface ICoverSheetDetector {
    detectCoverSheet(
        pageImageBuffer: Buffer,
        pageNumber: number
    ): Promise<CoverSheetDetectionResult>;
}

/**
 * Standard implementation of QR and Barcode Cover-Sheet Detector (AE-050).
 * Scans only page 1 (cover page) of normalized page images using @zxing/library and @napi-rs/canvas.
 */
export class CoverSheetDetector implements ICoverSheetDetector {
    private supportedFormats: zxing.BarcodeFormat[] = [
        zxing.BarcodeFormat.QR_CODE,
        zxing.BarcodeFormat.CODE_128,
        zxing.BarcodeFormat.CODE_39,
        zxing.BarcodeFormat.EAN_13,
        zxing.BarcodeFormat.PDF_417,
        zxing.BarcodeFormat.DATA_MATRIX,
        zxing.BarcodeFormat.ITF,
        zxing.BarcodeFormat.AZTEC
    ];

    /**
     * Detects QR or barcode on the canonical normalized page image.
     * Guaranteed not to scan non-cover pages (pageNumber > 1), and produces controlled
     * results without failing ingestion on missing or malformed barcodes.
     */
    async detectCoverSheet(
        pageImageBuffer: Buffer,
        pageNumber: number
    ): Promise<CoverSheetDetectionResult> {
        // Enforce: only scan page 1 (cover page)
        if (pageNumber !== 1) {
            return {
                isCoverPage: false,
                decodeOutcome: null,
                candidateStudentId: null
            };
        }

        if (!pageImageBuffer || pageImageBuffer.length === 0) {
            return {
                isCoverPage: true,
                decodeOutcome: 'not_found',
                candidateStudentId: null
            };
        }

        try {
            const image = await loadImage(pageImageBuffer);
            const width = image.width;
            const height = image.height;

            if (width <= 0 || height <= 0) {
                return {
                    isCoverPage: true,
                    decodeOutcome: 'not_found',
                    candidateStudentId: null
                };
            }

            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, width, height);

            const detectedCodes = new Set<string>();

            const hints = new Map<zxing.DecodeHintType, unknown>();
            hints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, this.supportedFormats);
            hints.set(zxing.DecodeHintType.TRY_HARDER, true);

            const reader = new zxing.MultiFormatReader();
            reader.setHints(hints);

            // 1. Scan full canvas
            this.scanRegion(ctx, 0, 0, width, height, reader, detectedCodes);

            // 2. Scan sub-regions (quadrants and halves) to discover multiple codes or localized codes
            if (width >= 100 && height >= 100) {
                const halfW = Math.floor(width / 2);
                const halfH = Math.floor(height / 2);

                // Four quadrants
                this.scanRegion(ctx, 0, 0, halfW, halfH, reader, detectedCodes);
                this.scanRegion(ctx, halfW, 0, width - halfW, halfH, reader, detectedCodes);
                this.scanRegion(ctx, 0, halfH, halfW, height - halfH, reader, detectedCodes);
                this.scanRegion(ctx, halfW, halfH, width - halfW, height - halfH, reader, detectedCodes);

                // Top / bottom halves
                this.scanRegion(ctx, 0, 0, width, halfH, reader, detectedCodes);
                this.scanRegion(ctx, 0, halfH, width, height - halfH, reader, detectedCodes);

                // Left / right halves
                this.scanRegion(ctx, 0, 0, halfW, height, reader, detectedCodes);
                this.scanRegion(ctx, halfW, 0, width - halfW, height, reader, detectedCodes);
            }

            const uniqueCodes = Array.from(detectedCodes);

            if (uniqueCodes.length === 1) {
                const rawCode = uniqueCodes[0];
                let parsedExamId: string | undefined;
                let parsedStudentId: string | undefined;

                if (rawCode.includes(':')) {
                    const parts = rawCode.split(':');
                    if (parts.length === 2 && parts[0] && parts[1]) {
                        parsedExamId = parts[0];
                        parsedStudentId = parts[1];
                    }
                }

                return {
                    isCoverPage: true,
                    decodeOutcome: 'found',
                    candidateStudentId: rawCode,
                    metadata: {
                        detectedCount: 1,
                        code: rawCode,
                        rawPayload: rawCode,
                        ...(parsedExamId && parsedStudentId
                            ? { examId: parsedExamId, studentId: parsedStudentId }
                            : {})
                    }
                };
            } else if (uniqueCodes.length > 1) {
                return {
                    isCoverPage: true,
                    decodeOutcome: 'multiple',
                    candidateStudentId: null,
                    metadata: {
                        detectedCount: uniqueCodes.length,
                        codes: uniqueCodes
                    }
                };
            } else {
                return {
                    isCoverPage: true,
                    decodeOutcome: 'not_found',
                    candidateStudentId: null,
                    metadata: {
                        detectedCount: 0
                    }
                };
            }
        } catch {
            // Controlled fallback: missing or unreadable codes must not fail ingestion
            return {
                isCoverPage: true,
                decodeOutcome: 'not_found',
                candidateStudentId: null
            };
        }
    }

    private scanRegion(
        ctx: SKRSContext2D,
        sx: number,
        sy: number,
        sw: number,
        sh: number,
        reader: zxing.MultiFormatReader,
        detectedCodes: Set<string>
    ): void {
        if (sw < 20 || sh < 20) return;

        try {
            const imgData = ctx.getImageData(sx, sy, sw, sh);
            const luminances = new Uint8ClampedArray(sw * sh);
            const data = imgData.data;

            for (let i = 0; i < sw * sh; i++) {
                const off = i * 4;
                luminances[i] = ((data[off] + 2 * data[off + 1] + data[off + 2]) / 4) & 0xff;
            }

            const lumSource = new zxing.RGBLuminanceSource(luminances, sw, sh);

            // Try HybridBinarizer first
            let result: zxing.Result | null = null;
            try {
                const hybridBitmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(lumSource));
                result = reader.decode(hybridBitmap);
            } catch {
                // Fallback to GlobalHistogramBinarizer
                try {
                    const globalBitmap = new zxing.BinaryBitmap(new zxing.GlobalHistogramBinarizer(lumSource));
                    result = reader.decode(globalBitmap);
                } catch {
                    result = null;
                }
            }

            if (result) {
                const text = result.getText()?.trim();
                if (text) {
                    detectedCodes.add(text);
                }
            }
        } catch {
            // Non-fatal: region did not yield a code
        }
    }
}

export const defaultCoverSheetDetector = new CoverSheetDetector();
export default defaultCoverSheetDetector;
