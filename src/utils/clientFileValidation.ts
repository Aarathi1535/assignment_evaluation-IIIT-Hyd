export const MAX_SINGLE_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_FILES_PER_BATCH = 20;
export const MAX_TOTAL_REQUEST_SIZE = 200 * 1024 * 1024; // 200 MB
export const MAX_PDF_PAGE_COUNT = 200;

export interface FileValidationError {
  fileName: string;
  error: string;
}

/**
 * Parses the PDF content asynchronously on client-side to count pages.
 * Replicates the server-side page counting logic.
 */
export async function countPdfPages(file: File): Promise<number> {
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsBinaryString(file);
  });

  if (!text.includes('%PDF-') && !text.includes('%PDF')) {
    throw new Error('Invalid or corrupted PDF file');
  }

  // Find root Pages dictionary /Count <N>
  const pagesCountRegex = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/g;
  let match: RegExpExecArray | null;
  let maxPagesCount = 0;

  while ((match = pagesCountRegex.exec(text)) !== null) {
    const parsed = parseInt(match[1], 10);
    if (!isNaN(parsed) && parsed > maxPagesCount) {
      maxPagesCount = parsed;
    }
  }

  // Count distinct /Type /Page objects
  const pageObjRegex = /\/Type\s*\/Page(?![sS\w])/g;
  const pageMatches = text.match(pageObjRegex);
  const directPageCount = pageMatches ? pageMatches.length : 0;

  const count = Math.max(maxPagesCount, directPageCount);

  if (count <= 0) {
    if (text.includes('%%EOF') || text.includes('trailer') || text.includes('obj')) {
      if (directPageCount === 0 && maxPagesCount === 0) {
        throw new Error('PDF contains no readable pages');
      }
      return count || 1;
    }
    throw new Error('Invalid or corrupted PDF structure');
  }

  return count;
}

/**
 * Performs client-side validation on selected files.
 * Returns an array of FileValidationErrors.
 */
export function validateFiles(
  files: File[],
  pdfPageCounts: Record<string, number>
): { isValid: boolean; errors: FileValidationError[]; generalError?: string } {
  const errors: FileValidationError[] = [];
  let generalError: string | undefined;

  // 1. Batch size (max files per batch)
  if (files.length > MAX_FILES_PER_BATCH) {
    generalError = `Too many files. The maximum number of files per batch is ${MAX_FILES_PER_BATCH}.`;
  }

  // 2. Individual file size limit and PDF page limit
  let totalSize = 0;
  for (const file of files) {
    totalSize += file.size;

    // Check individual file size (50MB)
    if (file.size > MAX_SINGLE_FILE_SIZE) {
      errors.push({
        fileName: file.name,
        error: `Exceeds single file size limit of 50 MB (size: ${(file.size / (1024 * 1024)).toFixed(1)} MB)`,
      });
    }

    // Check PDF page count if loaded
    if (file.name.toLowerCase().endsWith('.pdf')) {
      const pageCount = pdfPageCounts[file.name];
      if (pageCount !== undefined && pageCount > MAX_PDF_PAGE_COUNT) {
        errors.push({
          fileName: file.name,
          error: `Exceeds maximum PDF page count limit of ${MAX_PDF_PAGE_COUNT} pages (contains ${pageCount} pages)`,
        });
      }
    }
  }

  // 3. Total request size limit (200MB)
  if (totalSize > MAX_TOTAL_REQUEST_SIZE) {
    generalError = `Total request size of ${(totalSize / (1024 * 1024)).toFixed(1)} MB exceeds the maximum limit of ${MAX_TOTAL_REQUEST_SIZE / (1024 * 1024)} MB (200 MB).`;
  }

  return {
    isValid: errors.length === 0 && !generalError,
    errors,
    generalError,
  };
}
