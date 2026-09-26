import {
    ComparisonMatchState,
    HANDWRITING_FEATURE_NAMES,
    HandwritingFeatureName,
    IFeatureDeviation,
    IHandwritingComparisonResult,
    IHandwritingFeatures,
    IHandwritingProfileData,
    ProfileStatus,
    SampleExtractionStatus
} from '../../models/HandwritingConsistency';
import { HandwritingFeatureExtractor } from './HandwritingFeatureExtractor';
import { HandwritingSampleInput } from './HandwritingProfileBuilder';

/**
 * PROVISIONAL ENGINEERING THRESHOLDS
 *
 * IMPORTANT ARCHITECTURAL DISCLAIMER:
 * These thresholds are provisional engineering heuristics configured for deterministic testing,
 * algorithmic validation, and pipeline development. They do NOT represent scientifically or
 * forensically validated biometric identity verification cutoffs.
 *
 * Real-world production deployment requires rigorous calibration against verified multi-writer
 * handwriting datasets across varied digitizing devices, scanners, and pen types.
 */
export interface HandwritingComparisonThresholds {
    /**
     * Minimum valid baseline samples required to perform comparison.
     * Profiles below this count return INSUFFICIENT_SAMPLE.
     * Default: 3
     */
    minBaselineSamples: number;

    /**
     * Standard deviation lower bound to prevent division-by-zero or excessive
     * z-score magnification on near-zero baseline variance.
     * Default: 0.02
     */
    minStdDevFloor: number;

    /**
     * Maximum aggregate distance threshold below which a sample is classified as MATCH.
     * Default: 0.38
     */
    matchDistanceThreshold: number;

    /**
     * Minimum aggregate distance threshold above which a sample triggers REVIEW_REQUIRED
     * if multiple features deviate.
     * Default: 0.50
     */
    reviewDistanceThreshold: number;

    /**
     * Normalized z-score deviation threshold for a single feature to qualify as deviating.
     * Default: 2.5
     */
    featureDeviationZThreshold: number;

    /**
     * Minimum absolute difference required alongside z-score to avoid false alarms
     * on minuscule feature variance.
     * Default: 0.04
     */
    minAbsoluteDiff: number;

    /**
     * Minimum number of deviating features required to trigger REVIEW_REQUIRED.
     * Protects against single isolated feature fluctuations.
     * Default: 2
     */
    minDeviatingFeaturesForReview: number;

    /**
     * Confidence threshold below which a decision becomes INCONCLUSIVE.
     * Default: 0.45
     */
    minConfidenceThreshold: number;
}

export const DEFAULT_COMPARISON_THRESHOLDS: HandwritingComparisonThresholds = {
    minBaselineSamples: 3,
    minStdDevFloor: 0.02,
    matchDistanceThreshold: 0.38,
    reviewDistanceThreshold: 0.50,
    featureDeviationZThreshold: 2.5,
    minAbsoluteDiff: 0.04,
    minDeviatingFeaturesForReview: 2,
    minConfidenceThreshold: 0.45
};

/**
 * Deterministic handwriting comparison engine.
 * Evaluates a new handwriting sample against an established or provisional student profile
 * using variance-normalized distance metrics and feature-level contribution analysis.
 *
 * NOTE: Flags are strictly investigative consistency/anomaly indicators (e.g. REVIEW_REQUIRED).
 * NEVER classifies or reports any result as plagiarism or cheating.
 */
export class HandwritingComparisonEngine {
    private readonly featureExtractor: HandwritingFeatureExtractor;
    private readonly thresholds: HandwritingComparisonThresholds;

    constructor(
        featureExtractor?: HandwritingFeatureExtractor,
        thresholds?: Partial<HandwritingComparisonThresholds>
    ) {
        this.featureExtractor = featureExtractor || new HandwritingFeatureExtractor();
        this.thresholds = {
            ...DEFAULT_COMPARISON_THRESHOLDS,
            ...thresholds
        };
    }

    /**
     * Gets the active comparison thresholds.
     */
    public getThresholds(): HandwritingComparisonThresholds {
        return { ...this.thresholds };
    }

    /**
     * Compares a handwriting sample against a student profile.
     */
    public async compare(
        profile: IHandwritingProfileData,
        sampleInput: HandwritingSampleInput
    ): Promise<IHandwritingComparisonResult> {
        const comparedAt = new Date();

        // 1. Resolve and validate new sample features
        let sampleFeatures: IHandwritingFeatures | undefined;
        let disqualificationReason: string | undefined;

        if (sampleInput.features) {
            if (sampleInput.status && sampleInput.status !== SampleExtractionStatus.VALID) {
                disqualificationReason = sampleInput.disqualificationReason || `Pre-flagged status: ${sampleInput.status}`;
            } else if (!Array.isArray(sampleInput.features.rawVector) || sampleInput.features.rawVector.length !== 8) {
                disqualificationReason = 'Sample features missing valid 8-element rawVector';
            } else if (sampleInput.features.quality && !sampleInput.features.quality.isSufficient) {
                disqualificationReason = 'Sample quality marked as insufficient stroke density';
            } else {
                sampleFeatures = sampleInput.features;
            }
        } else if (sampleInput.imageBuffer) {
            const extractionResult = await this.featureExtractor.extractFeatures(
                sampleInput.imageBuffer,
                sampleInput.boundingBox
            );

            if (extractionResult.status === SampleExtractionStatus.VALID && extractionResult.features) {
                sampleFeatures = extractionResult.features;
            } else {
                disqualificationReason = extractionResult.disqualificationReason || `Extraction failed with status: ${extractionResult.status}`;
            }
        } else {
            disqualificationReason = 'Neither image buffer nor feature vector provided';
        }

        // Handle rejected or poor-quality sample
        if (!sampleFeatures) {
            return {
                status: ComparisonMatchState.UNASSESSED,
                distance: 0,
                confidence: 0,
                featureDeviations: [],
                anomalyFactors: [
                    disqualificationReason
                        ? `Sample rejected during quality validation: ${disqualificationReason}`
                        : 'Sample rejected during quality validation'
                ],
                comparedAt,
                disqualificationReason
            };
        }

        // 2. Validate baseline profile sufficiency
        const isBaselineInsufficient =
            !profile ||
            profile.sampleCount < this.thresholds.minBaselineSamples ||
            profile.status === ProfileStatus.PROVISIONAL ||
            !Array.isArray(profile.featureMeans) ||
            profile.featureMeans.length < 8;

        if (isBaselineInsufficient) {
            return {
                status: ComparisonMatchState.INSUFFICIENT_SAMPLE,
                distance: 0,
                confidence: 0,
                sampleQuality: sampleFeatures.quality,
                featureDeviations: [],
                anomalyFactors: [
                    `Insufficient baseline samples to establish a reliable handwriting profile (profile has ${profile?.sampleCount ?? 0} samples, minimum ${this.thresholds.minBaselineSamples} required)`
                ],
                comparedAt
            };
        }

        // 3. Compute per-feature normalized deviations and raw anomaly scores
        const featureDeviations: IFeatureDeviation[] = [];
        const anomalyFactors: string[] = [];
        const rawScores: number[] = new Array(8).fill(0);
        let totalScore = 0;
        let sumSquaredCappedDev = 0;

        for (let k = 0; k < 8; k++) {
            const featureName: HandwritingFeatureName = HANDWRITING_FEATURE_NAMES[k];
            const baselineMean = profile.featureMeans[k];
            const baselineStdDev = profile.featureStdDevs?.[k] ?? 0;
            const observed = sampleFeatures.rawVector[k];

            // Robust standard deviation floor to prevent division-by-zero or extreme magnification
            const effectiveStdDev = Math.max(baselineStdDev, this.thresholds.minStdDevFloor);
            const absDiff = Math.abs(observed - baselineMean);
            const zScore = absDiff / effectiveStdDev;

            // Safe numerical formatting
            const normalizedDeviation = Number(zScore.toFixed(4));
            const rawScore = zScore * zScore;
            rawScores[k] = rawScore;
            totalScore += rawScore;

            // Soft-capped divergence component for bounded aggregate distance:
            // Capped at 1.0 when z >= 3 to prevent a single outlier from dominating
            const cappedComponent = Math.min(1.0, absDiff / (3 * effectiveStdDev));
            sumSquaredCappedDev += cappedComponent * cappedComponent;

            // Flag individual feature anomaly
            const isDeviating =
                zScore >= this.thresholds.featureDeviationZThreshold &&
                absDiff >= this.thresholds.minAbsoluteDiff;

            if (isDeviating) {
                anomalyFactors.push(
                    `Significant deviation in ${featureName} (observed: ${observed.toFixed(4)}, baseline: ${baselineMean.toFixed(4)}, z: ${zScore.toFixed(2)})`
                );
            }

            featureDeviations.push({
                feature: featureName,
                baselineMean: Number(baselineMean.toFixed(4)),
                baselineStdDev: Number(baselineStdDev.toFixed(4)),
                observed: Number(observed.toFixed(4)),
                normalizedDeviation,
                contribution: 0 // Computed below
            });
        }

        // 4. Compute relative contributions and sort deterministically
        for (let k = 0; k < 8; k++) {
            const contribution = totalScore > 0
                ? Number((rawScores[k] / totalScore).toFixed(4))
                : 0.1250;
            featureDeviations[k].contribution = contribution;
        }

        // Deterministic sort: descending by contribution, tie-break alphabetically by feature name
        featureDeviations.sort((a, b) => {
            if (Math.abs(b.contribution - a.contribution) > 0.00001) {
                return b.contribution - a.contribution;
            }
            return String(a.feature).localeCompare(String(b.feature));
        });

        // 5. Aggregate distance calculation (deterministic bounded RMS distance)
        const aggregateDistance = Math.sqrt(sumSquaredCappedDev / 8);
        const distance = Number(aggregateDistance.toFixed(4));

        // 6. Confidence estimation based on sample count and image quality
        const sampleCountFactor = Math.min(1.0, 0.5 + 0.1 * profile.sampleCount);
        const q = sampleFeatures.quality;
        const qualityFactor = q
            ? Math.min(1.0, (q.contrast * 0.6 + q.sharpnessScore * 0.4)) * (1.0 - Math.min(1.0, q.noiseRatio))
            : 0.8;
        const rawConfidence = sampleCountFactor * qualityFactor;
        const confidence = Number(Math.max(0.0, Math.min(1.0, rawConfidence)).toFixed(4));

        // 7. Decision logic based on multi-feature evidence
        const deviatingFeatureCount = anomalyFactors.length;
        let status: ComparisonMatchState;

        if (
            deviatingFeatureCount >= this.thresholds.minDeviatingFeaturesForReview &&
            distance >= this.thresholds.reviewDistanceThreshold
        ) {
            // Multiple meaningful deviations indicate manual verification is warranted
            status = ComparisonMatchState.REVIEW_REQUIRED;
        } else if (
            distance <= this.thresholds.matchDistanceThreshold &&
            deviatingFeatureCount < this.thresholds.minDeviatingFeaturesForReview
        ) {
            // Consistent with profile; check confidence
            if (confidence < this.thresholds.minConfidenceThreshold) {
                status = ComparisonMatchState.INCONCLUSIVE;
            } else {
                status = ComparisonMatchState.MATCH;
            }
        } else {
            // Ambiguous evidence: e.g. single isolated feature deviation, moderate distance, or borderline confidence
            status = ComparisonMatchState.INCONCLUSIVE;
        }

        return {
            status,
            distance,
            confidence,
            sampleQuality: sampleFeatures.quality,
            featureDeviations,
            anomalyFactors,
            comparedAt
        };
    }
}
