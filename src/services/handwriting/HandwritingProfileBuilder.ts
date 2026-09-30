import {
    IBoundingBox,
    IHandwritingFeatures,
    IHandwritingProfileData,
    IHandwritingSampleMetadata,
    ProfileStatus,
    SampleExtractionStatus
} from '../../models/HandwritingConsistency';
import { HandwritingFeatureExtractor } from './HandwritingFeatureExtractor';

export interface HandwritingSampleInput {
    sampleId: string;
    studentId?: string;
    imageBuffer?: Buffer;
    boundingBox?: IBoundingBox;
    features?: IHandwritingFeatures;
    status?: SampleExtractionStatus;
    disqualificationReason?: string;
    pageNumber?: number;
    answerScriptId?: string;
    extractedAt?: Date;
}

export interface ProfileBuildAcceptedSample {
    sampleId: string;
    features: IHandwritingFeatures;
    metadata: IHandwritingSampleMetadata;
}

export interface ProfileBuildRejectedSample {
    sampleId: string;
    status: SampleExtractionStatus;
    reason?: string;
}

export interface ProfileBuildResult {
    profile: IHandwritingProfileData;
    acceptedSamples: ProfileBuildAcceptedSample[];
    rejectedSamples: ProfileBuildRejectedSample[];
}

export interface ProfileBuilderOptions {
    /**
     * Minimum valid samples required to transition status from PROVISIONAL to ESTABLISHED.
     * Default: 3
     */
    minEstablishedSamples?: number;

    /**
     * Variance calculation type:
     * - 'sample': Bessel-corrected sample standard deviation (N - 1 denominator for N > 1)
     * - 'population': Population standard deviation (N denominator)
     * Default: 'sample'
     */
    varianceType?: 'sample' | 'population';

    /**
     * Decimal places for deterministic rounding.
     * Default: 4
     */
    precision?: number;
}

/**
 * Deterministic multi-sample handwriting profile builder.
 * Aggregates verified handwriting samples for a student, runs feature extraction
 * via HandwritingFeatureExtractor (or consumes pre-extracted features), filters out
 * rejected or poor-quality samples, and computes per-feature mean and standard deviation.
 */
export class HandwritingProfileBuilder {
    private readonly featureExtractor: HandwritingFeatureExtractor;
    private readonly minEstablishedSamples: number;
    private readonly varianceType: 'sample' | 'population';
    private readonly precision: number;

    constructor(
        featureExtractor?: HandwritingFeatureExtractor,
        options?: ProfileBuilderOptions
    ) {
        this.featureExtractor = featureExtractor || new HandwritingFeatureExtractor();
        this.minEstablishedSamples = options?.minEstablishedSamples ?? 3;
        this.varianceType = options?.varianceType ?? 'sample';
        this.precision = options?.precision ?? 4;
    }

    /**
     * Builds a handwriting profile for a student from an array of sample inputs.
     * Does NOT mutate the input sample objects.
     */
    public async buildProfile(
        studentId: string,
        samples: readonly HandwritingSampleInput[]
    ): Promise<ProfileBuildResult> {
        const acceptedSamples: ProfileBuildAcceptedSample[] = [];
        const rejectedSamples: ProfileBuildRejectedSample[] = [];

        // 1. Process and validate each sample
        for (const sample of samples) {
            // Defensive check: ensure original sample is not mutated
            const sampleId = sample.sampleId;

            // Scenario A: Pre-extracted features provided
            if (sample.features) {
                if (sample.status && sample.status !== SampleExtractionStatus.VALID) {
                    rejectedSamples.push({
                        sampleId,
                        status: sample.status,
                        reason: sample.disqualificationReason || `Pre-flagged status: ${sample.status}`
                    });
                    continue;
                }

                // Validate that features include a valid 8-element raw vector
                if (!Array.isArray(sample.features.rawVector) || sample.features.rawVector.length !== 8) {
                    rejectedSamples.push({
                        sampleId,
                        status: SampleExtractionStatus.ERROR,
                        reason: 'Pre-extracted features missing valid 8-element rawVector'
                    });
                    continue;
                }

                // Check sample sufficiency
                if (sample.features.quality && !sample.features.quality.isSufficient) {
                    rejectedSamples.push({
                        sampleId,
                        status: SampleExtractionStatus.INSUFFICIENT_SAMPLE,
                        reason: 'Sample quality marked as insufficient stroke density'
                    });
                    continue;
                }

                acceptedSamples.push({
                    sampleId,
                    features: sample.features,
                    metadata: {
                        sampleId,
                        answerScriptId: sample.answerScriptId,
                        pageNumber: sample.pageNumber,
                        extractedAt: sample.extractedAt || new Date(),
                        quality: sample.features.quality
                    }
                });
                continue;
            }

            // Scenario B: Image buffer provided - run extraction pipeline
            if (sample.imageBuffer) {
                const extractionResult = await this.featureExtractor.extractFeatures(
                    sample.imageBuffer,
                    sample.boundingBox
                );

                if (extractionResult.status === SampleExtractionStatus.VALID && extractionResult.features) {
                    acceptedSamples.push({
                        sampleId,
                        features: extractionResult.features,
                        metadata: {
                            sampleId,
                            answerScriptId: sample.answerScriptId,
                            pageNumber: sample.pageNumber,
                            extractedAt: sample.extractedAt || new Date(),
                            quality: extractionResult.features.quality
                        }
                    });
                } else {
                    rejectedSamples.push({
                        sampleId,
                        status: extractionResult.status,
                        reason: extractionResult.disqualificationReason || `Extraction returned status ${extractionResult.status}`
                    });
                }
                continue;
            }

            // Scenario C: Neither buffer nor features provided
            rejectedSamples.push({
                sampleId,
                status: SampleExtractionStatus.ERROR,
                reason: 'Neither image buffer nor feature vector provided'
            });
        }

        // 2. Compute per-feature statistics across accepted samples
        const sampleCount = acceptedSamples.length;
        const featureMeans: number[] = new Array(8).fill(0);
        const featureStdDevs: number[] = new Array(8).fill(0);

        if (sampleCount > 0) {
            // Calculate means
            for (let f = 0; f < 8; f++) {
                let sum = 0;
                for (const acc of acceptedSamples) {
                    sum += acc.features.rawVector[f];
                }
                const mean = sum / sampleCount;
                featureMeans[f] = Number(mean.toFixed(this.precision));
            }

            // Calculate standard deviations
            if (sampleCount >= 2) {
                const denominator = this.varianceType === 'population' ? sampleCount : (sampleCount - 1);
                for (let f = 0; f < 8; f++) {
                    const mean = featureMeans[f];
                    let sqDiffSum = 0;
                    for (const acc of acceptedSamples) {
                        const diff = acc.features.rawVector[f] - mean;
                        sqDiffSum += diff * diff;
                    }
                    const variance = Math.max(0, sqDiffSum / denominator);
                    const stdDev = Math.sqrt(variance);
                    // Safe numerical precision handling - avoid NaN/Infinity
                    featureStdDevs[f] = Number((Number.isFinite(stdDev) ? stdDev : 0).toFixed(this.precision));
                }
            } else {
                // If only 1 sample, variance cannot be established across multiple samples; stdDev is 0
                for (let f = 0; f < 8; f++) {
                    featureStdDevs[f] = 0;
                }
            }
        }

        // 3. Determine profile status
        const status = sampleCount >= this.minEstablishedSamples
            ? ProfileStatus.ESTABLISHED
            : ProfileStatus.PROVISIONAL;

        const profile: IHandwritingProfileData = {
            studentId,
            sampleCount,
            featureMeans,
            featureStdDevs,
            status,
            samplesUsed: acceptedSamples.map(s => s.sampleId),
            sampleMetadata: acceptedSamples.map(s => s.metadata),
            createdAt: new Date(),
            updatedAt: new Date()
        };

        return {
            profile,
            acceptedSamples,
            rejectedSamples
        };
    }
}
