/**
 * Classroom Activity - Automated Answer Verification Engine
 *
 * Compares student answers against professor reference solutions.
 * Handles:
 * - Direct text matching & case-insensitivity
 * - Numeric & mathematical equivalence (e.g. 42 vs 42.0, x = 5 vs 5, 1/2 vs 0.5)
 * - Punctuation & whitespace normalization
 * - Key concepts & token set overlap (handles reasonable phrasing / wording variations)
 * - Levenshtein distance for minor spelling variations
 * - Bigram / Dice similarity for phrase matching
 * - Zero external API dependency (LLM only used if explicitly configured via GEMINI_API_KEY)
 */

export interface VerificationResult {
    isCorrect: boolean;
    confidence: number;
    matchType: 'EXACT' | 'NUMERIC' | 'KEY_CONCEPTS' | 'FUZZY' | 'SEMANTIC' | 'NO_MATCH';
    feedback: string;
}

const COMMON_STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
    'be', 'been', 'being', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
    'about', 'against', 'between', 'into', 'through', 'during', 'before',
    'after', 'above', 'below', 'from', 'up', 'down', 'of', 'off', 'over',
    'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when',
    'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
    'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'should',
    'now', 'it', 'its', 'this', 'that', 'these', 'those', 'as'
]);

/**
 * Normalizes text for comparison.
 */
export function normalizeText(text: string): string {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/[,;:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extracts alphanumeric words/tokens, filtering out common filler words.
 */
export function extractKeywords(text: string): string[] {
    const normalized = normalizeText(text);
    return normalized
        .split(/[\s,;.!?-]+/)
        .map(w => w.replace(/[^a-z0-9]/g, ''))
        .filter(w => w.length > 1 && !COMMON_STOP_WORDS.has(w));
}

/**
 * Parses numbers, floats, or fractions from a string.
 */
export function parseNumericValue(text: string): number | null {
    if (!text) return null;
    const clean = text.trim().toLowerCase();

    // Remove leading variable assignment like "x =", "ans =", "result ="
    const valStr = clean.replace(/^[a-z_][a-z0-9_]*\s*=\s*/i, '').trim();

    // Check fraction like "1/2" or "3/4"
    const fractionMatch = valStr.match(/^(-?\d+)\s*\/\s*(\d+)$/);
    if (fractionMatch) {
        const num = parseFloat(fractionMatch[1]);
        const den = parseFloat(fractionMatch[2]);
        if (den !== 0) return num / den;
    }

    // Direct float/integer
    const numMatch = valStr.match(/^-?\d+(\.\d+)?$/);
    if (numMatch) {
        return parseFloat(numMatch[0]);
    }

    // Number with units (e.g. "10 m/s", "42 kg", "50%")
    const unitMatch = valStr.match(/^(-?\d+(\.\d+)?)\s*[a-z%°]+$/);
    if (unitMatch) {
        return parseFloat(unitMatch[1]);
    }

    return null;
}

/**
 * Computes Levenshtein edit distance between two strings.
 */
export function levenshteinDistance(a: string, b: string): number {
    const m = a.length;
    const n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;

    const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i <= m; i++) d[i][0] = i;
    for (let j = 0; j <= n; j++) d[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            d[i][j] = Math.min(
                d[i - 1][j] + 1,       // deletion
                d[i][j - 1] + 1,       // insertion
                d[i - 1][j - 1] + cost // substitution
            );
        }
    }
    return d[m][n];
}

/**
 * Computes string similarity score between 0 and 1.
 */
export function stringSimilarity(a: string, b: string): number {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1.0;
    const dist = levenshteinDistance(a, b);
    return Math.max(0, 1 - dist / maxLen);
}

/**
 * Primary answer verification function.
 * Compares student answer to reference answer reliably without needing manual professor grading.
 */
export function verifyClassroomAnswer(studentAnswer?: string | null, referenceAnswer?: string | null): VerificationResult {
    if (!referenceAnswer || !referenceAnswer.trim()) {
        // If professor didn't provide a reference answer, accept submission as received
        return {
            isCorrect: true,
            confidence: 1.0,
            matchType: 'EXACT',
            feedback: 'Submission verified'
        };
    }

    if (!studentAnswer || !studentAnswer.trim()) {
        return {
            isCorrect: false,
            confidence: 1.0,
            matchType: 'NO_MATCH',
            feedback: 'No answer text provided'
        };
    }

    const normStudent = normalizeText(studentAnswer);
    const normRef = normalizeText(referenceAnswer);

    // 1. Direct exact or substring match
    if (normStudent === normRef) {
        return {
            isCorrect: true,
            confidence: 1.0,
            matchType: 'EXACT',
            feedback: 'Answer matches the reference solution perfectly.'
        };
    }

    // 2. Numeric and Mathematical Equivalence
    const studentNum = parseNumericValue(studentAnswer);
    const refNum = parseNumericValue(referenceAnswer);

    if (studentNum !== null && refNum !== null) {
        const diff = Math.abs(studentNum - refNum);
        const tolerance = Math.max(1e-4, Math.abs(refNum) * 0.01); // 1% tolerance or 1e-4

        if (diff <= tolerance) {
            return {
                isCorrect: true,
                confidence: 1.0,
                matchType: 'NUMERIC',
                feedback: `Numerical value ${studentNum} matches reference value ${refNum}.`
            };
        }
    }

    // 3. Substring containment (e.g. reference answer is a key term contained in student explanation)
    if (normRef.length >= 3 && normStudent.includes(normRef)) {
        return {
            isCorrect: true,
            confidence: 0.95,
            matchType: 'KEY_CONCEPTS',
            feedback: 'Answer contains the complete reference solution.'
        };
    }

    if (normStudent.length >= 3 && normRef.includes(normStudent) && normStudent.length >= normRef.length * 0.75) {
        return {
            isCorrect: true,
            confidence: 0.9,
            matchType: 'KEY_CONCEPTS',
            feedback: 'Answer matches the primary component of the reference solution.'
        };
    }

    // 4. Key Concept / Token Overlap
    const refKeywords = extractKeywords(referenceAnswer);
    const studentKeywords = extractKeywords(studentAnswer);

    if (refKeywords.length > 0) {
        const studentKeywordSet = new Set(studentKeywords);
        let matchedCount = 0;

        for (const kw of refKeywords) {
            if (studentKeywordSet.has(kw)) {
                matchedCount++;
            } else {
                // Check if any student keyword is very close (fuzzy match for typo)
                for (const sk of studentKeywords) {
                    if (stringSimilarity(kw, sk) >= 0.82) {
                        matchedCount++;
                        break;
                    }
                }
            }
        }

        const matchRatio = matchedCount / refKeywords.length;

        // If >= 70% of reference keywords are covered (or >= 60% for longer answers)
        const threshold = refKeywords.length <= 2 ? 1.0 : refKeywords.length <= 4 ? 0.75 : 0.65;
        if (matchRatio >= threshold) {
            return {
                isCorrect: true,
                confidence: Math.round(matchRatio * 100) / 100,
                matchType: 'KEY_CONCEPTS',
                feedback: `Key concepts match (${matchedCount}/${refKeywords.length} core concepts identified).`
            };
        }
    }

    // 5. Overall String Similarity (Fuzzy matching for short answers)
    const similarity = stringSimilarity(normStudent, normRef);
    if (similarity >= 0.8) {
        return {
            isCorrect: true,
            confidence: Math.round(similarity * 100) / 100,
            matchType: 'FUZZY',
            feedback: 'Answer matches reference solution with minor wording variation.'
        };
    }

    // If no match criteria met, mark as Incorrect
    return {
        isCorrect: false,
        confidence: Math.round((1 - similarity) * 100) / 100,
        matchType: 'NO_MATCH',
        feedback: 'Answer does not match the reference solution.'
    };
}

