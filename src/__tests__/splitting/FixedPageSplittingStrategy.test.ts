import { describe, it, expect } from 'vitest';
import { FixedPageSplittingStrategy } from '../../services/splitting/FixedPageSplittingStrategy';
import { IIngestionPage } from '../../models/IngestionPage';

describe('FixedPageSplittingStrategy', () => {
    it('should split pages into exact groups of N', () => {
        const strategy = new FixedPageSplittingStrategy(3);
        const pages = [
            { fileIndex: 0, pageNumber: 1 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 2 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 3 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 4 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 5 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 6 } as IIngestionPage,
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
        expect(result[1].endPageNumber).toBe(6);
        expect(result[1].pageCount).toBe(3);
        expect(result[1].pages).toEqual([pages[3], pages[4], pages[5]]);
    });

    it('should handle an incomplete final group', () => {
        const strategy = new FixedPageSplittingStrategy(4);
        const pages = [
            { fileIndex: 0, pageNumber: 1 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 2 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 3 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 4 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 5 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 6 } as IIngestionPage,
        ];

        const result = strategy.split(pages);

        expect(result.length).toBe(2);

        expect(result[0].pageCount).toBe(4);
        expect(result[0].startPageNumber).toBe(1);
        expect(result[0].endPageNumber).toBe(4);

        expect(result[1].pageCount).toBe(2);
        expect(result[1].startPageNumber).toBe(5);
        expect(result[1].endPageNumber).toBe(6);
        expect(result[1].pages).toEqual([pages[4], pages[5]]);
    });

    it('should throw an error for invalid N', () => {
        expect(() => new FixedPageSplittingStrategy(0)).toThrow();
        expect(() => new FixedPageSplittingStrategy(-5)).toThrow();
        expect(() => new FixedPageSplittingStrategy(2.5)).toThrow();
    });

    it('should preserve page ordering', () => {
        const strategy = new FixedPageSplittingStrategy(2);
        const pages = [
            { fileIndex: 0, pageNumber: 1 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 2 } as IIngestionPage,
        ];

        const result = strategy.split(pages);
        expect(result[0].pages[0].pageNumber).toBe(1);
        expect(result[0].pages[1].pageNumber).toBe(2);
    });

    it('should preserve file boundaries', () => {
        const strategy = new FixedPageSplittingStrategy(3);
        const pages = [
            { fileIndex: 0, pageNumber: 1 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 2 } as IIngestionPage,
            // FileIndex changes before N is reached
            { fileIndex: 1, pageNumber: 1 } as IIngestionPage,
            { fileIndex: 1, pageNumber: 2 } as IIngestionPage,
            { fileIndex: 1, pageNumber: 3 } as IIngestionPage,
            { fileIndex: 1, pageNumber: 4 } as IIngestionPage,
        ];

        const result = strategy.split(pages);

        expect(result.length).toBe(3);

        // Group 1: File 0, pages 1-2 (incomplete due to file boundary)
        expect(result[0].fileIndex).toBe(0);
        expect(result[0].startPageNumber).toBe(1);
        expect(result[0].endPageNumber).toBe(2);
        expect(result[0].pageCount).toBe(2);

        // Group 2: File 1, pages 1-3
        expect(result[1].fileIndex).toBe(1);
        expect(result[1].startPageNumber).toBe(1);
        expect(result[1].endPageNumber).toBe(3);
        expect(result[1].pageCount).toBe(3);

        // Group 3: File 1, page 4
        expect(result[2].fileIndex).toBe(1);
        expect(result[2].startPageNumber).toBe(4);
        expect(result[2].endPageNumber).toBe(4);
        expect(result[2].pageCount).toBe(1);
    });

    it('should not depend on student identity or QR properties', () => {
        const strategy = new FixedPageSplittingStrategy(2);
        const pages = [
            { fileIndex: 0, pageNumber: 1 } as IIngestionPage,
            { fileIndex: 0, pageNumber: 2 } as IIngestionPage,
        ];

        const result = strategy.split(pages);
        expect(result.length).toBe(1);
        expect(result[0].pageCount).toBe(2);
    });
});
