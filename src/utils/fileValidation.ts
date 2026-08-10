import { HttpError } from '../lib/errors';

export const MAX_SINGLE_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_FILES_PER_BATCH = 20; // 20 files
export const MAX_TOTAL_REQUEST_SIZE = 200 * 1024 * 1024; // 200 MB
export const MAX_PDF_PAGE_COUNT = 200; // 200 pages

export interface DetectedFileType {
    mimeType: string;
    extension: string;
    category: 'pdf' | 'image';
}

/**
 * Inspects the initial bytes (magic numbers) of the buffer to determine
 * the actual file type without trusting Content-Type headers or file extensions.
 */
export function detectFileTypeByMagicBytes(buffer: Buffer): DetectedFileType | null {
    if (!buffer || buffer.length < 4) {
        return null;
    }

    // PDF Magic Bytes: %PDF (0x25 0x50 0x44 0x46)
    // Spec allows header within first 1024 bytes
    const checkLength = Math.min(buffer.length, 1024);
    const headerSlice = buffer.subarray(0, checkLength);
    const pdfIndex = headerSlice.indexOf(Buffer.from([0x25, 0x50, 0x44, 0x46]));
    if (pdfIndex !== -1 && pdfIndex <= 1024) {
        return {
            mimeType: 'application/pdf',
            extension: 'pdf',
            category: 'pdf'
        };
    }

    // JPEG / JPG: 0xFF 0xD8 0xFF
    if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return {
            mimeType: 'image/jpeg',
            extension: 'jpg',
            category: 'image'
        };
    }

    // PNG: 0x89 0x50 0x4E 0x47 0x0D 0x0A 0x1A 0x0A
    if (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
    ) {
        return {
            mimeType: 'image/png',
            extension: 'png',
            category: 'image'
        };
    }

    // WebP: RIFF (0x52 0x49 0x46 0x46) at 0..3 and WEBP (0x57 0x45 0x42 0x50) at 8..11
    if (
        buffer.length >= 12 &&
        buffer[0] === 0x52 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x46 &&
        buffer[8] === 0x57 &&
        buffer[9] === 0x45 &&
        buffer[10] === 0x42 &&
        buffer[11] === 0x50
    ) {
        return {
            mimeType: 'image/webp',
            extension: 'webp',
            category: 'image'
        };
    }

    // TIFF (Little Endian: II*\0 = 0x49 0x49 0x2A 0x00 / Big Endian: MM\0* = 0x4D 0x4D 0x00 0x2A)
    if (
        (buffer.length >= 4 &&
            buffer[0] === 0x49 &&
            buffer[1] === 0x49 &&
            buffer[2] === 0x2a &&
            buffer[3] === 0x00) ||
        (buffer.length >= 4 &&
            buffer[0] === 0x4d &&
            buffer[1] === 0x4d &&
            buffer[2] === 0x00 &&
            buffer[3] === 0x2a)
    ) {
        return {
            mimeType: 'image/tiff',
            extension: 'tiff',
            category: 'image'
        };
    }

    // GIF: GIF87a or GIF89a (0x47 0x49 0x46 0x38 0x37/0x39 0x61)
    if (
        buffer.length >= 6 &&
        buffer[0] === 0x47 &&
        buffer[1] === 0x49 &&
        buffer[2] === 0x46 &&
        buffer[3] === 0x38 &&
        (buffer[4] === 0x37 || buffer[4] === 0x39) &&
        buffer[5] === 0x61
    ) {
        return {
            mimeType: 'image/gif',
            extension: 'gif',
            category: 'image'
        };
    }

    return null;
}

/**
 * Checks whether a PDF contains an /Encrypt dictionary.
 */
export function isPdfEncrypted(buffer: Buffer): boolean {
    const text = buffer.toString('latin1');
    // PDF encryption dictionary is indicated by /Encrypt followed by a reference or inline dict
    const encryptRegex = /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/;
    return encryptRegex.test(text);
}

/**
 * Safely parses the PDF structure to count the total number of pages.
 * Throws HttpError(400) if the PDF is corrupt or invalid.
 */
export function getPdfPageCount(buffer: Buffer): number {
    const text = buffer.toString('latin1');

    // Quick sanity check: Must have PDF header and EOF marker
    if (!text.includes('%PDF-') && !text.includes('%PDF')) {
        throw new HttpError('Invalid or corrupted PDF file', 400);
    }

    // First attempt: Search for root Pages dictionary /Count <N>
    // e.g. /Type /Pages ... /Count 12
    const pagesCountRegex = /\/Type\s*\/Pages[\s\S]*?\/Count\s+(\d+)/g;
    let match: RegExpExecArray | null;
    let maxPagesCount = 0;

    while ((match = pagesCountRegex.exec(text)) !== null) {
        const parsed = parseInt(match[1], 10);
        if (!isNaN(parsed) && parsed > maxPagesCount) {
            maxPagesCount = parsed;
        }
    }

    // Second attempt: Count /Type /Page objects (distinct from /Type /Pages)
    // Matches /Type /Page or /Type/Page with negative lookahead for 's'
    const pageObjRegex = /\/Type\s*\/Page(?![sS\w])/g;
    const pageMatches = text.match(pageObjRegex);
    const directPageCount = pageMatches ? pageMatches.length : 0;

    const count = Math.max(maxPagesCount, directPageCount);

    if (count <= 0) {
        // If text contains trailer / xref or valid structure without explicit page count,
        // or if it's completely unparseable
        if (text.includes('%%EOF') || text.includes('trailer') || text.includes('obj')) {
            // If it has standard objects, fallback to at least 1 page or throw if empty
            if (directPageCount === 0 && maxPagesCount === 0) {
                // If no page object at all, it's invalid
                throw new HttpError('PDF contains no readable pages', 400);
            }
            return count || 1;
        }
        throw new HttpError('Invalid or corrupted PDF structure', 400);
    }

    return count;
}

/**
 * Sanitizes the client-provided original filename to be used strictly as display metadata.
 * Strips path traversal sequences, directory delimiters, null bytes, and non-printable characters.
 */
export function sanitizeDisplayFilename(rawFilename?: string): string {
    if (!rawFilename || typeof rawFilename !== 'string') {
        return 'unnamed_file';
    }

    // Strip null bytes and control characters
    let sanitized = rawFilename.replace(/[\x00-\x1f\x7f]/g, '');

    // Extract basename if path was provided (e.g. C:\foo\bar.pdf or ../../etc/passwd)
    sanitized = sanitized.replace(/^.*[\\/]/, '');

    // Strip remaining relative path traversal tokens
    sanitized = sanitized.replace(/\.\.+[\\/]/g, '').trim();

    // Strip leading/trailing dots or spaces
    sanitized = sanitized.replace(/^\.+/, '').trim();

    if (!sanitized) {
        return 'unnamed_file';
    }

    // Truncate to maximum 255 chars
    if (sanitized.length > 255) {
        sanitized = sanitized.substring(0, 255);
    }

    return sanitized;
}
