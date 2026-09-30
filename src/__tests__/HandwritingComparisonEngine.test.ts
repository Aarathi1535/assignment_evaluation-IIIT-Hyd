import { describe, it, expect, beforeAll } from 'vitest';
import { HandwritingComparisonEngine } from '../services/handwriting/HandwritingComparisonEngine';
import { HandwritingProfileBuilder } from '../services/handwriting/HandwritingProfileBuilder';
import { HandwritingFixtureGenerator } from './fixtures/HandwritingFixtureGenerator';
import {
    ComparisonMatchState,
    IHandwritingFeatures,
    IHandwritingProfileData,
    ProfileStatus,
    SampleExtractionStatus
} from '../models/HandwritingConsistency';

function createMockFeatures(rawVector: number[], qualityOverrides?: Partial<IHandwritingFeatures['quality']>): IHandwritingFeatures {
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
            isDiagramHeavy: false,
            ...qualityOverrides
        },
        rawVector
    };
}

describe('HandwritingComparisonEngine (Phase 2)', () => {
    const builder = new HandwritingProfileBuilder();
    const engine = new HandwritingComparisonEngine();

    describe('1. Baseline Profile Sufficiency', () => {
        it('should return INSUFFICIENT_SAMPLE when comparing against a PROVISIONAL profile', async () => {
            const provisionalProfile: IHandwritingProfileData = {
                studentId: 'stud-prov',
                sampleCount: 2,
                featureMeans: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
                featureStdDevs: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
                status: ProfileStatus.PROVISIONAL,
                samplesUsed: ['s1', 's2'],
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const sampleInput = {
                sampleId: 'new-sample-1',
                features: createMockFeatures([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]),
                status: SampleExtractionStatus.VALID
            };

            const result = await engine.compare(provisionalProfile, sampleInput);
            expect(result.status).toBe(ComparisonMatchState.INSUFFICIENT_SAMPLE);
            expect(result.distance).toBe(0);
            expect(result.confidence).toBe(0);
            expect(result.anomalyFactors[0]).toContain('Insufficient baseline samples');
        });

        it('should return INSUFFICIENT_SAMPLE when baseline profile has fewer than minBaselineSamples', async () => {
            const incompleteProfile: IHandwritingProfileData = {
                studentId: 'stud-inc',
                sampleCount: 1,
                featureMeans: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
                featureStdDevs: [0, 0, 0, 0, 0, 0, 0, 0],
                status: ProfileStatus.PROVISIONAL,
                samplesUsed: ['s1'],
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const result = await engine.compare(incompleteProfile, {
                sampleId: 's-test',
                features: createMockFeatures([0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5])
            });

            expect(result.status).toBe(ComparisonMatchState.INSUFFICIENT_SAMPLE);
        });
    });

    describe('2. Poor-Quality and Invalid Sample Rejection', () => {
        let establishedProfile: IHandwritingProfileData;

        beforeAll(async () => {
            const b1 = HandwritingFixtureGenerator.createConsistentSample(1);
            const b2 = HandwritingFixtureGenerator.createConsistentSample(2);
            const b3 = HandwritingFixtureGenerator.createConsistentSample(3);

            const buildRes = await builder.buildProfile('test-student', [
                { sampleId: 'b1', imageBuffer: b1 },
                { sampleId: 'b2', imageBuffer: b2 },
                { sampleId: 'b3', imageBuffer: b3 }
            ]);
            establishedProfile = buildRes.profile;
        });

        it('should reject a blank new sample and return UNASSESSED', async () => {
            const blankBuffer = HandwritingFixtureGenerator.createBlankSample();
            const result = await engine.compare(establishedProfile, {
                sampleId: 'blank-sample',
                imageBuffer: blankBuffer
            });

            expect(result.status).toBe(ComparisonMatchState.UNASSESSED);
            expect(result.distance).toBe(0);
            expect(result.disqualificationReason).toContain('blank');
            expect(result.anomalyFactors[0]).toContain('Sample rejected during quality validation');
        });

        it('should reject an insufficient-stroke new sample and return UNASSESSED', async () => {
            const insufficientBuffer = HandwritingFixtureGenerator.createInsufficientSample();
            const result = await engine.compare(establishedProfile, {
                sampleId: 'insufficient-sample',
                imageBuffer: insufficientBuffer
            });

            expect(result.status).toBe(ComparisonMatchState.UNASSESSED);
            expect(result.disqualificationReason).toContain('Insufficient handwriting strokes');
        });

        it('should reject a diagram-only new sample and return UNASSESSED', async () => {
            const diagramBuffer = HandwritingFixtureGenerator.createDiagramSample();
            const result = await engine.compare(establishedProfile, {
                sampleId: 'diagram-sample',
                imageBuffer: diagramBuffer
            });

            expect(result.status).toBe(ComparisonMatchState.UNASSESSED);
            expect(result.disqualificationReason).toContain('geometric');
        });
    });

    describe('3. Consistency, Divergence, and Multi-Feature Anomaly Logic', () => {
        let profile: IHandwritingProfileData;

        beforeAll(async () => {
            const buf1 = HandwritingFixtureGenerator.createConsistentSample(42);
            const buf2 = HandwritingFixtureGenerator.createConsistentSample(43);
            const buf3 = HandwritingFixtureGenerator.createConsistentSample(44);

            const buildRes = await builder.buildProfile('writer-1', [
                { sampleId: 'w1-1', imageBuffer: buf1 },
                { sampleId: 'w1-2', imageBuffer: buf2 },
                { sampleId: 'w1-3', imageBuffer: buf3 }
            ]);
            profile = buildRes.profile;
            expect(profile.status).toBe(ProfileStatus.ESTABLISHED);
        });

        it('should produce low distance and MATCH for an identical or similar new sample', async () => {
            const similarSample = HandwritingFixtureGenerator.createConsistentSample(45);
            const result = await engine.compare(profile, {
                sampleId: 'w1-similar',
                imageBuffer: similarSample
            });

            expect(result.status).toBe(ComparisonMatchState.MATCH);
            expect(result.distance).toBeLessThan(0.38);
            expect(result.confidence).toBeGreaterThan(0.5);
            expect(result.anomalyFactors).toHaveLength(0);
            expect(result.sampleQuality).toBeDefined();
        });

        it('should produce significantly higher distance for a strongly different feature distribution', async () => {
            const similarSample = HandwritingFixtureGenerator.createConsistentSample(45);
            const slantedSample = HandwritingFixtureGenerator.createSlantedSample(35);

            const resSimilar = await engine.compare(profile, {
                sampleId: 'similar',
                imageBuffer: similarSample
            });
            const resSlanted = await engine.compare(profile, {
                sampleId: 'slanted',
                imageBuffer: slantedSample
            });

            expect(resSlanted.distance).toBeGreaterThan(resSimilar.distance);
        });

        it('should trigger REVIEW_REQUIRED when multiple meaningful deviations are detected', async () => {
            // Profile baseline: all features at 0.40, with stdDev 0.03
            const establishedProf: IHandwritingProfileData = {
                studentId: 'multi-dev-student',
                sampleCount: 5,
                featureMeans: [0.40, 0.40, 0.40, 0.40, 0.40, 0.40, 0.40, 0.40],
                featureStdDevs: [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03],
                status: ProfileStatus.ESTABLISHED,
                samplesUsed: ['s1', 's2', 's3', 's4', 's5'],
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Sample with 3 strongly deviating features (inkDensity: 0.70, slant: 0.75, strokeWidth: 0.70)
            const sampleWithMultiDev = {
                sampleId: 'multi-dev-sample',
                features: createMockFeatures([0.70, 0.40, 0.40, 0.40, 0.70, 0.40, 0.75, 0.40]),
                status: SampleExtractionStatus.VALID
            };

            const result = await engine.compare(establishedProf, sampleWithMultiDev);

            expect(result.status).toBe(ComparisonMatchState.REVIEW_REQUIRED);
            expect(result.distance).toBeGreaterThanOrEqual(0.50);
            expect(result.anomalyFactors.length).toBeGreaterThanOrEqual(2);
            // Verify objective terminology: never mentions cheating or plagiarism
            const fullOutput = JSON.stringify(result);
            expect(fullOutput.toLowerCase()).not.toContain('plagiarism');
            expect(fullOutput.toLowerCase()).not.toContain('cheating');
        });

        it('should NOT automatically produce REVIEW_REQUIRED for a single isolated feature deviation', async () => {
            // Baseline: all features at 0.50, stdDev 0.03
            const baselineProf: IHandwritingProfileData = {
                studentId: 'single-dev-student',
                sampleCount: 4,
                featureMeans: [0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50],
                featureStdDevs: [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03],
                status: ProfileStatus.ESTABLISHED,
                samplesUsed: ['s1', 's2', 's3', 's4'],
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Only feature 0 (inkDensity) deviates significantly (0.80 vs 0.50)
            // All other 7 features remain perfectly identical to baseline (0.50)
            const singleDevSample = {
                sampleId: 'single-dev-sample',
                features: createMockFeatures([0.80, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50, 0.50]),
                status: SampleExtractionStatus.VALID
            };

            const result = await engine.compare(baselineProf, singleDevSample);

            // A single isolated feature must NEVER produce REVIEW_REQUIRED
            expect(result.status).not.toBe(ComparisonMatchState.REVIEW_REQUIRED);
            // Only 1 feature in anomalyFactors
            expect(result.anomalyFactors).toHaveLength(1);
            expect(result.anomalyFactors[0]).toContain('inkDensity');
        });
    });

    describe('4. Zero / Near-Zero Standard Deviation Safety', () => {
        it('should safely handle zero standard deviation without NaN or Infinity', async () => {
            const zeroVarProfile: IHandwritingProfileData = {
                studentId: 'zero-var',
                sampleCount: 3,
                featureMeans: [0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4],
                featureStdDevs: [0, 0, 0, 0, 0, 0, 0, 0],
                status: ProfileStatus.ESTABLISHED,
                samplesUsed: ['s1', 's2', 's3'],
                createdAt: new Date(),
                updatedAt: new Date()
            };

            const identicalSample = {
                sampleId: 'identical',
                features: createMockFeatures([0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4]),
                status: SampleExtractionStatus.VALID
            };

            const resultIdentical = await engine.compare(zeroVarProfile, identicalSample);
            expect(Number.isFinite(resultIdentical.distance)).toBe(true);
            expect(resultIdentical.distance).toBe(0);
            for (const fd of resultIdentical.featureDeviations) {
                expect(Number.isFinite(fd.normalizedDeviation)).toBe(true);
                expect(Number.isFinite(fd.contribution)).toBe(true);
            }

            const differingSample = {
                sampleId: 'diff',
                features: createMockFeatures([0.5, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4, 0.4]),
                status: SampleExtractionStatus.VALID
            };
            const resultDiff = await engine.compare(zeroVarProfile, differingSample);
            expect(Number.isFinite(resultDiff.distance)).toBe(true);
            expect(resultDiff.distance).toBeGreaterThan(0);
            for (const fd of resultDiff.featureDeviations) {
                expect(Number.isFinite(fd.normalizedDeviation)).toBe(true);
                expect(Number.isFinite(fd.contribution)).toBe(true);
            }
        });
    });

    describe('5. Determinism and Feature Contribution Ranking', () => {
        const testProfile: IHandwritingProfileData = {
            studentId: 'det-prof',
            sampleCount: 4,
            featureMeans: [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3],
            featureStdDevs: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
            status: ProfileStatus.ESTABLISHED,
            samplesUsed: ['s1', 's2', 's3', 's4'],
            createdAt: new Date(),
            updatedAt: new Date()
        };

        const testSample = {
            sampleId: 'det-sample',
            // InkDensity diff = 0.4, Slant diff = 0.2, StrokeWidth diff = 0.1, others 0
            features: createMockFeatures([0.7, 0.3, 0.3, 0.3, 0.4, 0.3, 0.5, 0.3]),
            status: SampleExtractionStatus.VALID
        };

        it('should rank feature contributions deterministically in descending order', async () => {
            const result = await engine.compare(testProfile, testSample);
            const deviations = result.featureDeviations;

            expect(deviations).toHaveLength(8);

            // Verify descending contribution order
            for (let i = 0; i < deviations.length - 1; i++) {
                expect(deviations[i].contribution).toBeGreaterThanOrEqual(deviations[i + 1].contribution);
            }

            // inkDensity had the largest diff (0.7 vs 0.3), so it must be top
            expect(deviations[0].feature).toBe('inkDensity');
            // dominantSlantAngle had the second largest diff (0.5 vs 0.3)
            expect(deviations[1].feature).toBe('dominantSlantAngle');
            // strokeWidthMean had the third largest diff (0.4 vs 0.3)
            expect(deviations[2].feature).toBe('strokeWidthMean');
        });

        it('should yield strictly identical results on multiple comparison runs', async () => {
            const run1 = await engine.compare(testProfile, testSample);
            const run2 = await engine.compare(testProfile, testSample);

            expect(run1.distance).toBe(run2.distance);
            expect(run1.confidence).toBe(run2.confidence);
            expect(run1.status).toBe(run2.status);
            expect(run1.anomalyFactors).toEqual(run2.anomalyFactors);
            expect(run1.featureDeviations).toEqual(run2.featureDeviations);
        });
    });

    describe('6. Configurable Thresholds Injection', () => {
        it('should respect custom injected thresholds', async () => {
            // Create engine with a very strict match threshold (0.01)
            const strictEngine = new HandwritingComparisonEngine(undefined, {
                matchDistanceThreshold: 0.01
            });

            expect(strictEngine.getThresholds().matchDistanceThreshold).toBe(0.01);

            const profile: IHandwritingProfileData = {
                studentId: 'cust-prof',
                sampleCount: 3,
                featureMeans: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
                featureStdDevs: [0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.05],
                status: ProfileStatus.ESTABLISHED,
                samplesUsed: ['s1', 's2', 's3'],
                createdAt: new Date(),
                updatedAt: new Date()
            };

            // Sample with tiny deviation (distance ~0.03 > 0.01)
            const slightSample = {
                sampleId: 'slight',
                features: createMockFeatures([0.51, 0.51, 0.51, 0.51, 0.51, 0.51, 0.51, 0.51]),
                status: SampleExtractionStatus.VALID
            };

            const result = await strictEngine.compare(profile, slightSample);
            // With strict 0.01 threshold, slightSample fails match threshold
            expect(result.distance).toBeGreaterThan(0.01);
            expect(result.status).not.toBe(ComparisonMatchState.MATCH);
        });
    });
});
