import { describe, it, expect, beforeEach, vi } from 'vitest';
import AnswerScript, { IAnswerScript, IdentificationStatus } from '../models/AnswerScript';
import Exam, { IExam, ExamStatus } from '../models/Exam';
import Course, { ICourse } from '../models/Course';
import User, { IUser, UserRole } from '../models/User';
import Page from '../models/Page';
import IngestionPage from '../models/IngestionPage';
import HandwritingSampleModel from '../models/HandwritingSample';
import HandwritingProfileModel from '../models/HandwritingProfile';
import HandwritingComparisonModel from '../models/HandwritingComparison';
import { AnswerSheetSourceAdapter } from '../services/handwriting/AnswerSheetSourceAdapter';
import { AnswerRegionResolver } from '../services/handwriting/AnswerRegionResolver';
import { AnswerSheetHandwritingIntegrationService } from '../services/handwriting/AnswerSheetHandwritingIntegrationService';
import { HandwritingConsistencyWorkflowService, HandwritingAuthContext } from '../services/handwriting/HandwritingConsistencyWorkflowService';
import { HandwritingFixtureGenerator } from './fixtures/HandwritingFixtureGenerator';
import { ComparisonMatchState, ProfileStatus } from '../models/HandwritingConsistency';
import { IDerivedStorageService } from '../services/DerivedStorageService';

describe('HandwritingAnswerSheetIntegration (Phase 4)', () => {
    let mockDerivedStorage: {
        readDerivedPage: ReturnType<typeof vi.fn>;
        storeDerivedPage: ReturnType<typeof vi.fn>;
        getDerivedPageKey: ReturnType<typeof vi.fn>;
        storeDerivedThumbnail: ReturnType<typeof vi.fn>;
        getDerivedThumbnailKey: ReturnType<typeof vi.fn>;
    };

    let sourceAdapter: AnswerSheetSourceAdapter;
    let regionResolver: AnswerRegionResolver;
    let workflowService: HandwritingConsistencyWorkflowService;
    let integrationService: AnswerSheetHandwritingIntegrationService;

    let studentAUser: IUser;
    let studentBUser: IUser;
    let profUser: IUser;
    let courseDoc: ICourse;
    let examDoc: IExam;
    let answerScriptDoc: IAnswerScript;

    let studentAAuth: HandwritingAuthContext;
    let profAuth: HandwritingAuthContext;

    beforeEach(async () => {
        // Clean collections
        await HandwritingSampleModel.deleteMany({});
        await HandwritingProfileModel.deleteMany({});
        await HandwritingComparisonModel.deleteMany({});
        await AnswerScript.deleteMany({});
        await Page.deleteMany({});
        await IngestionPage.deleteMany({});
        await Exam.deleteMany({});
        await Course.deleteMany({});
        await User.deleteMany({});

        // Mock DerivedStorageService
        mockDerivedStorage = {
            readDerivedPage: vi.fn(),
            storeDerivedPage: vi.fn(),
            getDerivedPageKey: vi.fn(),
            storeDerivedThumbnail: vi.fn(),
            getDerivedThumbnailKey: vi.fn()
        };

        sourceAdapter = new AnswerSheetSourceAdapter(mockDerivedStorage as unknown as IDerivedStorageService);
        regionResolver = new AnswerRegionResolver();
        workflowService = new HandwritingConsistencyWorkflowService();
        integrationService = new AnswerSheetHandwritingIntegrationService(
            sourceAdapter,
            regionResolver,
            workflowService
        );

        // Seed users
        studentAUser = await User.create({
            name: 'Student A',
            email: 'student_a@test.edu',
            password: 'Password123!',
            role: UserRole.STUDENT
        });

        studentBUser = await User.create({
            name: 'Student B',
            email: 'student_b@test.edu',
            password: 'Password123!',
            role: UserRole.STUDENT
        });

        profUser = await User.create({
            name: 'Professor X',
            email: 'prof_x@test.edu',
            password: 'Password123!',
            role: UserRole.PROFESSOR
        });

        courseDoc = await Course.create({
            courseCode: 'CS101',
            courseName: 'Intro to CS',
            semester: 1,
            academicYear: '2025-2026',
            professor: profUser._id
        });

        examDoc = await Exam.create({
            title: 'Midterm Exam',
            course: courseDoc._id,
            createdBy: profUser._id,
            totalMarks: 100,
            examDate: new Date(),
            status: ExamStatus.SCHEDULED,
            numberOfQuestions: 5
        });

        // Seed identified AnswerScript for Student A
        answerScriptDoc = await AnswerScript.create({
            exam: examDoc._id,
            student: studentAUser._id,
            identificationStatus: IdentificationStatus.IDENTIFIED,
            pageCount: 3,
            startPageNumber: 1,
            endPageNumber: 3
        });

        studentAAuth = {
            userId: studentAUser._id.toString(),
            role: UserRole.STUDENT
        };

        profAuth = {
            userId: profUser._id.toString(),
            role: UserRole.PROFESSOR
        };
    });

    describe('1. Trusted Student Identity & Security Resolution', () => {
        it('1. AnswerScript resolves to the correct trusted student', async () => {
            const { studentId } = await sourceAdapter.resolveAnswerScriptStudent(
                answerScriptDoc._id.toString()
            );
            expect(studentId).toBe(studentAUser._id.toString());
        });

        it('7 & 8. Arbitrary supplied student ID cannot override trusted AnswerScript identity', async () => {
            // Supplying matching studentId succeeds
            await expect(
                sourceAdapter.resolveAnswerScriptStudent(
                    answerScriptDoc._id.toString(),
                    studentAUser._id.toString()
                )
            ).resolves.toBeDefined();

            // Supplying conflicting studentId throws 403 Security Violation
            await expect(
                sourceAdapter.resolveAnswerScriptStudent(
                    answerScriptDoc._id.toString(),
                    studentBUser._id.toString()
                )
            ).rejects.toThrow(/Security violation/);
        });

        it('9. Missing student mapping fails safely with 422 Unprocessable Entity', async () => {
            const unidentifiedScript = await AnswerScript.create({
                exam: examDoc._id,
                student: null,
                identificationStatus: IdentificationStatus.UNIDENTIFIED
            });

            await expect(
                sourceAdapter.resolveAnswerScriptStudent(unidentifiedScript._id.toString())
            ).rejects.toThrow(/no verified student mapping/);
        });
    });

    describe('2. Physical Page Image Resolution through Storage Infrastructure', () => {
        it('2. Rendered page resolves through existing storage infrastructure', async () => {
            const pageBuffer = HandwritingFixtureGenerator.createConsistentSample(42);
            mockDerivedStorage.readDerivedPage.mockResolvedValue(pageBuffer);

            // Seed production Page record
            await Page.create({
                answerScript: answerScriptDoc._id,
                pageNumber: 1,
                imagePath: 'batches/b1/derived/f1/1/page.png'
            });

            const resolvedPages = await sourceAdapter.resolveAnswerSheetPages(
                answerScriptDoc._id.toString()
            );

            expect(resolvedPages).toHaveLength(1);
            expect(resolvedPages[0].pageNumber).toBe(1);
            expect(resolvedPages[0].imageBuffer).toEqual(pageBuffer);
            expect(resolvedPages[0].studentId).toBe(studentAUser._id.toString());
            expect(mockDerivedStorage.readDerivedPage).toHaveBeenCalledWith('batches/b1/derived/f1/1/page.png');
        });
    });

    describe('3. Answer Region Segmentation & Independence', () => {
        let page1Buffer: Buffer;
        let page7Buffer: Buffer;

        beforeEach(async () => {
            page1Buffer = HandwritingFixtureGenerator.createConsistentSample(10);
            page7Buffer = HandwritingFixtureGenerator.createConsistentSample(20);

            // Mock page resolution for page 1 and page 7
            mockDerivedStorage.readDerivedPage.mockImplementation(async (key: string) => {
                if (key.includes('page_1')) return page1Buffer;
                if (key.includes('page_7')) return page7Buffer;
                return page1Buffer;
            });

            await Page.create({
                answerScript: answerScriptDoc._id,
                pageNumber: 1,
                imagePath: 'derived/page_1.png'
            });

            await Page.create({
                answerScript: answerScriptDoc._id,
                pageNumber: 7,
                imagePath: 'derived/page_7.png'
            });
        });

        it('3. One answer region becomes one handwriting sample with accurate bounding box', async () => {
            const results = await integrationService.processAnswerScriptRegionsForBaseline(
                answerScriptDoc._id.toString(),
                [
                    {
                        regionId: 'r1',
                        questionNumber: 1,
                        pageNumber: 1,
                        boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 }
                    }
                ],
                profAuth
            );

            expect(results).toHaveLength(1);
            expect(results[0].sample.isUsable).toBe(true);
            expect(results[0].sample.boundingBox).toMatchObject({ x: 0.1, y: 0.1, width: 0.8, height: 0.4 });
            expect(results[0].sample.pageNumber).toBe(1);
            expect(results[0].sample.sourceReference).toContain('script_');
            expect(results[0].sample.sourceReference).toContain('_p1');
        });

        it('4. Multiple regions on one page remain separate samples and do not blend into a whole-page sample', async () => {
            // Page 1 has Q1 in top half and Q2 in bottom half
            const results = await integrationService.processAnswerScriptRegionsForBaseline(
                answerScriptDoc._id.toString(),
                [
                    {
                        regionId: 'q1_top',
                        questionNumber: 1,
                        pageNumber: 1,
                        boundingBox: { x: 0.05, y: 0.05, width: 0.9, height: 0.4 }
                    },
                    {
                        regionId: 'q2_bottom',
                        questionNumber: 2,
                        pageNumber: 1,
                        boundingBox: { x: 0.05, y: 0.50, width: 0.9, height: 0.4 }
                    }
                ],
                profAuth
            );

            expect(results).toHaveLength(2);
            // Two distinct samples
            expect(results[0].sample._id.toString()).not.toBe(results[1].sample._id.toString());
            expect(results[0].sample.boundingBox?.y).toBe(0.05);
            expect(results[1].sample.boundingBox?.y).toBe(0.50);
            expect(results[0].sample.sourceReference).toContain('q1_top');
            expect(results[1].sample.sourceReference).toContain('q2_bottom');
        });

        it('5. Non-consecutive answer regions remain associated with the same reconstructed question', async () => {
            // Direction 3 format: Q1 on Page 1, continuing on Page 7
            const reconstructedQ1 = {
                answerScript: answerScriptDoc._id.toString(),
                questionNumber: 1,
                segments: [
                    {
                        segmentId: 'seg_p1_start',
                        pageNumber: 1,
                        box: { x: 0.1, y: 0.1, width: 0.8, height: 0.5 },
                        segmentType: 'START',
                        sequenceIndex: 1
                    },
                    {
                        segmentId: 'seg_p7_cont',
                        pageNumber: 7,
                        box: { x: 0.1, y: 0.2, width: 0.8, height: 0.4 },
                        segmentType: 'CONTINUATION',
                        sequenceIndex: 2
                    }
                ]
            };

            const resolvedPages = [
                {
                    answerScriptId: answerScriptDoc._id.toString(),
                    studentId: studentAUser._id.toString(),
                    pageNumber: 1,
                    sourceReference: 'script_p1',
                    imageBuffer: page1Buffer
                },
                {
                    answerScriptId: answerScriptDoc._id.toString(),
                    studentId: studentAUser._id.toString(),
                    pageNumber: 7,
                    sourceReference: 'script_p7',
                    imageBuffer: page7Buffer
                }
            ];

            const resolution = regionResolver.resolveFromDirection3ReconstructedAnswer(
                reconstructedQ1,
                studentAUser._id.toString(),
                resolvedPages
            );

            expect(resolution.resolved).toBe(true);
            expect(resolution.regions).toHaveLength(2);
            // Both regions are for Question 1
            expect(resolution.regions[0].questionNumber).toBe(1);
            expect(resolution.regions[1].questionNumber).toBe(1);
            // But from distinct non-consecutive pages
            expect(resolution.regions[0].pageNumber).toBe(1);
            expect(resolution.regions[1].pageNumber).toBe(7);
        });

        it('6. Same source region processed twice does not create duplicate usable samples', async () => {
            const region = {
                regionId: 'dedup_reg',
                questionNumber: 3,
                pageNumber: 1,
                boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.3 }
            };

            const firstRun = await integrationService.processAnswerScriptRegionsForBaseline(
                answerScriptDoc._id.toString(),
                [region],
                profAuth
            );
            expect(firstRun[0].isDuplicate).toBe(false);

            const secondRun = await integrationService.processAnswerScriptRegionsForBaseline(
                answerScriptDoc._id.toString(),
                [region],
                profAuth
            );
            expect(secondRun[0].isDuplicate).toBe(true);
            expect(secondRun[0].sample._id.toString()).toBe(firstRun[0].sample._id.toString());
        });

        it('15. Blank / diagram-only region is handled correctly and does not enter baseline', async () => {
            const blankBuffer = HandwritingFixtureGenerator.createBlankSample();
            mockDerivedStorage.readDerivedPage.mockResolvedValue(blankBuffer);

            const results = await integrationService.processAnswerScriptRegionsForBaseline(
                answerScriptDoc._id.toString(),
                [
                    {
                        regionId: 'blank_reg',
                        questionNumber: 4,
                        pageNumber: 1,
                        boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 }
                    }
                ],
                profAuth
            );

            expect(results).toHaveLength(1);
            expect(results[0].sample.isUsable).toBe(false);
            expect(results[0].sample.status).toBe('BLANK');
            // Baseline count does not increase
            const usableCount = await HandwritingSampleModel.countDocuments({
                student: studentAUser._id,
                isUsable: true
            });
            expect(usableCount).toBe(0);
        });
    });

    describe('4. Profile Building and Comparison Integration on Answer Sheets', () => {
        beforeEach(async () => {
            const consistentPage = HandwritingFixtureGenerator.createConsistentSample(42);
            mockDerivedStorage.readDerivedPage.mockResolvedValue(consistentPage);

            await Page.create({
                answerScript: answerScriptDoc._id,
                pageNumber: 1,
                imagePath: 'derived/page_1.png'
            });
        });

        it('11. Comparison on student without enough baseline samples returns INSUFFICIENT_SAMPLE', async () => {
            const comparisons = await integrationService.compareAnswerScriptRegions(
                answerScriptDoc._id.toString(),
                [
                    {
                        regionId: 'comp_q1',
                        questionNumber: 1,
                        pageNumber: 1,
                        boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.4 }
                    }
                ],
                studentAAuth
            );

            expect(comparisons).toHaveLength(1);
            expect(comparisons[0].status).toBe(ComparisonMatchState.INSUFFICIENT_SAMPLE);
            expect(comparisons[0].profileVersion).toBeUndefined();
        });

        it('10, 13 & 14. Established profile produces comparison referencing exact profileVersion', async () => {
            // Seed 3 baseline samples for student A to create an ESTABLISHED profile (v1)
            for (let i = 1; i <= 3; i++) {
                await integrationService.processAnswerScriptRegionsForBaseline(
                    answerScriptDoc._id.toString(),
                    [
                        {
                            regionId: `base_q_${i}`,
                            questionNumber: i,
                            pageNumber: 1,
                            boundingBox: { x: 0.05, y: 0.05 + i * 0.1, width: 0.8, height: 0.25 }
                        }
                    ],
                    profAuth
                );
            }

            const currentProfile = await HandwritingProfileModel.findOne({
                student: studentAUser._id,
                isCurrent: true
            });
            expect(currentProfile?.status).toBe(ProfileStatus.ESTABLISHED);
            expect(currentProfile?.profileVersion).toBe(1);

            // Perform comparison against profile v1
            const comparisons = await integrationService.compareAnswerScriptRegions(
                answerScriptDoc._id.toString(),
                [
                    {
                        regionId: 'new_exam_q1',
                        questionNumber: 1,
                        pageNumber: 1,
                        boundingBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.3 }
                    }
                ],
                studentAAuth
            );

            expect(comparisons).toHaveLength(1);
            expect(comparisons[0].status).toBe(ComparisonMatchState.MATCH);
            expect(comparisons[0].profileVersion).toBe(1);
            expect(comparisons[0].profile?.toString()).toBe(currentProfile?._id.toString());
            const savedCompId = comparisons[0]._id.toString();

            // Now add a 4th sample to advance profile to v2
            await integrationService.processAnswerScriptRegionsForBaseline(
                answerScriptDoc._id.toString(),
                [
                    {
                        regionId: 'base_q_4',
                        questionNumber: 4,
                        pageNumber: 1,
                        boundingBox: { x: 0.05, y: 0.6, width: 0.8, height: 0.25 }
                    }
                ],
                profAuth
            );

            const v2Profile = await HandwritingProfileModel.findOne({
                student: studentAUser._id,
                isCurrent: true
            });
            expect(v2Profile?.profileVersion).toBe(2);

            // Historical comparison must remain unchanged referencing v1
            const historicalComp = await HandwritingComparisonModel.findById(savedCompId);
            expect(historicalComp?.profileVersion).toBe(1);
            expect(historicalComp?.profile?.toString()).toBe(currentProfile?._id.toString());
        });

        it('16. Source traceability is preserved across generated samples and comparisons', async () => {
            const results = await integrationService.processAnswerScriptRegionsForBaseline(
                answerScriptDoc._id.toString(),
                [
                    {
                        regionId: 'trace_q5',
                        questionNumber: 5,
                        subQuestion: 'b',
                        pageNumber: 1,
                        boundingBox: { x: 0.2, y: 0.3, width: 0.6, height: 0.3 }
                    }
                ],
                profAuth
            );

            const sample = results[0].sample;
            expect(sample.student.toString()).toBe(studentAUser._id.toString());
            expect(sample.answerScriptId?.toString()).toBe(answerScriptDoc._id.toString());
            expect(sample.pageNumber).toBe(1);
            expect(sample.boundingBox).toMatchObject({ x: 0.2, y: 0.3, width: 0.6, height: 0.3 });
            expect(sample.sourceReference).toContain('trace_q5');
            expect(sample.extractionVersion).toBe('1.0.0');
        });
    });
});
