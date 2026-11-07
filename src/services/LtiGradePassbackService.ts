import mongoose from 'mongoose';
import { HttpError } from '../lib/errors';
import { ExamStatus, IExam } from '../models/Exam';
import ExamRepository from '../repositories/ExamRepository';
import {
    LmsStudentInput,
    mapLmsStudentIdsToGrades
} from '../lib/lmsMapping';

export type LtiActivityProgress = 'Initial' | 'Initialized' | 'InProgress' | 'Submitted' | 'Completed';
export type LtiGradingProgress = 'NotReady' | 'Failed' | 'Pending' | 'PendingManual' | 'FullyGraded';

export interface LtiScorePayload {
    userId: string;
    scoreGiven: number;
    scoreMaximum: number;
    comment?: string;
    timestamp: string;
    activityProgress: LtiActivityProgress;
    gradingProgress: LtiGradingProgress;
}

export interface LtiGradePassbackOptions {
    lineItemUrl?: string;
    students?: LmsStudentInput[];
    dryRun?: boolean;
    comment?: string;
}

export interface LtiScoreResult {
    studentId?: string;
    lmsStudentId: string;
    studentName?: string;
    email?: string;
    scoreGiven: number | null;
    scoreMaximum: number;
    status: 'SUCCESS' | 'SKIPPED' | 'FAILED';
    reason?: string;
    payload?: LtiScorePayload;
}

export interface LtiGradePassbackExecutionResult {
    examId: string;
    examTitle: string;
    courseCode: string;
    stubMode: true;
    status: 'STUB_COMPLETED' | 'DRY_RUN' | 'PARTIAL_SUCCESS' | 'FAILED';
    totalProcessed: number;
    successfulScores: number;
    skippedScores: number;
    failedScores: number;
    lineItemUrl?: string;
    scores: LtiScoreResult[];
    message: string;
}

export class LtiGradePassbackService {
    /**
     * Validates that a provided LineItem URL has a valid HTTPS protocol.
     */
    validateLineItemUrl(url?: string): boolean {
        if (!url) {
            return true;
        }
        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' || parsed.hostname === 'localhost';
        } catch {
            return false;
        }
    }

    /**
     * Executes the LTI 1.3 Assignment and Grade Services (AGS) grade passback pipeline in safe stub mode.
     * Enforces course-scoped authorization, grade finality, identifier mapping, and duplicate prevention.
     * No outbound network sockets are opened to external LMS servers in this release.
     */
    async executeGradePassback(
        examId: string,
        options: LtiGradePassbackOptions = {},
        actingUserId?: string,
        actingUserRole?: string
    ): Promise<LtiGradePassbackExecutionResult> {
        if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
            throw new HttpError('Invalid exam ID', 400);
        }

        if (options.lineItemUrl && !this.validateLineItemUrl(options.lineItemUrl)) {
            throw new HttpError('Invalid lineItemUrl: Must be a valid HTTPS URL', 400);
        }

        // 1. Authorize exam access and enforce ownership/course scoping
        const exam: IExam | null = await ExamRepository.getExamById(examId, actingUserId, actingUserRole);
        if (!exam) {
            throw new HttpError('Exam not found', 404);
        }

        if (!exam.isActive || exam.status !== ExamStatus.PUBLISHED) {
            throw new HttpError('LTI grade passback is available only for published exams', 409);
        }

        // 2. Map student identifiers to grades using AE-215 course-scoped service
        const mappingResult = await mapLmsStudentIdsToGrades(exam, options.students);

        // 3. Construct LTI 1.3 AGS Score payloads for each record
        const scores: LtiScoreResult[] = [];
        let successfulScores = 0;
        let skippedScores = 0;
        let failedScores = 0;

        const defaultComment = options.comment || `Final published grade for ${exam.title}`;

        for (const record of mappingResult.records) {
            if (record.status === 'MAPPED' && record.grade !== null) {
                const payload: LtiScorePayload = {
                    userId: record.lmsStudentId,
                    scoreGiven: record.grade,
                    scoreMaximum: record.maxGrade,
                    comment: defaultComment,
                    timestamp: new Date().toISOString(),
                    activityProgress: 'Completed',
                    gradingProgress: 'FullyGraded'
                };

                scores.push({
                    studentId: record.studentId,
                    lmsStudentId: record.lmsStudentId,
                    studentName: record.studentName,
                    email: record.email,
                    scoreGiven: record.grade,
                    scoreMaximum: record.maxGrade,
                    status: 'SUCCESS',
                    payload
                });
                successfulScores++;
            } else if (record.status === 'UNMAPPED') {
                scores.push({
                    studentId: record.studentId,
                    lmsStudentId: record.lmsStudentId,
                    studentName: record.studentName,
                    email: record.email,
                    scoreGiven: null,
                    scoreMaximum: record.maxGrade,
                    status: 'SKIPPED',
                    reason: record.validationMessage || 'Student grade not finalized or unreleased'
                });
                skippedScores++;
            } else {
                scores.push({
                    studentId: record.studentId,
                    lmsStudentId: record.lmsStudentId,
                    studentName: record.studentName,
                    email: record.email,
                    scoreGiven: null,
                    scoreMaximum: record.maxGrade,
                    status: 'FAILED',
                    reason: record.validationMessage || `Failed with status ${record.status}`
                });
                failedScores++;
            }
        }

        const totalProcessed = scores.length;
        let overallStatus: LtiGradePassbackExecutionResult['status'] = 'STUB_COMPLETED';
        if (options.dryRun) {
            overallStatus = 'DRY_RUN';
        } else if (successfulScores === 0 && totalProcessed > 0) {
            overallStatus = 'FAILED';
        } else if (failedScores > 0 || skippedScores > 0) {
            overallStatus = 'PARTIAL_SUCCESS';
        }

        return {
            examId: exam._id.toString(),
            examTitle: exam.title,
            courseCode: mappingResult.courseCode,
            stubMode: true,
            status: overallStatus,
            totalProcessed,
            successfulScores,
            skippedScores,
            failedScores,
            lineItemUrl: options.lineItemUrl,
            scores,
            message: 'LTI 1.3 grade passback simulated in safe stub mode. No external LMS endpoints were contacted.'
        };
    }
}

export const ltiGradePassbackService = new LtiGradePassbackService();
export default ltiGradePassbackService;

