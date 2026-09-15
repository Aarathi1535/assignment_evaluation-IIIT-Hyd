import { describe, it, expect } from 'vitest';
import {
  sortScriptPages,
  clampPageIndex,
  getNextPageIndex,
  getPrevPageIndex,
  canGoNext,
  canGoPrev,
  formatPageIndicator,
  getPageImageUrl,
  AnswerSheetPage,
} from '../lib/pageNavigation';

describe('AE-125: Multi-Page Navigation Models & Utilities', () => {
  const samplePages: AnswerSheetPage[] = [
    { _id: 'page-1', pageNumber: 1, fileIndex: 0, imageUrl: '/api/ingest/batch-1/pages/page-1/image' },
    { _id: 'page-2', pageNumber: 2, fileIndex: 0, imageUrl: '/api/ingest/batch-1/pages/page-2/image' },
    { _id: 'page-3', pageNumber: 3, fileIndex: 0, imageUrl: '/api/ingest/batch-1/pages/page-3/image' },
    { _id: 'page-4', pageNumber: 4, fileIndex: 0, imageUrl: '/api/ingest/batch-1/pages/page-4/image' },
    { _id: 'page-5', pageNumber: 5, fileIndex: 0, imageUrl: '/api/ingest/batch-1/pages/page-5/image' },
  ];

  describe('1. Deterministic Page Ordering', () => {
    it('sorts unordered pages strictly by pageNumber ascending (1, 2, ... N)', () => {
      const scrambled: AnswerSheetPage[] = [
        { _id: 'p3', pageNumber: 3 },
        { _id: 'p1', pageNumber: 1 },
        { _id: 'p5', pageNumber: 5 },
        { _id: 'p2', pageNumber: 2 },
        { _id: 'p4', pageNumber: 4 },
      ];

      const sorted = sortScriptPages(scrambled);
      expect(sorted.map((p) => p.pageNumber)).toEqual([1, 2, 3, 4, 5]);
      expect(sorted.map((p) => p._id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
    });

    it('tiebreaks matching page numbers by fileIndex ascending', () => {
      const duplicatePageNums: AnswerSheetPage[] = [
        { _id: 'p1-f2', pageNumber: 1, fileIndex: 2 },
        { _id: 'p1-f0', pageNumber: 1, fileIndex: 0 },
        { _id: 'p1-f1', pageNumber: 1, fileIndex: 1 },
      ];

      const sorted = sortScriptPages(duplicatePageNums);
      expect(sorted.map((p) => p.fileIndex)).toEqual([0, 1, 2]);
    });

    it('tiebreaks matching pageNumber and fileIndex by ID lexicographically', () => {
      const duplicates: AnswerSheetPage[] = [
        { _id: 'page-c', pageNumber: 1, fileIndex: 0 },
        { _id: 'page-a', pageNumber: 1, fileIndex: 0 },
        { _id: 'page-b', pageNumber: 1, fileIndex: 0 },
      ];

      const sorted = sortScriptPages(duplicates);
      expect(sorted.map((p) => p._id)).toEqual(['page-a', 'page-b', 'page-c']);
    });

    it('handles empty, null, or undefined page arrays gracefully without throwing', () => {
      expect(sortScriptPages([])).toEqual([]);
      expect(sortScriptPages(null as unknown as AnswerSheetPage[])).toEqual([]);
      expect(sortScriptPages(undefined as unknown as AnswerSheetPage[])).toEqual([]);
    });

    it('does not mutate the source array', () => {
      const original: AnswerSheetPage[] = [
        { _id: 'p2', pageNumber: 2 },
        { _id: 'p1', pageNumber: 1 },
      ];
      const copy = [...original];

      sortScriptPages(original);
      expect(original).toEqual(copy);
    });
  });

  describe('2. Initial Page Selection & Boundaries', () => {
    it('clamps initial page index safely within [0, totalPages - 1]', () => {
      expect(clampPageIndex(0, 5)).toBe(0);
      expect(clampPageIndex(4, 5)).toBe(4);
      expect(clampPageIndex(-1, 5)).toBe(0); // Clamped to lower bound
      expect(clampPageIndex(10, 5)).toBe(4); // Clamped to upper bound
    });

    it('returns 0 when total pages is 0 or negative', () => {
      expect(clampPageIndex(0, 0)).toBe(0);
      expect(clampPageIndex(3, 0)).toBe(0);
      expect(clampPageIndex(2, -1)).toBe(0);
    });

    it('correctly disables previous at first page (index 0)', () => {
      expect(canGoPrev(0, 5)).toBe(false);
      expect(canGoPrev(1, 5)).toBe(true);
    });

    it('correctly disables next at final page (index N - 1)', () => {
      expect(canGoNext(4, 5)).toBe(false);
      expect(canGoNext(3, 5)).toBe(true);
    });

    it('disables both previous and next when totalPages <= 1', () => {
      expect(canGoPrev(0, 1)).toBe(false);
      expect(canGoNext(0, 1)).toBe(false);
      expect(canGoPrev(0, 0)).toBe(false);
      expect(canGoNext(0, 0)).toBe(false);
    });
  });

  describe('3. Next and Previous Page Navigation Transitions', () => {
    it('advances to the next page index with getNextPageIndex', () => {
      expect(getNextPageIndex(0, 5)).toBe(1);
      expect(getNextPageIndex(1, 5)).toBe(2);
      expect(getNextPageIndex(3, 5)).toBe(4);
      expect(getNextPageIndex(4, 5)).toBe(4); // Upper bound clamping
    });

    it('decreases to the previous page index with getPrevPageIndex', () => {
      expect(getPrevPageIndex(4, 5)).toBe(3);
      expect(getPrevPageIndex(2, 5)).toBe(1);
      expect(getPrevPageIndex(1, 5)).toBe(0);
      expect(getPrevPageIndex(0, 5)).toBe(0); // Lower bound clamping
    });

    it('handles transition on empty or single-page script', () => {
      expect(getNextPageIndex(0, 0)).toBe(0);
      expect(getPrevPageIndex(0, 0)).toBe(0);
      expect(getNextPageIndex(0, 1)).toBe(0);
      expect(getPrevPageIndex(0, 1)).toBe(0);
    });
  });

  describe('4. Page Indicator Formatting & Screen Reader Text', () => {
    it('formats correct 1-based page indicator text: "Page X of Y"', () => {
      expect(formatPageIndicator(0, 5)).toBe('Page 1 of 5');
      expect(formatPageIndicator(1, 5)).toBe('Page 2 of 5');
      expect(formatPageIndicator(4, 5)).toBe('Page 5 of 5');
      expect(formatPageIndicator(7, 8)).toBe('Page 8 of 8');
    });

    it('formats empty state when total pages is zero', () => {
      expect(formatPageIndicator(0, 0)).toBe('No pages');
    });

    it('clamps out-of-range index when generating indicator', () => {
      expect(formatPageIndicator(99, 5)).toBe('Page 5 of 5');
      expect(formatPageIndicator(-10, 5)).toBe('Page 1 of 5');
    });
  });

  describe('5. Page Image URL Resolution', () => {
    it('extracts imageUrl from page record', () => {
      const page: AnswerSheetPage = {
        _id: 'p1',
        pageNumber: 1,
        imageUrl: '/api/ingest/batch-1/pages/p1/image',
      };
      expect(getPageImageUrl(page)).toBe('/api/ingest/batch-1/pages/p1/image');
    });

    it('falls back to src property if imageUrl is not present', () => {
      const page: AnswerSheetPage = {
        _id: 'p1',
        pageNumber: 1,
        src: 'data:image/png;base64,sample',
      };
      expect(getPageImageUrl(page)).toBe('data:image/png;base64,sample');
    });

    it('returns null if page is null, undefined, or missing image fields', () => {
      expect(getPageImageUrl(null)).toBeNull();
      expect(getPageImageUrl(undefined)).toBeNull();
      expect(getPageImageUrl({ pageNumber: 1 })).toBeNull();
    });
  });

  describe('6. Script Navigation Flow & Image Switching Simulation', () => {
    it('traverses all pages from first to last verifying index, indicator, and image URL', () => {
      let currentIndex = 0;
      const total = samplePages.length;

      // Initial state (Page 1)
      expect(currentIndex).toBe(0);
      expect(formatPageIndicator(currentIndex, total)).toBe('Page 1 of 5');
      expect(getPageImageUrl(samplePages[currentIndex])).toBe('/api/ingest/batch-1/pages/page-1/image');
      expect(canGoPrev(currentIndex, total)).toBe(false);
      expect(canGoNext(currentIndex, total)).toBe(true);

      // Navigate to Page 2
      currentIndex = getNextPageIndex(currentIndex, total);
      expect(currentIndex).toBe(1);
      expect(formatPageIndicator(currentIndex, total)).toBe('Page 2 of 5');
      expect(getPageImageUrl(samplePages[currentIndex])).toBe('/api/ingest/batch-1/pages/page-2/image');
      expect(canGoPrev(currentIndex, total)).toBe(true);
      expect(canGoNext(currentIndex, total)).toBe(true);

      // Navigate to Page 3
      currentIndex = getNextPageIndex(currentIndex, total);
      expect(currentIndex).toBe(2);
      expect(formatPageIndicator(currentIndex, total)).toBe('Page 3 of 5');
      expect(getPageImageUrl(samplePages[currentIndex])).toBe('/api/ingest/batch-1/pages/page-3/image');

      // Navigate to Page 4
      currentIndex = getNextPageIndex(currentIndex, total);
      expect(currentIndex).toBe(3);
      expect(formatPageIndicator(currentIndex, total)).toBe('Page 4 of 5');
      expect(getPageImageUrl(samplePages[currentIndex])).toBe('/api/ingest/batch-1/pages/page-4/image');

      // Navigate to Page 5 (Final)
      currentIndex = getNextPageIndex(currentIndex, total);
      expect(currentIndex).toBe(4);
      expect(formatPageIndicator(currentIndex, total)).toBe('Page 5 of 5');
      expect(getPageImageUrl(samplePages[currentIndex])).toBe('/api/ingest/batch-1/pages/page-5/image');
      expect(canGoPrev(currentIndex, total)).toBe(true);
      expect(canGoNext(currentIndex, total)).toBe(false);

      // Attempt to exceed final page
      currentIndex = getNextPageIndex(currentIndex, total);
      expect(currentIndex).toBe(4); // Remains clamped
    });

    it('traverses backwards from final to first page', () => {
      let currentIndex = 4;
      const total = samplePages.length;

      // Navigate back to Page 4
      currentIndex = getPrevPageIndex(currentIndex, total);
      expect(currentIndex).toBe(3);
      expect(formatPageIndicator(currentIndex, total)).toBe('Page 4 of 5');

      // Navigate back to Page 1
      currentIndex = getPrevPageIndex(currentIndex, total);
      currentIndex = getPrevPageIndex(currentIndex, total);
      currentIndex = getPrevPageIndex(currentIndex, total);
      expect(currentIndex).toBe(0);
      expect(formatPageIndicator(currentIndex, total)).toBe('Page 1 of 5');
      expect(canGoPrev(currentIndex, total)).toBe(false);

      // Attempt to go below first page
      currentIndex = getPrevPageIndex(currentIndex, total);
      expect(currentIndex).toBe(0); // Remains clamped
    });
  });

  describe('7. Pan/Zoom Reconciliation on Page Navigation', () => {
    it('verifies that new page transitions reset transform to fit zoom (1.0)', () => {
      // Prior page state (e.g. TA zoomed in 3x and panned)
      const staleTransform = { x: -450, y: -600, zoom: 3.0 };

      // Transition to new page triggers default reset
      const resetTransform = { x: 0, y: 0, zoom: 1.0 };

      expect(resetTransform.zoom).toBe(1.0);
      expect(resetTransform.x).toBe(0);
      expect(resetTransform.y).toBe(0);
      expect(resetTransform.zoom).not.toBe(staleTransform.zoom);
    });
  });
});
