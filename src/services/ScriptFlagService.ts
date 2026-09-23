import mongoose from 'mongoose';
import ScriptFlag, { IScriptFlag, FlagReason, FlagStatus, FlagResolutionAction, IScriptFlagResolution, ICriterionOverride } from '../models/ScriptFlag';
import AnswerScript from '../models/AnswerScript';
import Exam from '../models/Exam';
import Grade from '../models/Grade';
import Rubric from '../models/Rubric';
import User from '../models/User';
import AllocationService from './AllocationService';
import NotificationService from './NotificationService';
import { NotificationType } from '../models/Notification';
import { renderFlagTemplate } from '../templates/notificationTemplates';
import { writeAuditLog } from '../lib/audit';
import { HttpError, isDuplicateKeyError } from '../lib/errors';
import { hasPermission, Permission, UserRole } from '../constants/permissions';
import { isValidScoreStep, DEFAULT_SCORE_STEP } from './GradingService';

export interface CreateScriptFlagInput {
    scriptId: string | mongoose.Types.ObjectId;
    question?: number | null;
    reason: FlagReason | string;
    note?: string;
    userId: string | mongoose.Types.ObjectId;
    userRole: UserRole | string;
    ipAddress?: string;
}

export interface ResolveScriptFlagInput {
    flagId: string | mongoose.Types.ObjectId;
    action: FlagResolutionAction | string;
    notes: string;
    newScore?: number | null;
    criterionOverrides?: ICriterionOverride[];
    userId: string | mongoose.Types.ObjectId;
    userRole: UserRole | string;
    ipAddress?: string;
}

export interface GetFlagAnalyticsOptions {
    userId: string | mongoose.Types.ObjectId;
    userRole: UserRole | string;
    examId?: string | mongoose.Types.ObjectId;
}

export interface FlagAnalyticsResult {
    total: number;
    byStatus: {
        OPEN: number;
        RESOLVED: number;
        ESCALATED: number;
    };
    byReason: {
        CHEATING_SUSPECTED: number;
        ILLEGIBLE: number;
        OTHER: number;
    };
    byReasonAndStatus: {
        CHEATING_SUSPECTED: {
            OPEN: number;
            RESOLVED: number;
            ESCALATED: number;
        };
        ILLEGIBLE: {
            OPEN: number;
            RESOLVED: number;
            ESCALATED: number;
        };
        OTHER: {
            OPEN: number;
            RESOLVED: number;
            ESCALATED: number;
        };
    };
}

export interface GetScriptFlagsOptions {
    scriptId: string | mongoose.Types.ObjectId;
    userId: string | mongoose.Types.ObjectId;
    userRole: UserRole | string;
}

export interface GetProfessorFlagQueueOptions {
    userId: string | mongoose.Types.ObjectId;
    userRole: UserRole | string;
    status?: FlagStatus | string;
    examId?: string | mongoose.Types.ObjectId;
    page?: number;
    limit?: number;
}

export interface EffectiveGradeResult {
    totalScore: number;
    isOverridden: boolean;
    originalScore?: number;
    override?: {
        action?: FlagResolutionAction | string;
        by?: {
            _id?: string;
            name?: string;
            email?: string;
        } | mongoose.Types.ObjectId | string | null;
        at?: Date | string | null;
        notes?: string;
        previousScore?: number;
        newScore?: number;
        criterionOverrides?: ICriterionOverride[];
    } | null;
    marksAwarded?: Array<{ criterionName: string; score: number; feedback?: string }>;
}

export interface PopulatedFlagQueueItem {
    _id: string;
    answerScript: {
        _id: string;
        scriptReference?: string;
        anonymousId?: string;
        candidateStudentId?: string | null;
        pageCount?: number;
        student?: {
            _id: string;
            name?: string;
            email?: string;
            rollNumber?: string;
        } | null;
    };
    exam: {
        _id: string;
        title: string;
        totalMarks?: number;
    };
    question?: number | null;
    raisedBy: {
        _id: string;
        name: string;
        email: string;
    };
    reason: FlagReason;
    note?: string;
    status: FlagStatus;
    resolution?: IScriptFlagResolution | null;
    createdAt: Date;
    updatedAt: Date;
    currentMarks?: {
        totalScore?: number;
        marksAwarded?: Array<{ criterionName: string; score: number; feedback?: string }>;
        feedback?: string;
        isFinal?: boolean;
        gradedBy?: string;
    } | null;
    effectiveGrade?: EffectiveGradeResult | null;
}

export interface FlagQueueResult {
    flags: PopulatedFlagQueueItem[];
    counts: {
        open: number;
        resolved: number;
        escalated: number;
        total: number;
    };
    pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
    };
}

export class ScriptFlagService {
    /**
     * Creates a new ScriptFlag for an answer script or question (AE-162).
     * Enforces:
     * - Input validation (valid ObjectIds, valid reason enum, note length <= 2000)
     * - Permission.FLAG_FOR_REVIEW
     * - AllocationService.verifyTaAllocation(script, user, question)
     * - One OPEN flag per (answerScript, question, raisedBy) partial uniqueness (409 Conflict)
     * - AuditLog recording via writeAuditLog
     * - Professor notification via NotificationService and AE-117 notification templates
     */
    static async createFlag(input: CreateScriptFlagInput): Promise<IScriptFlag> {
        const { scriptId, reason, note, userId, userRole, ipAddress } = input;
        let { question } = input;

        // 1. Validate ObjectIds
        if (!scriptId || !mongoose.Types.ObjectId.isValid(scriptId)) {
            throw new HttpError('Invalid AnswerScript ID format', 400);
        }
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            throw new HttpError('Invalid User ID format', 400);
        }

        const scriptObjectId = new mongoose.Types.ObjectId(scriptId);
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const role = (typeof userRole === 'string' ? userRole.toUpperCase() : userRole) as UserRole;

        // 2. Validate reason enum
        if (!reason || !Object.values(FlagReason).includes(reason as FlagReason)) {
            throw new HttpError(
                `Invalid flag reason: '${reason}'. Supported reasons are: ${Object.values(FlagReason).join(', ')}`,
                400
            );
        }

        // 3. Validate and trim note
        let trimmedNote: string | undefined = undefined;
        if (note !== undefined && note !== null) {
            trimmedNote = typeof note === 'string' ? note.trim() : String(note).trim();
            if (trimmedNote.length > 2000) {
                throw new HttpError('Flag note cannot exceed 2000 characters', 400);
            }
            if (trimmedNote.length === 0) {
                trimmedNote = undefined;
            }
        }

        // 4. Validate question number if provided
        if (question !== undefined && question !== null) {
            const num = Number(question);
            if (isNaN(num) || num < 1 || !Number.isInteger(num)) {
                throw new HttpError('Invalid question number. Must be a positive integer', 400);
            }
            question = Math.floor(num);
        } else {
            question = undefined;
        }

        // 5. Enforce Permission.FLAG_FOR_REVIEW
        if (!hasPermission(role, Permission.FLAG_FOR_REVIEW)) {
            await writeAuditLog({
                user: userObjectId,
                action: 'AUTHORIZATION_FAILURE',
                outcome: 'FAILURE',
                entityId: scriptObjectId,
                entityType: 'AnswerScript',
                details: {
                    attemptedPermission: Permission.FLAG_FOR_REVIEW,
                    role,
                    scriptId: scriptObjectId.toString()
                },
                ipAddress
            });
            throw new HttpError('Forbidden: You do not have permission to flag scripts for review', 403);
        }

        // 6. Retrieve AnswerScript and verify it exists and is active
        const script = await AnswerScript.findOne({ _id: scriptObjectId, isActive: true });
        if (!script) {
            throw new HttpError('AnswerScript not found', 404);
        }

        // 7. Enforce AllocationService.verifyTaAllocation
        const allocation = await AllocationService.verifyTaAllocation(
            scriptObjectId,
            userObjectId,
            question
        );

        if (!allocation) {
            await writeAuditLog({
                user: userObjectId,
                action: 'SCRIPT_FLAG_REJECTED_UNALLOCATED',
                outcome: 'FAILURE',
                entityId: scriptObjectId,
                entityType: 'AnswerScript',
                details: {
                    scriptId: scriptObjectId.toString(),
                    userId: userObjectId.toString(),
                    question: question ?? null,
                    reason
                },
                ipAddress
            });
            throw new HttpError('Forbidden: You are not allocated to grade this answer script or question', 403);
        }

        // 8. Prevent duplicate OPEN flags by the same TA on the same question
        const existingOpenFlag = await ScriptFlag.findOne({
            answerScript: scriptObjectId,
            question: question ?? null,
            raisedBy: userObjectId,
            status: FlagStatus.OPEN
        });

        if (existingOpenFlag) {
            throw new HttpError(
                'An open flag for this script and question by this TA already exists',
                409
            );
        }

        // 9. Create and save the ScriptFlag
        try {
            const flag = new ScriptFlag({
                answerScript: scriptObjectId,
                exam: script.exam,
                question: question ?? undefined,
                raisedBy: userObjectId,
                reason: reason as FlagReason,
                note: trimmedNote,
                status: FlagStatus.OPEN,
                resolution: null
            });

            await flag.save();

            // 10. Record AuditLog entry
            await writeAuditLog({
                user: userObjectId,
                action: 'SCRIPT_FLAG_CREATED',
                outcome: 'SUCCESS',
                entityId: flag._id as mongoose.Types.ObjectId,
                entityType: 'ScriptFlag',
                details: {
                    flagId: flag._id.toString(),
                    answerScript: scriptObjectId.toString(),
                    exam: script.exam.toString(),
                    question: question ?? null,
                    reason,
                    note: trimmedNote ?? null,
                    status: FlagStatus.OPEN
                },
                ipAddress
            });

            // 11. Notify the Exam's Professor (AE-117 Notification Infrastructure)
            try {
                const exam = await Exam.findById(script.exam);
                if (exam && exam.createdBy) {
                    const rendered = renderFlagTemplate({
                        exam: exam._id as mongoose.Types.ObjectId,
                        examTitle: exam.title,
                        answerScript: scriptObjectId,
                        question: question ?? null,
                        reason: reason as string,
                        recipient: exam.createdBy
                    });

                    await NotificationService.createNotifications([
                        {
                            recipient: exam.createdBy,
                            type: NotificationType.FLAG,
                            title: rendered.title,
                            message: rendered.message,
                            exam: exam._id as mongoose.Types.ObjectId,
                            answerScript: scriptObjectId,
                            question: question ?? null
                        }
                    ]);
                }
            } catch (notifyErr) {
                // Non-blocking notification logging
                console.error('Failed to dispatch professor flag notification:', notifyErr);
            }

            return flag;
        } catch (err: unknown) {
            if (isDuplicateKeyError(err)) {
                throw new HttpError(
                    'An open flag for this script and question by this TA already exists',
                    409
                );
            }
            throw err;
        }
    }

    /**
     * Retrieves flags for an answer script, strictly enforcing visibility rules (Requirement 6).
     * - TA: only sees flags raised by themselves
     * - Professor (exam owner) / Admin: sees all flags for the script
     * - Student: completely forbidden (403)
     */
    static async getFlagsForScript(options: GetScriptFlagsOptions): Promise<IScriptFlag[]> {
        const { scriptId, userId, userRole } = options;

        if (!scriptId || !mongoose.Types.ObjectId.isValid(scriptId)) {
            throw new HttpError('Invalid AnswerScript ID format', 400);
        }
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            throw new HttpError('Invalid User ID format', 400);
        }

        const scriptObjectId = new mongoose.Types.ObjectId(scriptId);
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const role = (typeof userRole === 'string' ? userRole.toUpperCase() : userRole) as UserRole;

        // Privacy rule: Students must never see flag details
        if (role === UserRole.STUDENT) {
            throw new HttpError('Forbidden: Student accounts cannot access flag information', 403);
        }

        const script = await AnswerScript.findOne({ _id: scriptObjectId, isActive: true });
        if (!script) {
            throw new HttpError('AnswerScript not found', 404);
        }

        const query: Record<string, unknown> = {
            answerScript: scriptObjectId
        };

        if (role === UserRole.TA) {
            // TAs can only see flags they raised themselves
            query.raisedBy = userObjectId;
        } else if (role === UserRole.PROFESSOR) {
            // Verify the professor owns the exam
            const exam = await Exam.findOne({ _id: script.exam, createdBy: userObjectId });
            if (!exam) {
                throw new HttpError('Forbidden: You do not own the exam for this script', 403);
            }
        }

        return await ScriptFlag.find(query).sort({ createdAt: -1 });
    }

    /**
     * Retrieves the Professor Flag Review Queue (AE-163).
     * Enforces:
     * - Professor/Admin only access (TAs and Students rejected with 403 Forbidden).
     * - Scopes flags strictly to exams owned by the logged-in professor (Exam.find({ createdBy: viewer.id })).
     * - Client-supplied examId is never trusted for authorization; if supplied by a professor, it must belong to their owned exams.
     * - Two-professor isolation: Professor A cannot see Professor B's flags even when passing Professor B's examId.
     * - Default filter: OPEN flags, sorted newest first (createdAt: -1).
     * - Filtering supported for OPEN, RESOLVED, ESCALATED.
     * - Returns populated flag data, student identity (for professors), TA's current marks, and status counts.
     */
    static async getProfessorFlagQueue(options: GetProfessorFlagQueueOptions): Promise<FlagQueueResult> {
        const { userId, userRole, examId, status, page = 1, limit = 20 } = options;

        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            throw new HttpError('Invalid User ID format', 400);
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);
        const role = (typeof userRole === 'string' ? userRole.toUpperCase() : userRole) as UserRole;

        // 1. Enforce Role-Based Access Control (RBAC)
        if (role === UserRole.STUDENT || role === UserRole.TA) {
            throw new HttpError('Forbidden: Access denied to professor flag review queue', 403);
        }

        if (role !== UserRole.PROFESSOR && role !== UserRole.ADMIN) {
            throw new HttpError('Forbidden: Access denied to professor flag review queue', 403);
        }

        // 2. Server-side Exam Ownership Scoping
        let examFilter: mongoose.Types.ObjectId | { $in: mongoose.Types.ObjectId[] } | undefined;

        if (role === UserRole.PROFESSOR) {
            // Scope ownership server-side using Exam.find({ createdBy: viewer.id })
            const ownedExams = await Exam.find({ createdBy: userObjectId }).select('_id');
            const ownedExamIds = ownedExams.map((e) => e._id as mongoose.Types.ObjectId);

            if (examId) {
                if (!mongoose.Types.ObjectId.isValid(examId)) {
                    throw new HttpError('Invalid Exam ID format', 400);
                }
                const requestedExamObjectId = new mongoose.Types.ObjectId(examId);
                const isOwned = ownedExamIds.some((id) => id.equals(requestedExamObjectId));
                if (!isOwned) {
                    // Two-professor isolation: passing another professor's examId must yield no flags
                    examFilter = { $in: [] };
                } else {
                    examFilter = requestedExamObjectId;
                }
            } else {
                examFilter = { $in: ownedExamIds };
            }
        } else if (role === UserRole.ADMIN) {
            if (examId) {
                if (!mongoose.Types.ObjectId.isValid(examId)) {
                    throw new HttpError('Invalid Exam ID format', 400);
                }
                examFilter = new mongoose.Types.ObjectId(examId);
            } else {
                examFilter = undefined;
            }
        }

        // 3. Status Filtering (Default: OPEN)
        let targetStatus = FlagStatus.OPEN;
        if (status !== undefined && status !== null && String(status).trim() !== '') {
            const statusUpper = typeof status === 'string' ? status.toUpperCase().trim() : status;
            if (!Object.values(FlagStatus).includes(statusUpper as FlagStatus)) {
                throw new HttpError(
                    `Invalid flag status filter: '${status}'. Supported statuses are: ${Object.values(FlagStatus).join(', ')}`,
                    400
                );
            }
            targetStatus = statusUpper as FlagStatus;
        }

        const baseExamQuery = examFilter !== undefined ? { exam: examFilter } : {};

        // 4. Compute Status Counts across the authorized exam scope
        const [openCount, resolvedCount, escalatedCount] = await Promise.all([
            ScriptFlag.countDocuments({ ...baseExamQuery, status: FlagStatus.OPEN }),
            ScriptFlag.countDocuments({ ...baseExamQuery, status: FlagStatus.RESOLVED }),
            ScriptFlag.countDocuments({ ...baseExamQuery, status: FlagStatus.ESCALATED })
        ]);

        const totalForStatus =
            targetStatus === FlagStatus.OPEN
                ? openCount
                : targetStatus === FlagStatus.RESOLVED
                  ? resolvedCount
                  : escalatedCount;

        // 5. Pagination and Newest-First Sorting
        const validPage = Math.max(1, Number(page) || 1);
        const validLimit = Math.max(1, Math.min(100, Number(limit) || 20));
        const skip = (validPage - 1) * validLimit;

        const query: Record<string, unknown> = {
            ...baseExamQuery,
            status: targetStatus
        };

        const flags = await ScriptFlag.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(validLimit)
            .populate('exam', 'title totalMarks')
            .populate('raisedBy', 'name email')
            .populate('resolution.by', 'name email')
            .populate({
                path: 'answerScript',
                select: 'student scriptReference candidateStudentId pageCount isActive',
                populate: {
                    path: 'student',
                    select: 'name email rollNumber'
                }
            })
            .lean();

        // 6. Fetch TA Grade and Marks for relevant scripts/questions
        const scriptIds = flags
            .map((f) => (f.answerScript as { _id?: mongoose.Types.ObjectId } | null)?._id)
            .filter((id): id is mongoose.Types.ObjectId => Boolean(id));

        const grades = scriptIds.length > 0
            ? await Grade.find({ answerScript: { $in: scriptIds } }).lean()
            : [];

        const populatedFlags: PopulatedFlagQueueItem[] = await Promise.all(
            flags.map(async (flag) => {
                const script = flag.answerScript as {
                    _id?: mongoose.Types.ObjectId;
                    scriptReference?: string;
                    anonymousId?: string;
                    candidateStudentId?: string | null;
                    pageCount?: number;
                    student?: {
                        _id?: mongoose.Types.ObjectId;
                        name?: string;
                        email?: string;
                        rollNumber?: string;
                    } | null;
                } | null;

                const exam = flag.exam as {
                    _id?: mongoose.Types.ObjectId;
                    title?: string;
                    totalMarks?: number;
                } | null;

                const raisedBy = flag.raisedBy as {
                    _id?: mongoose.Types.ObjectId;
                    name?: string;
                    email?: string;
                } | null;

                const scriptIdStr = script?._id?.toString() || '';
                const matchingGrade = grades.find((g) => {
                    const matchesScript = g.answerScript && g.answerScript.toString() === scriptIdStr;
                    if (!matchesScript) return false;
                    if (flag.question !== undefined && flag.question !== null) {
                        return g.question === flag.question;
                    }
                    return g.question === undefined || g.question === null;
                }) || grades.find((g) => g.answerScript && g.answerScript.toString() === scriptIdStr);

                // Use ScriptFlagService.getEffectiveGrade() to compute effective grade without duplicating logic
                let effectiveGrade: EffectiveGradeResult | null = null;
                if (scriptIdStr) {
                    effectiveGrade = await ScriptFlagService.getEffectiveGrade(scriptIdStr, flag.question);
                }

                return {
                    _id: flag._id.toString(),
                    answerScript: {
                        _id: scriptIdStr,
                        scriptReference: script?.scriptReference,
                        anonymousId: script?.anonymousId,
                        candidateStudentId: script?.candidateStudentId,
                        pageCount: script?.pageCount,
                        student: script?.student
                            ? {
                                  _id: script.student._id?.toString() || '',
                                  name: script.student.name,
                                  email: script.student.email,
                                  rollNumber: script.student.rollNumber
                              }
                            : null
                    },
                    exam: {
                        _id: exam?._id?.toString() || '',
                        title: exam?.title || 'Exam',
                        totalMarks: exam?.totalMarks
                    },
                    question: flag.question ?? null,
                    raisedBy: {
                        _id: raisedBy?._id?.toString() || '',
                        name: raisedBy?.name || 'TA',
                        email: raisedBy?.email || ''
                    },
                    reason: flag.reason,
                    note: flag.note,
                    status: flag.status,
                    resolution: (flag.resolution as unknown as IScriptFlagResolution) ?? null,
                    createdAt: flag.createdAt,
                    updatedAt: flag.updatedAt,
                    currentMarks: matchingGrade
                        ? {
                              totalScore: matchingGrade.totalScore,
                              marksAwarded: matchingGrade.marksAwarded,
                              feedback: matchingGrade.feedback,
                              isFinal: matchingGrade.isFinal,
                              gradedBy: matchingGrade.gradedBy?.toString()
                          }
                        : null,
                    effectiveGrade
                };
            })
        );

        return {
            flags: populatedFlags,
            counts: {
                open: openCount,
                resolved: resolvedCount,
                escalated: escalatedCount,
                total: openCount + resolvedCount + escalatedCount
            },
            pagination: {
                page: validPage,
                limit: validLimit,
                total: totalForStatus,
                pages: Math.ceil(totalForStatus / validLimit) || 1
            }
        };
    }

    /**
     * Resolves an active ScriptFlag (AE-164).
     * Enforces:
     * - Only exam-owner PROFESSOR or ADMIN can resolve.
     * - Server-side exam ownership verification via Exam.findOne({ _id: flag.exam, createdBy: viewer.id }).
     * - Two-professor isolation (Professor A cannot resolve Professor B's flags).
     * - TAs and Students cannot resolve flags (403 Forbidden).
     * - Actions supported: OVERRIDE, CLEAR, ESCALATE.
     * - OVERRIDE validates score against rubric bounds and Rubric.scoreStep.
     * - Never mutates the original TA Grade document.
     * - Stores resolution metadata (action, by, at, notes, previousScore, newScore, criterionOverrides).
     * - Writes AuditLog entry for every resolution action.
     */
    static async resolveFlag(input: ResolveScriptFlagInput): Promise<IScriptFlag> {
        const { flagId, action, notes, newScore, criterionOverrides, userId, userRole, ipAddress } = input;

        // 1. Validate IDs
        if (!flagId || !mongoose.Types.ObjectId.isValid(flagId)) {
            throw new HttpError('Invalid ScriptFlag ID format', 400);
        }
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            throw new HttpError('Invalid User ID format', 400);
        }

        const flagObjectId = new mongoose.Types.ObjectId(flagId);
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const role = (typeof userRole === 'string' ? userRole.toUpperCase() : userRole) as UserRole;

        // 2. Enforce Role-Based Access Control (Professor/Admin only)
        if (role === UserRole.STUDENT || role === UserRole.TA) {
            await writeAuditLog({
                user: userObjectId,
                action: 'SCRIPT_FLAG_RESOLUTION_DENIED',
                outcome: 'FAILURE',
                entityId: flagObjectId,
                entityType: 'ScriptFlag',
                details: {
                    reason: 'Insufficient permissions (TA/Student cannot resolve flags)',
                    role,
                    flagId: flagObjectId.toString()
                },
                ipAddress
            });
            throw new HttpError('Forbidden: Only the exam-owner professor or an admin can resolve flags', 403);
        }

        if (role !== UserRole.PROFESSOR && role !== UserRole.ADMIN) {
            throw new HttpError('Forbidden: Access denied to resolve flags', 403);
        }

        // 3. Retrieve the ScriptFlag
        const flag = await ScriptFlag.findById(flagObjectId);
        if (!flag) {
            throw new HttpError('Script flag not found', 404);
        }

        // 4. Verify flag is currently OPEN
        if (flag.status === FlagStatus.RESOLVED || flag.status === FlagStatus.ESCALATED) {
            throw new HttpError('This flag has already been resolved or escalated and cannot be modified', 400);
        }

        // 5. Server-side Exam Ownership Verification for Professors
        const exam = await Exam.findById(flag.exam);
        if (!exam) {
            throw new HttpError('Exam associated with this flag not found', 404);
        }

        if (role === UserRole.PROFESSOR) {
            if (!exam.createdBy || !exam.createdBy.equals(userObjectId)) {
                await writeAuditLog({
                    user: userObjectId,
                    action: 'SCRIPT_FLAG_RESOLUTION_DENIED',
                    outcome: 'FAILURE',
                    entityId: flagObjectId,
                    entityType: 'ScriptFlag',
                    details: {
                        reason: 'Professor does not own the exam',
                        examId: exam._id.toString(),
                        createdBy: exam.createdBy?.toString()
                    },
                    ipAddress
                });
                throw new HttpError('Forbidden: You do not own the exam for this flag', 403);
            }
        }

        // 6. Validate resolution action
        if (!action || !Object.values(FlagResolutionAction).includes(action as FlagResolutionAction)) {
            throw new HttpError(
                `Invalid resolution action: '${action}'. Supported actions are: ${Object.values(FlagResolutionAction).join(', ')}`,
                400
            );
        }

        // 7. Validate resolution notes
        if (notes === undefined || notes === null || typeof notes !== 'string' || notes.trim().length === 0) {
            throw new HttpError('Resolution notes are required', 400);
        }
        const trimmedNotes = notes.trim();
        if (trimmedNotes.length > 2000) {
            throw new HttpError('Resolution notes cannot exceed 2000 characters', 400);
        }

        // 8. Fetch existing TA Grade for score tracking (if available)
        const gradeQuery: Record<string, unknown> = {
            answerScript: flag.answerScript
        };
        if (flag.question !== undefined && flag.question !== null) {
            gradeQuery.question = flag.question;
        }
        const existingGrade = await Grade.findOne(gradeQuery);
        const previousScore = existingGrade ? existingGrade.totalScore : undefined;

        // 9. Process resolution by action type
        let calculatedNewScore: number | undefined = undefined;
        let validatedCriterionOverrides: ICriterionOverride[] | undefined = undefined;

        if (action === FlagResolutionAction.CLEAR) {
            flag.status = FlagStatus.RESOLVED;
            calculatedNewScore = previousScore;
        } else if (action === FlagResolutionAction.ESCALATE) {
            flag.status = FlagStatus.ESCALATED;
            calculatedNewScore = previousScore;
        } else if (action === FlagResolutionAction.OVERRIDE) {
            flag.status = FlagStatus.RESOLVED;

            // Load active rubric to validate score step and bounds
            const rubric = await Rubric.findOne({ exam: flag.exam, isActive: true });
            const step = rubric?.scoreStep ?? DEFAULT_SCORE_STEP;

            if (flag.question !== undefined && flag.question !== null) {
                const rubricQuestion = rubric?.questions?.find((q) => q.questionNumber === flag.question);

                if (criterionOverrides && Array.isArray(criterionOverrides) && criterionOverrides.length > 0) {
                    // Criterion-level override validation
                    let computedOverrideTotal = 0;
                    const validatedOverrides: ICriterionOverride[] = [];

                    for (const item of criterionOverrides) {
                        if (!item.criterionName || typeof item.criterionName !== 'string') {
                            throw new HttpError('Each criterion override must specify a valid criterionName', 400);
                        }

                        const rubricCrit = rubricQuestion?.criteria?.find(
                            (c) => c.criterionName === item.criterionName
                        );

                        if (rubricQuestion && !rubricCrit) {
                            throw new HttpError(
                                `Criterion "${item.criterionName}" does not exist in Question ${flag.question} rubric`,
                                400
                            );
                        }

                        const scoreVal = typeof item.score === 'number' ? item.score : Number(item.score);
                        if (isNaN(scoreVal) || !Number.isFinite(scoreVal)) {
                            throw new HttpError(
                                `Invalid score for criterion "${item.criterionName}". Must be a valid finite number`,
                                400
                            );
                        }

                        if (scoreVal < 0) {
                            throw new HttpError(
                                `Score for criterion "${item.criterionName}" cannot be negative`,
                                400
                            );
                        }

                        if (rubricCrit) {
                            const isExactMax = Math.abs(scoreVal - rubricCrit.points) < 1e-9;
                            if (scoreVal > rubricCrit.points && !isExactMax) {
                                throw new HttpError(
                                    `Score ${scoreVal} for criterion "${item.criterionName}" exceeds maximum allowed points of ${rubricCrit.points}`,
                                    400
                                );
                            }

                            if (!isExactMax && !isValidScoreStep(scoreVal, step)) {
                                throw new HttpError(
                                    `Score ${scoreVal} for criterion "${item.criterionName}" must be a multiple of the score step (${step})`,
                                    400
                                );
                            }
                        }

                        computedOverrideTotal += scoreVal;
                        validatedOverrides.push({
                            criterionName: item.criterionName.trim(),
                            score: scoreVal,
                            feedback: item.feedback ? item.feedback.trim() : undefined
                        });
                    }

                    if (rubricQuestion && computedOverrideTotal > rubricQuestion.maxMarks) {
                        throw new HttpError(
                            `Computed total score (${computedOverrideTotal}) exceeds maximum marks (${rubricQuestion.maxMarks}) for Question ${flag.question}`,
                            400
                        );
                    }

                    calculatedNewScore = Math.round(computedOverrideTotal * 100) / 100;
                    validatedCriterionOverrides = validatedOverrides;
                } else if (newScore !== undefined && newScore !== null) {
                    const scoreNum = typeof newScore === 'number' ? newScore : Number(newScore);
                    if (isNaN(scoreNum) || !Number.isFinite(scoreNum)) {
                        throw new HttpError('Invalid override score. Must be a finite number', 400);
                    }
                    if (scoreNum < 0) {
                        throw new HttpError('Override score cannot be negative', 400);
                    }
                    if (rubricQuestion) {
                        const isExactMax = Math.abs(scoreNum - rubricQuestion.maxMarks) < 1e-9;
                        if (scoreNum > rubricQuestion.maxMarks && !isExactMax) {
                            throw new HttpError(
                                `Override score ${scoreNum} exceeds maximum allowed marks of ${rubricQuestion.maxMarks} for Question ${flag.question}`,
                                400
                            );
                        }
                        if (!isExactMax && !isValidScoreStep(scoreNum, step)) {
                            throw new HttpError(
                                `Override score ${scoreNum} must be a multiple of the score step (${step})`,
                                400
                            );
                        }
                    } else if (exam.totalMarks && scoreNum > exam.totalMarks) {
                        throw new HttpError(
                            `Override score ${scoreNum} exceeds exam total marks of ${exam.totalMarks}`,
                            400
                        );
                    }
                    calculatedNewScore = scoreNum;
                } else {
                    throw new HttpError('A valid new score or criterion overrides are required for OVERRIDE', 400);
                }
            } else {
                // Script-level override
                if (newScore === undefined || newScore === null) {
                    throw new HttpError('A valid new score is required for OVERRIDE', 400);
                }
                const scoreNum = typeof newScore === 'number' ? newScore : Number(newScore);
                if (isNaN(scoreNum) || !Number.isFinite(scoreNum)) {
                    throw new HttpError('Invalid override score. Must be a finite number', 400);
                }
                if (scoreNum < 0) {
                    throw new HttpError('Override score cannot be negative', 400);
                }
                if (exam.totalMarks && scoreNum > exam.totalMarks) {
                    throw new HttpError(
                        `Override score ${scoreNum} exceeds exam total marks of ${exam.totalMarks}`,
                        400
                    );
                }
                if (!isValidScoreStep(scoreNum, step)) {
                    throw new HttpError(
                        `Override score ${scoreNum} must be a multiple of the score step (${step})`,
                        400
                    );
                }
                calculatedNewScore = scoreNum;
            }
        }

        // 10. Persist resolution on the ScriptFlag document
        flag.resolution = {
            action: action as FlagResolutionAction,
            by: userObjectId,
            at: new Date(),
            notes: trimmedNotes,
            previousScore,
            newScore: calculatedNewScore,
            criterionOverrides: validatedCriterionOverrides
        };

        await flag.save();

        // 11. Record AuditLog entry (Requirement 8)
        await writeAuditLog({
            user: userObjectId,
            action: `SCRIPT_FLAG_${action}`,
            outcome: 'SUCCESS',
            entityId: flag._id as mongoose.Types.ObjectId,
            entityType: 'ScriptFlag',
            details: {
                flagId: flag._id.toString(),
                scriptId: flag.answerScript.toString(),
                examId: flag.exam.toString(),
                question: flag.question ?? null,
                actor: userObjectId.toString(),
                actorRole: role,
                action,
                status: flag.status,
                previousScore: flag.resolution.previousScore ?? null,
                newScore: flag.resolution.newScore ?? null,
                notes: trimmedNotes,
                timestamp: flag.resolution.at
            },
            ipAddress
        });

        // 12. Dispatch Admin Notification upon ESCALATE
        if (action === FlagResolutionAction.ESCALATE) {
            try {
                const admins = await User.find({ role: UserRole.ADMIN, isActive: true });
                if (admins.length > 0) {
                    const qText = flag.question !== undefined && flag.question !== null
                        ? `Question ${flag.question}`
                        : 'Answer Script';
                    const notifications = admins.map((admin) => ({
                        recipient: admin._id as mongoose.Types.ObjectId,
                        type: NotificationType.FLAG,
                        title: 'Flag Escalated to Admin',
                        message: `A flag on ${qText} has been escalated for administrative review: "${trimmedNotes}"`,
                        exam: flag.exam as mongoose.Types.ObjectId,
                        answerScript: flag.answerScript as mongoose.Types.ObjectId,
                        question: flag.question ?? null
                    }));
                    await NotificationService.createNotifications(notifications);
                }
            } catch (notifyErr) {
                console.error('Failed to dispatch admin escalation notification:', notifyErr);
            }
        }

        return flag;
    }

    /**
     * Computes the effective grade for an answer script / question,
     * giving precedence to audited professor overrides stored in ScriptFlag.resolution (AE-164).
     * Never mutates the underlying TA Grade document.
     */
    static async getEffectiveGrade(
        scriptId: string | mongoose.Types.ObjectId,
        question?: number | null
    ): Promise<EffectiveGradeResult> {
        if (!scriptId || !mongoose.Types.ObjectId.isValid(scriptId)) {
            throw new HttpError('Invalid AnswerScript ID format', 400);
        }

        const scriptObjectId = new mongoose.Types.ObjectId(scriptId);

        // 1. Fetch original Grade
        const gradeQuery: Record<string, unknown> = {
            answerScript: scriptObjectId
        };
        if (question !== undefined && question !== null) {
            gradeQuery.question = question;
        }
        const originalGrade = await Grade.findOne(gradeQuery).lean();

        // 2. Fetch latest resolved OVERRIDE flag
        const flagQuery: Record<string, unknown> = {
            answerScript: scriptObjectId,
            status: FlagStatus.RESOLVED,
            'resolution.action': FlagResolutionAction.OVERRIDE
        };
        if (question !== undefined && question !== null) {
            flagQuery.question = question;
        }
        const overrideFlag = await ScriptFlag.findOne(flagQuery)
            .sort({ 'resolution.at': -1, updatedAt: -1 })
            .populate('resolution.by', 'name email')
            .lean();

        const overrideAt = overrideFlag?.resolution?.at
            ? new Date(overrideFlag.resolution.at).getTime()
            : (overrideFlag?.updatedAt ? new Date(overrideFlag.updatedAt).getTime() : 0);
        const gradeUpdatedAt = originalGrade?.updatedAt ? new Date(originalGrade.updatedAt).getTime() : 0;

        const isOverrideActive = Boolean(
            overrideFlag?.resolution &&
            typeof overrideFlag.resolution.newScore === 'number' &&
            overrideAt >= gradeUpdatedAt
        );

        if (isOverrideActive && overrideFlag?.resolution && typeof overrideFlag.resolution.newScore === 'number') {
            return {
                totalScore: overrideFlag.resolution.newScore,
                isOverridden: true,
                originalScore: originalGrade?.totalScore,
                override: overrideFlag.resolution as unknown as EffectiveGradeResult['override'],
                marksAwarded: overrideFlag.resolution.criterionOverrides?.length
                    ? overrideFlag.resolution.criterionOverrides
                    : originalGrade?.marksAwarded
            };
        }

        return {
            totalScore: originalGrade?.totalScore ?? 0,
            isOverridden: false,
            originalScore: originalGrade?.totalScore,
            override: null,
            marksAwarded: originalGrade?.marksAwarded
        };
    }

    /**
     * Aggregates ScriptFlag analytics and counts (AE-165).
     * Enforces:
     * - Access control (Professor / Admin only, 403 for TA / Student).
     * - Server-side exam ownership scoping for professors (Exam.find({ createdBy: viewer.id })).
     * - Verification of client-supplied examId filter against ownership.
     * - MongoDB aggregation via $group on the server without loading all documents into memory.
     * - Structured response with zero-filled reason × status combinations.
     */
    static async getFlagAnalytics(options: GetFlagAnalyticsOptions): Promise<FlagAnalyticsResult> {
        const { userId, userRole, examId } = options;

        // 1. Validate User ID
        if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
            throw new HttpError('Invalid User ID format', 400);
        }

        const userObjectId = new mongoose.Types.ObjectId(userId);
        const role = (typeof userRole === 'string' ? userRole.toUpperCase() : userRole) as UserRole;

        // 2. Enforce Role-Based Access Control (RBAC)
        if (role === UserRole.STUDENT || role === UserRole.TA) {
            throw new HttpError('Forbidden: Access denied to flag analytics', 403);
        }

        if (role !== UserRole.PROFESSOR && role !== UserRole.ADMIN) {
            throw new HttpError('Forbidden: Access denied to flag analytics', 403);
        }

        // 3. Server-side Exam Ownership Scoping & Filtering
        let matchFilter: Record<string, unknown> = {};

        if (role === UserRole.PROFESSOR) {
            const ownedExams = await Exam.find({ createdBy: userObjectId }).select('_id');
            const ownedExamIds = ownedExams.map((e) => e._id as mongoose.Types.ObjectId);

            if (examId) {
                if (!mongoose.Types.ObjectId.isValid(examId)) {
                    throw new HttpError('Invalid Exam ID format', 400);
                }
                const requestedExamObjectId = new mongoose.Types.ObjectId(examId);
                const requestedExam = await Exam.findById(requestedExamObjectId);
                if (!requestedExam) {
                    throw new HttpError('Exam not found', 404);
                }
                const isOwned = ownedExamIds.some((id) => id.equals(requestedExamObjectId));
                if (!isOwned) {
                    throw new HttpError('Forbidden: You do not own the requested exam', 403);
                }
                matchFilter = { exam: requestedExamObjectId };
            } else {
                matchFilter = { exam: { $in: ownedExamIds } };
            }
        } else if (role === UserRole.ADMIN) {
            if (examId) {
                if (!mongoose.Types.ObjectId.isValid(examId)) {
                    throw new HttpError('Invalid Exam ID format', 400);
                }
                const requestedExamObjectId = new mongoose.Types.ObjectId(examId);
                const requestedExam = await Exam.findById(requestedExamObjectId);
                if (!requestedExam) {
                    throw new HttpError('Exam not found', 404);
                }
                matchFilter = { exam: requestedExamObjectId };
            } else {
                matchFilter = {};
            }
        }

        // 4. Server-Side MongoDB Aggregation using $group
        const aggregationResults = await ScriptFlag.aggregate<{
            _id: { reason: string; status: string };
            count: number;
        }>([
            { $match: matchFilter },
            {
                $group: {
                    _id: {
                        reason: '$reason',
                        status: '$status'
                    },
                    count: { $sum: 1 }
                }
            }
        ]);

        // 5. Initialize complete zero-count matrix for all reason × status combinations
        const byReasonAndStatus: FlagAnalyticsResult['byReasonAndStatus'] = {
            [FlagReason.CHEATING_SUSPECTED]: {
                [FlagStatus.OPEN]: 0,
                [FlagStatus.RESOLVED]: 0,
                [FlagStatus.ESCALATED]: 0
            },
            [FlagReason.ILLEGIBLE]: {
                [FlagStatus.OPEN]: 0,
                [FlagStatus.RESOLVED]: 0,
                [FlagStatus.ESCALATED]: 0
            },
            [FlagReason.OTHER]: {
                [FlagStatus.OPEN]: 0,
                [FlagStatus.RESOLVED]: 0,
                [FlagStatus.ESCALATED]: 0
            }
        };

        const byStatus: FlagAnalyticsResult['byStatus'] = {
            [FlagStatus.OPEN]: 0,
            [FlagStatus.RESOLVED]: 0,
            [FlagStatus.ESCALATED]: 0
        };

        const byReason: FlagAnalyticsResult['byReason'] = {
            [FlagReason.CHEATING_SUSPECTED]: 0,
            [FlagReason.ILLEGIBLE]: 0,
            [FlagReason.OTHER]: 0
        };

        let total = 0;

        for (const item of aggregationResults) {
            const reason = item._id?.reason as FlagReason;
            const status = item._id?.status as FlagStatus;
            const count = Number(item.count) || 0;

            if (
                reason &&
                byReasonAndStatus[reason] &&
                status &&
                byReasonAndStatus[reason][status] !== undefined
            ) {
                byReasonAndStatus[reason][status] = count;
                byStatus[status] = (byStatus[status] || 0) + count;
                byReason[reason] = (byReason[reason] || 0) + count;
                total += count;
            }
        }

        return {
            total,
            byStatus,
            byReason,
            byReasonAndStatus
        };
    }
}

export default ScriptFlagService;
