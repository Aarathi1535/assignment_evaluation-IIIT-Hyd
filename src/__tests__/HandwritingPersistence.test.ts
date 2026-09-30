import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import HandwritingSampleModel from '../models/HandwritingSample';
import HandwritingProfileModel from '../models/HandwritingProfile';
import HandwritingComparisonModel from '../models/HandwritingComparison';
import handwritingSampleRepository from '../repositories/HandwritingSampleRepository';
import handwritingProfileRepository from '../repositories/HandwritingProfileRepository';
import handwritingComparisonRepository from '../repositories/HandwritingComparisonRepository';
import {
    ComparisonMatchState,
    ProfileStatus,
    SampleExtractionStatus
} from '../models/HandwritingConsistency';

describe('HandwritingPersistence (Phase 3)', () => {
    const studentA = new mongoose.Types.ObjectId().toString();
    const studentB = new mongoose.Types.ObjectId().toString();

    beforeEach(async () => {
        await HandwritingSampleModel.deleteMany({});
        await HandwritingProfileModel.deleteMany({});
        await HandwritingComparisonModel.deleteMany({});
    });

    describe('1. Handwriting Sample Persistence', () => {
        it('1. Valid sample is persisted with 8-element rawVector and usability flag', async () => {
            const rawVector = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
            const sample = await handwritingSampleRepository.create({
                student: new mongoose.Types.ObjectId(studentA),
                sourceReference: 'script-101-page-1',
                sampleType: 'EXAM_SCRIPT',
                status: SampleExtractionStatus.VALID,
                isUsable: true,
                rawVector,
                extractionVersion: '1.0.0'
            });

            expect(sample._id).toBeDefined();
            expect(sample.student.toString()).toBe(studentA);
            expect(sample.isUsable).toBe(true);
            expect(sample.rawVector).toEqual(rawVector);
            expect(sample.extractionVersion).toBe('1.0.0');

            // Find via repository
            const found = await handwritingSampleRepository.findById(sample._id.toString(), studentA);
            expect(found).not.toBeNull();
            expect(found?.sourceReference).toBe('script-101-page-1');
        });

        it('2. Invalid/blank sample cannot become a usable baseline', async () => {
            const rejectedSample = await handwritingSampleRepository.create({
                student: new mongoose.Types.ObjectId(studentA),
                sourceReference: 'blank-doc-page',
                status: SampleExtractionStatus.BLANK,
                isUsable: false,
                disqualificationReason: 'Region contains negligible ink markings'
            });

            expect(rejectedSample.isUsable).toBe(false);
            expect(rejectedSample.status).toBe(SampleExtractionStatus.BLANK);

            // Verify count of usable samples is 0
            const usableCount = await handwritingSampleRepository.countUsableSamples(studentA);
            expect(usableCount).toBe(0);

            // Querying usableOnly returns empty array
            const usableSamples = await handwritingSampleRepository.findByStudent(studentA, { usableOnly: true });
            expect(usableSamples).toHaveLength(0);
        });

        it('18. Non-finite or invalid feature values are rejected by schema validation', async () => {
            // Attempt to persist a vector with Infinity
            await expect(
                HandwritingSampleModel.create({
                    student: new mongoose.Types.ObjectId(studentA),
                    status: SampleExtractionStatus.VALID,
                    isUsable: true,
                    rawVector: [0.1, 0.2, Infinity, 0.4, 0.5, 0.6, 0.7, 0.8],
                    extractionVersion: '1.0.0'
                })
            ).rejects.toThrow();

            // Attempt to persist a vector with wrong length (e.g. 7 elements)
            await expect(
                HandwritingSampleModel.create({
                    student: new mongoose.Types.ObjectId(studentA),
                    status: SampleExtractionStatus.VALID,
                    isUsable: true,
                    rawVector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
                    extractionVersion: '1.0.0'
                })
            ).rejects.toThrow();
        });

        it('11. Duplicate source reference is detected deterministically', async () => {
            await handwritingSampleRepository.create({
                student: new mongoose.Types.ObjectId(studentA),
                sourceReference: 'unique-source-ref-1',
                status: SampleExtractionStatus.VALID,
                isUsable: true,
                rawVector: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]
            });

            const existing = await handwritingSampleRepository.findBySourceReference(
                studentA,
                'unique-source-ref-1'
            );
            expect(existing).not.toBeNull();
            expect(existing?.sourceReference).toBe('unique-source-ref-1');

            // Attempting to duplicate triggers unique constraint error
            await expect(
                handwritingSampleRepository.create({
                    student: new mongoose.Types.ObjectId(studentA),
                    sourceReference: 'unique-source-ref-1',
                    status: SampleExtractionStatus.VALID,
                    isUsable: true
                })
            ).rejects.toThrow();
        });
    });

    describe('2. Handwriting Profile Persistence and Versioning', () => {
        it('4. Profile is associated with correct student and queryable', async () => {
            const profile = await handwritingProfileRepository.create({
                student: new mongoose.Types.ObjectId(studentA),
                sampleCount: 3,
                samplesUsed: [new mongoose.Types.ObjectId()],
                featureMeans: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2],
                featureStdDevs: [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03],
                status: ProfileStatus.ESTABLISHED,
                profileVersion: 1,
                isCurrent: true
            });

            expect(profile._id).toBeDefined();
            expect(profile.student.toString()).toBe(studentA);
            expect(profile.profileVersion).toBe(1);

            const found = await handwritingProfileRepository.findByStudent(studentA);
            expect(found).not.toBeNull();
            expect(found?._id.toString()).toBe(profile._id.toString());
        });

        it('7. Profile version 1 remains intact after version 2 creation', async () => {
            // Version 1
            const v1 = await handwritingProfileRepository.create({
                student: new mongoose.Types.ObjectId(studentA),
                sampleCount: 3,
                samplesUsed: [new mongoose.Types.ObjectId()],
                featureMeans: [0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2],
                featureStdDevs: [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03],
                status: ProfileStatus.ESTABLISHED,
                profileVersion: 1,
                isCurrent: false
            });

            // Version 2
            const v2 = await handwritingProfileRepository.create({
                student: new mongoose.Types.ObjectId(studentA),
                sampleCount: 4,
                samplesUsed: [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()],
                featureMeans: [0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25, 0.25],
                featureStdDevs: [0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04, 0.04],
                status: ProfileStatus.ESTABLISHED,
                profileVersion: 2,
                isCurrent: true
            });

            // Retrieve version 1 explicitly
            const retrievedV1 = await handwritingProfileRepository.findByStudentAndVersion(studentA, 1);
            expect(retrievedV1).not.toBeNull();
            expect(retrievedV1?.sampleCount).toBe(3);
            expect(retrievedV1?.profileVersion).toBe(1);
            expect(retrievedV1?._id.toString()).toBe(v1._id.toString());

            // Retrieve version 2 explicitly
            const retrievedV2 = await handwritingProfileRepository.findByStudentAndVersion(studentA, 2);
            expect(retrievedV2).not.toBeNull();
            expect(retrievedV2?.sampleCount).toBe(4);
            expect(retrievedV2?.profileVersion).toBe(2);
            expect(retrievedV2?._id.toString()).toBe(v2._id.toString());

            // Find current returns v2
            const current = await handwritingProfileRepository.findByStudent(studentA);
            expect(current?.profileVersion).toBe(2);
        });

        it('17. Insecure or invalid ObjectIds return null or empty array safely', async () => {
            const badId = 'not-an-object-id';
            expect(await handwritingSampleRepository.findById(badId)).toBeNull();
            expect(await handwritingSampleRepository.findByStudent(badId)).toEqual([]);
            expect(await handwritingProfileRepository.findByStudent(badId)).toBeNull();
            expect(await handwritingComparisonRepository.findById(badId)).toBeNull();
        });
    });

    describe('3. Comparison Persistence and Isolation', () => {
        it('15. Comparison result is persisted and student-scoped', async () => {
            const sampleId = new mongoose.Types.ObjectId();
            const profileId = new mongoose.Types.ObjectId();

            const comparison = await handwritingComparisonRepository.create({
                student: new mongoose.Types.ObjectId(studentA),
                profile: profileId,
                profileVersion: 1,
                sample: sampleId,
                status: ComparisonMatchState.MATCH,
                distance: 0.18,
                confidence: 0.85,
                featureDeviations: [
                    {
                        feature: 'inkDensity',
                        baselineMean: 0.2,
                        baselineStdDev: 0.03,
                        observed: 0.22,
                        normalizedDeviation: 0.67,
                        contribution: 0.125
                    }
                ],
                anomalyFactors: [],
                comparedAt: new Date()
            });

            expect(comparison._id).toBeDefined();
            expect(comparison.profileVersion).toBe(1);
            expect(comparison.status).toBe(ComparisonMatchState.MATCH);
            expect(comparison.distance).toBe(0.18);

            // Retrieve scoped to Student A
            const foundA = await handwritingComparisonRepository.findById(comparison._id.toString(), studentA);
            expect(foundA).not.toBeNull();

            // Attempt to retrieve using Student B scope must return null
            const foundB = await handwritingComparisonRepository.findById(comparison._id.toString(), studentB);
            expect(foundB).toBeNull();
        });
    });
});
