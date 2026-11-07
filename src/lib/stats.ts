export interface DescriptiveStatistics {
    count: number;
    mean: number | null;
    median: number | null;
    standardDeviation: number | null;
}

export interface ScoreDistributionBin {
    startPercentage: number;
    endPercentage: number;
    label: string;
    count: number;
}

export interface QuestionScoreDefinition {
    questionNumber: number;
    maxMarks: number;
}

export interface QuestionScoreObservation {
    questionNumber: number;
    score: number;
    maxMarks: number;
}

export interface QuestionPerformanceStatistic {
    questionNumber: number;
    maxMarks: number;
    gradedCount: number;
    meanScorePercentage: number | null;
    standardDeviationPercentagePoints: number | null;
    difficultyIndexPercentage: number | null;
}

export interface GraderScoreObservation {
    graderId: string;
    comparableGroup: string;
    scorePercentage: number;
}

export interface GraderConsistencyMetric {
    graderId: string;
    comparisonCount: number;
    meanAbsoluteDeviationPercentagePoints: number;
    sampleSizeStatus: 'SUFFICIENT' | 'INSUFFICIENT';
}

export const MIN_GRADER_CONSISTENCY_SAMPLE_SIZE = 5;

export function calculateDescriptiveStatistics(values: readonly number[]): DescriptiveStatistics {
    const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (sorted.length === 0) {
        return { count: 0, mean: null, median: null, standardDeviation: null };
    }

    const count = sorted.length;
    const mean = sorted.reduce((sum, value) => sum + value, 0) / count;
    const midpoint = Math.floor(count / 2);
    const median = count % 2 === 1
        ? sorted[midpoint]
        : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
    const populationVariance = sorted.reduce(
        (sum, value) => sum + (value - mean) ** 2,
        0
    ) / count;

    return {
        count,
        mean,
        median,
        standardDeviation: Math.sqrt(populationVariance)
    };
}

export function calculateScoreDistribution(
    scores: readonly { score: number; maxMarks: number }[],
    binCount = 10
): ScoreDistributionBin[] {
    if (!Number.isSafeInteger(binCount) || binCount < 1 || binCount > 100) {
        throw new Error('Histogram bin count must be an integer between 1 and 100');
    }

    const bins = Array.from({ length: binCount }, (_, index) => {
        const startPercentage = (index / binCount) * 100;
        const endPercentage = ((index + 1) / binCount) * 100;
        return {
            startPercentage,
            endPercentage,
            label: `${Math.round(startPercentage)}-${Math.round(endPercentage)}%`,
            count: 0
        };
    });

    for (const { score, maxMarks } of scores) {
        if (!Number.isFinite(score) || !Number.isFinite(maxMarks) ||
            maxMarks <= 0 || score < 0 || score > maxMarks) {
            continue;
        }
        const percentage = (score / maxMarks) * 100;
        const index = Math.min(Math.floor(percentage / (100 / binCount)), binCount - 1);
        bins[index].count += 1;
    }

    return bins;
}

export function calculateQuestionPerformance(
    questions: readonly QuestionScoreDefinition[],
    observations: readonly QuestionScoreObservation[]
): QuestionPerformanceStatistic[] {
    const definitions = new Map<number, QuestionScoreDefinition>();
    for (const question of questions) {
        if (!Number.isSafeInteger(question.questionNumber) ||
            !Number.isFinite(question.maxMarks) || question.maxMarks < 0 ||
            definitions.has(question.questionNumber)) {
            continue;
        }
        definitions.set(question.questionNumber, question);
    }

    const percentagesByQuestion = new Map<number, number[]>();
    for (const observation of observations) {
        if (!definitions.has(observation.questionNumber) ||
            !Number.isFinite(observation.score) ||
            !Number.isFinite(observation.maxMarks) ||
            observation.maxMarks <= 0 ||
            observation.score < 0 || observation.score > observation.maxMarks) {
            continue;
        }
        const percentages = percentagesByQuestion.get(observation.questionNumber) || [];
        percentages.push((observation.score / observation.maxMarks) * 100);
        percentagesByQuestion.set(observation.questionNumber, percentages);
    }

    return Array.from(definitions.values())
        .sort((left, right) => left.questionNumber - right.questionNumber)
        .map(question => {
            const statistics = calculateDescriptiveStatistics(
                percentagesByQuestion.get(question.questionNumber) || []
            );
            return {
                questionNumber: question.questionNumber,
                maxMarks: question.maxMarks,
                gradedCount: statistics.count,
                meanScorePercentage: statistics.mean,
                standardDeviationPercentagePoints: statistics.standardDeviation,
                difficultyIndexPercentage: statistics.mean === null
                    ? null
                    : 100 - statistics.mean
            };
        });
}

/**
 * Measures each TA's mean absolute distance from the pooled percentage score
 * within comparable rubric-question groups. Groups with only one TA are omitted.
 * Fewer than five comparable scores are marked insufficient; this cohort proxy
 * is not formal inter-rater reliability because students are not double-graded.
 */
export function calculateGraderConsistency(
    observations: readonly GraderScoreObservation[],
    minimumSampleSize = MIN_GRADER_CONSISTENCY_SAMPLE_SIZE
): GraderConsistencyMetric[] {
    if (!Number.isSafeInteger(minimumSampleSize) || minimumSampleSize < 1) {
        throw new Error('Minimum sample size must be a positive integer');
    }

    const groups = new Map<string, GraderScoreObservation[]>();
    for (const observation of observations) {
        if (!observation.graderId || !observation.comparableGroup ||
            !Number.isFinite(observation.scorePercentage) ||
            observation.scorePercentage < 0 || observation.scorePercentage > 100) {
            continue;
        }
        const group = groups.get(observation.comparableGroup) || [];
        group.push(observation);
        groups.set(observation.comparableGroup, group);
    }

    const deviationsByGrader = new Map<string, number[]>();
    for (const group of groups.values()) {
        if (new Set(group.map(observation => observation.graderId)).size < 2) {
            continue;
        }
        const groupMean = group.reduce((sum, observation) => sum + observation.scorePercentage, 0) / group.length;
        for (const observation of group) {
            const deviations = deviationsByGrader.get(observation.graderId) || [];
            deviations.push(Math.abs(observation.scorePercentage - groupMean));
            deviationsByGrader.set(observation.graderId, deviations);
        }
    }

    return Array.from(deviationsByGrader, ([graderId, deviations]): GraderConsistencyMetric => ({
        graderId,
        comparisonCount: deviations.length,
        meanAbsoluteDeviationPercentagePoints:
            deviations.reduce((sum, deviation) => sum + deviation, 0) / deviations.length,
        sampleSizeStatus: deviations.length >= minimumSampleSize
            ? 'SUFFICIENT'
            : 'INSUFFICIENT'
    })).sort((left, right) => left.graderId.localeCompare(right.graderId));
}
