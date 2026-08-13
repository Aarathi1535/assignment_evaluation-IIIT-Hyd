/**
 * Shared normalization and helper utilities for StudentMapping and roll numbers.
 */

/**
 * Normalizes a student roll number consistently across storage, uniqueness, and lookup.
 * - Trims leading and trailing whitespace
 * - Converts to uppercase
 * - Strips all internal whitespace so variants like "CS 101" and "CS101" normalize identically
 * Returns null if input is null, undefined, or empty string after trimming.
 */
export function normalizeRollNumber(rollNumber: unknown): string | null {
    if (rollNumber === null || rollNumber === undefined) {
        return null;
    }
    const str = String(rollNumber).trim();
    if (!str) {
        return null;
    }
    return str.replace(/\s+/g, '').toUpperCase();
}
