import mongoose from 'mongoose';
import { HttpError } from '../lib/errors';
import { writeAuditLog } from '../lib/audit';
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
    status: 'NOT_SENT' | 'SUCCESS' | 'SKIPPED' | 'FAILED';
    reason?: string;
    payload?: LtiScorePayload;
}

export interface LtiGradePassbackExecutionResult {
    examId: string;
    examTitle: string;
    courseCode: string;
    stubMode: true;
    status: 'STUB_COMPLETED' | 'DRY_RUN' | 'PARTIAL_SUCCESS' | 'FAILED' | 'NOT_SENT';
    totalProcessed: number;
    successfulScores: number;
    notSentScores?: number;
    skippedScores: number;
    failedScores: number;
    lineItemUrl?: string;
    scores: LtiScoreResult[];
    message: string;
}

export class LtiGradePassbackService {
    /**
     * Validates that a provided LineItem URL has a valid HTTPS protocol and rejects localhost.
     */
    validateLineItemUrl(url?: string): boolean {
        if (!url) {
            return true;
        }
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:') {
                return false;
            }
            if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
                return false;
            }
            return true;
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
            throw new HttpError('Invalid lineItemUrl: Must be a valid HTTPS URL (localhost is rejected)', 400);
        }

        if (options.students !== undefined) {
            if (!Array.isArray(options.students)) {
                throw new HttpError('options.students must be an array', 400);
            }
            if (options.students.length > 2000) {
                throw new HttpError('options.students exceeds maximum limit of 2000 entries', 400);
            }
            if (options.students.some(s => !s || typeof s !== 'object')) {
                throw new HttpError('options.students cannot contain null or non-object entries', 400);
            }
        }

        if (options.comment !== undefined) {
            if (typeof options.comment !== 'string' || options.comment.length > 1000) {
                throw new HttpError('Comment must be a string up to 1000 characters', 400);
            }
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
        let readyCount = 0;
        let skippedScores = 0;
        let failedScores = 0;

        const isModeB = !options.students || options.students.length === 0;
        const defaultComment = options.comment || `Final published grade for ${exam.title}`;

        for (const record of mappingResult.records) {
            if (isModeB) {
                if (!record.ltiSub) {
                    // Mode B lacks external LMS sub identifiers; mark as not ready
                    scores.push({
                        studentId: record.studentId,
                        lmsStudentId: record.lmsStudentId,
                        studentName: record.studentName,
                        email: record.email,
                        scoreGiven: record.grade,
                        scoreMaximum: record.maxGrade,
                        status: 'SKIPPED',
                        reason: 'LTI platform sub claim is not resolved. Mode B grade passback requires prior LTI 1.3 launch or NRPS roster synchronization.'
                    });
                    skippedScores++;
                } else if (record.grade !== null) {
                    const payload: LtiScorePayload = {
                        userId: record.ltiSub,
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
                        status: 'NOT_SENT',
                        reason: 'Safe stub mode: AGS 2.0 Score payload validated but not dispatched to external LMS',
                        payload
                    });
                    readyCount++;
                } else {
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
                }
            } else if (record.status === 'MAPPED' && record.grade !== null) {
                if (!record.ltiSub) {
                    // Mode A: AGS userId must be the platform's LTI sub. If input identifier did not resolve to a stored sub, skip record
                    scores.push({
                        studentId: record.studentId,
                        lmsStudentId: record.lmsStudentId,
                        studentName: record.studentName,
                        email: record.email,
                        scoreGiven: record.grade,
                        scoreMaximum: record.maxGrade,
                        status: 'SKIPPED',
                        reason: 'LTI platform sub claim is not resolved. AGS Mode A score submission requires a mapped LTI platform sub identifier.'
                    });
                    skippedScores++;
                } else {
                    const payload: LtiScorePayload = {
                        userId: record.ltiSub,
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
                        status: 'NOT_SENT',
                        reason: 'Safe stub mode: AGS 2.0 Score payload validated but not dispatched to external LMS',
                        payload
                    });
                    readyCount++;
                }
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
        let overallStatus: LtiGradePassbackExecutionResult['status'] = 'NOT_SENT';
        if (options.dryRun) {
            overallStatus = 'DRY_RUN';
        } else if (readyCount === 0 && totalProcessed > 0 && failedScores === totalProcessed) {
            overallStatus = 'FAILED';
        } else if (failedScores > 0) {
            overallStatus = 'PARTIAL_SUCCESS';
        } else {
            overallStatus = 'NOT_SENT';
        }

        if (!options.dryRun && actingUserId) {
            try {
                await writeAuditLog({
                    user: actingUserId,
                    action: 'LTI_GRADE_PASSBACK_SIMULATED',
                    outcome: 'SUCCESS',
                    entityId: exam._id,
                    entityType: 'Exam',
                    details: {
                        examId: exam._id.toString(),
                        courseCode: mappingResult.courseCode,
                        lineItemUrl: options.lineItemUrl,
                        mode: isModeB ? 'MODE_B' : 'MODE_A',
                        status: overallStatus,
                        totalProcessed,
                        notSentScores: readyCount,
                        skippedScores,
                        failedScores,
                        stubMode: true
                    }
                });
            } catch (auditErr) {
                console.error('Failed to record audit log for LTI grade passback simulation:', auditErr);
            }
        }

        const message = (isModeB && readyCount === 0)
            ? `LTI 1.3 AGS 2.0 Mode B passback: All ${totalProcessed} student records were skipped because LTI platform sub claims are unresolved. Passback was not sent. An audit entry was recorded.`
            : (readyCount === 0 && skippedScores === totalProcessed)
                ? `LTI 1.3 AGS 2.0 passback: All ${totalProcessed} student records were skipped because LTI platform sub claims are unresolved. Passback was not sent. An audit entry was recorded.`
                : 'LTI 1.3 grade passback simulated in safe stub mode. Validated payloads generated; no external LMS endpoints were contacted.';

        return {
            examId: exam._id.toString(),
            examTitle: exam.title,
            courseCode: mappingResult.courseCode,
            stubMode: true,
            status: overallStatus,
            totalProcessed,
            successfulScores: 0,
            notSentScores: readyCount,
            skippedScores,
            failedScores,
            lineItemUrl: options.lineItemUrl,
            scores,
            message
        };
    }
}

export const ltiGradePassbackService = new LtiGradePassbackService();
export default ltiGradePassbackService;

