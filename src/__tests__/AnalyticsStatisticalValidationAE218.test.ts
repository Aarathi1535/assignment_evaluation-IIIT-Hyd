import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as apiAuth from '../lib/apiAuth';
import { UserRole } from '../constants/permissions';
import Course from '../models/Course';
import Exam, { ExamStatus } from '../models/Exam';
import User from '../models/User';
import AnswerScript, { IdentificationStatus } from '../models/AnswerScript';
import Grade from '../models/Grade';
import Rubric from '../models/Rubric';
import {
    calculateDescriptiveStatistics,
    calculateScoreDistribution,
    calculateQuestionPerformance,
    calculateGraderConsistency
} from '../lib/stats';
import { GET as getExamAnalytics } from '../app/api/analytics/exams/[id]/route';
import { GET as getGraderConsistency } from '../app/api/analytics/exams/[id]/graders/route';
import {
    HAND_COMPUTED_DESCRIPTIVE_FIXTURES,
    HAND_COMPUTED_DISTRIBUTION_FIXTURES,
    HAND_COMPUTED_QUESTION_FIXTURE,
    HAND_COMPUTED_CONSISTENCY_FIXTURE
} from './fixtures/analyticsFixtures';

describe('AE-218: Analytics Fixture and Statistical Validation', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('1. Descriptive Statistics Validation against Hand-Computed Fixtures', () => {
        for (const [key, fixture] of Object.entries(HAND_COMPUTED_DESCRIPTIVE_FIXTURES)) {
            it(`correctly computes descriptive statistics for: ${fixture.name} (${key})`, () => {
                const stats = calculateDescriptiveStatistics(fixture.input);

                expect(stats.count).toBe(fixture.expected.count);

                if (fixture.expected.mean === null) {
                    expect(stats.mean).toBeNull();
                } else {
                    expect(stats.mean).toBeCloseTo(fixture.expected.mean, 10);
                }

                if (fixture.expected.median === null) {
                    expect(stats.median).toBeNull();
                } else {
                    expect(stats.median).toBeCloseTo(fixture.expected.median, 10);
                }

                if (fixture.expected.populationStandardDeviation === null) {
                    expect(stats.standardDeviation).toBeNull();
                } else {
                    expect(stats.standardDeviation).toBeCloseTo(
                        fixture.expected.populationStandardDeviation,
                        10
                    );
                }
            });
        }

        it('strictly validates population vs sample standard deviation divergence', () => {
            // For odd sample [10, 20, 30, 40, 50]:
            // Population stdDev is sqrt(200) ~ 14.1421356
            // Sample stdDev is sqrt(250) ~ 15.8113883
            const oddFixture = HAND_COMPUTED_DESCRIPTIVE_FIXTURES.oddSampleSize;
            const stats = calculateDescriptiveStatistics(oddFixture.input);

            expect(stats.standardDeviation).toBeCloseTo(
                oddFixture.expected.populationStandardDeviation!,
                10
            );
            // Verify that the implementation does NOT use sample standard deviation (N - 1)
            expect(stats.standardDeviation).not.toBeCloseTo(
                oddFixture.expected.sampleStandardDeviation!,
                1
            );
        });

        it('handles single-value dataset without crashing or returning NaN', () => {
            const singleFixture = HAND_COMPUTED_DESCRIPTIVE_FIXTURES.singleValue;
            const stats = calculateDescriptiveStatistics(singleFixture.input);

            expect(stats).toEqual({
                count: 1,
                mean: 42,
                median: 42,
                standardDeviation: 0
            });
        });

        it('handles empty and all-non-finite datasets safely returning null moments', () => {
            expect(calculateDescriptiveStatistics([])).toEqual({
                count: 0,
                mean: null,
                median: null,
                standardDeviation: null
            });

            expect(calculateDescriptiveStatistics([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])).toEqual({
                count: 0,
                mean: null,
                median: null,
                standardDeviation: null
            });
        });
    });

    describe('2. Score Distribution (Histogram) Partitioning & Clamping', () => {
        it('validates boundary conditions and clamping for standard 10-bin histogram', () => {
            const fixture = HAND_COMPUTED_DISTRIBUTION_FIXTURES.standardTenBinsWithBoundaries;
            const bins = calculateScoreDistribution(fixture.scores, fixture.binCount);

            expect(bins).toHaveLength(10);
            expect(bins.map(b => b.count)).toEqual(fixture.expectedBinCounts);
            expect(bins[0].label).toBe('0-10%');
            expect(bins[9].label).toBe('90-100%');
        });

        it('validates custom bin count (5 bins = 20% intervals)', () => {
            const fixture = HAND_COMPUTED_DISTRIBUTION_FIXTURES.customFiveBins;
            const bins = calculateScoreDistribution(fixture.scores, fixture.binCount);

            expect(bins).toHaveLength(5);
            expect(bins.map(b => b.count)).toEqual(fixture.expectedBinCounts);
            expect(bins[0].label).toBe('0-20%');
            expect(bins[4].label).toBe('80-100%');
        });

        it('rejects invalid binCount values with clear error', () => {
            expect(() => calculateScoreDistribution([], 0)).toThrow(
                'Histogram bin count must be an integer between 1 and 100'
            );
            expect(() => calculateScoreDistribution([], 101)).toThrow(
                'Histogram bin count must be an integer between 1 and 100'
            );
            expect(() => calculateScoreDistribution([], 2.5)).toThrow(
                'Histogram bin count must be an integer between 1 and 100'
            );
        });
    });

    describe('3. Question-Level Performance & Difficulty Index Validation', () => {
        it('calculates question-level percentage metrics and difficulty index', () => {
            const fixture = HAND_COMPUTED_QUESTION_FIXTURE;
            const results = calculateQuestionPerformance(fixture.questions, fixture.observations);

            expect(results).toHaveLength(fixture.expected.length);

            for (let i = 0; i < fixture.expected.length; i++) {
                const actual = results[i];
                const expected = fixture.expected[i];

                expect(actual.questionNumber).toBe(expected.questionNumber);
                expect(actual.maxMarks).toBe(expected.maxMarks);
                expect(actual.gradedCount).toBe(expected.gradedCount);

                if (expected.meanScorePercentage === null) {
                    expect(actual.meanScorePercentage).toBeNull();
                    expect(actual.standardDeviationPercentagePoints).toBeNull();
                    expect(actual.difficultyIndexPercentage).toBeNull();
                } else {
                    expect(actual.meanScorePercentage).toBeCloseTo(expected.meanScorePercentage, 10);
                    expect(actual.standardDeviationPercentagePoints).toBeCloseTo(
                        expected.standardDeviationPercentagePoints!,
                        10
                    );
                    expect(actual.difficultyIndexPercentage).toBeCloseTo(
                        expected.difficultyIndexPercentage!,
                        10
                    );
                }
            }
        });

        it('safely handles empty questions list and empty observations', () => {
            expect(calculateQuestionPerformance([], [])).toEqual([]);
            expect(calculateQuestionPerformance([{ questionNumber: 1, maxMarks: 10 }], [])).toEqual([
                {
                    questionNumber: 1,
                    maxMarks: 10,
                    gradedCount: 0,
                    meanScorePercentage: null,
                    standardDeviationPercentagePoints: null,
                    difficultyIndexPercentage: null
                }
            ]);
        });
    });

    describe('4. TA Grading Consistency & Mean Absolute Deviation Validation', () => {
        it('calculates MAD correctly across comparable groups and flags sample size status', () => {
            const fixture = HAND_COMPUTED_CONSISTENCY_FIXTURE;
            const results = calculateGraderConsistency(fixture.observations);

            expect(results).toHaveLength(fixture.expected.length);

            for (let i = 0; i < fixture.expected.length; i++) {
                const actual = results[i];
                const expected = fixture.expected[i];

                expect(actual.graderId).toBe(expected.graderId);
                expect(actual.comparisonCount).toBe(expected.comparisonCount);
                expect(actual.meanAbsoluteDeviationPercentagePoints).toBeCloseTo(
                    expected.meanAbsoluteDeviationPercentagePoints,
                    10
                );
                expect(actual.sampleSizeStatus).toBe(expected.sampleSizeStatus);
            }
        });

        it('disregards groups where fewer than 2 distinct graders contributed', () => {
            const results = calculateGraderConsistency([
                { graderId: 'ta-solo', comparableGroup: 'isolated-group', scorePercentage: 80 },
                { graderId: 'ta-solo', comparableGroup: 'isolated-group', scorePercentage: 90 }
            ]);
            expect(results).toEqual([]);
        });

        it('allows custom minimum sample size threshold', () => {
            const observations = [
                { graderId: 'ta-1', comparableGroup: 'g1', scorePercentage: 70 },
                { graderId: 'ta-2', comparableGroup: 'g1', scorePercentage: 80 }
            ];
            // With minSampleSize = 1: 1 comparison is SUFFICIENT
            const metrics1 = calculateGraderConsistency(observations, 1);
            expect(metrics1[0].sampleSizeStatus).toBe('SUFFICIENT');

            // With default minSampleSize = 5: 1 comparison is INSUFFICIENT
            const metricsDefault = calculateGraderConsistency(observations);
            expect(metricsDefault[0].sampleSizeStatus).toBe('INSUFFICIENT');
        });
    });

    describe('5. Database & API End-to-End Aggregation Correctness', () => {
        it('aggregates scores accurately for the target exam without cross-exam or unreleased data pollution', async () => {
            // Setup Users: 2 Professors, 2 TAs, 6 Students
            const profA = await User.create({
                name: 'Professor A',
                email: 'prof-a-ae218@example.test',
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });
            const profB = await User.create({
                name: 'Professor B',
                email: 'prof-b-ae218@example.test',
                password: 'password123',
                role: UserRole.PROFESSOR,
                isActive: true
            });

            const ta1 = await User.create({
                name: 'TA One',
                email: 'ta-1-ae218@example.test',
                password: 'password123',
                role: UserRole.TA,
                isActive: true
            });
            const ta2 = await User.create({
                name: 'TA Two',
                email: 'ta-2-ae218@example.test',
                password: 'password123',
                role: UserRole.TA,
                isActive: true
            });

            const students = await Promise.all([1, 2, 3, 4, 5, 6].map(i => User.create({
                name: `Student ${i}`,
                email: `student-${i}-ae218@example.test`,
                password: 'password123',
                role: UserRole.STUDENT,
                isActive: i !== 5 // Student 5 is deactivated to test inactive student filtering
            })));

            // Courses
            const courseA = await Course.create({
                courseCode: 'CS-101-AE218',
                courseName: 'Data Structures',
                academicYear: '2026-2027',
                semester: 1,
                professor: profA._id,
                enrolledStudents: [students[0]._id, students[1]._id, students[2]._id, students[3]._id, students[4]._id],
                teachingAssistants: [ta1._id, ta2._id],
                isActive: true
            });

            const courseB = await Course.create({
                courseCode: 'CS-201-AE218',
                courseName: 'Algorithms',
                academicYear: '2026-2027',
                semester: 1,
                professor: profB._id,
                enrolledStudents: [students[5]._id],
                teachingAssistants: [],
                isActive: true
            });

            // Exams
            // Exam 1: Course A, PUBLISHED (Target exam for analytics)
            const exam1 = await Exam.create({
                title: 'CS-101 Midterm',
                course: courseA._id,
                createdBy: profA._id,
                examDate: new Date('2026-11-01'),
                totalMarks: 50,
                numberOfQuestions: 2,
                status: ExamStatus.PUBLISHED,
                isActive: true
            });

            // Exam 2: Course A, DRAFT (Must not be eligible for analytics)
            const exam2 = await Exam.create({
                title: 'CS-101 Final Exam',
                course: courseA._id,
                createdBy: profA._id,
                examDate: new Date('2026-12-01'),
                totalMarks: 100,
                numberOfQuestions: 4,
                status: ExamStatus.DRAFT,
                isActive: true
            });

            // Exam 3: Course B, PUBLISHED (Must not leak into Exam 1 analytics)
            const exam3 = await Exam.create({
                title: 'CS-201 Quiz',
                course: courseB._id,
                createdBy: profB._id,
                examDate: new Date('2026-11-02'),
                totalMarks: 100,
                numberOfQuestions: 1,
                status: ExamStatus.PUBLISHED,
                isActive: true
            });

            // Rubric for Exam 1
            const rubric1 = await Rubric.create({
                exam: exam1._id,
                createdBy: profA._id,
                scoreStep: 0.5,
                questions: [
                    { questionNumber: 1, maxMarks: 20, criteria: [{ criterionName: 'Q1', points: 20 }] },
                    { questionNumber: 2, maxMarks: 30, criteria: [{ criterionName: 'Q2', points: 30 }] }
                ],
                isActive: true
            });

            // Submissions & Grades for Exam 1:
            // S1 (index 0): Released. Q1: 16/20 (80%), Q2: 24/30 (80%). Total: 40/50.
            // Graded by TA1 for Q1, TA2 for Q2.
            const script1 = await AnswerScript.create({
                exam: exam1._id,
                student: students[0]._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create({
                answerScript: script1._id,
                rubric: rubric1._id,
                gradedBy: ta1._id,
                question: 1,
                marksAwarded: [{ criterionName: 'Q1', score: 16 }],
                totalScore: 16,
                isFinal: true
            });
            await Grade.create({
                answerScript: script1._id,
                rubric: rubric1._id,
                gradedBy: ta2._id,
                question: 2,
                marksAwarded: [{ criterionName: 'Q2', score: 24 }],
                totalScore: 24,
                isFinal: true
            });

            // S2 (index 1): Released. Q1: 12/20 (60%), Q2: 21/30 (70%). Total: 33/50.
            // Graded by TA2 for Q1, TA1 for Q2.
            const script2 = await AnswerScript.create({
                exam: exam1._id,
                student: students[1]._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create({
                answerScript: script2._id,
                rubric: rubric1._id,
                gradedBy: ta2._id,
                question: 1,
                marksAwarded: [{ criterionName: 'Q1', score: 12 }],
                totalScore: 12,
                isFinal: true
            });
            await Grade.create({
                answerScript: script2._id,
                rubric: rubric1._id,
                gradedBy: ta1._id,
                question: 2,
                marksAwarded: [{ criterionName: 'Q2', score: 21 }],
                totalScore: 21,
                isFinal: true
            });

            // S3 (index 2): Released. Q1: 20/20 (100%), Q2: 27/30 (90%). Total: 47/50.
            // Graded by TA1 for Q1, TA1 for Q2.
            const script3 = await AnswerScript.create({
                exam: exam1._id,
                student: students[2]._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true,
                needsManualId: false,
                hasIdentificationConflict: false
            });
            await Grade.create({
                answerScript: script3._id,
                rubric: rubric1._id,
                gradedBy: ta1._id,
                question: 1,
                marksAwarded: [{ criterionName: 'Q1', score: 20 }],
                totalScore: 20,
                isFinal: true
            });
            await Grade.create({
                answerScript: script3._id,
                rubric: rubric1._id,
                gradedBy: ta1._id,
                question: 2,
                marksAwarded: [{ criterionName: 'Q2', score: 27 }],
                totalScore: 27,
                isFinal: true
            });

            // S4 (index 3): Unreleased because identification is UNIDENTIFIED
            const script4 = await AnswerScript.create({
                exam: exam1._id,
                student: students[3]._id,
                identificationStatus: IdentificationStatus.UNIDENTIFIED,
                needsManualId: true,
                isActive: true
            });
            await Grade.create({
                answerScript: script4._id,
                rubric: rubric1._id,
                gradedBy: profA._id,
                totalScore: 25,
                isFinal: false
            });

            // S5 (index 4): Inactive student -> Must be excluded
            const script5 = await AnswerScript.create({
                exam: exam1._id,
                student: students[4]._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true
            });
            await Grade.create({
                answerScript: script5._id,
                rubric: rubric1._id,
                gradedBy: profA._id,
                totalScore: 10,
                isFinal: true
            });

            // Foreign submission in Course B (Exam 3)
            const rubric3 = await Rubric.create({
                exam: exam3._id,
                createdBy: profB._id,
                scoreStep: 1,
                questions: [{ questionNumber: 1, maxMarks: 100, criteria: [{ criterionName: 'Q1', points: 100 }] }],
                isActive: true
            });
            const script6 = await AnswerScript.create({
                exam: exam3._id,
                student: students[5]._id,
                identificationStatus: IdentificationStatus.IDENTIFIED,
                isActive: true
            });
            await Grade.create({
                answerScript: script6._id,
                rubric: rubric3._id,
                gradedBy: profB._id,
                question: 1,
                marksAwarded: [{ criterionName: 'Q1', score: 100 }],
                totalScore: 100,
                isFinal: true
            });

            // Mock authentication as Professor A
            vi.spyOn(apiAuth, 'requirePermission').mockResolvedValue({
                authorized: true,
                response: null,
                user: {
                    id: profA._id.toString(),
                    email: profA.email,
                    name: profA.name,
                    role: UserRole.PROFESSOR
                }
            });

            // Fetch Exam 1 analytics
            const response = await getExamAnalytics(
                new NextRequest(`http://localhost/api/analytics/exams/${exam1._id}`),
                { params: Promise.resolve({ id: exam1._id.toString() }) }
            );
            const body = await response.json();

            expect(response.status).toBe(200);
            expect(body.success).toBe(true);

            // 1. Validate Class Statistics:
            // Released scores: [40, 33, 47] on maxMarks 50
            // count = 3
            // sum = 120 -> mean = 40
            // sorted = [33, 40, 47] -> median = 40
            // squared deviations: (33-40)^2 + 0 + (47-40)^2 = 49 + 49 = 98
            // population variance = 98 / 3
            // population stdDev = Math.sqrt(98 / 3) ~ 5.715476066496677
            expect(body.data.classStatistics.count).toBe(3);
            expect(body.data.classStatistics.mean).toBe(40);
            expect(body.data.classStatistics.median).toBe(40);
            expect(body.data.classStatistics.standardDeviationMethod).toBe('population');
            expect(body.data.classStatistics.standardDeviation).toBeCloseTo(Math.sqrt(98 / 3), 10);

            // 2. Validate Question Statistics:
            // Q1 (maxMarks 20):
            // Scores: S1: 16 (80%), S2: 12 (60%), S3: 20 (100%)
            // mean% = 80%, stdDev = sqrt(800 / 3) ~ 16.32993, difficulty% = 20%
            const q1Stat = body.data.questionStatistics.find(
                (q: { questionNumber: number }) => q.questionNumber === 1
            );
            expect(q1Stat).toBeDefined();
            expect(q1Stat.gradedCount).toBe(3);
            expect(q1Stat.maxMarks).toBe(20);
            expect(q1Stat.meanScorePercentage).toBe(80);
            expect(q1Stat.standardDeviationPercentagePoints).toBeCloseTo(Math.sqrt(800 / 3), 10);
            expect(q1Stat.difficultyIndexPercentage).toBe(20);

            // Q2 (maxMarks 30):
            // Scores: S1: 24 (80%), S2: 21 (70%), S3: 27 (90%)
            // mean% = 80%, stdDev = sqrt(200 / 3) ~ 8.1649658, difficulty% = 20%
            const q2Stat = body.data.questionStatistics.find(
                (q: { questionNumber: number }) => q.questionNumber === 2
            );
            expect(q2Stat).toBeDefined();
            expect(q2Stat.gradedCount).toBe(3);
            expect(q2Stat.maxMarks).toBe(30);
            expect(q2Stat.meanScorePercentage).toBe(80);
            expect(q2Stat.standardDeviationPercentagePoints).toBeCloseTo(Math.sqrt(200 / 3), 10);
            expect(q2Stat.difficultyIndexPercentage).toBe(20);

            // 3. Validate Grader Consistency endpoint:
            const graderResponse = await getGraderConsistency(
                new NextRequest(`http://localhost/api/analytics/exams/${exam1._id}/graders`),
                { params: Promise.resolve({ id: exam1._id.toString() }) }
            );
            const graderBody = await graderResponse.json();

            expect(graderResponse.status).toBe(200);
            expect(graderBody.success).toBe(true);

            // TA1:
            // Q1 group: |80-80|=0, |100-80|=20
            // Q2 group: |70-80|=10, |90-80|=10
            // total comparisons = 4 (< 5 -> INSUFFICIENT)
            // MAD = (0 + 20 + 10 + 10) / 4 = 10
            const ta1Metric = graderBody.data.graders.find(
                (g: { graderId: string }) => g.graderId === ta1._id.toString()
            );
            expect(ta1Metric).toBeDefined();
            expect(ta1Metric.name).toBe('TA One');
            expect(ta1Metric.comparisonCount).toBe(4);
            expect(ta1Metric.meanAbsoluteDeviationPercentagePoints).toBe(10);
            expect(ta1Metric.sampleSizeStatus).toBe('INSUFFICIENT');

            // TA2:
            // Q1 group: |60-80|=20
            // Q2 group: |80-80|=0
            // total comparisons = 2 (< 5 -> INSUFFICIENT)
            // MAD = (20 + 0) / 2 = 10
            const ta2Metric = graderBody.data.graders.find(
                (g: { graderId: string }) => g.graderId === ta2._id.toString()
            );
            expect(ta2Metric).toBeDefined();
            expect(ta2Metric.name).toBe('TA Two');
            expect(ta2Metric.comparisonCount).toBe(2);
            expect(ta2Metric.meanAbsoluteDeviationPercentagePoints).toBe(10);
            expect(ta2Metric.sampleSizeStatus).toBe('INSUFFICIENT');

            // 4. Draft exam rejection test (Exam 2)
            const draftResponse = await getExamAnalytics(
                new NextRequest(`http://localhost/api/analytics/exams/${exam2._id}`),
                { params: Promise.resolve({ id: exam2._id.toString() }) }
            );
            expect(draftResponse.status).toBe(409);
        });
    });
});
