import { describe, it, expect, beforeEach } from 'vitest';
import mongoose from 'mongoose';
import HandwritingSampleModel from '../models/HandwritingSample';
import HandwritingProfileModel from '../models/HandwritingProfile';
import HandwritingComparisonModel from '../models/HandwritingComparison';
import {
    HandwritingConsistencyWorkflowService,
    HandwritingAuthContext
} from '../services/handwriting/HandwritingConsistencyWorkflowService';
import { HandwritingFixtureGenerator } from './fixtures/HandwritingFixtureGenerator';
import {
    ComparisonMatchState,
    ProfileStatus,
    SampleExtractionStatus
} from '../models/HandwritingConsistency';
import { UserRole } from '../constants/permissions';

describe('HandwritingConsistencyWorkflowService (Phase 3)', () => {
    const workflow = new HandwritingConsistencyWorkflowService();

    const studentAId = new mongoose.Types.ObjectId().toString();
    const studentBId = new mongoose.Types.ObjectId().toString();

    const studentAContext: HandwritingAuthContext = {
        userId: studentAId,
        role: UserRole.STUDENT
    };

    const studentBContext: HandwritingAuthContext = {
        userId: studentBId,
        role: UserRole.STUDENT
    };

    const professorContext: HandwritingAuthContext = {
        userId: new mongoose.Types.ObjectId().toString(),
        role: UserRole.PROFESSOR
    };

    beforeEach(async () => {
        await HandwritingSampleModel.deleteMany({});
        await HandwritingProfileModel.deleteMany({});
        await HandwritingComparisonModel.deleteMany({});
    });

    describe('1. Sample Registration & Profile Establishment', () => {
        it('1 & 3. Registering 3 valid samples creates an ESTABLISHED profile (v1)', async () => {
            const buf1 = HandwritingFixtureGenerator.createConsistentSample(1);
            const buf2 = HandwritingFixtureGenerator.createConsistentSample(2);
            const buf3 = HandwritingFixtureGenerator.createConsistentSample(3);

            // Sample 1 -> PROVISIONAL
            const res1 = await workflow.registerSample({
                studentId: studentAId,
                sourceReference: 'exam-1-page-1',
                imageBuffer: buf1
            }, studentAContext);
            expect(res1.sample.isUsable).toBe(true);
            expect(res1.profile?.status).toBe(ProfileStatus.PROVISIONAL);
            expect(res1.profile?.sampleCount).toBe(1);

            // Sample 2 -> PROVISIONAL
            const res2 = await workflow.registerSample({
                studentId: studentAId,
                sourceReference: 'exam-1-page-2',
                imageBuffer: buf2
            }, studentAContext);
            expect(res2.profile?.status).toBe(ProfileStatus.PROVISIONAL);
            expect(res2.profile?.sampleCount).toBe(2);

            // Sample 3 -> ESTABLISHED (v1)
            const res3 = await workflow.registerSample({
                studentId: studentAId,
                sourceReference: 'exam-1-page-3',
                imageBuffer: buf3
            }, studentAContext);
            expect(res3.profile?.status).toBe(ProfileStatus.ESTABLISHED);
            expect(res3.profile?.sampleCount).toBe(3);
            expect(res3.profile?.profileVersion).toBe(1);
            expect(res3.profile?.isCurrent).toBe(true);
        });

        it('2. Invalid/blank sample cannot become a usable baseline and does not advance profile', async () => {
            const blankBuffer = HandwritingFixtureGenerator.createBlankSample();
            const res = await workflow.registerSample({
                studentId: studentAId,
                sourceReference: 'blank-sub',
                imageBuffer: blankBuffer
            }, studentAContext);

            expect(res.sample.status).toBe(SampleExtractionStatus.BLANK);
            expect(res.sample.isUsable).toBe(false);
            // Profile count remains 0 or null
            expect(res.profile?.sampleCount ?? 0).toBe(0);
        });

        it('11. Duplicate source sample is handled deterministically without duplicating data', async () => {
            const buf = HandwritingFixtureGenerator.createConsistentSample(42);

            const first = await workflow.registerSample({
                studentId: studentAId,
                sourceReference: 'dup-ref-100',
                imageBuffer: buf
            }, studentAContext);
            expect(first.isDuplicate).toBe(false);

            const second = await workflow.registerSample({
                studentId: studentAId,
                sourceReference: 'dup-ref-100',
                imageBuffer: buf
            }, studentAContext);
            expect(second.isDuplicate).toBe(true);
            expect(second.sample._id.toString()).toBe(first.sample._id.toString());
        });
    });

    describe('2. Authorization and Student Privacy', () => {
        beforeEach(async () => {
            // Seed a sample for student A
            await workflow.registerSample({
                studentId: studentAId,
                sourceReference: 'seed-a',
                imageBuffer: HandwritingFixtureGenerator.createConsistentSample(1)
            }, studentAContext);
        });

        it('5. Student A cannot retrieve Student B profile (403 Forbidden)', async () => {
            await expect(
                workflow.getStudentProfile(studentBId, studentAContext)
            ).rejects.toThrow(/Unauthorized/);

            // Bidirectional verification: Student B cannot retrieve Student A's profile
            await expect(
                workflow.getStudentProfile(studentAId, studentBContext)
            ).rejects.toThrow(/Unauthorized/);
        });

        it('6. Student A cannot retrieve Student B samples (403 Forbidden)', async () => {
            await expect(
                workflow.getStudentSamples(studentBId, studentAContext)
            ).rejects.toThrow(/Unauthorized/);
        });

        it('16. Student A cannot retrieve Student B comparisons (403 Forbidden)', async () => {
            await expect(
                workflow.getStudentComparisons(studentBId, studentAContext)
            ).rejects.toThrow(/Unauthorized/);
        });

        it('Staff (PROFESSOR) is explicitly authorized to view student profile and samples', async () => {
            const profProfile = await workflow.getStudentProfile(studentAId, professorContext);
            expect(profProfile).toBeDefined();

            const samples = await workflow.getStudentSamples(studentAId, professorContext);
            expect(samples.length).toBeGreaterThanOrEqual(1);
        });

        it('17. Invalid ObjectId format throws 400 Bad Request', async () => {
            await expect(
                workflow.getStudentProfile('invalid-id', studentAContext)
            ).rejects.toThrow(/Invalid student ID/);
        });
    });

    describe('3. Profile Versioning and Historical Traceability', () => {
        let v1Id: string;

        beforeEach(async () => {
            // Create established profile v1 for student A (3 samples)
            for (let i = 1; i <= 3; i++) {
                await workflow.registerSample({
                    studentId: studentAId,
                    sourceReference: `v1-ref-${i}`,
                    imageBuffer: HandwritingFixtureGenerator.createConsistentSample(i * 10)
                }, studentAContext);
            }
            const p1 = await workflow.getStudentProfile(studentAId, studentAContext);
            expect(p1?.profileVersion).toBe(1);
            v1Id = p1!._id.toString();
        });

        it('7 & 8. Adding a 4th sample creates version 2 while keeping version 1 intact', async () => {
            // Register 4th sample
            await workflow.registerSample({
                studentId: studentAId,
                sourceReference: 'v2-ref-4',
                imageBuffer: HandwritingFixtureGenerator.createConsistentSample(40)
            }, studentAContext);

            // Latest profile is v2
            const currentProf = await workflow.getStudentProfile(studentAId, studentAContext);
            expect(currentProf?.profileVersion).toBe(2);
            expect(currentProf?.sampleCount).toBe(4);
            expect(currentProf?.isCurrent).toBe(true);

            // Version 1 still exists intact
            const historicalV1 = await workflow.getStudentProfile(studentAId, studentAContext, 1);
            expect(historicalV1).not.toBeNull();
            expect(historicalV1?.profileVersion).toBe(1);
            expect(historicalV1?.sampleCount).toBe(3);
            expect(historicalV1?.isCurrent).toBe(false);
            expect(historicalV1?._id.toString()).toBe(v1Id);
        });

        it('20. Rebuilding profile without new samples reuses the existing version (idempotent)', async () => {
            const rebuilt = await workflow.rebuildProfile(studentAId, studentAContext);
            expect(rebuilt.profileVersion).toBe(1);
            expect(rebuilt._id.toString()).toBe(v1Id);
        });

        it('9 & 10. Comparison references exact profile version and remains unchanged after profile update', async () => {
            // Perform comparison against profile v1
            const testSampleBuffer = HandwritingFixtureGenerator.createConsistentSample(99);
            const compV1 = await workflow.compareSample(studentAId, {
                sourceReference: 'exam-submission-v1',
                imageBuffer: testSampleBuffer
            }, studentAContext);

            expect(compV1.profileVersion).toBe(1);
            expect(compV1.profile?.toString()).toBe(v1Id);
            expect(compV1.status).toBe(ComparisonMatchState.MATCH);
            const savedDistance = compV1.distance;

            // Now update the student's profile to version 2 by adding a new sample
            await workflow.registerSample({
                studentId: studentAId,
                sourceReference: 'new-baseline-sample',
                imageBuffer: HandwritingFixtureGenerator.createConsistentSample(77)
            }, studentAContext);

            const updatedProfile = await workflow.getStudentProfile(studentAId, studentAContext);
            expect(updatedProfile?.profileVersion).toBe(2);

            // Retrieve the historical comparison record: it must STILL reference version 1
            const historicalComp = (await workflow.getStudentComparisons(studentAId, studentAContext))
                .find(c => c._id.toString() === compV1._id.toString());

            expect(historicalComp).toBeDefined();
            expect(historicalComp?.profileVersion).toBe(1);
            expect(historicalComp?.profile?.toString()).toBe(v1Id);
            expect(historicalComp?.distance).toBe(savedDistance);
        });
    });

    describe('4. Comparison Scenarios and Edge Cases', () => {
        it('13. Comparison against a student without an established baseline returns INSUFFICIENT_SAMPLE', async () => {
            const newStudentId = new mongoose.Types.ObjectId().toString();
            const newStudentContext: HandwritingAuthContext = {
                userId: newStudentId,
                role: UserRole.STUDENT
            };

            const comp = await workflow.compareSample(newStudentId, {
                sourceReference: 'no-baseline-test',
                imageBuffer: HandwritingFixtureGenerator.createConsistentSample(1)
            }, newStudentContext);

            expect(comp.status).toBe(ComparisonMatchState.INSUFFICIENT_SAMPLE);
            expect(comp.profileVersion).toBeUndefined();
            expect(comp.distance).toBe(0);
        });

        it('14. Poor-quality comparison sample is handled correctly and persisted as UNASSESSED', async () => {
            // Create established profile for student A
            for (let i = 1; i <= 3; i++) {
                await workflow.registerSample({
                    studentId: studentAId,
                    sourceReference: `seed-${i}`,
                    imageBuffer: HandwritingFixtureGenerator.createConsistentSample(i)
                }, studentAContext);
            }

            const blankBuffer = HandwritingFixtureGenerator.createBlankSample();
            const comp = await workflow.compareSample(studentAId, {
                sourceReference: 'poor-quality-comp',
                imageBuffer: blankBuffer
            }, studentAContext);

            expect(comp.status).toBe(ComparisonMatchState.UNASSESSED);
            expect(comp.distance).toBe(0);
            expect(comp.anomalyFactors[0]).toContain('Sample rejected during quality validation');
        });
    });
});
