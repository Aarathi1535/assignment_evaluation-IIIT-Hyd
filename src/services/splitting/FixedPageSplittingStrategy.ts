import { IIngestionPage } from '../../models/IngestionPage';
import { PageSplittingStrategy, ScriptRange } from './PageSplittingStrategy';

/**
 * Fixed-page script splitting strategy.
 * 
 * Rules:
 * - Constructor accepts a fixed page count N.
 * - Throws an error if N <= 0 or not an integer.
 * - Groups pages of each file into contiguous script ranges of size N.
 * - Preserves page ordering.
 * - Preserves file boundaries: when fileIndex changes, the active range is closed.
 * - Supports incomplete final ranges (where pageCount < N).
 */
export class FixedPageSplittingStrategy implements PageSplittingStrategy {
    private fixedPageCount: number;

    constructor(fixedPageCount: number) {
        if (fixedPageCount <= 0 || !Number.isInteger(fixedPageCount)) {
            throw new Error('Fixed page count must be a positive integer greater than zero');
        }
        this.fixedPageCount = fixedPageCount;
    }

    split(pages: IIngestionPage[]): ScriptRange[] {
        const ranges: ScriptRange[] = [];
        let currentRange: ScriptRange | null = null;
        let currentFileIndex: number | null = null;

        for (const page of pages) {
            const fileBoundaryCrossed = currentFileIndex !== null && page.fileIndex !== currentFileIndex;
            const limitReached = currentRange !== null && currentRange.pageCount >= this.fixedPageCount;

            if (fileBoundaryCrossed || limitReached) {
                if (currentRange) {
                    ranges.push(currentRange);
                    currentRange = null;
                }
            }

            currentFileIndex = page.fileIndex;

            if (currentRange === null) {
                currentRange = {
                    fileIndex: page.fileIndex,
                    startPageNumber: page.pageNumber,
                    endPageNumber: page.pageNumber,
                    pageCount: 1,
                    pages: [page]
                };
            } else {
                currentRange.endPageNumber = page.pageNumber;
                currentRange.pageCount += 1;
                currentRange.pages.push(page);
            }
        }

        if (currentRange) {
            ranges.push(currentRange);
        }

        return ranges;
    }
}
