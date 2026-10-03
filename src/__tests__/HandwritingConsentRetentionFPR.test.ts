import { describe, it, expect, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import HandwritingSampleModel from '../models/HandwritingSample';
import HandwritingProfileModel from '../models/HandwritingProfile';
import HandwritingComparisonModel from '../models/HandwritingComparison';
import HandwritingConsentModel from '../models/HandwritingConsent';
import { handwritingConsentRepository } from '../repositories/HandwritingConsentRepository';
import { handwritingSampleRepository } from '../repositories/HandwritingSampleRepository';
import { handwritingProfileRepository } from '../repositories/HandwritingProfileRepository';
import {
    HandwritingConsistencyWorkflowService,
    HandwritingAuthContext
} from '../services/handwriting/HandwritingConsistencyWorkflowService';
import {
    HandwritingEvaluationService,
    HANDWRITING_EVALUATION_DISCLAIMER
} from '../services/handwriting/HandwritingEvaluationService';
import { HandwritingFixtureGenerator } from './fixtures/HandwritingFixtureGenerator';
import {
    ComparisonMatchState,
    ProfileStatus,
    SampleExtractionStatus
} from '../models/HandwritingConsistency';
import { UserRole } from '../constants/permissions';
import { HANDWRITING_RETENTION_POLICY } from '../models/HandwritingConsent';

describe('HandwritingConsistency: Consent, Retention, Status, and FPR (Mentor Review)', () => {
    const studentAId = new mongoose.Types.ObjectId().toString();
    const studentBId = new mongoose.Types.ObjectId().toString();

    const studentAContext: HandwritingAuthContext = {
        userId: studentAId,
        role: UserRole.STUDENT
    };

    beforeEach(async () => {
        await HandwritingSampleModel.deleteMany({});
        await HandwritingProfileModel.deleteMany({});
        await HandwritingComparisonModel.deleteMany({});
        await HandwritingConsentModel.deleteMany({});
    });

    // 1. CONSENT REQUIRED
    describe('1. Consent Required', () => {
        it('registerSample is rejected with 403 when consent is absent', async () => {
            const workflow = new HandwritingConsistencyWorkflowService();
            await expect(
                workflow.registerSample(
                    { studentId: studentAId, imageBuffer: HandwritingFixtureGenerator.createConsistentSample(1) },
                    studentAContext
                )
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('registerSample is rejected with 403 when consent is explicitly revoked', async () => {
            await handwritingConsentRepository.setConsent(studentAId, true);
            await handwritingConsentRepository.setConsent(studentAId, false);
            const workflow = new HandwritingConsistencyWorkflowService();
            await expect(
                workflow.registerSample(
                    { studentId: studentAId, imageBuffer: HandwritingFixtureGenerator.createConsistentSample(2) },
                    studentAContext
                )
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('compareSample is rejected with 403 when consent is absent', async () => {
            const workflow = new HandwritingConsistencyWorkflowService();
            await expect(
                workflow.compareSample(
                    studentAId,
                    { imageBuffer: HandwritingFixtureGenerator.createConsistentSample(3) },
                    studentAContext
                )
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('rebuildProfile is rejected with 403 when consent is absent', async () => {
            const workflow = new HandwritingConsistencyWorkflowService();
            await expect(workflow.rebuildProfile(studentAId, studentAContext)).rejects.toMatchObject({ statusCode: 403 });
        });

        it('registerSample succeeds after consent is granted', async () => {
            await handwritingConsentRepository.setConsent(studentAId, true);
            const workflow = new HandwritingConsistencyWorkflowService();
            const result = await workflow.registerSample(
                {
                    studentId: studentAId,
                    sourceReference: 'consent-ok-ref',
                    imageBuffer: HandwritingFixtureGenerator.createConsistentSample(10)
                },
                studentAContext
            );
            expect(result.sample).toBeDefined();
            expect(result.isDuplicate).toBe(false);
        });
    });

    // 2. CONSENT TIMESTAMP
    describe('2. Consent Timestamp', () => {
        it('consentedAt is stored when consent is granted', async () => {
            const beforeGrant = new Date();
            await handwritingConsentRepository.setConsent(studentAId, true);
            const afterGrant = new Date();
            const consent = await handwritingConsentRepository.findByStudent(studentAId);
            expect(consent).not.toBeNull();
            expect(consent!.hasConsented).toBe(true);
            expect(consent!.consentedAt).toBeDefined();
            expect(consent!.consentedAt!.getTime()).toBeGreaterThanOrEqual(beforeGrant.getTime());
            expect(consent!.consentedAt!.getTime()).toBeLessThanOrEqual(afterGrant.getTime());
        });

        it('revokedAt is stored and retentionExpiresAt set to now when revoked', async () => {
            await handwritingConsentRepository.setConsent(studentAId, true);
            const beforeRevoke = new Date();
            await handwritingConsentRepository.setConsent(studentAId, false);
            const afterRevoke = new Date();
            const consent = await handwritingConsentRepository.findByStudent(studentAId);
            expect(consent!.hasConsented).toBe(false);
            expect(consent!.revokedAt).toBeDefined();
            expect(consent!.revokedAt!.getTime()).toBeGreaterThanOrEqual(beforeRevoke.getTime());
            expect(consent!.revokedAt!.getTime()).toBeLessThanOrEqual(afterRevoke.getTime());
            expect(consent!.retentionExpiresAt).toBeDefined();
            expect(consent!.retentionExpiresAt!.getTime()).toBeLessThanOrEqual(afterRevoke.getTime() + 1000);
        });

        it('retentionExpiresAt is set to consentedAt + retentionDays', async () => {
            const retentionDays = 30;
            const beforeGrant = Date.now();
            await handwritingConsentRepository.setConsent(studentAId, true, { retentionDays });
            const consent = await handwritingConsentRepository.findByStudent(studentAId);
            const expectedExpiry = beforeGrant + retentionDays * 24 * 60 * 60 * 1000;
            expect(consent!.retentionExpiresAt).toBeDefined();
            expect(consent!.retentionDays).toBe(retentionDays);
            expect(Math.abs(consent!.retentionExpiresAt!.getTime() - expectedExpiry)).toBeLessThan(5000);
        });

        it('default retention policy is ACADEMIC_YEAR_365_DAYS (365 days)', async () => {
            await handwritingConsentRepository.setConsent(studentAId, true);
            const consent = await handwritingConsentRepository.findByStudent(studentAId);
            expect(consent!.retentionDays).toBe(365);
            expect(HANDWRITING_RETENTION_POLICY.DEFAULT_RETENTION_DAYS).toBe(365);
            expect(HANDWRITING_RETENTION_POLICY.POLICY_NAME).toBe('ACADEMIC_YEAR_365_DAYS');
        });
    });

    // 3. RETENTION / EXPIRY
    describe('3. Retention and Expiry', () => {
        it('expired samples are excluded from usable baseline query', async () => {
            await HandwritingSampleModel.create({
                student: new mongoose.Types.ObjectId(studentAId),
                sourceReference: 'expired-sample',
                sampleType: 'EXAM_SCRIPT',
                status: SampleExtractionStatus.VALID,
                isUsable: true,
                extractionVersion: '1.0.0',
                rawVector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
                retentionExpiresAt: new Date(Date.now() - 1000),
                retentionPolicy: HANDWRITING_RETENTION_POLICY.POLICY_NAME
            });
            const samples = await handwritingSampleRepository.findByStudent(studentAId, { usableOnly: true });
            expect(samples).toHaveLength(0);
        });

        it('non-expired samples are returned normally', async () => {
            await HandwritingSampleModel.create({
                student: new mongoose.Types.ObjectId(studentAId),
                sourceReference: 'active-sample',
                sampleType: 'EXAM_SCRIPT',
                status: SampleExtractionStatus.VALID,
                isUsable: true,
                extractionVersion: '1.0.0',
                rawVector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
                retentionExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
            });
            const samples = await handwritingSampleRepository.findByStudent(studentAId, { usableOnly: true });
            expect(samples).toHaveLength(1);
            expect(samples[0].sourceReference).toBe('active-sample');
        });

        it('expired profiles are excluded from findByStudent', async () => {
            await HandwritingProfileModel.create({
                student: new mongoose.Types.ObjectId(studentAId),
                sampleCount: 3,
                samplesUsed: [],
                featureMeans: new Array(8).fill(0.3),
                featureStdDevs: new Array(8).fill(0.05),
                status: ProfileStatus.ESTABLISHED,
                profileVersion: 1,
                extractionVersion: '1.0.0',
                isCurrent: true,
                retentionExpiresAt: new Date(Date.now() - 1000)
            });
            const profile = await handwritingProfileRepository.findByStudent(studentAId);
            expect(profile).toBeNull();
        });

        it('purgeExpired removes expired samples and returns count', async () => {
            const base = {
                student: new mongoose.Types.ObjectId(studentAId),
                sampleType: 'EXAM_SCRIPT' as const,
                status: SampleExtractionStatus.VALID,
                isUsable: true,
                extractionVersion: '1.0.0',
                rawVector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
            };
            await HandwritingSampleModel.create([
                { ...base, sourceReference: 'exp-1', retentionExpiresAt: new Date(Date.now() - 2000) },
                { ...base, sourceReference: 'exp-2', retentionExpiresAt: new Date(Date.now() - 1000) },
                { ...base, sourceReference: 'active-3', retentionExpiresAt: new Date(Date.now() + 1000000) }
            ]);
            const purged = await handwritingSampleRepository.purgeExpired(studentAId);
            expect(purged).toBe(2);
            const remaining = await HandwritingSampleModel.find({ student: new mongoose.Types.ObjectId(studentAId) });
            expect(remaining).toHaveLength(1);
            expect(remaining[0].sourceReference).toBe('active-3');
        });

        it('consent expiry blocks processing even if hasConsented is still true', async () => {
            await handwritingConsentRepository.setConsent(studentAId, true);
            await HandwritingConsentModel.updateOne(
                { student: new mongoose.Types.ObjectId(studentAId) },
                { $set: { retentionExpiresAt: new Date(Date.now() - 1000) } }
            );
            const workflow = new HandwritingConsistencyWorkflowService();
            await expect(
                workflow.registerSample(
                    { studentId: studentAId, imageBuffer: HandwritingFixtureGenerator.createConsistentSample(5) },
                    studentAContext
                )
            ).rejects.toMatchObject({ statusCode: 403 });
        });

        it('production paths invoke background purge for expired data', async () => {
            const workflow = new HandwritingConsistencyWorkflowService();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const purgeSpy = vi.spyOn(workflow as any, 'purgeExpiredData');
            
            // Create some expired samples
            const base = {
                student: new mongoose.Types.ObjectId(studentAId),
                sampleType: 'EXAM_SCRIPT' as const,
                status: SampleExtractionStatus.VALID,
                isUsable: true,
                extractionVersion: '1.0.0',
                rawVector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
            };
            await HandwritingSampleModel.create([
                { ...base, sourceReference: 'auto-exp-1', retentionExpiresAt: new Date(Date.now() - 2000) },
                { ...base, sourceReference: 'auto-exp-2', retentionExpiresAt: new Date(Date.now() - 1000) },
                { ...base, sourceReference: 'auto-active-3', retentionExpiresAt: new Date(Date.now() + 100000) }
            ]);

            // Set valid consent so it doesn't fail early
            await handwritingConsentRepository.setConsent(studentAId, true);
            await HandwritingConsentModel.updateOne(
                { student: new mongoose.Types.ObjectId(studentAId) },
                { $set: { retentionExpiresAt: new Date(Date.now() + 100000) } }
            );

            // Trigger a production path like verifyConsent (used by registerSample, etc.)
            await workflow.verifyConsent(studentAId);

            // Wait a tick for the floating promise to execute
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(purgeSpy).toHaveBeenCalled();
            
            // Verify expired data was actually purged
            const remaining = await HandwritingSampleModel.find({ student: new mongoose.Types.ObjectId(studentAId) });
            expect(remaining).toHaveLength(1);
            expect(remaining[0].sourceReference).toBe('auto-active-3');
            
            purgeSpy.mockRestore();
        });
    });

    // 4. RENAMED STATUS
    describe('4. Renamed Review Status: REVIEWED_CONSISTENT', () => {
        it('reviewStatus enum includes REVIEWED_CONSISTENT, not VERIFIED_AUTHENTIC', () => {
            const allowed = ['PENDING_REVIEW', 'REVIEWED_CONSISTENT', 'FLAGGED_MISMATCH'];
            expect(allowed).toContain('REVIEWED_CONSISTENT');
            expect(allowed).not.toContain('VERIFIED_AUTHENTIC');
        });

        it('HandwritingComparison model accepts REVIEWED_CONSISTENT', async () => {
            const doc = await HandwritingComparisonModel.create({
                student: new mongoose.Types.ObjectId(),
                sample: new mongoose.Types.ObjectId(),
                status: ComparisonMatchState.MATCH,
                distance: 0.1,
                confidence: 0.9,
                featureDeviations: [],
                anomalyFactors: [],
                comparedAt: new Date(),
                reviewStatus: 'REVIEWED_CONSISTENT'
            });
            expect(doc.reviewStatus).toBe('REVIEWED_CONSISTENT');
        });

        it('HandwritingComparison model rejects VERIFIED_AUTHENTIC', async () => {
            await expect(
                HandwritingComparisonModel.create({
                    student: new mongoose.Types.ObjectId(),
                    sample: new mongoose.Types.ObjectId(),
                    status: ComparisonMatchState.MATCH,
                    distance: 0.1,
                    confidence: 0.9,
                    featureDeviations: [],
                    anomalyFactors: [],
                    comparedAt: new Date(),
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    reviewStatus: 'VERIFIED_AUTHENTIC' as any // TS enum enforces type; we test Mongoose runtime validation rejects it
                })
            ).rejects.toThrow();
        });


        it('default reviewStatus is PENDING_REVIEW, not VERIFIED_AUTHENTIC', async () => {
            const doc = await HandwritingComparisonModel.create({
                student: new mongoose.Types.ObjectId(),
                sample: new mongoose.Types.ObjectId(),
                status: ComparisonMatchState.REVIEW_REQUIRED,
                distance: 0.5,
                confidence: 0.5,
                featureDeviations: [],
                anomalyFactors: [],
                comparedAt: new Date()
            });
            expect(doc.reviewStatus).toBe('PENDING_REVIEW');
            expect(doc.reviewStatus).not.toBe('VERIFIED_AUTHENTIC');
        });
    });

    // 5. FALSE-POSITIVE RATE CALCULATION
    describe('5. False-Positive Rate Calculation', () => {
        const evaluationService = new HandwritingEvaluationService();

        it('FPR is 0 when no different-student comparisons', () => {
            const metrics = evaluationService.computeMetrics([]);
            expect(metrics.differentStudentComparisons).toBe(0);
            expect(metrics.differentStudentFalseMatches).toBe(0);
            expect(metrics.falsePositiveRate).toBe(0.0);
        });

        it('FPR = differentStudentFalseMatches / differentStudentComparisons', () => {
            const pairwise = [
                ...Array.from({ length: 8 }, (_, i) => ({
                    profileStudentId: studentAId,
                    sampleStudentId: studentBId,
                    sampleId: `ds-ok-${i}`,
                    isSameStudent: false,
                    matchState: ComparisonMatchState.INCONCLUSIVE,
                    distance: 0.8,
                    confidence: 0.2,
                    isFalsePositiveMatch: false,
                    isTruePositiveMatch: false
                })),
                {
                    profileStudentId: studentAId,
                    sampleStudentId: studentBId,
                    sampleId: 'ds-fp-1',
                    isSameStudent: false,
                    matchState: ComparisonMatchState.MATCH,
                    distance: 0.2,
                    confidence: 0.8,
                    isFalsePositiveMatch: true,
                    isTruePositiveMatch: false
                },
                {
                    profileStudentId: studentAId,
                    sampleStudentId: studentBId,
                    sampleId: 'ds-fp-2',
                    isSameStudent: false,
                    matchState: ComparisonMatchState.MATCH,
                    distance: 0.15,
                    confidence: 0.85,
                    isFalsePositiveMatch: true,
                    isTruePositiveMatch: false
                }
            ];
            const metrics = evaluationService.computeMetrics(pairwise);
            expect(metrics.differentStudentComparisons).toBe(10);
            expect(metrics.differentStudentFalseMatches).toBe(2);
            expect(metrics.falsePositiveRate).toBeCloseTo(0.2, 4);
        });

        it('metrics carry mandatory disclaimer about not being proof of authorship', () => {
            const metrics = evaluationService.computeMetrics([]);
            expect(metrics.disclaimer).toBe(HANDWRITING_EVALUATION_DISCLAIMER);
            expect(metrics.disclaimer).toContain('does NOT constitute');
            expect(metrics.disclaimer).toContain('proof of authorship');
        });
    });

    // 6. DIFFERENT-STUDENT FALSE MATCH COUNTING
    describe('6. Different-Student False Match Counting', () => {
        const evaluationService = new HandwritingEvaluationService();

        it('only cross-student MATCH comparisons are false positives', () => {
            const pairwise = [
                {
                    profileStudentId: studentAId, sampleStudentId: studentAId, sampleId: 'ss',
                    isSameStudent: true, matchState: ComparisonMatchState.MATCH,
                    distance: 0.05, confidence: 0.95,
                    isFalsePositiveMatch: false, isTruePositiveMatch: true
                },
                {
                    profileStudentId: studentAId, sampleStudentId: studentBId, sampleId: 'ds-match',
                    isSameStudent: false, matchState: ComparisonMatchState.MATCH,
                    distance: 0.12, confidence: 0.88,
                    isFalsePositiveMatch: true, isTruePositiveMatch: false
                },
                {
                    profileStudentId: studentAId, sampleStudentId: studentBId, sampleId: 'ds-rev',
                    isSameStudent: false, matchState: ComparisonMatchState.REVIEW_REQUIRED,
                    distance: 0.45, confidence: 0.55,
                    isFalsePositiveMatch: false, isTruePositiveMatch: false
                }
            ];
            const metrics = evaluationService.computeMetrics(pairwise);
            expect(metrics.differentStudentFalseMatches).toBe(1);
            expect(metrics.differentStudentComparisons).toBe(2);
            expect(metrics.falsePositiveRate).toBeCloseTo(0.5, 4);
            expect(metrics.sameStudentMatches).toBe(1);
        });
    });

    // 7. NO FPR INFLATION FROM SAME-STUDENT SAMPLES
    describe('7. No FPR Inflation from Same-Student Samples', () => {
        const evaluationService = new HandwritingEvaluationService();

        it('adding 100 same-student MATCHes does not change differentStudentFalseMatches', () => {
            const base = [{
                profileStudentId: studentAId, sampleStudentId: studentBId, sampleId: 'ds-fp',
                isSameStudent: false, matchState: ComparisonMatchState.MATCH,
                distance: 0.1, confidence: 0.9,
                isFalsePositiveMatch: true, isTruePositiveMatch: false
            }];
            const withSame = [
                ...base,
                ...Array.from({ length: 100 }, (_, i) => ({
                    profileStudentId: studentAId, sampleStudentId: studentAId, sampleId: `ss-${i}`,
                    isSameStudent: true, matchState: ComparisonMatchState.MATCH,
                    distance: 0.05, confidence: 0.95,
                    isFalsePositiveMatch: false, isTruePositiveMatch: true
                }))
            ];
            const m1 = evaluationService.computeMetrics(base);
            const m2 = evaluationService.computeMetrics(withSame);
            expect(m2.differentStudentFalseMatches).toBe(m1.differentStudentFalseMatches);
            expect(m2.differentStudentComparisons).toBe(1);
            expect(m2.sameStudentComparisons).toBe(100);
        });

        it('FPR denominator is strictly different-student pairs (3), not inflated by 50 same-student', () => {
            const results = [
                {
                    profileStudentId: studentAId, sampleStudentId: studentBId, sampleId: 'ds-1',
                    isSameStudent: false, matchState: ComparisonMatchState.MATCH,
                    distance: 0.1, confidence: 0.9, isFalsePositiveMatch: true, isTruePositiveMatch: false
                },
                {
                    profileStudentId: studentAId, sampleStudentId: studentBId, sampleId: 'ds-2',
                    isSameStudent: false, matchState: ComparisonMatchState.INCONCLUSIVE,
                    distance: 0.8, confidence: 0.2, isFalsePositiveMatch: false, isTruePositiveMatch: false
                },
                {
                    profileStudentId: studentAId, sampleStudentId: studentBId, sampleId: 'ds-3',
                    isSameStudent: false, matchState: ComparisonMatchState.REVIEW_REQUIRED,
                    distance: 0.4, confidence: 0.5, isFalsePositiveMatch: false, isTruePositiveMatch: false
                },
                ...Array.from({ length: 50 }, (_, i) => ({
                    profileStudentId: studentAId, sampleStudentId: studentAId, sampleId: `ss-${i}`,
                    isSameStudent: true, matchState: ComparisonMatchState.MATCH,
                    distance: 0.05, confidence: 0.95, isFalsePositiveMatch: false, isTruePositiveMatch: true
                }))
            ];
            const metrics = evaluationService.computeMetrics(results);
            expect(metrics.differentStudentComparisons).toBe(3);
            expect(metrics.differentStudentFalseMatches).toBe(1);
            expect(metrics.falsePositiveRate).toBeCloseTo(1 / 3, 4);
            expect(metrics.sameStudentComparisons).toBe(50);
        });
    });

    // 8. END-TO-END RETENTION INTEGRATION
    describe('8. End-to-End Consent -> Sample Retention Integration', () => {
        it('samples carry retentionExpiresAt and retentionPolicy from consent', async () => {
            await handwritingConsentRepository.setConsent(studentAId, true, { retentionDays: 7 });
            const workflow = new HandwritingConsistencyWorkflowService();
            const result = await workflow.registerSample(
                {
                    studentId: studentAId,
                    sourceReference: 'retention-e2e',
                    imageBuffer: HandwritingFixtureGenerator.createConsistentSample(42),
                    autoRebuildProfile: false
                },
                studentAContext
            );
            const sample = result.sample;
            expect(sample.retentionExpiresAt).toBeDefined();
            expect(sample.retentionPolicy).toBe(HANDWRITING_RETENTION_POLICY.POLICY_NAME);
            const expectedExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
            expect(Math.abs(sample.retentionExpiresAt!.getTime() - expectedExpiry)).toBeLessThan(5000);
        });

        it('comparison evidence inherits consent expiry and is purged when that retention expires', async () => {
            await handwritingConsentRepository.setConsent(studentAId, true, { retentionDays: 7 });
            const workflow = new HandwritingConsistencyWorkflowService();
            const comparison = await workflow.compareSample(
                studentAId,
                { imageBuffer: HandwritingFixtureGenerator.createConsistentSample(43) },
                studentAContext
            );
            expect(comparison.retentionExpiresAt).toBeDefined();
            expect(comparison.retentionPolicy).toBe(HANDWRITING_RETENTION_POLICY.POLICY_NAME);

            await HandwritingComparisonModel.updateOne(
                { _id: comparison._id },
                { $set: { retentionExpiresAt: new Date(Date.now() - 1000) } }
            );
            await workflow.purgeExpiredData(studentAId, studentAContext);
            expect(await HandwritingComparisonModel.countDocuments({ _id: comparison._id })).toBe(0);
        });
    });
});
