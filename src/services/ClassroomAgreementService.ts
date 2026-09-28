import { IClassroomCriterionScore } from '../models/ClassroomSubmission';

export interface CriterionAgreementMetric {
    criterionName: string;
    sampleSize: number;
    exactAgreementCount: number;
    exactAgreementRate: number;
    averageAbsoluteDifference: number;
    withinHalfMarkCount: number;
    withinHalfMarkRate: number;
    withinOneMarkCount: number;
    withinOneMarkRate: number;
}

export interface ClassroomAgreementMetrics {
    sampleSize: number;
    exactAgreementCount: number;
    exactAgreementRate: number;
    averageAbsoluteScoreDifference: number;
    withinHalfMarkCount: number;
    withinHalfMarkRate: number;
    withinOneMarkCount: number;
    withinOneMarkRate: number;
    criterionAgreement: CriterionAgreementMetric[];
    disclaimer: string;
}

export interface SubmissionAgreementCandidate {
    provisionalScore?: number | null;
    confirmedScore?: number | null;
    provisionalCriterionScores?: IClassroomCriterionScore[] | null;
    confirmedCriterionScores?: IClassroomCriterionScore[] | null;
}

const RESEARCH_DISCLAIMER =
    'These metrics report measured empirical agreement between AI provisional scores and professor-confirmed scores on available human-confirmed samples. They do not claim general AI accuracy or grading reliability.';

/**
 * Calculates empirical agreement metrics between AI provisional and professor-confirmed grading.
 */
export function calculateAgreementMetrics(
    submissions: SubmissionAgreementCandidate[]
): ClassroomAgreementMetrics {
    // Only analyze confirmed submissions that have both provisional and confirmed scores
    const confirmedPairs = submissions.filter(
        (s): s is SubmissionAgreementCandidate & { provisionalScore: number; confirmedScore: number } =>
            typeof s.provisionalScore === 'number' &&
            Number.isFinite(s.provisionalScore) &&
            typeof s.confirmedScore === 'number' &&
            Number.isFinite(s.confirmedScore)
    );

    const sampleSize = confirmedPairs.length;
    if (sampleSize === 0) {
        return {
            sampleSize: 0,
            exactAgreementCount: 0,
            exactAgreementRate: 0,
            averageAbsoluteScoreDifference: 0,
            withinHalfMarkCount: 0,
            withinHalfMarkRate: 0,
            withinOneMarkCount: 0,
            withinOneMarkRate: 0,
            criterionAgreement: [],
            disclaimer: RESEARCH_DISCLAIMER
        };
    }

    let exactCount = 0;
    let withinHalfCount = 0;
    let withinOneCount = 0;
    let totalAbsDiff = 0;

    // Track criterion pairs: criterionName (normalized) -> array of { ai, prof, displayName }
    const criterionMap = new Map<string, { displayName: string; pairs: Array<{ ai: number; prof: number }> }>();

    for (const sub of confirmedPairs) {
        const diff = Math.abs(sub.provisionalScore - sub.confirmedScore);
        totalAbsDiff += diff;

        // Use epsilon for floating point comparison
        if (diff < 0.0001) {
            exactCount++;
        }
        if (diff <= 0.5 + 0.0001) {
            withinHalfCount++;
        }
        if (diff <= 1.0 + 0.0001) {
            withinOneCount++;
        }

        // Criterion-level agreement
        const aiCriteria = sub.provisionalCriterionScores || [];
        const profCriteria = sub.confirmedCriterionScores || aiCriteria;

        if (aiCriteria.length > 0 && profCriteria.length > 0) {
            for (const aiC of aiCriteria) {
                const normKey = aiC.criterionName.trim().toLowerCase();
                const matchedProf = profCriteria.find(
                    (p) => p.criterionName.trim().toLowerCase() === normKey
                );

                if (matchedProf) {
                    const entry = criterionMap.get(normKey) || {
                        displayName: aiC.criterionName.trim(),
                        pairs: []
                    };
                    entry.pairs.push({
                        ai: aiC.marksAwarded,
                        prof: matchedProf.marksAwarded
                    });
                    criterionMap.set(normKey, entry);
                }
            }
        }
    }

    const round4 = (val: number): number => Math.round(val * 10000) / 10000;

    const criterionAgreement: CriterionAgreementMetric[] = [];
    for (const [, { displayName, pairs }] of criterionMap.entries()) {
        const cTotal = pairs.length;
        if (cTotal === 0) continue;

        let cExact = 0;
        let cWithinHalf = 0;
        let cWithinOne = 0;
        let cAbsDiff = 0;

        for (const p of pairs) {
            const pDiff = Math.abs(p.ai - p.prof);
            cAbsDiff += pDiff;
            if (pDiff < 0.0001) cExact++;
            if (pDiff <= 0.5 + 0.0001) cWithinHalf++;
            if (pDiff <= 1.0 + 0.0001) cWithinOne++;
        }

        criterionAgreement.push({
            criterionName: displayName,
            sampleSize: cTotal,
            exactAgreementCount: cExact,
            exactAgreementRate: round4(cExact / cTotal),
            averageAbsoluteDifference: round4(cAbsDiff / cTotal),
            withinHalfMarkCount: cWithinHalf,
            withinHalfMarkRate: round4(cWithinHalf / cTotal),
            withinOneMarkCount: cWithinOne,
            withinOneMarkRate: round4(cWithinOne / cTotal)
        });
    }

    return {
        sampleSize,
        exactAgreementCount: exactCount,
        exactAgreementRate: round4(exactCount / sampleSize),
        averageAbsoluteScoreDifference: round4(totalAbsDiff / sampleSize),
        withinHalfMarkCount: withinHalfCount,
        withinHalfMarkRate: round4(withinHalfCount / sampleSize),
        withinOneMarkCount: withinOneCount,
        withinOneMarkRate: round4(withinOneCount / sampleSize),
        criterionAgreement,
        disclaimer: RESEARCH_DISCLAIMER
    };
}
