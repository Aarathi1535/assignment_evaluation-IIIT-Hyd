import mongoose from 'mongoose';
import Grade, { IGrade, ICriterionGrade } from '../models/Grade';
import Rubric, { IRubric, IQuestion } from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import ExamRepository from '../repositories/ExamRepository';
import AllocationService from './AllocationService';
import { AllocationStatus } from '../models/Allocation';
import { UserRole } from '../constants/permissions';
import { HttpError } from '../lib/errors';
import { writeAuditLog } from '../lib/audit';

export interface ValidateAndComputeOptions {
    rubric: IRubric | { questions: IQuestion[] };
    questionNumber: number;
    marksAwarded: ICriterionGrade[];
    clientTotalScore?: number;
}

export interface ComputedQuestionTotalResult {
    questionNumber: number;
    maxMarks: number;
    marksAwarded: ICriterionGrade[];
    totalScore: number;
}

export interface SaveGradeOptions {
    scriptId: string | mongoose.Types.ObjectId;
    question: number;
    marksAwarded: ICriterionGrade[];
    feedback?: string;
    userId: string;
    userRole: string;
    ipAddress?: string;
    clientTotalScore?: number;
}

export class GradingService {
    /**
     * Helper to safely compute total score from criterion marksAwarded with floating-point precision rounding.
     */
    computeAuthoritativeTotal(marksAwarded: ICriterionGrade[]): number {
        if (!marksAwarded || !Array.isArray(marksAwarded)) {
            return 0;
        }
        const sum = marksAwarded.reduce((acc, curr) => {
            const score = typeof curr.score === 'number' ? curr.score : Number(curr.score);
            return acc + (Number.isNaN(score) ? 0 : score);
        }, 0);
        return Math.round(sum * 100) / 100;
    }

    /**
     * Validates submitted criterion scores against the rubric for a specific question,
     * recomputes the authoritative totalScore, checks against question.maxMarks,
     * and completely ignores any client-supplied totalScore.
     */
    validateAndComputeQuestionTotal(options: ValidateAndComputeOptions): ComputedQuestionTotalResult {
        const { rubric, questionNumber, marksAwarded } = options;

        if (!rubric || !rubric.questions || !Array.isArray(rubric.questions)) {
            throw new HttpError('Invalid rubric configuration.', 400);
        }

        const question = rubric.questions.find((q) => q.questionNumber === questionNumber);
        if (!question) {
            throw new HttpError(`Question ${questionNumber} not found in rubric.`, 400);
        }

        if (!Array.isArray(marksAwarded)) {
            throw new HttpError('Marks awarded must be an array of criterion scores.', 400);
        }

        // Validate each criterion score against rubric criterion definition
        for (const item of marksAwarded) {
            if (!item.criterionName || typeof item.criterionName !== 'string') {
                throw new HttpError('Each score entry must specify a valid criterionName.', 400);
            }

            const rubricCriterion = question.criteria?.find(
                (c) => c.criterionName === item.criterionName
            );

            if (!rubricCriterion) {
                throw new HttpError(
                    `Criterion "${item.criterionName}" does not exist in Question ${questionNumber} rubric.`,
                    400
                );
            }

            const score = item.score;
            if (typeof score !== 'number' || Number.isNaN(score) || !Number.isFinite(score)) {
                throw new HttpError(
                    `Invalid score for criterion "${item.criterionName}". Score must be a valid finite number.`,
                    400
                );
            }

            if (score < 0) {
                throw new HttpError(
                    `Score for criterion "${item.criterionName}" cannot be negative (received ${score}).`,
                    400
                );
            }

            if (score > rubricCriterion.points) {
                throw new HttpError(
                    `Score ${score} for criterion "${item.criterionName}" exceeds maximum allowed points of ${rubricCriterion.points}.`,
                    400
                );
            }
        }

        // Server-authoritative computation: recompute totalScore directly from validated criterion scores
        const computedTotal = this.computeAuthoritativeTotal(marksAwarded);

        // Ensure computed question total does not exceed rubric question.maxMarks
        if (computedTotal > question.maxMarks) {
            throw new HttpError(
                `Computed question total (${computedTotal}) exceeds maximum marks of ${question.maxMarks} for Question ${questionNumber}.`,
                400
            );
        }

        return {
            questionNumber,
            maxMarks: question.maxMarks,
            marksAwarded,
            totalScore: computedTotal,
        };
    }

    /**
     * Persists or updates a question-level Grade document (AE-145).
     * Enforces:
     * - Access control (exam access for Professor/Admin; exact question allocation for TA).
     * - Active rubric presence (HTTP 409 if no active rubric configured).
     * - Server-authoritative validation and totalScore calculation (ignores client totalScore).
     * - Completed allocation & final Grade protection (HTTP 409).
     * - Automatic allocation claim on first successful grade save (PENDING -> IN_PROGRESS).
     * - Audit logging for every successful grade write.
     */
    async saveGrade(options: SaveGradeOptions): Promise<IGrade> {
        const {
            scriptId,
            question,
            marksAwarded,
            feedback,
            userId,
            userRole,
            ipAddress,
        } = options;

        if (!scriptId || !mongoose.Types.ObjectId.isValid(scriptId)) {
            throw new HttpError('Invalid AnswerScript ID format.', 400);
        }

        if (question === undefined || question === null || typeof question !== 'number' || Number.isNaN(question)) {
            throw new HttpError('Valid question number is required.', 400);
        }

        // 1. Fetch active AnswerScript
        const script = await AnswerScript.findOne({ _id: scriptId, isActive: true });
        if (!script) {
            throw new HttpError('Answer script not found.', 404);
        }

        // 2. Authorization and Allocation verification
        const normalizedRole = userRole?.toUpperCase();
        const isProfessorOrAdmin =
            normalizedRole === UserRole.PROFESSOR || normalizedRole === UserRole.ADMIN;

        let allocationDoc = null;

        if (isProfessorOrAdmin) {
            const exam = await ExamRepository.getExamById(
                script.exam.toString(),
                userId,
                userRole
            );
            if (!exam) {
                throw new HttpError('Forbidden: Access denied to the exam for this answer script.', 403);
            }
        } else {
            // TA role: must be allocated to this exact question
            allocationDoc = await AllocationService.verifyTaAllocation(
                script._id,
                userId,
                question
            );

            if (!allocationDoc) {
                throw new HttpError(
                    `Forbidden: You are not allocated to grade Question ${question} for this answer script.`,
                    403
                );
            }

            // Reject if allocation is already marked as COMPLETED
            if (allocationDoc.status === AllocationStatus.COMPLETED) {
                throw new HttpError(
                    'Cannot grade script: Allocation has already been marked as COMPLETED.',
                    409
                );
            }
        }

        // 3. Load active Rubric for the exam
        const rubric = await Rubric.findOne({ exam: script.exam, isActive: true });
        if (!rubric) {
            throw new HttpError(
                'No active rubric configured for this exam. Grading cannot proceed without a rubric.',
                409
            );
        }

        // 4. Server-authoritative validation & totalScore calculation
        const computed = this.validateAndComputeQuestionTotal({
            rubric,
            questionNumber: question,
            marksAwarded,
        });

        // 5. Check existing Grade and finalized protection
        let gradeDoc = await Grade.findOne({
            answerScript: script._id,
            question,
        });

        const isExisting = Boolean(gradeDoc);

        if (gradeDoc && gradeDoc.isFinal) {
            throw new HttpError(
                'Cannot edit grade: This grade has been finalized and cannot be modified.',
                409
            );
        }

        // Validate and sanitize feedback (AE-148)
        let processedFeedback: string | undefined = undefined;
        if (feedback !== undefined && feedback !== null) {
            if (typeof feedback !== 'string') {
                throw new HttpError('Feedback must be a valid text string.', 400);
            }
            const trimmed = feedback.trim();
            if (trimmed.length > 2000) {
                throw new HttpError('Feedback exceeds maximum allowed length of 2000 characters.', 400);
            }
            processedFeedback = trimmed;
        }

        // 6. Persist or Update Grade document
        let savedGrade: IGrade;

        if (gradeDoc) {
            const updateFields: Record<string, unknown> = {
                rubric: rubric._id,
                gradedBy: new mongoose.Types.ObjectId(userId),
                marksAwarded,
                totalScore: computed.totalScore,
            };

            if (processedFeedback !== undefined) {
                updateFields.feedback = processedFeedback;
            }

            const updateResult = await Grade.updateOne(
                { _id: gradeDoc._id, isFinal: false },
                { $set: updateFields }
            );

            if (updateResult.matchedCount === 0) {
                throw new HttpError(
                    'Cannot modify grade: Grade has already been finalized.',
                    409
                );
            }

            const updated = await Grade.findById(gradeDoc._id);
            if (!updated) {
                throw new HttpError('Grade not found after update.', 404);
            }

            savedGrade = updated;
        } else {
            gradeDoc = new Grade({
                answerScript: script._id,
                rubric: rubric._id,
                gradedBy: new mongoose.Types.ObjectId(userId),
                question,
                marksAwarded,
                totalScore: computed.totalScore,
                feedback: processedFeedback !== undefined ? processedFeedback : '',
                isFinal: false,
            });

            savedGrade = await gradeDoc.save();
        }
        // 7. Claim allocation if this is the first successful save and status is PENDING
        if (allocationDoc && allocationDoc.status === AllocationStatus.PENDING) {
            try {
                await AllocationService.claimAllocation(allocationDoc._id.toString(), userId);
            } catch {
                // If already claimed concurrently, ignore claim conflict
            }
        }

        // 8. Write audit log
        await writeAuditLog({
            user: userId,
            action: isExisting ? 'GRADE_UPDATED' : 'GRADE_SAVED',
            outcome: 'SUCCESS',
            entityId: savedGrade._id as mongoose.Types.ObjectId,
            entityType: 'Grade',
            details: {
                examId: script.exam.toString(),
                answerScriptId: script._id.toString(),
                question,
                totalScore: computed.totalScore,
                marksAwardedCount: marksAwarded.length,
                rubricId: rubric._id.toString(),
            },
            ipAddress,
        });

        return savedGrade;
    }

    /**
     * Retrieves all Grade documents for a given AnswerScript (AE-148).
     * Enforces access control (Exam access for Professor/Admin, allocation check for TA).
     */
    async getGradesForScript(
        scriptId: string | mongoose.Types.ObjectId,
        userId: string,
        userRole: string
    ): Promise<IGrade[]> {
        if (!scriptId || !mongoose.Types.ObjectId.isValid(scriptId)) {
            throw new HttpError('Invalid AnswerScript ID format.', 400);
        }

        const script = await AnswerScript.findOne({ _id: scriptId, isActive: true });
        if (!script) {
            throw new HttpError('Answer script not found.', 404);
        }

        const normalizedRole = userRole?.toUpperCase();
        const isProfessorOrAdmin =
            normalizedRole === UserRole.PROFESSOR || normalizedRole === UserRole.ADMIN;

        if (isProfessorOrAdmin) {
            const exam = await ExamRepository.getExamById(
                script.exam.toString(),
                userId,
                userRole
            );
            if (!exam) {
                throw new HttpError('Forbidden: Access denied to the exam for this answer script.', 403);
            }
        } else {
            const allocation = await AllocationService.verifyTaAllocation(
                script._id,
                userId
            );
            if (!allocation) {
                throw new HttpError(
                    'Forbidden: You are not allocated to grade this answer script.',
                    403
                );
            }
        }

        const grades = await Grade.find({ answerScript: script._id }).sort({ question: 1 });
        return grades;
    }
}

export const gradingService = new GradingService();
export default gradingService;
