import { describe, it, expect } from 'vitest';
import { HandwritingProfileBuilder, HandwritingSampleInput } from '../services/handwriting/HandwritingProfileBuilder';
import { HandwritingFixtureGenerator } from './fixtures/HandwritingFixtureGenerator';
import {
    IHandwritingFeatures,
    ProfileStatus,
    SampleExtractionStatus
} from '../models/HandwritingConsistency';

/**
 * Creates a synthetic valid IHandwritingFeatures object with a custom rawVector
 */
function createMockFeatures(rawVector: number[]): IHandwritingFeatures {
    return {
        inkDensity: rawVector[0],
        horizontalProjection: { mean: 0.1, variance: 0.01, peakCount: 5 },
        verticalProjection: { mean: 0.1, variance: 0.01 },
        estimatedLineSpacing: 40,
        strokeWidthProxy: { mean: 2.0, variance: 0.5, median: 2.0 },
        slantAngle: 12,
        connectedComponents: { count: 30, meanArea: 25, meanAspectRatio: 1.2 },
        normalizedDimensions: { width: 1.0, height: 1.0 },
        quality: {
            contrast: 0.8,
            sharpnessScore: 0.7,
            noiseRatio: 0.01,
            strokeCount: 30,
            isSufficient: true,
            isBlank: false,
            isDiagramHeavy: false
        },
        rawVector
    };
}

describe('HandwritingProfileBuilder (Phase 2)', () => {
    const builder = new HandwritingProfileBuilder();

    describe('1. Minimum Sample Count and Profile Status', () => {
        it('should mark profile as PROVISIONAL when only 1 or 2 valid samples are provided', async () => {
            const sample1: HandwritingSampleInput = {
                sampleId: 'sample-001',
                features: createMockFeatures([0.2, 0.3, 0.4, 0.5, 0.2, 0.1, 0.6, 0.4]),
                status: SampleExtractionStatus.VALID
            };
            const sample2: HandwritingSampleInput = {
                sampleId: 'sample-002',
                features: createMockFeatures([0.22, 0.31, 0.41, 0.52, 0.21, 0.11, 0.61, 0.42]),
                status: SampleExtractionStatus.VALID
            };

            // 1 sample
            const res1 = await builder.buildProfile('student-123', [sample1]);
            expect(res1.profile.status).toBe(ProfileStatus.PROVISIONAL);
            expect(res1.profile.sampleCount).toBe(1);
            expect(res1.profile.samplesUsed).toEqual(['sample-001']);
            // 1 sample has 0 std dev
            expect(res1.profile.featureStdDevs.every(sd => sd === 0)).toBe(true);

            // 2 samples
            const res2 = await builder.buildProfile('student-123', [sample1, sample2]);
            expect(res2.profile.status).toBe(ProfileStatus.PROVISIONAL);
            expect(res2.profile.sampleCount).toBe(2);
            expect(res2.profile.samplesUsed).toEqual(['sample-001', 'sample-002']);
        });

        it('should mark profile as ESTABLISHED when 3 or more valid samples are provided', async () => {
            const buf1 = HandwritingFixtureGenerator.createConsistentSample(10);
            const buf2 = HandwritingFixtureGenerator.createConsistentSample(20);
            const buf3 = HandwritingFixtureGenerator.createConsistentSample(30);

            const result = await builder.buildProfile('student-est', [
                { sampleId: 'img-1', imageBuffer: buf1 },
                { sampleId: 'img-2', imageBuffer: buf2 },
                { sampleId: 'img-3', imageBuffer: buf3 }
            ]);

            expect(result.profile.status).toBe(ProfileStatus.ESTABLISHED);
            expect(result.profile.sampleCount).toBe(3);
            expect(result.profile.samplesUsed).toEqual(['img-1', 'img-2', 'img-3']);
            expect(result.acceptedSamples).toHaveLength(3);
            expect(result.rejectedSamples).toHaveLength(0);
        });

        it('should return PROVISIONAL with 0 samples if empty sample list is provided', async () => {
            const result = await builder.buildProfile('student-empty', []);
            expect(result.profile.status).toBe(ProfileStatus.PROVISIONAL);
            expect(result.profile.sampleCount).toBe(0);
            expect(result.profile.samplesUsed).toEqual([]);
            expect(result.profile.featureMeans).toEqual(new Array(8).fill(0));
            expect(result.profile.featureStdDevs).toEqual(new Array(8).fill(0));
        });
    });

    describe('2. Disqualification and Exclusion of Invalid Samples', () => {
        it('should exclude rejected samples and not allow them to contribute to the profile', async () => {
            const validBuffer1 = HandwritingFixtureGenerator.createConsistentSample(50);
            const validBuffer2 = HandwritingFixtureGenerator.createConsistentSample(51);
            const blankBuffer = HandwritingFixtureGenerator.createBlankSample();
            const diagramBuffer = HandwritingFixtureGenerator.createDiagramSample();
            const insufficientBuffer = HandwritingFixtureGenerator.createInsufficientSample();

            const result = await builder.buildProfile('student-mix', [
                { sampleId: 'valid-1', imageBuffer: validBuffer1 },
                { sampleId: 'blank-1', imageBuffer: blankBuffer },
                { sampleId: 'valid-2', imageBuffer: validBuffer2 },
                { sampleId: 'diagram-1', imageBuffer: diagramBuffer },
                { sampleId: 'insufficient-1', imageBuffer: insufficientBuffer }
            ]);

            // Only the 2 valid samples must be accepted
            expect(result.acceptedSamples).toHaveLength(2);
            expect(result.profile.sampleCount).toBe(2);
            // With only 2 accepted samples, profile remains PROVISIONAL
            expect(result.profile.status).toBe(ProfileStatus.PROVISIONAL);
            expect(result.profile.samplesUsed).toEqual(['valid-1', 'valid-2']);

            // The 3 bad samples must be in rejectedSamples with corresponding reasons
            expect(result.rejectedSamples).toHaveLength(3);
            const rejectedIds = result.rejectedSamples.map(r => r.sampleId);
            expect(rejectedIds).toContain('blank-1');
            expect(rejectedIds).toContain('diagram-1');
            expect(rejectedIds).toContain('insufficient-1');
        });

        it('should reject pre-flagged non-valid sample inputs', async () => {
            const samplePreRejected: HandwritingSampleInput = {
                sampleId: 'pre-rej',
                status: SampleExtractionStatus.BLANK,
                disqualificationReason: 'Manual TA rejection'
            };
            const sampleValid: HandwritingSampleInput = {
                sampleId: 'pre-val',
                features: createMockFeatures([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
                status: SampleExtractionStatus.VALID
            };

            const result = await builder.buildProfile('student-rej', [samplePreRejected, sampleValid]);
            expect(result.acceptedSamples).toHaveLength(1);
            expect(result.rejectedSamples).toHaveLength(1);
            expect(result.rejectedSamples[0].sampleId).toBe('pre-rej');
        });
    });

    describe('3. Mathematical Correctness of Feature Statistics', () => {
        it('should calculate accurate feature means across multiple samples', async () => {
            const s1: HandwritingSampleInput = {
                sampleId: 's1',
                features: createMockFeatures([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
                status: SampleExtractionStatus.VALID
            };
            const s2: HandwritingSampleInput = {
                sampleId: 's2',
                features: createMockFeatures([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]),
                status: SampleExtractionStatus.VALID
            };
            const s3: HandwritingSampleInput = {
                sampleId: 's3',
                features: createMockFeatures([0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]),
                status: SampleExtractionStatus.VALID
            };

            const result = await builder.buildProfile('student-stats', [s1, s2, s3]);
            const means = result.profile.featureMeans;

            // Feature 0: (0.1 + 0.2 + 0.3) / 3 = 0.2
            expect(means[0]).toBe(0.2);
            // Feature 1: (0.2 + 0.3 + 0.4) / 3 = 0.3
            expect(means[1]).toBe(0.3);
            // Feature 7: (0.8 + 0.9 + 1.0) / 3 = 0.9
            expect(means[7]).toBe(0.9);
        });

        it('should calculate accurate sample standard deviations with Bessel correction', async () => {
            // Values: 0.1, 0.2, 0.3 -> mean = 0.2
            // Sum of squared diffs: (0.1-0.2)^2 + (0.2-0.2)^2 + (0.3-0.2)^2 = 0.01 + 0 + 0.01 = 0.02
            // Sample variance (N - 1 = 2): 0.02 / 2 = 0.01 -> stdDev = sqrt(0.01) = 0.1
            const s1: HandwritingSampleInput = {
                sampleId: 's1',
                features: createMockFeatures([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]),
                status: SampleExtractionStatus.VALID
            };
            const s2: HandwritingSampleInput = {
                sampleId: 's2',
                features: createMockFeatures([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]),
                status: SampleExtractionStatus.VALID
            };
            const s3: HandwritingSampleInput = {
                sampleId: 's3',
                features: createMockFeatures([0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]),
                status: SampleExtractionStatus.VALID
            };

            const result = await builder.buildProfile('student-stddev', [s1, s2, s3]);
            for (let f = 0; f < 8; f++) {
                expect(result.profile.featureStdDevs[f]).toBe(0.1);
            }
        });

        it('should support population standard deviation when configured', async () => {
            const popBuilder = new HandwritingProfileBuilder(undefined, { varianceType: 'population' });
            const s1: HandwritingSampleInput = {
                sampleId: 's1',
                features: createMockFeatures([0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1]),
                status: SampleExtractionStatus.VALID
            };
            const s2: HandwritingSampleInput = {
                sampleId: 's2',
                features: createMockFeatures([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2]),
                status: SampleExtractionStatus.VALID
            };
            const s3: HandwritingSampleInput = {
                sampleId: 's3',
                features: createMockFeatures([0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]),
                status: SampleExtractionStatus.VALID
            };

            const result = await popBuilder.buildProfile('student-pop', [s1, s2, s3]);
            // Population variance: 0.02 / 3 = 0.0066667 -> sqrt = 0.081649... -> rounded to 4 decimals = 0.0816
            for (let f = 0; f < 8; f++) {
                expect(result.profile.featureStdDevs[f]).toBe(0.0816);
            }
        });

        it('should handle zero or near-zero standard deviation safely without NaN or Infinity', async () => {
            const identicalFeatures = [0.45, 0.30, 0.25, 0.50, 0.15, 0.05, 0.60, 0.40];
            const s1: HandwritingSampleInput = {
                sampleId: 's1',
                features: createMockFeatures(identicalFeatures),
                status: SampleExtractionStatus.VALID
            };
            const s2: HandwritingSampleInput = {
                sampleId: 's2',
                features: createMockFeatures(identicalFeatures),
                status: SampleExtractionStatus.VALID
            };
            const s3: HandwritingSampleInput = {
                sampleId: 's3',
                features: createMockFeatures(identicalFeatures),
                status: SampleExtractionStatus.VALID
            };

            const result = await builder.buildProfile('student-zero-var', [s1, s2, s3]);
            expect(result.profile.status).toBe(ProfileStatus.ESTABLISHED);
            for (let f = 0; f < 8; f++) {
                expect(result.profile.featureStdDevs[f]).toBe(0);
                expect(Number.isFinite(result.profile.featureStdDevs[f])).toBe(true);
            }
        });
    });

    describe('4. Immutability and Determinism', () => {
        it('should not mutate the original sample input objects', async () => {
            const originalVec = [0.12, 0.34, 0.56, 0.78, 0.90, 0.11, 0.22, 0.33];
            const originalFeatures = createMockFeatures([...originalVec]);
            const originalSample: HandwritingSampleInput = {
                sampleId: 'sample-immutable',
                features: originalFeatures,
                status: SampleExtractionStatus.VALID
            };

            const sampleSnapshot = JSON.parse(JSON.stringify(originalSample));

            await builder.buildProfile('student-immutability', [
                originalSample,
                { sampleId: 's2', features: createMockFeatures([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]), status: SampleExtractionStatus.VALID },
                { sampleId: 's3', features: createMockFeatures([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]), status: SampleExtractionStatus.VALID }
            ]);

            // Assert original sample was not modified
            expect(JSON.parse(JSON.stringify(originalSample))).toEqual(sampleSnapshot);
        });

        it('should produce strictly deterministic output on repeated builds', async () => {
            const buf1 = HandwritingFixtureGenerator.createConsistentSample(101);
            const buf2 = HandwritingFixtureGenerator.createConsistentSample(102);
            const buf3 = HandwritingFixtureGenerator.createConsistentSample(103);

            const samples: HandwritingSampleInput[] = [
                { sampleId: 'det-1', imageBuffer: buf1 },
                { sampleId: 'det-2', imageBuffer: buf2 },
                { sampleId: 'det-3', imageBuffer: buf3 }
            ];

            const run1 = await builder.buildProfile('student-det', samples);
            const run2 = await builder.buildProfile('student-det', samples);

            expect(run1.profile.featureMeans).toEqual(run2.profile.featureMeans);
            expect(run1.profile.featureStdDevs).toEqual(run2.profile.featureStdDevs);
            expect(run1.profile.status).toBe(run2.profile.status);
            expect(run1.profile.samplesUsed).toEqual(run2.profile.samplesUsed);
        });
    });
});
