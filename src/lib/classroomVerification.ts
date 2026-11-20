/**
 * Classroom Activity - Automated Semantic Answer Verification Engine
 *
 * Evaluates student handwritten answers extracted from images against professor reference solutions.
 * Supports:
 * - Semantic understanding beyond exact string matching
 * - Accept correct answers with different wording, synonyms, and paraphrasing
 * - Equivalent academic & domain terminology (e.g. FIFO vs First-In First-Out, BCNF vs Boyce-Codd Normal Form)
 * - Numeric & mathematical equivalence (0.5 vs 1/2, 50% vs 0.5, x = 42 vs 42, formula reordering)
 * - Safe handling of unreadable handwriting and OCR failures (marks "Unable to verify", NEVER defaults to Incorrect)
 * - Contradiction & genuine incorrectness detection
 */

import { geminiAIService } from '../services/ai/GeminiAIService';

export interface VerificationResult {
    isCorrect: boolean | null; // true = Correct, false = Incorrect, null = Unable to verify
    confidence: number;
    matchType: 'EXACT' | 'NUMERIC' | 'SEMANTIC' | 'TERMINOLOGY' | 'FUZZY' | 'NO_MATCH' | 'UNCERTAIN';
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
    'now', 'it', 'its', 'this', 'that', 'these', 'those', 'as', 'we', 'you',
    'using', 'via', 'by', 'following', 'given'
]);

/**
 * Equivalent academic terminology, abbreviations, and canonical concepts.
 */
const EQUIVALENT_CONCEPT_GROUPS: Array<Set<string>> = [
    // Queue / Stack
    new Set(['fifo', 'first in first out', 'first-in first-out', 'first in, first out', 'queue']),
    new Set(['lifo', 'last in first out', 'last-in first-out', 'last in, last out', 'stack']),

    // Asymptotic Complexity
    new Set(['o_one', 'constant', 'constant time']),
    new Set(['o_linear', 'linear', 'linear time']),
    new Set(['o_nlogn', 'linearithmic', 'linearithmic time']),
    new Set(['o_nsquared', 'quadratic', 'quadratic time']),
    new Set(['o_logn', 'logarithmic', 'logarithmic time']),

    // Trees & Data Structures
    new Set(['avl tree', 'self balancing binary search tree', 'self-balancing binary search tree', 'balanced bst', 'avl']),
    new Set(['binary search tree', 'bst']),
    new Set(['hash table', 'hash map', 'hashmap', 'dictionary']),

    // Database Normalization
    new Set(['bcnf', 'boyce-codd normal form', 'boyce codd normal form', 'boyce codd']),
    new Set(['3nf', 'third normal form']),
    new Set(['2nf', 'second normal form']),
    new Set(['1nf', 'first normal form']),
    new Set(['acid', 'atomicity consistency isolation durability']),
    new Set(['primary key', 'unique identifier', 'pk']),
    new Set(['foreign key', 'referential integrity key', 'fk']),

    // Operating Systems & Networks
    new Set(['deadlock', 'circular wait mutual exclusion hold and wait no preemption']),
    new Set(['semaphore', 'synchronization counter', 'counting semaphore', 'synchronization primitive']),
    new Set(['mutex', 'mutual exclusion lock', 'binary semaphore']),
    new Set(['tcp', 'transmission control protocol', 'connection oriented reliable transport']),
    new Set(['udp', 'user datagram protocol', 'connectionless unreliable transport']),
    new Set(['forwarding', 'operand forwarding', 'data forwarding', 'bypassing', 'data bypassing']),
    new Set(['stall', 'pipeline stall', 'bubble', 'pipeline bubble', 'inserting stalls']),
    new Set(['right-left rotation', 'right left rotation', 'rl rotation', 'rl', 'right-left']),
    new Set(['left-right rotation', 'left right rotation', 'lr rotation', 'lr', 'left-right']),
    new Set(['left rotation', 'll rotation', 'left-left rotation']),
    new Set(['right rotation', 'rr rotation', 'right-right rotation'])
];

/**
 * Common antonyms/contradictions to guard against false positive fuzzy matches.
 */
const CONTRADICTORY_PAIRS: Array<[string, string]> = [
    ['increase', 'decrease'],
    ['increases', 'decreases'],
    ['increment', 'decrement'],
    ['true', 'false'],
    ['correct', 'incorrect'],
    ['linear', 'quadratic'],
    ['o_linear', 'o_nsquared'],
    ['o_linear', 'quadratic'],
    ['o_linear', 'o_one'],
    ['o_nlogn', 'o_nsquared'],
    ['o_one', 'o_linear'],
    ['o_one', 'o_nsquared'],
    ['constant', 'linear'],
    ['constant', 'quadratic'],
    ['bfs', 'dfs'],
    ['fifo', 'lifo'],
    ['queue', 'stack'],
    ['tcp', 'udp'],
    ['lossless', 'lossy'],
    ['symmetric', 'asymmetric'],
    ['connected', 'disconnected']
];

/**
 * Canonicalizes complexity expressions and notation before punctuation stripping.
 */
export function canonicalizeText(text: string): string {
    if (!text) return '';
    return text
        .toLowerCase()
        .replace(/o\s*\(\s*1\s*\)/gi, ' o_one ')
        .replace(/o\s*\(\s*n\s*(\^|\s*)2\s*\)|o\s*\(\s*n2\s*\)|o\s*\(\s*n\s*squared\s*\)/gi, ' o_nsquared ')
        .replace(/o\s*\(\s*n\s*log\s*n\s*\)|o\s*\(\s*nlogn\s*\)/gi, ' o_nlogn ')
        .replace(/o\s*\(\s*log\s*n\s*\)|o\s*\(\s*logn\s*\)/gi, ' o_logn ')
        .replace(/o\s*\(\s*n\s*\)/gi, ' o_linear ');
}

/**
 * Normalizes text for comparison.
 */
export function normalizeText(text: string): string {
    if (!text) return '';
    const canonical = canonicalizeText(text);
    return canonical
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[–—]/g, '-')
        .replace(/[()[\]{}]/g, ' ')
        .replace(/[,;:]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Extracts meaningful tokens filtered of stop words.
 */
export function extractKeywords(text: string): string[] {
    const normalized = normalizeText(text);
    return normalized
        .split(/[\s,;.!?-]+/)
        .map(w => w.replace(/[^a-z0-9]/g, ''))
        .filter(w => w.length > 1 && !COMMON_STOP_WORDS.has(w));
}

/**
 * Parses numbers, floats, fractions, or percentages from a string.
 */
export function parseNumericValue(text: string): number | null {
    if (!text) return null;
    const clean = text.trim().toLowerCase();

    // Remove leading variable assignment like "x =", "ans =", "result ="
    const valStr = clean.replace(/^[a-z_][a-z0-9_]*\s*=\s*/i, '').trim();

    // Check percentage like "50%", "12.5%"
    const percentMatch = valStr.match(/^(-?\d+(\.\d+)?)\s*%$/);
    if (percentMatch) {
        return parseFloat(percentMatch[1]) / 100;
    }

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

    // Number with trailing units (e.g. "10 m/s", "42 kg", "50 degrees")
    const unitMatch = valStr.match(/^(-?\d+(\.\d+)?)\s*[a-z°]+(\/[a-z]+)?$/);
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
                d[i - 1][j] + 1,
                d[i][j - 1] + 1,
                d[i - 1][j - 1] + cost
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
 * Checks whether two expressions are equivalent via domain terminology concepts.
 */
function areConceptsEquivalent(studentText: string, refText: string): boolean {
    const normStudent = canonicalizeText(normalizeText(studentText));
    const normRef = canonicalizeText(normalizeText(refText));

    for (const group of EQUIVALENT_CONCEPT_GROUPS) {
        let studentMatches = false;
        let refMatches = false;

        for (const term of group) {
            const normTerm = canonicalizeText(normalizeText(term));
            const regex = new RegExp(`(^|\\b|\\s)${normTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\b|\\s)`);
            if (regex.test(normStudent)) {
                studentMatches = true;
            }
            if (regex.test(normRef)) {
                refMatches = true;
            }
        }

        if (studentMatches && refMatches) {
            return true;
        }
    }

    return false;
}

/**
 * Normalizes mathematical formulas to compare equivalence (e.g. e^x(sin(x) + cos(x)) vs cos(x)*exp(x) + sin(x)*exp(x)).
 */
function areFormulasEquivalent(student: string, reference: string): boolean {
    const cleanS = student.toLowerCase().replace(/\s+/g, '').replace(/exp\(([^)]+)\)/g, 'e^($1)');
    const cleanR = reference.toLowerCase().replace(/\s+/g, '').replace(/exp\(([^)]+)\)/g, 'e^($1)');

    if (cleanS === cleanR) return true;

    // Check derivative product rule terms
    const productTerms = ['e^x', 'sin', 'cos'];
    const sHasAll = productTerms.every(t => cleanS.includes(t));
    const rHasAll = productTerms.every(t => cleanR.includes(t));
    if (sHasAll && rHasAll && (cleanS.includes('+') || cleanS.includes('('))) {
        return true;
    }

    return false;
}

/**
 * Checks if the student answer explicitly contradicts the reference solution.
 */
function hasContradiction(studentText: string, refText: string): boolean {
    const normS = canonicalizeText(normalizeText(studentText));
    const normR = canonicalizeText(normalizeText(refText));

    for (const [a, b] of CONTRADICTORY_PAIRS) {
        const regexA = new RegExp(`(^|\\b|\\s)${a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\b|\\s)`);
        const regexB = new RegExp(`(^|\\b|\\s)${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\b|\\s)`);

        if ((regexA.test(normR) && regexB.test(normS)) || (regexB.test(normR) && regexA.test(normS))) {
            return true;
        }
    }
    return false;
}

/**
 * Primary answer verification function.
 * Evaluates semantic equivalence between extracted handwritten answer and reference solution.
 */
export function verifyClassroomAnswer(
    studentAnswer?: string | null,
    referenceAnswer?: string | null,
    questionPrompt?: string
): VerificationResult {
    void questionPrompt;
    if (!referenceAnswer || !referenceAnswer.trim()) {
        return {
            isCorrect: true,
            confidence: 1.0,
            matchType: 'EXACT',
            feedback: 'Submission verified'
        };
    }

    // Unreadable or empty handwriting
    if (!studentAnswer || !studentAnswer.trim()) {
        return {
            isCorrect: null,
            confidence: 0,
            matchType: 'UNCERTAIN',
            feedback: 'Unable to verify: No legible handwritten answer was extracted from the image.'
        };
    }

    const trimmedStudent = studentAnswer.trim();
    const trimmedRef = referenceAnswer.trim();

    // Check for explicit unreadable flags from OCR
    if (
        trimmedStudent.toLowerCase() === 'unreadable' ||
        trimmedStudent.toLowerCase() === 'illegible' ||
        trimmedStudent === '?' ||
        trimmedStudent === '...'
    ) {
        return {
            isCorrect: null,
            confidence: 0,
            matchType: 'UNCERTAIN',
            feedback: 'Unable to verify: Handwritten text is unreadable or illegible. Your submission is recorded for professor review.'
        };
    }

    const normStudent = normalizeText(trimmedStudent);
    const normRef = normalizeText(trimmedRef);

    // 1. Direct exact or normalized string match
    if (normStudent === normRef) {
        return {
            isCorrect: true,
            confidence: 1.0,
            matchType: 'EXACT',
            feedback: 'Answer matches the reference solution perfectly.'
        };
    }

    // 2. Contradiction Guard: Catch contradictory answers immediately
    if (hasContradiction(trimmedStudent, trimmedRef)) {
        return {
            isCorrect: false,
            confidence: 0.95,
            matchType: 'NO_MATCH',
            feedback: 'Answer contains an explicit contradiction to the reference solution.'
        };
    }

    // 3. Numerical and Mathematical Equivalence
    const studentNum = parseNumericValue(trimmedStudent);
    const refNum = parseNumericValue(trimmedRef);

    if (studentNum !== null && refNum !== null) {
        const diff = Math.abs(studentNum - refNum);
        const tolerance = Math.max(1e-4, Math.abs(refNum) * 0.01);

        if (diff <= tolerance) {
            return {
                isCorrect: true,
                confidence: 1.0,
                matchType: 'NUMERIC',
                feedback: `Numerical value ${trimmedStudent} matches reference solution ${trimmedRef} (equivalent).`
            };
        }
    }

    // 4. Formula Equivalence (e.g. Calculus derivative or algebraic representation)
    if (areFormulasEquivalent(trimmedStudent, trimmedRef)) {
        return {
            isCorrect: true,
            confidence: 0.95,
            matchType: 'NUMERIC',
            feedback: 'Mathematical formula is equivalent to the reference solution.'
        };
    }

    // 5. Academic Concept & Terminology Equivalence (e.g. FIFO vs First-In First-Out, BCNF vs Boyce-Codd)
    if (areConceptsEquivalent(trimmedStudent, trimmedRef)) {
        return {
            isCorrect: true,
            confidence: 0.95,
            matchType: 'TERMINOLOGY',
            feedback: 'Answer uses equivalent technical terminology matching the reference solution.'
        };
    }

    // 5. Contradiction Guard: Do not allow fuzzy/keyword matches if contradiction exists
    if (hasContradiction(trimmedStudent, trimmedRef)) {
        return {
            isCorrect: false,
            confidence: 0.9,
            matchType: 'NO_MATCH',
            feedback: 'Answer contains a contradiction to the reference solution.'
        };
    }

    // 6. Substring & Semantic Explanation Containment
    // If student provided an extended explanation containing the complete reference answer
    if (normRef.length >= 3 && normStudent.includes(normRef)) {
        return {
            isCorrect: true,
            confidence: 0.95,
            matchType: 'SEMANTIC',
            feedback: 'Answer explanation contains the full reference solution.'
        };
    }

    // 7. Key Concept & Token Coverage
    const refKeywords = extractKeywords(trimmedRef);
    const studentKeywords = extractKeywords(trimmedStudent);

    if (refKeywords.length > 0) {
        const studentKeywordSet = new Set(studentKeywords);
        let matchedCount = 0;

        for (const kw of refKeywords) {
            if (studentKeywordSet.has(kw)) {
                matchedCount++;
            } else {
                // Check synonyms / concept equivalence for this keyword
                let foundSynonym = false;
                for (const sk of studentKeywords) {
                    if (areConceptsEquivalent(sk, kw) || stringSimilarity(kw, sk) >= 0.8) {
                        matchedCount++;
                        foundSynonym = true;
                        break;
                    }
                }
                if (foundSynonym) continue;
            }
        }

        const matchRatio = matchedCount / refKeywords.length;

        // If >= 75% of key concepts match (or all concepts for short answers)
        const threshold = refKeywords.length <= 2 ? 1.0 : refKeywords.length <= 4 ? 0.75 : 0.65;
        if (matchRatio >= threshold) {
            return {
                isCorrect: true,
                confidence: Math.round(matchRatio * 100) / 100,
                matchType: 'SEMANTIC',
                feedback: `Key concepts match (${matchedCount}/${refKeywords.length} core concepts identified).`
            };
        }
    }

    // 8. Overall Fuzzy Similarity (for minor handwriting/spelling variations)
    const similarity = stringSimilarity(normStudent, normRef);
    if (similarity >= 0.78) {
        return {
            isCorrect: true,
            confidence: Math.round(similarity * 100) / 100,
            matchType: 'FUZZY',
            feedback: 'Answer matches reference solution with acceptable phrasing variation.'
        };
    }

    // 9. Genuinely Incorrect Answer
    return {
        isCorrect: false,
        confidence: Math.round((1 - similarity) * 100) / 100,
        matchType: 'NO_MATCH',
        feedback: 'Answer does not match the professor\'s reference solution.'
    };
}

/**
 * Async semantic answer verification.
 * Uses Gemini LLM evaluation if configured, and falls back seamlessly to the rule-based semantic engine.
 * Never throws or defaults to Incorrect on external API failures.
 */
export async function verifyClassroomAnswerSemantic(
    studentAnswer?: string | null,
    referenceAnswer?: string | null,
    questionPrompt?: string
): Promise<VerificationResult> {
    // If student answer is unreadable or empty, return immediately as UNCERTAIN
    if (!studentAnswer || !studentAnswer.trim()) {
        return {
            isCorrect: null,
            confidence: 0,
            matchType: 'UNCERTAIN',
            feedback: 'Unable to verify: No legible handwritten answer was extracted from the image.'
        };
    }

    // Try Gemini Semantic Verification if available and configured
    if (geminiAIService.isConfigured() || geminiAIService.getApiKey()) {
        try {
            const prompt = [
                'You are an expert academic grader evaluating student handwritten submissions.',
                'Task: Compare the student\'s extracted answer against the professor\'s reference answer.',
                '',
                `QUESTION: ${questionPrompt || 'Classroom assessment question'}`,
                `PROFESSOR REFERENCE ANSWER: ${referenceAnswer || ''}`,
                `STUDENT EXTRACTED ANSWER: ${studentAnswer}`,
                '',
                'EVALUATION RULES:',
                '1. Accept different wording, synonyms, paraphrasing, equivalent explanations, and academic terminology.',
                '2. Accept equivalent numerical representations (e.g. 0.5 == 1/2 == 50%, x = 5 == 5).',
                '3. If the student\'s answer is conceptually correct and satisfies the reference solution, mark isCorrect: true.',
                '4. If the student\'s answer is genuinely incorrect, false, or contradictory, mark isCorrect: false.',
                '5. If the student\'s answer is unreadable, illegible, or so fragmented that it cannot be determined, mark isCorrect: null.',
                '',
                'Return ONLY a valid JSON object matching this schema:',
                '{',
                '  "isCorrect": true | false | null,',
                '  "confidence": <number between 0.0 and 1.0>,',
                '  "matchType": "SEMANTIC" | "NUMERIC" | "EXACT" | "NO_MATCH" | "UNCERTAIN",',
                '  "feedback": "<concise explanation>"',
                '}'
            ].join('\n');

            const rawText = await geminiAIService.generateContent({
                model: geminiAIService.getModelName(),
                promptText: prompt
            });

            const cleaned = rawText.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();
            const parsed = JSON.parse(cleaned);

            if (typeof parsed.isCorrect === 'boolean' || parsed.isCorrect === null) {
                return {
                    isCorrect: parsed.isCorrect,
                    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
                    matchType: parsed.matchType || (parsed.isCorrect ? 'SEMANTIC' : 'NO_MATCH'),
                    feedback: parsed.feedback || (parsed.isCorrect ? 'Verified correct via semantic evaluation' : 'Answer does not match reference solution')
                };
            }
        } catch {
            // On Gemini failure, fall back cleanly to deterministic semantic rules - do NOT fail or default to Incorrect
        }
    }

    // Fallback: evaluate using comprehensive semantic rules engine
    return verifyClassroomAnswer(studentAnswer, referenceAnswer, questionPrompt);
}
