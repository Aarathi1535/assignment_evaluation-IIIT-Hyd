import mongoose from 'mongoose';
import ScriptFlag, { IScriptFlag, FlagReason, FlagStatus } from '../models/ScriptFlag';
import AnswerScript from '../models/AnswerScript';
import Exam from '../models/Exam';
import AllocationService from './AllocationService';
import NotificationService from './NotificationService';
import { NotificationType } from '../models/Notification';
import { renderFlagTemplate } from '../templates/notificationTemplates';
import { writeAuditLog } from '../lib/audit';
import { HttpError, isDuplicateKeyError } from '../lib/errors';
import { hasPermission, Permission, UserRole } from '../constants/permissions';

export interface CreateScriptFlagInput {
    scriptId: string | mongoose.Types.ObjectId;
    question?: number | null;
    reason: FlagReason | string;
    note?: string;
    userId: string | mongoose.Types.ObjectId;
    userRole: UserRole | string;
    ipAddress?: string;
}

export interface GetScriptFlagsOptions {
    scriptId: string | mongoose.Types.ObjectId;
    userId: string | mongoose.Types.ObjectId;
    userRole: UserRole | string;
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
}

export default ScriptFlagService;
