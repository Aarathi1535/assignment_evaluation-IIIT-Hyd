export interface DescriptiveStatistics {
    count: number;
    mean: number | null;
    median: number | null;
    standardDeviation: number | null;
}

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
