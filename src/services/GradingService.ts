import mongoose from 'mongoose';
import Grade, { IGrade, ICriterionGrade } from '../models/Grade';
import Rubric, { IRubric, IQuestion } from '../models/Rubric';
import AnswerScript from '../models/AnswerScript';
import CommentTag, { TagScope } from '../models/CommentTag';
import ExamRepository from '../repositories/ExamRepository';
import AllocationService from './AllocationService';
import Allocation, { AllocationStatus } from '../models/Allocation';
import { UserRole } from '../constants/permissions';
import { HttpError } from '../lib/errors';
import { writeAuditLog } from '../lib/audit';

export const DEFAULT_SCORE_STEP = 0.5;

/**
 * Precision-safe helper to verify if a score falls on a configured step size.
 * Handles IEEE 754 floating-point inaccuracies (e.g., 0.3 with step 0.1, 0.75 with step 0.25).
 */
export function isValidScoreStep(score: number, step: number = DEFAULT_SCORE_STEP): boolean {
    if (typeof score !== 'number' || !Number.isFinite(score) || step <= 0) {
        return false;
    }
    const quotient = score / step;
    const roundedQuotient = Math.round(quotient);
    return Math.abs(quotient - roundedQuotient) < 1e-9;
}

export interface ValidateAndComputeOptions {
    rubric: IRubric | { questions: IQuestion[] };
    questionNumber: number;
    marksAwarded: ICriterionGrade[];
    clientTotalScore?: number;
    scoreStep?: number;
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
    tagIds?: Array<string | mongoose.Types.ObjectId>;
    userId: string;
    userRole: string;
    ipAddress?: string;
    clientTotalScore?: number;
    isFinal?: boolean;
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
            return acc + (Number.isNaN(score) || !Number.isFinite(score) ? 0 : score);
        }, 0);
        return Math.round(sum * 100) / 100;
    }

    /**
     * Validates submitted criterion scores against the rubric for a specific question,
     * enforces score bounds and step granularity (AE-158),
     * recomputes the authoritative totalScore, checks against question.maxMarks,
     * and completely ignores any client-supplied totalScore.
     */
    validateAndComputeQuestionTotal(options: ValidateAndComputeOptions): ComputedQuestionTotalResult {
        const { rubric, questionNumber, marksAwarded, scoreStep } = options;
        const step = (typeof scoreStep === 'number' && scoreStep > 0 && Number.isFinite(scoreStep))
            ? scoreStep
            : DEFAULT_SCORE_STEP;

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

            const isExactMax = Math.abs(score - rubricCriterion.points) < 1e-9;
            if (score > rubricCriterion.points && !isExactMax) {
                throw new HttpError(
                    `Score ${score} for criterion "${item.criterionName}" exceeds maximum allowed points of ${rubricCriterion.points}.`,
                    400
                );
            }

            if (!isExactMax && !isValidScoreStep(score, step)) {
                throw new HttpError(
                    `Score ${score} for criterion "${item.criterionName}" must be a multiple of the score step (${step}).`,
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
            tagIds,
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

        // 4.5. Validate and sanitize feedback & tagIds (AE-148, AE-149)
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

        let processedTagIds: mongoose.Types.ObjectId[] | undefined = undefined;
        if (tagIds !== undefined) {
            if (!Array.isArray(tagIds)) {
                throw new HttpError('tagIds must be an array of tag IDs.', 400);
            }

            const uniqueTagIdStrings: string[] = [];
            for (const id of tagIds) {
                if (!id || !mongoose.Types.ObjectId.isValid(id.toString())) {
                    throw new HttpError('Invalid comment tag ID format.', 400);
                }
                const str = id.toString();
                if (!uniqueTagIdStrings.includes(str)) {
                    uniqueTagIdStrings.push(str);
                }
            }

            if (uniqueTagIdStrings.length > 0) {
                const tagObjIds = uniqueTagIdStrings.map(
                    (idStr) => new mongoose.Types.ObjectId(idStr)
                );

                const foundTags = await CommentTag.find({
                    _id: { $in: tagObjIds },
                });

                if (foundTags.length !== uniqueTagIdStrings.length) {
                    throw new HttpError('One or more comment tag IDs do not exist.', 400);
                }

                // Validate tag availability / authorization:
                for (const tag of foundTags) {
                    if (tag.scope === TagScope.GLOBAL) {
                        continue;
                    } else if (tag.scope === TagScope.EXAM) {
                        if (!tag.exam || tag.exam.toString() !== script.exam.toString()) {
                            throw new HttpError(
                                'Forbidden: Comment tag belongs to a different exam and cannot be attached.',
                                403
                            );
                        }
                    } else {
                        throw new HttpError('Invalid comment tag scope.', 400);
                    }
                }

                processedTagIds = tagObjIds;
            } else {
                processedTagIds = [];
            }
        }

        // 5. Final vs Draft Submission Flow
        const shouldFinalize = Boolean(options.isFinal);

        if (shouldFinalize) {
            return await AllocationService.runInTransaction(async (session) => {
                let gradeDoc = await Grade.findOne({
                    answerScript: script._id,
                    question,
                }).session(session || null);

                const isExisting = Boolean(gradeDoc);

                if (gradeDoc && gradeDoc.isFinal) {
                    throw new HttpError(
                        'Cannot edit grade: This grade has been finalized and cannot be modified.',
                        409
                    );
                }

                if (allocationDoc) {
                    const freshAlloc = await Allocation.findById(allocationDoc._id).session(session || null);
                    if (!freshAlloc) {
                        throw new HttpError('Allocation not found.', 404);
                    }
                    if (freshAlloc.status === AllocationStatus.COMPLETED) {
                        throw new HttpError(
                            'Cannot grade script: Allocation has already been marked as COMPLETED.',
                            409
                        );
                    }
                }

                if (gradeDoc) {
                    gradeDoc.rubric = rubric._id as mongoose.Types.ObjectId;
                    gradeDoc.gradedBy = new mongoose.Types.ObjectId(userId);
                    gradeDoc.marksAwarded = marksAwarded;
                    gradeDoc.totalScore = computed.totalScore;
                    if (processedFeedback !== undefined) {
                        gradeDoc.feedback = processedFeedback;
                    }
                    if (processedTagIds !== undefined) {
                        gradeDoc.tagIds = processedTagIds;
                    }
                    gradeDoc.isFinal = true;
                } else {
                    gradeDoc = new Grade({
                        answerScript: script._id,
                        rubric: rubric._id,
                        gradedBy: new mongoose.Types.ObjectId(userId),
                        question,
                        marksAwarded,
                        totalScore: computed.totalScore,
                        feedback: processedFeedback !== undefined ? processedFeedback : '',
                        tagIds: processedTagIds !== undefined ? processedTagIds : [],
                        isFinal: true,
                    });
                }

                let savedGrade: IGrade;
                try {
                    savedGrade = await gradeDoc.save({ session });

                    if (allocationDoc) {
                        const currentAlloc = await Allocation.findById(allocationDoc._id).session(session || null);
                        if (currentAlloc && currentAlloc.status === AllocationStatus.PENDING) {
                            try {
                                await AllocationService.claimAllocation(allocationDoc._id.toString(), userId, { session });
                            } catch {
                                // Concurrent claim handled
                            }
                        }

                        const isReady = await AllocationService.isCompletionReady(
                            allocationDoc,
                            { session: session || undefined, rubric }
                        );

                        if (isReady) {
                            await AllocationService.markCompleted(
                                allocationDoc._id.toString(),
                                { id: userId, role: userRole },
                                { session }
                            );
                        }
                    }
                } catch (err) {
                    // If running in a non-transactional topology (session is undefined), manually rollback to maintain invariant
                    if (!session) {
                        if (!isExisting && gradeDoc._id) {
                            try {
                                await Grade.deleteOne({ _id: gradeDoc._id });
                            } catch {
                                // Ignore cleanup errors
                            }
                        } else if (isExisting && gradeDoc._id) {
                            try {
                                await Grade.updateOne({ _id: gradeDoc._id }, { $set: { isFinal: false } });
                            } catch {
                                // Ignore cleanup errors
                            }
                        }
                    }
                    throw err;
                }

                await writeAuditLog({
                    user: userId,
                    action: 'GRADE_FINALIZED',
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
                        isFinal: true,
                    },
                    ipAddress,
                });

                return savedGrade;
            });
        }

        // 6. Normal Non-Final Save (AE-145 Behavior)
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

            if (processedTagIds !== undefined) {
                updateFields.tagIds = processedTagIds;
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
                tagIds: processedTagIds !== undefined ? processedTagIds : [],
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
                isFinal: false,
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

        let gradesQuery: Record<string, unknown> = { answerScript: script._id };

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
            const allocations = await Allocation.find({
                answerScript: script._id,
                ta: new mongoose.Types.ObjectId(userId),
            });

            if (!allocations || allocations.length === 0) {
                throw new HttpError(
                    'Forbidden: You are not allocated to grade this answer script.',
                    403
                );
            }

            const hasWholeScriptAllocation = allocations.some(
                (a) => a.question === null || a.question === undefined
            );

            if (!hasWholeScriptAllocation) {
                const allocatedQuestions = allocations
                    .map((a) => a.question)
                    .filter((q): q is number => typeof q === 'number');

                gradesQuery = {
                    answerScript: script._id,
                    question: { $in: allocatedQuestions },
                };
            }
        }

        const grades = await Grade.find(gradesQuery).sort({ question: 1 });
        return grades;
    }
}

export const gradingService = new GradingService();
export default gradingService;
