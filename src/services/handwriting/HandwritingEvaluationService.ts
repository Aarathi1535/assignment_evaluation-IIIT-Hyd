import {
    ComparisonMatchState,
    IHandwritingProfileData,
    ProfileStatus
} from '../../models/HandwritingConsistency';
import { HandwritingProfileBuilder, HandwritingSampleInput } from './HandwritingProfileBuilder';
import { HandwritingComparisonEngine } from './HandwritingComparisonEngine';
import { HandwritingSampleRepository, handwritingSampleRepository } from '../../repositories/HandwritingSampleRepository';
import { HandwritingProfileRepository, handwritingProfileRepository } from '../../repositories/HandwritingProfileRepository';
import { HandwritingConsentRepository, handwritingConsentRepository } from '../../repositories/HandwritingConsentRepository';
import { HandwritingAuthContext, isAuthorizedForStudent } from './HandwritingConsistencyWorkflowService';
import { HttpError } from '../../lib/errors';

export const HANDWRITING_EVALUATION_DISCLAIMER =
    'Empirical evaluation metric based on tested sample distribution. This metric measures geometric and statistical consistency heuristics and does NOT constitute mathematical, biometric, or legal proof of authorship.';

export interface EvaluationStudentData {
    studentId: string;
    profileSamples: HandwritingSampleInput[];
    evaluationSamples: HandwritingSampleInput[];
}

export interface PairwiseComparisonEvaluation {
    profileStudentId: string;
    sampleStudentId: string;
    sampleId: string;
    isSameStudent: boolean;
    matchState: ComparisonMatchState;
    distance: number;
    confidence: number;
    isFalsePositiveMatch: boolean;
    isTruePositiveMatch: boolean;
}

export interface HandwritingFalsePositiveMetrics {
    /** Total pairwise evaluations conducted across the test corpus */
    totalEvaluations: number;

    /** Number of different-student pairs evaluated */
    differentStudentComparisons: number;

    /** Number of different-student pairs incorrectly accepted as MATCH */
    differentStudentFalseMatches: number;

    /**
     * Empirical False Positive Rate = differentStudentFalseMatches / differentStudentComparisons.
     * Bounded in [0.0, 1.0]. Defaults to 0.0 when differentStudentComparisons is 0.
     */
    falsePositiveRate: number;

    /** Number of same-student pairs evaluated */
    sameStudentComparisons: number;

    /** Number of same-student pairs identified as MATCH */
    sameStudentMatches: number;

    /**
     * Empirical Same-Student Match Rate (True Positive Rate) = sameStudentMatches / sameStudentComparisons.
     */
    sameStudentMatchRate: number;

    /** Breakdown of comparison outcomes for different-student pairs */
    differentStudentBreakdown: {
        matches: number;
        reviewRequired: number;
        inconclusive: number;
        insufficientSample: number;
        unassessed: number;
    };

    /** Breakdown of comparison outcomes for same-student pairs */
    sameStudentBreakdown: {
        matches: number;
        reviewRequired: number;
        inconclusive: number;
        insufficientSample: number;
        unassessed: number;
    };

    /** Explicit disclaimer clarifying this is an empirical metric, not proof of authorship */
    disclaimer: string;

    /** Timestamp of evaluation */
    evaluatedAt: Date;
}

export class HandwritingEvaluationService {
    constructor(
        private readonly profileBuilder: HandwritingProfileBuilder = new HandwritingProfileBuilder(),
        private readonly comparisonEngine: HandwritingComparisonEngine = new HandwritingComparisonEngine(),
        private readonly sampleRepo: HandwritingSampleRepository = handwritingSampleRepository,
        private readonly profileRepo: HandwritingProfileRepository = handwritingProfileRepository,
        private readonly consentRepo: HandwritingConsentRepository = handwritingConsentRepository
    ) {}

    /**
     * Evaluates a labeled dataset of students with known baseline and evaluation samples.
     * Computes same-student consistency and cross-student false-positive rates.
     */
    public async evaluateDataset(
        students: EvaluationStudentData[]
    ): Promise<{
        metrics: HandwritingFalsePositiveMetrics;
        pairwiseResults: PairwiseComparisonEvaluation[];
    }> {
        // 1. Build profile for each student with sufficient samples
        const studentProfiles = new Map<string, IHandwritingProfileData>();

        for (const student of students) {
            if (student.profileSamples && student.profileSamples.length > 0) {
                const buildResult = await this.profileBuilder.buildProfile(
                    student.studentId,
                    student.profileSamples
                );
                studentProfiles.set(student.studentId, buildResult.profile);
            }
        }

        const pairwiseResults: PairwiseComparisonEvaluation[] = [];

        // 2. Perform pairwise comparisons across all students
        for (const targetStudent of students) {
            const profile = studentProfiles.get(targetStudent.studentId);
            if (!profile || profile.status !== ProfileStatus.ESTABLISHED) {
                continue; // Cannot evaluate against an unestablished profile
            }

            for (const sampleStudent of students) {
                const isSameStudent = targetStudent.studentId === sampleStudent.studentId;

                for (const sample of sampleStudent.evaluationSamples) {
                    const comparison = await this.comparisonEngine.compare(profile, sample);

                    const isMatch = comparison.status === ComparisonMatchState.MATCH;
                    const isFalsePositiveMatch = !isSameStudent && isMatch;
                    const isTruePositiveMatch = isSameStudent && isMatch;

                    pairwiseResults.push({
                        profileStudentId: targetStudent.studentId,
                        sampleStudentId: sampleStudent.studentId,
                        sampleId: sample.sampleId,
                        isSameStudent,
                        matchState: comparison.status,
                        distance: comparison.distance,
                        confidence: comparison.confidence,
                        isFalsePositiveMatch,
                        isTruePositiveMatch
                    });
                }
            }
        }

        // 3. Calculate summary metrics
        const metrics = this.computeMetrics(pairwiseResults);

        return {
            metrics,
            pairwiseResults
        };
    }

    /**
     * Aggregates pairwise comparison outcomes into empirical false-positive and match rate metrics.
     */
    public computeMetrics(
        pairwiseResults: PairwiseComparisonEvaluation[]
    ): HandwritingFalsePositiveMetrics {
        let differentStudentComparisons = 0;
        let differentStudentFalseMatches = 0;

        let sameStudentComparisons = 0;
        let sameStudentMatches = 0;

        const differentStudentBreakdown = {
            matches: 0,
            reviewRequired: 0,
            inconclusive: 0,
            insufficientSample: 0,
            unassessed: 0
        };

        const sameStudentBreakdown = {
            matches: 0,
            reviewRequired: 0,
            inconclusive: 0,
            insufficientSample: 0,
            unassessed: 0
        };

        for (const res of pairwiseResults) {
            if (res.isSameStudent) {
                sameStudentComparisons++;
                if (res.matchState === ComparisonMatchState.MATCH) {
                    sameStudentMatches++;
                    sameStudentBreakdown.matches++;
                } else if (res.matchState === ComparisonMatchState.REVIEW_REQUIRED) {
                    sameStudentBreakdown.reviewRequired++;
                } else if (res.matchState === ComparisonMatchState.INCONCLUSIVE) {
                    sameStudentBreakdown.inconclusive++;
                } else if (res.matchState === ComparisonMatchState.INSUFFICIENT_SAMPLE) {
                    sameStudentBreakdown.insufficientSample++;
                } else if (res.matchState === ComparisonMatchState.UNASSESSED) {
                    sameStudentBreakdown.unassessed++;
                }
            } else {
                differentStudentComparisons++;
                if (res.matchState === ComparisonMatchState.MATCH) {
                    differentStudentFalseMatches++;
                    differentStudentBreakdown.matches++;
                } else if (res.matchState === ComparisonMatchState.REVIEW_REQUIRED) {
                    differentStudentBreakdown.reviewRequired++;
                } else if (res.matchState === ComparisonMatchState.INCONCLUSIVE) {
                    differentStudentBreakdown.inconclusive++;
                } else if (res.matchState === ComparisonMatchState.INSUFFICIENT_SAMPLE) {
                    differentStudentBreakdown.insufficientSample++;
                } else if (res.matchState === ComparisonMatchState.UNASSESSED) {
                    differentStudentBreakdown.unassessed++;
                }
            }
        }

        const falsePositiveRate =
            differentStudentComparisons > 0
                ? Number((differentStudentFalseMatches / differentStudentComparisons).toFixed(4))
                : 0.0;

        const sameStudentMatchRate =
            sameStudentComparisons > 0
                ? Number((sameStudentMatches / sameStudentComparisons).toFixed(4))
                : 0.0;

        return {
            totalEvaluations: pairwiseResults.length,
            differentStudentComparisons,
            differentStudentFalseMatches,
            falsePositiveRate,
            sameStudentComparisons,
            sameStudentMatches,
            sameStudentMatchRate,
            differentStudentBreakdown,
            sameStudentBreakdown,
            disclaimer: HANDWRITING_EVALUATION_DISCLAIMER,
            evaluatedAt: new Date()
        };
    }

    /**
     * Evaluates registered students in the database whose consent is active.
     */
    public async evaluateRegisteredCorpus(
        studentIds: string[],
        authContext: HandwritingAuthContext
    ): Promise<HandwritingFalsePositiveMetrics> {
        // Enforce staff authorization to audit multiple students
        for (const sid of studentIds) {
            if (!isAuthorizedForStudent(authContext, sid)) {
                throw new HttpError(`Unauthorized to evaluate student: ${sid}`, 403);
            }
        }

        const studentDataList: EvaluationStudentData[] = [];

        for (const studentId of studentIds) {
            // Verify active consent
            const hasConsent = await this.consentRepo.hasActiveConsent(studentId);
            if (!hasConsent) {
                continue; // Skip students who have not consented or whose consent expired
            }

            const usableSamples = await this.sampleRepo.findByStudent(studentId, {
                usableOnly: true,
                sortOrder: 'asc'
            });

            if (usableSamples.length < 3) {
                continue; // Cannot establish baseline profile
            }

            // Split: first 3 samples for profile, remaining for evaluation (or all if few)
            const profileInputs: HandwritingSampleInput[] = usableSamples.slice(0, 3).map(s => ({
                sampleId: s._id.toString(),
                studentId,
                features: s.features,
                status: s.status,
                pageNumber: s.pageNumber
            }));

            const evalInputs: HandwritingSampleInput[] = (
                usableSamples.length > 3 ? usableSamples.slice(3) : usableSamples
            ).map(s => ({
                sampleId: s._id.toString(),
                studentId,
                features: s.features,
                status: s.status,
                pageNumber: s.pageNumber
            }));

            studentDataList.push({
                studentId,
                profileSamples: profileInputs,
                evaluationSamples: evalInputs
            });
        }

        const { metrics } = await this.evaluateDataset(studentDataList);
        return metrics;
    }
}

export const handwritingEvaluationService = new HandwritingEvaluationService();
export default handwritingEvaluationService;
