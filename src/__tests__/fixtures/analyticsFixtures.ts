/**
 * Reusable statistical and analytics fixtures for AE-218 validation.
 *
 * All expected statistical values in this module have been hand-computed and
 * verified against standard statistical formulas to ensure independent validation
 * of production analytics calculations.
 */

export interface HandComputedDescriptiveStatisticFixture {
    name: string;
    description: string;
    input: readonly number[];
    expected: {
        count: number;
        mean: number | null;
        median: number | null;
        populationVariance: number | null;
        populationStandardDeviation: number | null;
        sampleVariance: number | null;
        sampleStandardDeviation: number | null;
    };
}

export const HAND_COMPUTED_DESCRIPTIVE_FIXTURES: Record<string, HandComputedDescriptiveStatisticFixture> = {
    empty: {
        name: 'Empty dataset',
        description: 'Zero observations should yield null statistical moments and zero count',
        input: [],
        expected: {
            count: 0,
            mean: null,
            median: null,
            populationVariance: null,
            populationStandardDeviation: null,
            sampleVariance: null,
            sampleStandardDeviation: null
        }
    },
    singleValue: {
        name: 'Single-value dataset',
        description: 'Single observation has zero variance in population stats, mean and median equal to value',
        input: [42],
        expected: {
            count: 1,
            mean: 42,
            median: 42,
            populationVariance: 0,
            populationStandardDeviation: 0,
            sampleVariance: null, // undefined (division by N - 1 = 0)
            sampleStandardDeviation: null
        }
    },
    oddSampleSize: {
        name: 'Odd sample size with symmetric spread',
        description: '[10, 20, 30, 40, 50]: median is exact middle element (30), mean is 30',
        input: [50, 10, 40, 20, 30], // intentionally unsorted to test sorting requirement
        expected: {
            count: 5,
            mean: 30,
            median: 30,
            populationVariance: 200, // 1000 / 5
            populationStandardDeviation: Math.sqrt(200), // ~14.142135623730951
            sampleVariance: 250, // 1000 / 4
            sampleStandardDeviation: Math.sqrt(250) // ~15.811388300841896
        }
    },
    evenSampleSize: {
        name: 'Even sample size with symmetric spread',
        description: '[10, 20, 30, 40]: median is midpoint between 20 and 30 (25), mean is 25',
        input: [40, 10, 30, 20],
        expected: {
            count: 4,
            mean: 25,
            median: 25,
            populationVariance: 125, // 500 / 4
            populationStandardDeviation: Math.sqrt(125), // ~11.18033988749895
            sampleVariance: 500 / 3, // ~166.66666666666666
            sampleStandardDeviation: Math.sqrt(500 / 3) // ~12.909944487358056
        }
    },
    asymmetricSkewed: {
        name: 'Positively skewed distribution',
        description: '[2, 3, 5, 7, 23]: mean is pulled by extreme outlier to 8, median stays at 5',
        input: [23, 3, 7, 2, 5],
        expected: {
            count: 5,
            mean: 8,
            median: 5,
            populationVariance: 59.2, // 296 / 5
            populationStandardDeviation: Math.sqrt(59.2), // ~7.694153624668538
            sampleVariance: 74, // 296 / 4
            sampleStandardDeviation: Math.sqrt(74) // ~8.602325267042627
        }
    },
    identicalValues: {
        name: 'All identical values',
        description: 'Zero dispersion around the mean',
        input: [17, 17, 17, 17, 17, 17],
        expected: {
            count: 6,
            mean: 17,
            median: 17,
            populationVariance: 0,
            populationStandardDeviation: 0,
            sampleVariance: 0,
            sampleStandardDeviation: 0
        }
    },
    decimalScores: {
        name: 'Decimal fractional scores',
        description: 'Floating point precision verification with half-point increments [2.5, 4.5, 6.5, 8.5]',
        input: [8.5, 2.5, 6.5, 4.5],
        expected: {
            count: 4,
            mean: 5.5,
            median: 5.5,
            populationVariance: 5, // 20 / 4
            populationStandardDeviation: Math.sqrt(5), // ~2.23606797749979
            sampleVariance: 20 / 3,
            sampleStandardDeviation: Math.sqrt(20 / 3)
        }
    },
    boundaryExtremeZerosAndHundreds: {
        name: 'Bimodal extremes: zeros and hundreds',
        description: '[0, 0, 100, 100]: mean = 50, median = 50, population stdDev = 50',
        input: [100, 0, 100, 0],
        expected: {
            count: 4,
            mean: 50,
            median: 50,
            populationVariance: 2500,
            populationStandardDeviation: 50,
            sampleVariance: 10000 / 3,
            sampleStandardDeviation: Math.sqrt(10000 / 3)
        }
    },
    pollutedWithNonFinite: {
        name: 'Data with non-finite values (NaN, Infinity, null, undefined)',
        description: 'NaN and infinities must be safely filtered out before calculation without crashing or skewing',
        input: [
            Number.NaN,
            10,
            Number.POSITIVE_INFINITY,
            20,
            Number.NEGATIVE_INFINITY,
            30,
            Number.NaN
        ],
        expected: {
            count: 3, // only [10, 20, 30] are finite
            mean: 20,
            median: 20,
            populationVariance: 200 / 3,
            populationStandardDeviation: Math.sqrt(200 / 3), // ~8.16496580927726
            sampleVariance: 100,
            sampleStandardDeviation: 10
        }
    }
};

export interface HandComputedDistributionFixture {
    name: string;
    binCount: number;
    scores: Array<{ score: number; maxMarks: number }>;
    expectedBinCounts: number[];
}

export const HAND_COMPUTED_DISTRIBUTION_FIXTURES: Record<string, HandComputedDistributionFixture> = {
    standardTenBinsWithBoundaries: {
        name: 'Standard 10-bin distribution with exact edge boundary cases',
        binCount: 10,
        scores: [
            // Bin 0: 0-10% (0 <= p < 10)
            { score: 0, maxMarks: 100 },
            { score: 9.99, maxMarks: 100 },
            // Bin 1: 10-20% (10 <= p < 20)
            { score: 10, maxMarks: 100 },
            { score: 15, maxMarks: 100 },
            // Bin 2: 20-30%
            { score: 25, maxMarks: 100 },
            // Bin 3: 30-40% -> none
            // Bin 4: 40-50% -> none
            // Bin 5: 50-60% (50 <= p < 60)
            { score: 50, maxMarks: 100 },
            // Bin 6: 60-70% -> none
            // Bin 7: 70-80% -> none
            // Bin 8: 80-90% (80 <= p < 90)
            { score: 89.9, maxMarks: 100 },
            // Bin 9: 90-100% (90 <= p <= 100, clamped at 100%)
            { score: 90, maxMarks: 100 },
            { score: 99.9, maxMarks: 100 },
            { score: 100, maxMarks: 100 }, // 100% clamped into 90-100%
            // Invalid scores that MUST be ignored:
            { score: -5, maxMarks: 100 },
            { score: 105, maxMarks: 100 },
            { score: 50, maxMarks: 0 },
            { score: 50, maxMarks: -10 },
            { score: Number.NaN, maxMarks: 100 },
            { score: 50, maxMarks: Number.POSITIVE_INFINITY }
        ],
        // Expected counts in bins 0 through 9:
        // bin 0: 2 (0, 9.99)
        // bin 1: 2 (10, 15)
        // bin 2: 1 (25)
        // bin 3: 0
        // bin 4: 0
        // bin 5: 1 (50)
        // bin 6: 0
        // bin 7: 0
        // bin 8: 1 (89.9)
        // bin 9: 3 (90, 99.9, 100)
        expectedBinCounts: [2, 2, 1, 0, 0, 1, 0, 0, 1, 3]
    },
    customFiveBins: {
        name: '5-bin histogram (20% step) boundary test',
        binCount: 5,
        scores: [
            { score: 0, maxMarks: 50 },   // 0% -> bin 0
            { score: 19.9, maxMarks: 50 },// 39.8% -> bin 1
            { score: 20, maxMarks: 50 },  // 40% -> bin 2
            { score: 40, maxMarks: 50 },  // 80% -> bin 4
            { score: 50, maxMarks: 50 }   // 100% -> bin 4 (clamped)
        ],
        // Bin 0 (0-20%): 1 (0)
        // Bin 1 (20-40%): 1 (39.8%)
        // Bin 2 (40-60%): 1 (40%)
        // Bin 3 (60-80%): 0
        // Bin 4 (80-100%): 2 (80%, 100%)
        expectedBinCounts: [1, 1, 1, 0, 2]
    }
};

export interface HandComputedQuestionAnalyticsFixture {
    questions: Array<{ questionNumber: number; maxMarks: number }>;
    observations: Array<{ questionNumber: number; score: number; maxMarks: number }>;
    expected: Array<{
        questionNumber: number;
        maxMarks: number;
        gradedCount: number;
        meanScorePercentage: number | null;
        standardDeviationPercentagePoints: number | null;
        difficultyIndexPercentage: number | null;
    }>;
}

export const HAND_COMPUTED_QUESTION_FIXTURE: HandComputedQuestionAnalyticsFixture = {
    questions: [
        { questionNumber: 1, maxMarks: 25 },
        { questionNumber: 2, maxMarks: 50 },
        { questionNumber: 3, maxMarks: 20 }
    ],
    observations: [
        // Q1: max 25
        // scores: 20 (80%), 25 (100%), 15 (60%)
        // mean% = 80%, stdDev% = sqrt(800/3) ~ 16.32993, difficulty% = 20%
        { questionNumber: 1, score: 20, maxMarks: 25 },
        { questionNumber: 1, score: 25, maxMarks: 25 },
        { questionNumber: 1, score: 15, maxMarks: 25 },
        // Invalid observation for Q1 (score > maxMarks)
        { questionNumber: 1, score: 30, maxMarks: 25 },

        // Q2: max 50
        // scores: 10 (20%), 15 (30%), 20 (40%), 25 (50%)
        // mean% = 35%, stdDev% = sqrt(125) ~ 11.18034, difficulty% = 65%
        { questionNumber: 2, score: 10, maxMarks: 50 },
        { questionNumber: 2, score: 15, maxMarks: 50 },
        { questionNumber: 2, score: 20, maxMarks: 50 },
        { questionNumber: 2, score: 25, maxMarks: 50 },

        // Q3: no valid observations
        // Invalid observation for Q3 (negative score)
        { questionNumber: 3, score: -5, maxMarks: 20 },
        // Unknown question observation
        { questionNumber: 99, score: 10, maxMarks: 10 }
    ],
    expected: [
        {
            questionNumber: 1,
            maxMarks: 25,
            gradedCount: 3,
            meanScorePercentage: 80,
            standardDeviationPercentagePoints: Math.sqrt(800 / 3),
            difficultyIndexPercentage: 20
        },
        {
            questionNumber: 2,
            maxMarks: 50,
            gradedCount: 4,
            meanScorePercentage: 35,
            standardDeviationPercentagePoints: Math.sqrt(125),
            difficultyIndexPercentage: 65
        },
        {
            questionNumber: 3,
            maxMarks: 20,
            gradedCount: 0,
            meanScorePercentage: null,
            standardDeviationPercentagePoints: null,
            difficultyIndexPercentage: null
        }
    ]
};

export interface HandComputedConsistencyFixture {
    observations: Array<{
        graderId: string;
        comparableGroup: string;
        scorePercentage: number;
    }>;
    expected: Array<{
        graderId: string;
        comparisonCount: number;
        meanAbsoluteDeviationPercentagePoints: number;
        sampleSizeStatus: 'SUFFICIENT' | 'INSUFFICIENT';
    }>;
}

export const HAND_COMPUTED_CONSISTENCY_FIXTURE: HandComputedConsistencyFixture = {
    observations: [
        // Group A: 2 graders (ta-1 and ta-2)
        // Scores: ta-1: 70%, 80%, 90% | ta-2: 90%, 80%
        // Group sum = 410, count = 5, group mean = 82%
        // Deviations:
        // ta-1: |70-82|=12, |80-82|=2, |90-82|=8
        // ta-2: |90-82|=8, |80-82|=2
        { graderId: 'ta-1', comparableGroup: 'group-A', scorePercentage: 70 },
        { graderId: 'ta-2', comparableGroup: 'group-A', scorePercentage: 90 },
        { graderId: 'ta-1', comparableGroup: 'group-A', scorePercentage: 80 },
        { graderId: 'ta-2', comparableGroup: 'group-A', scorePercentage: 80 },
        { graderId: 'ta-1', comparableGroup: 'group-A', scorePercentage: 90 },

        // Group B: 2 graders (ta-1 and ta-2)
        // Scores: ta-1: 60%, 70% | ta-2: 80%
        // Group sum = 210, count = 3, group mean = 70%
        // Deviations:
        // ta-1: |60-70|=10, |70-70|=0
        // ta-2: |80-70|=10
        { graderId: 'ta-1', comparableGroup: 'group-B', scorePercentage: 60 },
        { graderId: 'ta-2', comparableGroup: 'group-B', scorePercentage: 80 },
        { graderId: 'ta-1', comparableGroup: 'group-B', scorePercentage: 70 },

        // Group C: Single grader only (ta-1) -> MUST be excluded because cohort mean cannot compare graders
        { graderId: 'ta-1', comparableGroup: 'group-C', scorePercentage: 85 },
        { graderId: 'ta-1', comparableGroup: 'group-C', scorePercentage: 95 },

        // Invalid observations (negative, >100, non-finite)
        { graderId: 'ta-1', comparableGroup: 'group-A', scorePercentage: -10 },
        { graderId: 'ta-2', comparableGroup: 'group-A', scorePercentage: 110 },
        { graderId: 'ta-1', comparableGroup: 'group-A', scorePercentage: Number.NaN }
    ],
    expected: [
        // ta-1 total valid comparisons across groups A & B:
        // deviations: [12, 2, 8, 10, 0] -> sum = 32, count = 5
        // MAD = 32 / 5 = 6.4
        // count 5 >= 5 -> SUFFICIENT
        {
            graderId: 'ta-1',
            comparisonCount: 5,
            meanAbsoluteDeviationPercentagePoints: 6.4,
            sampleSizeStatus: 'SUFFICIENT'
        },
        // ta-2 total valid comparisons across groups A & B:
        // deviations: [8, 2, 10] -> sum = 20, count = 3
        // MAD = 20 / 3 = 6.666666666666667
        // count 3 < 5 -> INSUFFICIENT
        {
            graderId: 'ta-2',
            comparisonCount: 3,
            meanAbsoluteDeviationPercentagePoints: 20 / 3,
            sampleSizeStatus: 'INSUFFICIENT'
        }
    ]
};

