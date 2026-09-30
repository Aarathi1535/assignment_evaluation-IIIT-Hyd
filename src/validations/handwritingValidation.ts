import { z } from 'zod';
import { ComparisonMatchState, ProfileStatus, SampleExtractionStatus } from '../models/HandwritingConsistency';

/**
 * Strict 24-character hexadecimal ObjectId validator
 */
export const objectIdSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, {
    message: 'Invalid ObjectId format: must be a 24-character hexadecimal string'
});

/**
 * Canonical 8-element normalized handwriting feature vector validator.
 * Every element must be a finite number bounded in [0.0, 1.0].
 */
export const rawVectorSchema = z.array(
    z.number().refine(n => Number.isFinite(n) && n >= 0 && n <= 1, {
        message: 'Each rawVector feature value must be a finite number between 0.0 and 1.0'
    })
).length(8, {
    message: 'Feature vector must contain exactly 8 normalized feature elements'
});

export const sampleQualitySchema = z.object({
    contrast: z.number().refine(Number.isFinite),
    sharpnessScore: z.number().refine(Number.isFinite),
    noiseRatio: z.number().refine(Number.isFinite),
    strokeCount: z.number().int().nonnegative(),
    isSufficient: z.boolean(),
    isBlank: z.boolean(),
    isDiagramHeavy: z.boolean()
});

export const featureDeviationSchema = z.object({
    feature: z.string().min(1),
    baselineMean: z.number().refine(Number.isFinite),
    baselineStdDev: z.number().refine(Number.isFinite),
    observed: z.number().refine(Number.isFinite),
    normalizedDeviation: z.number().refine(Number.isFinite),
    contribution: z.number().refine(Number.isFinite)
});

export const registerSampleInputSchema = z.object({
    studentId: objectIdSchema,
    sourceReference: z.string().trim().min(1).optional(),
    sampleType: z.enum(['EXAM_SCRIPT', 'HOMEWORK', 'BASELINE_UPLOAD', 'GENERAL_SUBMISSION']).default('EXAM_SCRIPT'),
    answerScriptId: objectIdSchema.optional(),
    pageNumber: z.number().int().min(1).optional(),
    boundingBox: z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        height: z.number().min(0).max(1)
    }).optional()
});

export const compareSampleInputSchema = z.object({
    studentId: objectIdSchema,
    sampleId: objectIdSchema.optional(),
    sourceReference: z.string().trim().min(1).optional(),
    pageNumber: z.number().int().min(1).optional(),
    boundingBox: z.object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().min(0).max(1),
        height: z.number().min(0).max(1)
    }).optional()
});

export const profileVersionSchema = z.number().int().positive({
    message: 'Profile version must be a positive integer >= 1'
});

export const profileStatusSchema = z.nativeEnum(ProfileStatus);
export const sampleExtractionStatusSchema = z.nativeEnum(SampleExtractionStatus);
export const comparisonMatchStateSchema = z.nativeEnum(ComparisonMatchState);

export type RegisterSampleInputDto = z.infer<typeof registerSampleInputSchema>;
export type CompareSampleInputDto = z.infer<typeof compareSampleInputSchema>;
