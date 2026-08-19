import { createCanvas, loadImage } from '@napi-rs/canvas';
import { IOMRTemplate } from '../models/Exam';

export enum OMRStatus {
    SUCCESS = 'SUCCESS',
    AMBIGUOUS = 'AMBIGUOUS',
    UNREADABLE = 'UNREADABLE',
    INVALID_CONFIGURATION = 'INVALID_CONFIGURATION'
}

export interface IOMRColumnResult {
    columnIndex: number;
    status: 'SUCCESS' | 'AMBIGUOUS' | 'UNREADABLE';
    selectedValue: string | null;
    strongestValue: string | null;
    strongestFillRatio: number;
    secondStrongestValue: string | null;
    secondStrongestFillRatio: number;
    confidenceMargin: number;
    reason?: string;
}

export interface OMRResult {
    status: OMRStatus;
    studentId: string | null;
    columns: IOMRColumnResult[];
    failureReason?: string;
}

export class OMRReader {
    static readonly DARK_LUMINANCE_THRESHOLD = 180;
    static readonly EMPTY_THRESHOLD = 0.10;
    static readonly MARKED_THRESHOLD = 0.25;
    static readonly MIN_CONFIDENCE_MARGIN = 0.15;

    async readOMR(
        pageImageBuffer: Buffer,
        template: IOMRTemplate | null | undefined
    ): Promise<OMRResult> {
        if (!template || !template.columns || template.columns.length === 0) {
            return {
                status: OMRStatus.INVALID_CONFIGURATION,
                studentId: null,
                columns: [],
                failureReason: 'OMR template is missing or empty'
            };
        }

        // Validate template column indices (must be contiguous starting from 0)
        const sortedCols = [...template.columns].sort((a, b) => a.columnIndex - b.columnIndex);
        for (let i = 0; i < sortedCols.length; i++) {
            if (sortedCols[i].columnIndex !== i) {
                return {
                    status: OMRStatus.INVALID_CONFIGURATION,
                    studentId: null,
                    columns: [],
                    failureReason: 'Column indexes are not contiguous or do not start at 0'
                };
            }
        }

        try {
            const image = await loadImage(pageImageBuffer);
            const width = image.width;
            const height = image.height;

            if (width <= 0 || height <= 0) {
                return {
                    status: OMRStatus.UNREADABLE,
                    studentId: null,
                    columns: [],
                    failureReason: 'Incompatible or corrupt page image dimensions'
                };
            }

            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(image, 0, 0, width, height);

            const columnResults: IOMRColumnResult[] = [];
            let overallStatus = OMRStatus.SUCCESS;

            for (const col of sortedCols) {
                const bubbleResults = [];

                if (!col.bubbles || col.bubbles.length === 0) {
                    return {
                        status: OMRStatus.INVALID_CONFIGURATION,
                        studentId: null,
                        columns: [],
                        failureReason: `Column index ${col.columnIndex} has no configured bubbles`
                    };
                }

                const coordinateSet = new Set<string>();

                for (const bubble of col.bubbles) {
                    // Coordinates validation
                    if (
                        bubble.x < 0 || bubble.x > 1 ||
                        bubble.y < 0 || bubble.y > 1 ||
                        bubble.width <= 0 || bubble.width > 1 ||
                        bubble.height <= 0 || bubble.height > 1 ||
                        bubble.x + bubble.width > 1.000001 ||
                        bubble.y + bubble.height > 1.000001
                    ) {
                        return {
                            status: OMRStatus.INVALID_CONFIGURATION,
                            studentId: null,
                            columns: [],
                            failureReason: `Bubble region for value ${bubble.value} extends outside normalized page bounds`
                        };
                    }

                    // Check for duplicate coordinates to prevent overlapping coordinate errors
                    const coordKey = `${bubble.x.toFixed(4)},${bubble.y.toFixed(4)}`;
                    if (coordinateSet.has(coordKey)) {
                        return {
                            status: OMRStatus.INVALID_CONFIGURATION,
                            studentId: null,
                            columns: [],
                            failureReason: `Duplicate bubble coordinate conflict detected at (${bubble.x}, ${bubble.y})`
                        };
                    }
                    coordinateSet.add(coordKey);

                    // Convert to pixel coordinates
                    const pixelX = Math.round(bubble.x * width);
                    const pixelY = Math.round(bubble.y * height);
                    const pixelWidth = Math.round(bubble.width * width);
                    const pixelHeight = Math.round(bubble.height * height);

                    // Crop region to avoid border outline effects (15% inset)
                    const insetX = Math.round(pixelWidth * 0.15);
                    const insetY = Math.round(pixelHeight * 0.15);
                    const scanX = pixelX + insetX;
                    const scanY = pixelY + insetY;
                    const scanWidth = Math.max(1, pixelWidth - 2 * insetX);
                    const scanHeight = Math.max(1, pixelHeight - 2 * insetY);

                    // Extract pixel data
                    const imgData = ctx.getImageData(scanX, scanY, scanWidth, scanHeight);
                    const data = imgData.data;

                    let darkPixelCount = 0;
                    const totalPixels = scanWidth * scanHeight;

                    for (let i = 0; i < totalPixels; i++) {
                        const idx = i * 4;
                        const r = data[idx];
                        const g = data[idx + 1];
                        const b = data[idx + 2];
                        const luminance = 0.299 * r + 0.587 * g + 0.114 * b;

                        if (luminance < OMRReader.DARK_LUMINANCE_THRESHOLD) {
                            darkPixelCount++;
                        }
                    }

                    const fillRatio = totalPixels > 0 ? darkPixelCount / totalPixels : 0;
                    bubbleResults.push({
                        value: bubble.value,
                        fillRatio
                    });
                }

                // Sort bubbles by fill ratio descending
                bubbleResults.sort((a, b) => b.fillRatio - a.fillRatio);

                const strongest = bubbleResults[0];
                const secondStrongest = bubbleResults[1] || { value: null, fillRatio: 0 };
                const confidenceMargin = strongest ? strongest.fillRatio - secondStrongest.fillRatio : 0;

                let colStatus: 'SUCCESS' | 'AMBIGUOUS' | 'UNREADABLE' = 'SUCCESS';
                let selectedValue: string | null = null;
                let reason: string | undefined = undefined;

                if (!strongest) {
                    colStatus = 'UNREADABLE';
                    reason = 'No bubbles configured in column';
                } else if (strongest.fillRatio < OMRReader.EMPTY_THRESHOLD) {
                    colStatus = 'UNREADABLE';
                    reason = 'Column is completely empty/unmarked';
                } else if (strongest.fillRatio < OMRReader.MARKED_THRESHOLD) {
                    colStatus = 'AMBIGUOUS';
                    reason = `Strongest bubble is ambiguous (fill ratio ${strongest.fillRatio.toFixed(3)})`;
                } else if (secondStrongest && secondStrongest.fillRatio >= OMRReader.MARKED_THRESHOLD) {
                    colStatus = 'AMBIGUOUS';
                    reason = `Multiple bubbles are marked in column (${strongest.value} and ${secondStrongest.value})`;
                } else if (confidenceMargin < OMRReader.MIN_CONFIDENCE_MARGIN) {
                    colStatus = 'AMBIGUOUS';
                    reason = `Insufficient confidence margin between candidates (${confidenceMargin.toFixed(3)})`;
                } else {
                    colStatus = 'SUCCESS';
                    selectedValue = strongest.value;
                }

                if (colStatus !== 'SUCCESS') {
                    if (colStatus === 'AMBIGUOUS') {
                        overallStatus = OMRStatus.AMBIGUOUS;
                    } else if (colStatus === 'UNREADABLE' && overallStatus !== OMRStatus.AMBIGUOUS) {
                        overallStatus = OMRStatus.UNREADABLE;
                    }
                }

                columnResults.push({
                    columnIndex: col.columnIndex,
                    status: colStatus,
                    selectedValue,
                    strongestValue: strongest ? strongest.value : null,
                    strongestFillRatio: strongest ? strongest.fillRatio : 0,
                    secondStrongestValue: secondStrongest ? secondStrongest.value : null,
                    secondStrongestFillRatio: secondStrongest ? secondStrongest.fillRatio : 0,
                    confidenceMargin,
                    reason
                });
            }

            const studentId = overallStatus === OMRStatus.SUCCESS
                ? columnResults.map(r => r.selectedValue).join('')
                : null;

            return {
                status: overallStatus,
                studentId,
                columns: columnResults
            };

        } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            return {
                status: OMRStatus.UNREADABLE,
                studentId: null,
                columns: [],
                failureReason: `Failed to load page image: ${errorMsg}`
            };
        }
    }
}

export const defaultOMRReader = new OMRReader();
export default defaultOMRReader;
