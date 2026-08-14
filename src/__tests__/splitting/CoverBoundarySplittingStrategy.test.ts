import { describe, it, expect } from 'vitest';
import { CoverBoundarySplittingStrategy } from '../../services/splitting/CoverBoundarySplittingStrategy';
import { IIngestionPage } from '../../models/IngestionPage';

describe('CoverBoundarySplittingStrategy', () => {
    const strategy = new CoverBoundarySplittingStrategy();

    it('should split pages correctly with cover boundaries', () => {
        const pages = [
            { fileIndex: 0, pageNumber: 1, isCoverPage: true } as IIngestionPage,
            { fileIndex: 0, pageNumber: 2, isCoverPage: false } as IIngestionPage,
            { fileIndex: 0, pageNumber: 3, isCoverPage: false } as IIngestionPage,
            { fileIndex: 0, pageNumber: 4, isCoverPage: true } as IIngestionPage,
            { fileIndex: 0, pageNumber: 5, isCoverPage: false } as IIngestionPage,
        ];

        const result = strategy.split(pages);

        expect(result.length).toBe(2);

        expect(result[0].fileIndex).toBe(0);
        expect(result[0].startPageNumber).toBe(1);
        expect(result[0].endPageNumber).toBe(3);
        expect(result[0].pageCount).toBe(3);
        expect(result[0].pages).toEqual([pages[0], pages[1], pages[2]]);

        expect(result[1].fileIndex).toBe(0);
        expect(result[1].startPageNumber).toBe(4);
        expect(result[1].endPageNumber).toBe(5);
        expect(result[1].pageCount).toBe(2);
        expect(result[1].pages).toEqual([pages[3], pages[4]]);
    });

    it('should return empty array if no cover page is detected', () => {
        const pages = [
            { fileIndex: 0, pageNumber: 1, isCoverPage: false } as IIngestionPage,
            { fileIndex: 0, pageNumber: 2, isCoverPage: false } as IIngestionPage,
        ];

        const result = strategy.split(pages);

        expect(result).toEqual([]);
    });

    it('should skip pages before the first cover page', () => {
        const pages = [
            { fileIndex: 0, pageNumber: 1, isCoverPage: false } as IIngestionPage,
            { fileIndex: 0, pageNumber: 2, isCoverPage: true } as IIngestionPage,
            { fileIndex: 0, pageNumber: 3, isCoverPage: false } as IIngestionPage,
        ];

        const result = strategy.split(pages);

        expect(result.length).toBe(1);
        expect(result[0].startPageNumber).toBe(2);
        expect(result[0].endPageNumber).toBe(3);
        expect(result[0].pageCount).toBe(2);
        expect(result[0].pages).toEqual([pages[1], pages[2]]);
    });

    it('should preserve ordering of pages in split output ranges', () => {
        const pages = [
            { fileIndex: 0, pageNumber: 1, isCoverPage: true } as IIngestionPage,
            { fileIndex: 0, pageNumber: 2, isCoverPage: false } as IIngestionPage,
            { fileIndex: 1, pageNumber: 1, isCoverPage: true } as IIngestionPage,
            { fileIndex: 1, pageNumber: 2, isCoverPage: false } as IIngestionPage,
        ];

        const result = strategy.split(pages);

        expect(result.length).toBe(2);
        expect(result[0].fileIndex).toBe(0);
        expect(result[0].startPageNumber).toBe(1);
        expect(result[1].fileIndex).toBe(1);
        expect(result[1].startPageNumber).toBe(1);
    });

    it('should preserve file boundaries and not append pages from different fileIndex to previous range', () => {
        const pages = [
            { fileIndex: 0, pageNumber: 1, isCoverPage: true } as IIngestionPage,
            { fileIndex: 0, pageNumber: 2, isCoverPage: false } as IIngestionPage,
            // File 1 starts, with no cover page first, and should not be appended to file 0's range
            { fileIndex: 1, pageNumber: 1, isCoverPage: false } as IIngestionPage,
            { fileIndex: 1, pageNumber: 2, isCoverPage: true } as IIngestionPage,
            { fileIndex: 1, pageNumber: 3, isCoverPage: false } as IIngestionPage,
        ];

        const result = strategy.split(pages);

        expect(result.length).toBe(2);

        // First range must be from file 0 only
        expect(result[0].fileIndex).toBe(0);
        expect(result[0].startPageNumber).toBe(1);
        expect(result[0].endPageNumber).toBe(2);
        expect(result[0].pages).toEqual([pages[0], pages[1]]);

        // Second range must be from file 1 only
        expect(result[1].fileIndex).toBe(1);
        expect(result[1].startPageNumber).toBe(2);
        expect(result[1].endPageNumber).toBe(3);
        expect(result[1].pages).toEqual([pages[3], pages[4]]);
    });
});

