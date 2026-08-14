import { IIngestionPage } from '../../models/IngestionPage';
import { PageSplittingStrategy, ScriptRange } from './PageSplittingStrategy';

/**
 * CoverSheet-based page splitting strategy.
 * 
 * Rules:
 * - First detected cover (isCoverPage === true) starts a script range.
 * - Subsequent non-cover pages belong to the active script range.
 * - Next detected cover starts a new script range.
 * - Pages before the first cover are NOT silently grouped; they are omitted (no-cover behavior).
 * - If no cover pages are detected, an empty array is returned.
 */
export class CoverBoundarySplittingStrategy implements PageSplittingStrategy {
    split(pages: IIngestionPage[]): ScriptRange[] {
        const ranges: ScriptRange[] = [];
        let currentRange: ScriptRange | null = null;
        let currentFileIndex: number | null = null;

        for (const page of pages) {
            // Check if file boundary crossed
            if (currentFileIndex !== null && page.fileIndex !== currentFileIndex) {
                if (currentRange) {
                    ranges.push(currentRange);
                    currentRange = null;
                }
            }
            currentFileIndex = page.fileIndex;

            if (page.isCoverPage === true) {
                if (currentRange) {
                    ranges.push(currentRange);
                }
                currentRange = {
                    fileIndex: page.fileIndex,
                    startPageNumber: page.pageNumber,
                    endPageNumber: page.pageNumber,
                    pageCount: 1,
                    pages: [page]
                };
            } else if (currentRange) {
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
