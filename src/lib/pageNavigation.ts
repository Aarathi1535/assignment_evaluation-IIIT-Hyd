/**
 * Multi-Page Navigation Models and Pure Utilities (AE-125)
 *
 * Provides deterministic sorting, boundary clamping, next/previous transitions,
 * and accessibility-friendly indicator formatting for answer-script pages.
 */

export interface AnswerSheetPage {
  /** Unique identifier for the page (MongoDB ObjectId string or identifier) */
  _id?: string;
  /** Alternate unique identifier */
  id?: string;
  /** 1-based page number within the script or exam */
  pageNumber: number;
  /** Zero-based file index for ordering across multiple files in a batch */
  fileIndex?: number;
  /** Full resolution image URL / API endpoint to stream the page image */
  imageUrl?: string | null;
  /** Thumbnail image URL */
  thumbnailUrl?: string | null;
  /** Direct src or data URI alternative */
  src?: string | null;
  /** Native pixel width if known */
  width?: number;
  /** Native pixel height if known */
  height?: number;
  /** Whether this is a detected cover sheet */
  isCoverPage?: boolean;
  /** Whether this page is flagged as near-blank */
  nearBlank?: boolean;
  /** Whether this page is flagged as duplicate */
  isDuplicate?: boolean;
  /** Optional metadata dictionary */
  metadata?: Record<string, unknown>;
}

/**
 * Deterministically sorts an array of answer-script pages.
 *
 * Sorting precedence:
 * 1. `pageNumber` ascending (1, 2, 3, ... N)
 * 2. `fileIndex` ascending (if available)
 * 3. `_id` / `id` lexicographical (if available)
 * 4. Original index position in the array
 *
 * Does not mutate the input array.
 */
export function sortScriptPages(pages: AnswerSheetPage[]): AnswerSheetPage[] {
  if (!pages || !Array.isArray(pages) || pages.length === 0) {
    return [];
  }

  return [...pages].sort((a, b) => {
    const numA = typeof a.pageNumber === 'number' ? a.pageNumber : 0;
    const numB = typeof b.pageNumber === 'number' ? b.pageNumber : 0;

    if (numA !== numB) {
      return numA - numB;
    }

    const fileA = typeof a.fileIndex === 'number' ? a.fileIndex : 0;
    const fileB = typeof b.fileIndex === 'number' ? b.fileIndex : 0;
    if (fileA !== fileB) {
      return fileA - fileB;
    }

    const idA = String(a._id || a.id || '');
    const idB = String(b._id || b.id || '');
    if (idA !== idB) {
      return idA.localeCompare(idB);
    }

    return 0;
  });
}

/**
 * Clamps a proposed page index strictly within the valid range [0, totalPages - 1].
 * Returns 0 if totalPages <= 0.
 */
export function clampPageIndex(index: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  if (Number.isNaN(index) || index < 0) return 0;
  if (index >= totalPages) return totalPages - 1;
  return Math.floor(index);
}

/**
 * Calculates the next page index with upper boundary clamping.
 */
export function getNextPageIndex(currentIndex: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  return clampPageIndex(currentIndex + 1, totalPages);
}

/**
 * Calculates the previous page index with lower boundary clamping.
 */
export function getPrevPageIndex(currentIndex: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  return clampPageIndex(currentIndex - 1, totalPages);
}

/**
 * Determines whether moving to the next page is possible.
 */
export function canGoNext(currentIndex: number, totalPages: number): boolean {
  if (totalPages <= 1) return false;
  return currentIndex < totalPages - 1 && currentIndex >= 0;
}

/**
 * Determines whether moving to the previous page is possible.
 */
export function canGoPrev(currentIndex: number, totalPages: number): boolean {
  if (totalPages <= 1) return false;
  return currentIndex > 0 && currentIndex < totalPages;
}

/**
 * Formats a human-readable and screen-reader accessible page indicator.
 * Example: "Page 1 of 5"
 */
export function formatPageIndicator(currentPageIndex: number, totalPages: number): string {
  if (totalPages <= 0) {
    return 'No pages';
  }
  const displayCurrent = clampPageIndex(currentPageIndex, totalPages) + 1;
  return `Page ${displayCurrent} of ${totalPages}`;
}

/**
 * Extracts the effective image URL from a page object.
 */
export function getPageImageUrl(page: AnswerSheetPage | null | undefined): string | null {
  if (!page) return null;
  return page.imageUrl || page.src || null;
}
