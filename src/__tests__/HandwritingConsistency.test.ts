import { describe, it, expect } from 'vitest';
import { HandwritingFeatureExtractor } from '../services/handwriting/HandwritingFeatureExtractor';
import { HandwritingFixtureGenerator } from './fixtures/HandwritingFixtureGenerator';
import { SampleExtractionStatus } from '../models/HandwritingConsistency';

/**
 * Direction 4 Phase 1: Handwriting Feature Extraction Validation Test Suite
 *
 * IMPORTANT DISCLAIMER:
 * These tests validate the mathematical correctness, determinism, bounding-box
 * cropping, and robustness of the image feature extraction pipeline.
 * They do NOT prove or claim biometric writer identity verification.
 */
describe('Handwriting Feature Extractor (Phase 1)', () => {
    const extractor = new HandwritingFeatureExtractor();

    describe('1. Determinism and Pipeline Integrity', () => {
        it('should produce identical features on identical inputs', async () => {
            const buffer = HandwritingFixtureGenerator.createConsistentSample(42);

            const result1 = await extractor.extractFeatures(buffer);
            const result2 = await extractor.extractFeatures(buffer);

            expect(result1.status).toBe(SampleExtractionStatus.VALID);
            expect(result2.status).toBe(SampleExtractionStatus.VALID);
            expect(result1.features).toBeDefined();
            expect(result2.features).toBeDefined();

            // Strict deterministic equality
            expect(result1.features!.inkDensity).toBe(result2.features!.inkDensity);
            expect(result1.features!.slantAngle).toBe(result2.features!.slantAngle);
            expect(result1.features!.estimatedLineSpacing).toBe(result2.features!.estimatedLineSpacing);
            expect(result1.features!.strokeWidthProxy.mean).toBe(result2.features!.strokeWidthProxy.mean);
            expect(result1.features!.rawVector).toEqual(result2.features!.rawVector);
        });

        it('should produce valid normalized feature ranges', async () => {
            const buffer = HandwritingFixtureGenerator.createConsistentSample(101);
            const result = await extractor.extractFeatures(buffer);

            expect(result.status).toBe(SampleExtractionStatus.VALID);
            const f = result.features!;

            // Density and profiles
            expect(f.inkDensity).toBeGreaterThan(0);
            expect(f.inkDensity).toBeLessThan(1);
            expect(f.horizontalProjection.peakCount).toBeGreaterThan(0);
            expect(f.horizontalProjection.mean).toBeGreaterThan(0);
            expect(f.verticalProjection.mean).toBeGreaterThan(0);

            // Line spacing
            expect(f.estimatedLineSpacing).toBeGreaterThan(0);

            // Stroke width proxy (observational geometric metric)
            expect(f.strokeWidthProxy.mean).toBeGreaterThan(0);
            expect(f.strokeWidthProxy.median).toBeGreaterThan(0);

            // Slant angle bounded between -45 and 45
            expect(f.slantAngle).toBeGreaterThanOrEqual(-45);
            expect(f.slantAngle).toBeLessThanOrEqual(45);

            // Connected components
            expect(f.connectedComponents.count).toBeGreaterThan(0);
            expect(f.connectedComponents.meanArea).toBeGreaterThan(0);
            expect(f.connectedComponents.meanAspectRatio).toBeGreaterThan(0);

            // Quality metrics
            expect(f.quality.contrast).toBeGreaterThanOrEqual(0);
            expect(f.quality.contrast).toBeLessThanOrEqual(1);
            expect(f.quality.sharpnessScore).toBeGreaterThanOrEqual(0);
            expect(f.quality.sharpnessScore).toBeLessThanOrEqual(1);
            expect(f.quality.noiseRatio).toBeGreaterThanOrEqual(0);
            expect(f.quality.noiseRatio).toBeLessThanOrEqual(1);
            expect(f.quality.isSufficient).toBe(true);
            expect(f.quality.isBlank).toBe(false);
            expect(f.quality.isDiagramHeavy).toBe(false);

            // Raw vector (8-element normalized vector)
            expect(f.rawVector).toHaveLength(8);
            for (const val of f.rawVector) {
                expect(Number.isFinite(val)).toBe(true);
                expect(val).toBeGreaterThanOrEqual(0);
                expect(val).toBeLessThanOrEqual(1);
            }
        });
    });

    describe('2. Disqualification and Rejection Handling', () => {
        it('should detect and reject completely blank images', async () => {
            const blankBuffer = HandwritingFixtureGenerator.createBlankSample();
            const result = await extractor.extractFeatures(blankBuffer);

            expect(result.status).toBe(SampleExtractionStatus.BLANK);
            expect(result.features).toBeUndefined();
            expect(result.disqualificationReason).toContain('blank');
        });

        it('should gracefully handle empty buffer input', async () => {
            const emptyBuffer = Buffer.alloc(0);
            const result = await extractor.extractFeatures(emptyBuffer);

            expect(result.status).toBe(SampleExtractionStatus.BLANK);
            expect(result.disqualificationReason).toBeDefined();
        });

        it('should reject samples with insufficient stroke content', async () => {
            const insufficientBuffer = HandwritingFixtureGenerator.createInsufficientSample();
            const result = await extractor.extractFeatures(insufficientBuffer);

            expect(result.status).toBe(SampleExtractionStatus.INSUFFICIENT_SAMPLE);
            expect(result.features).toBeUndefined();
            expect(result.disqualificationReason).toContain('Insufficient handwriting strokes');
        });

        it('should detect and reject diagram-heavy non-text regions', async () => {
            const diagramBuffer = HandwritingFixtureGenerator.createDiagramSample();
            const result = await extractor.extractFeatures(diagramBuffer);

            expect(result.status).toBe(SampleExtractionStatus.DIAGRAM_REJECTED);
            expect(result.features).toBeUndefined();
            expect(result.disqualificationReason).toContain('geometric');
        });
    });

    describe('3. Consistency and Divergence Measurability', () => {
        it('should produce similar feature vectors for consistent handwriting samples', async () => {
            const sampleA = HandwritingFixtureGenerator.createConsistentSample(50);
            const sampleB = HandwritingFixtureGenerator.createConsistentSample(51);

            const resultA = await extractor.extractFeatures(sampleA);
            const resultB = await extractor.extractFeatures(sampleB);

            expect(resultA.status).toBe(SampleExtractionStatus.VALID);
            expect(resultB.status).toBe(SampleExtractionStatus.VALID);

            // Compute Euclidean distance between 8-element rawVectors
            const vecA = resultA.features!.rawVector;
            const vecB = resultB.features!.rawVector;

            let distSq = 0;
            for (let i = 0; i < vecA.length; i++) {
                distSq += (vecA[i] - vecB[i]) ** 2;
            }
            const distance = Math.sqrt(distSq);

            // Consistent samples should be very close in normalized feature space
            expect(distance).toBeLessThan(0.20);
        });

        it('should detect measurable slant divergence between upright and slanted writers', async () => {
            const uprightSample = HandwritingFixtureGenerator.createSlantedSample(0);
            const slantedSample = HandwritingFixtureGenerator.createSlantedSample(25);

            const resultUpright = await extractor.extractFeatures(uprightSample);
            const resultSlanted = await extractor.extractFeatures(slantedSample);

            expect(resultUpright.status).toBe(SampleExtractionStatus.VALID);
            expect(resultSlanted.status).toBe(SampleExtractionStatus.VALID);

            const slantDiff = Math.abs(resultSlanted.features!.slantAngle - resultUpright.features!.slantAngle);
            expect(slantDiff).toBeGreaterThan(10); // Measurable angular difference
        });

        it('should detect measurable stroke width difference between thin and thick writing tools', async () => {
            const thinSample = HandwritingFixtureGenerator.createThickStrokeSample(1.5);
            const thickSample = HandwritingFixtureGenerator.createThickStrokeSample(5.0);

            const resultThin = await extractor.extractFeatures(thinSample);
            const resultThick = await extractor.extractFeatures(thickSample);

            expect(resultThin.status).toBe(SampleExtractionStatus.VALID);
            expect(resultThick.status).toBe(SampleExtractionStatus.VALID);

            const swDiff = resultThick.features!.strokeWidthProxy.mean - resultThin.features!.strokeWidthProxy.mean;
            expect(swDiff).toBeGreaterThan(1.5); // Measurable stroke thickness difference
        });
    });

    describe('4. Bounding Box and Robustness', () => {
        it('should support normalized bounding box cropping', async () => {
            const sample = HandwritingFixtureGenerator.createConsistentSample(42, 600, 500);

            // Bounding box cropping center region: [x: 0.1, y: 0.1, w: 0.8, h: 0.8]
            const resultCropped = await extractor.extractFeatures(sample, {
                x: 0.1,
                y: 0.1,
                width: 0.8,
                height: 0.8
            });

            expect(resultCropped.status).toBe(SampleExtractionStatus.VALID);
            expect(resultCropped.features!.normalizedDimensions.width).toBeCloseTo(0.8, 1);
            expect(resultCropped.features!.normalizedDimensions.height).toBeCloseTo(0.8, 1);
        });

        it('should not crash and extract features from noisy scan images', async () => {
            const noisyBuffer = HandwritingFixtureGenerator.createNoisySample(0.02);
            const result = await extractor.extractFeatures(noisyBuffer);

            expect(result.status).toBe(SampleExtractionStatus.VALID);
            expect(result.features).toBeDefined();
            expect(result.features!.quality.noiseRatio).toBeGreaterThan(0);
        });

        it('should not crash and process slightly rotated images', async () => {
            const rotatedBuffer = HandwritingFixtureGenerator.createRotatedSample(8);
            const result = await extractor.extractFeatures(rotatedBuffer);

            expect(result.status).toBe(SampleExtractionStatus.VALID);
            expect(result.features).toBeDefined();
            expect(result.features!.horizontalProjection.peakCount).toBeGreaterThan(0);
        });
    });
});
