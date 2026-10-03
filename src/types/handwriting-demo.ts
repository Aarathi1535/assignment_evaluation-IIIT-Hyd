/** Browser-safe contract for the handwriting research demo API. */
export const ComparisonMatchState = {
    MATCH: 'MATCH',
    REVIEW_REQUIRED: 'REVIEW_REQUIRED',
    INCONCLUSIVE: 'INCONCLUSIVE',
    INSUFFICIENT_SAMPLE: 'INSUFFICIENT_SAMPLE',
    UNASSESSED: 'UNASSESSED'
} as const;

export type HandwritingDemoAction = 'load' | 'analyze';
export type DemoComparisonStatus = typeof ComparisonMatchState[keyof typeof ComparisonMatchState];
export type DemoSampleStatus = 'VALID' | 'INSUFFICIENT_SAMPLE' | 'BLANK' | 'DIAGRAM_REJECTED' | 'ERROR';
export type DemoProfileStatus = 'PROVISIONAL' | 'ESTABLISHED' | 'STALE';

export interface HandwritingDemoFeatures {
    inkDensity: number;
    horizontalProjection: { mean: number; variance: number; peakCount: number };
    verticalProjection: { mean: number; variance: number };
    estimatedLineSpacing: number;
    strokeWidthProxy: { mean: number; variance: number; median: number };
    slantAngle: number;
    connectedComponents: { count: number; meanArea: number; meanAspectRatio: number };
    normalizedDimensions: { width: number; height: number };
    quality: {
        contrast: number; sharpnessScore: number; noiseRatio: number; strokeCount: number;
        isSufficient: boolean; isBlank: boolean; isDiagramHeavy: boolean;
    };
    rawVector: number[];
}

export interface HandwritingDemoPage {
    pageNumber: number;
    label: string;
    imageDataUrl: string;
}

export interface HandwritingDemoRegion {
    regionId: string;
    questionNumber: number;
    pageNumber: number;
    label: string;
    boundingBox: { x: number; y: number; width: number; height: number };
    status?: DemoSampleStatus;
    features?: HandwritingDemoFeatures;
    disqualificationReason?: string;
}

export interface HandwritingDemoComparison {
    regionId: string;
    questionNumber: number;
    pageNumber: number;
    comparison: {
        status: DemoComparisonStatus;
        distance: number;
        confidence: number;
        featureDeviations: Array<{
            feature: string;
            baselineMean: number;
            baselineStdDev: number;
            observed: number;
            normalizedDeviation: number;
            contribution: number;
        }>;
        anomalyFactors: string[];
        comparedAt: string;
        disqualificationReason?: string;
        sampleQuality?: HandwritingDemoFeatures['quality'];
    };
}

export interface HandwritingDemoAnalysis {
    pagesAnalyzed: number;
    regionsAnalyzed: number;
    baselineRegionIds: string[];
    profile: {
        studentId: string;
        sampleCount: number;
        featureMeans: number[];
        featureStdDevs: number[];
        status: DemoProfileStatus;
        samplesUsed: string[];
        sampleMetadata?: Array<{
            sampleId: string;
            answerScriptId?: string;
            pageNumber?: number;
            extractedAt?: string;
            quality?: HandwritingDemoFeatures['quality'];
        }>;
        retentionExpiresAt?: string;
        retentionPolicy?: string;
        createdAt: string;
        updatedAt: string;
    };
    comparisons: HandwritingDemoComparison[];
    status: DemoComparisonStatus;
    reviewRequired: boolean;
}

export interface HandwritingDemoResult {
    studentLabel: string;
    examLabel: string;
    pages: HandwritingDemoPage[];
    regions: HandwritingDemoRegion[];
    analysis?: HandwritingDemoAnalysis;
}
