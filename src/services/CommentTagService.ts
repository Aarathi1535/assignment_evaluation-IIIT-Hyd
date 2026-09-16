import mongoose from 'mongoose';
import CommentTag, { ICommentTag, TagScope } from '../models/CommentTag';
import Exam from '../models/Exam';
import Course from '../models/Course';
import ExamRepository from '../repositories/ExamRepository';
import { UserRole } from '../constants/permissions';
import { HttpError } from '../lib/errors';
import { writeAuditLog } from '../lib/audit';

function escapeRegex(text: string): string {
    return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

export interface AuthContext {
    userId: string;
    userRole: string;
    ipAddress?: string;
}

export interface CreateTagInput {
    label: string;
    scope: TagScope;
    exam?: string | null;
    examId?: string | null;
    description?: string | null;
}

export interface UpdateTagInput {
    label?: string;
    description?: string | null;
}

export interface ListTagsOptions {
    examId?: string | null;
    scope?: TagScope | null;
    userId: string;
    userRole: string;
}

export class CommentTagService {
    /**
     * Lists preset comment tags accessible to the user.
     * - If examId is provided: returns GLOBAL tags and EXAM-specific tags for that exam
     *   (verifying that user has access to that exam).
     * - If examId is omitted:
     *   - For Professor: returns GLOBAL tags and EXAM tags belonging to exams owned by this professor.
     *   - For Admin: returns all tags.
     *   - For TA: returns GLOBAL tags.
     */
    async listTags(options: ListTagsOptions): Promise<ICommentTag[]> {
        const { examId, scope, userId, userRole } = options;
        const normalizedRole = userRole?.toUpperCase();

        if (examId) {
            if (!mongoose.Types.ObjectId.isValid(examId)) {
                throw new HttpError('Invalid Exam ID format', 400);
            }

            const examObjId = new mongoose.Types.ObjectId(examId);

            // Access check for the requested exam
            if (normalizedRole === UserRole.PROFESSOR) {
                const exam = await Exam.findOne({ _id: examObjId, createdBy: new mongoose.Types.ObjectId(userId), isActive: true });
                if (!exam) {
                    throw new HttpError('Forbidden: Access denied to this exam', 403);
                }
            } else if (normalizedRole === UserRole.TA) {
                // Verify TA has access to this exam via course or allocation
                const exam = await Exam.findOne({ _id: examObjId, isActive: true });
                if (!exam) {
                    throw new HttpError('Exam not found', 404);
                }
                const course = await Course.findOne({
                    _id: exam.course,
                    teachingAssistants: new mongoose.Types.ObjectId(userId),
                    isActive: true,
                });
                if (!course) {
                    // Also check if assigned via exam allocation directly
                    const Allocation = mongoose.models.Allocation || await import('../models/Allocation').then(m => m.default);
                    const alloc = await Allocation.findOne({ exam: examObjId, ta: new mongoose.Types.ObjectId(userId) });
                    if (!alloc) {
                        throw new HttpError('Forbidden: You are not assigned to grade or assist this exam', 403);
                    }
                }
            }

            // Query tags for this exam
            const query: Record<string, unknown> = {};

            if (scope === TagScope.GLOBAL) {
                query.scope = TagScope.GLOBAL;
            } else if (scope === TagScope.EXAM) {
                query.scope = TagScope.EXAM;
                query.exam = examObjId;
            } else {
                // Both GLOBAL tags and this exam's tags
                query.$or = [
                    { scope: TagScope.GLOBAL },
                    { scope: TagScope.EXAM, exam: examObjId },
                ];
            }

            return await CommentTag.find(query).sort({ scope: 1, label: 1 });
        }

        // No examId specified
        if (normalizedRole === UserRole.PROFESSOR) {
            const ownedExams = await Exam.find({ createdBy: new mongoose.Types.ObjectId(userId), isActive: true }).select('_id');
            const ownedExamIds = ownedExams.map((e) => e._id);

            const query: Record<string, unknown> = {};
            if (scope === TagScope.GLOBAL) {
                query.scope = TagScope.GLOBAL;
            } else if (scope === TagScope.EXAM) {
                query.scope = TagScope.EXAM;
                query.exam = { $in: ownedExamIds };
            } else {
                query.$or = [
                    { scope: TagScope.GLOBAL },
                    { scope: TagScope.EXAM, exam: { $in: ownedExamIds } },
                ];
            }
            return await CommentTag.find(query).sort({ scope: 1, label: 1 });
        }

        if (normalizedRole === UserRole.ADMIN) {
            const query: Record<string, unknown> = {};
            if (scope) {
                query.scope = scope;
            }
            return await CommentTag.find(query).sort({ scope: 1, label: 1 });
        }

        // For TA without examId: return all GLOBAL tags
        return await CommentTag.find({ scope: TagScope.GLOBAL }).sort({ label: 1 });
    }

    /**
     * Creates a new preset comment tag.
     * Only Professor and Admin can create tags.
     * For EXAM scope: professor must own the exam.
     * Checks and rejects duplicate labels within the same scope.
     */
    async createTag(input: CreateTagInput, context: AuthContext): Promise<ICommentTag> {
        const { userId, userRole, ipAddress } = context;
        const normalizedRole = userRole?.toUpperCase();

        if (normalizedRole !== UserRole.PROFESSOR && normalizedRole !== UserRole.ADMIN) {
            throw new HttpError('Forbidden: Only professors and admins can create comment tags', 403);
        }

        const label = input.label?.trim();
        if (!label) {
            throw new HttpError('Tag label is required and cannot be empty', 400);
        }
        if (label.length > 100) {
            throw new HttpError('Tag label cannot exceed 100 characters', 400);
        }

        const scope = input.scope;
        let examObjectId: mongoose.Types.ObjectId | null = null;

        if (scope === TagScope.EXAM) {
            const examId = input.exam || input.examId;
            if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
                throw new HttpError('Valid Exam ID is required for EXAM-scoped tags', 400);
            }

            examObjectId = new mongoose.Types.ObjectId(examId);

            // Ownership check for Professor
            if (normalizedRole === UserRole.PROFESSOR) {
                const exam = await Exam.findOne({
                    _id: examObjectId,
                    createdBy: new mongoose.Types.ObjectId(userId),
                    isActive: true,
                });
                if (!exam) {
                    throw new HttpError('Forbidden: You do not have permission to create tags for this exam', 403);
                }
            } else {
                const exam = await Exam.findOne({ _id: examObjectId, isActive: true });
                if (!exam) {
                    throw new HttpError('Exam not found', 404);
                }
            }

            // Duplicate check within this exam
            const duplicate = await CommentTag.findOne({
                label: { $regex: new RegExp(`^${escapeRegex(label)}$`, 'i') },
                scope: TagScope.EXAM,
                exam: examObjectId,
            });

            if (duplicate) {
                throw new HttpError(`A tag with label "${label}" already exists for this exam`, 409);
            }
        } else if (scope === TagScope.GLOBAL) {
            // Duplicate check among GLOBAL tags
            const duplicate = await CommentTag.findOne({
                label: { $regex: new RegExp(`^${escapeRegex(label)}$`, 'i') },
                scope: TagScope.GLOBAL,
            });

            if (duplicate) {
                throw new HttpError(`A global tag with label "${label}" already exists`, 409);
            }
        } else {
            throw new HttpError('Invalid tag scope. Must be GLOBAL or EXAM', 400);
        }

        const newTag = new CommentTag({
            label,
            scope,
            exam: examObjectId,
            createdBy: new mongoose.Types.ObjectId(userId),
            description: input.description?.trim() || undefined,
        });

        const savedTag = await newTag.save();

        await writeAuditLog({
            user: userId,
            action: 'TAG_CREATED',
            outcome: 'SUCCESS',
            entityId: savedTag._id as mongoose.Types.ObjectId,
            entityType: 'CommentTag',
            details: {
                label,
                scope,
                examId: examObjectId?.toString(),
            },
            ipAddress,
        });

        return savedTag;
    }

    /**
     * Updates an existing preset comment tag.
     * Only Professor and Admin can update tags.
     * For EXAM scope: professor must own the exam.
     */
    async updateTag(tagId: string, input: UpdateTagInput, context: AuthContext): Promise<ICommentTag> {
        const { userId, userRole, ipAddress } = context;
        const normalizedRole = userRole?.toUpperCase();

        if (normalizedRole !== UserRole.PROFESSOR && normalizedRole !== UserRole.ADMIN) {
            throw new HttpError('Forbidden: Only professors and admins can update comment tags', 403);
        }

        if (!tagId || !mongoose.Types.ObjectId.isValid(tagId)) {
            throw new HttpError('Invalid Tag ID format', 400);
        }

        const tag = await CommentTag.findById(tagId);
        if (!tag) {
            throw new HttpError('Comment tag not found', 404);
        }

        // Authorization / Ownership check
        if (normalizedRole === UserRole.PROFESSOR) {
            if (tag.scope === TagScope.EXAM) {
                const exam = await Exam.findOne({
                    _id: tag.exam,
                    createdBy: new mongoose.Types.ObjectId(userId),
                    isActive: true,
                });
                if (!exam) {
                    throw new HttpError('Forbidden: You do not have permission to modify tags for this exam', 403);
                }
            } else if (tag.scope === TagScope.GLOBAL) {
                if (tag.createdBy.toString() !== userId) {
                    throw new HttpError('Forbidden: You can only edit global tags created by you', 403);
                }
            }
        }

        // If label is being updated, validate and check for duplicate
        if (input.label !== undefined) {
            const newLabel = input.label.trim();
            if (!newLabel) {
                throw new HttpError('Tag label cannot be empty', 400);
            }
            if (newLabel.length > 100) {
                throw new HttpError('Tag label cannot exceed 100 characters', 400);
            }

            if (newLabel.toLowerCase() !== tag.label.toLowerCase()) {
                if (tag.scope === TagScope.GLOBAL) {
                    const duplicate = await CommentTag.findOne({
                        _id: { $ne: tag._id },
                        label: { $regex: new RegExp(`^${escapeRegex(newLabel)}$`, 'i') },
                        scope: TagScope.GLOBAL,
                    });
                    if (duplicate) {
                        throw new HttpError(`A global tag with label "${newLabel}" already exists`, 409);
                    }
                } else if (tag.scope === TagScope.EXAM) {
                    const duplicate = await CommentTag.findOne({
                        _id: { $ne: tag._id },
                        label: { $regex: new RegExp(`^${escapeRegex(newLabel)}$`, 'i') },
                        scope: TagScope.EXAM,
                        exam: tag.exam,
                    });
                    if (duplicate) {
                        throw new HttpError(`A tag with label "${newLabel}" already exists for this exam`, 409);
                    }
                }
            }

            tag.label = newLabel;
        }

        if (input.description !== undefined) {
            tag.description = input.description?.trim() || undefined;
        }

        const updatedTag = await tag.save();

        await writeAuditLog({
            user: userId,
            action: 'TAG_UPDATED',
            outcome: 'SUCCESS',
            entityId: updatedTag._id as mongoose.Types.ObjectId,
            entityType: 'CommentTag',
            details: {
                label: updatedTag.label,
                scope: updatedTag.scope,
                examId: updatedTag.exam?.toString(),
            },
            ipAddress,
        });

        return updatedTag;
    }

    /**
     * Deletes a preset comment tag.
     * Only Professor and Admin can delete tags.
     * For EXAM scope: professor must own the exam.
     */
    async deleteTag(tagId: string, context: AuthContext): Promise<void> {
        const { userId, userRole, ipAddress } = context;
        const normalizedRole = userRole?.toUpperCase();

        if (normalizedRole !== UserRole.PROFESSOR && normalizedRole !== UserRole.ADMIN) {
            throw new HttpError('Forbidden: Only professors and admins can delete comment tags', 403);
        }

        if (!tagId || !mongoose.Types.ObjectId.isValid(tagId)) {
            throw new HttpError('Invalid Tag ID format', 400);
        }

        const tag = await CommentTag.findById(tagId);
        if (!tag) {
            throw new HttpError('Comment tag not found', 404);
        }

        // Authorization / Ownership check
        if (normalizedRole === UserRole.PROFESSOR) {
            if (tag.scope === TagScope.EXAM) {
                const exam = await Exam.findOne({
                    _id: tag.exam,
                    createdBy: new mongoose.Types.ObjectId(userId),
                    isActive: true,
                });
                if (!exam) {
                    throw new HttpError('Forbidden: You do not have permission to delete tags for this exam', 403);
                }
            } else if (tag.scope === TagScope.GLOBAL) {
                if (tag.createdBy.toString() !== userId) {
                    throw new HttpError('Forbidden: You can only delete global tags created by you', 403);
                }
            }
        }

        await CommentTag.findByIdAndDelete(tag._id);

        await writeAuditLog({
            user: userId,
            action: 'TAG_DELETED',
            outcome: 'SUCCESS',
            entityId: tag._id as mongoose.Types.ObjectId,
            entityType: 'CommentTag',
            details: {
                label: tag.label,
                scope: tag.scope,
                examId: tag.exam?.toString(),
            },
            ipAddress,
        });
    }

    /**
     * Gets a single tag by ID, verifying access.
     */
    async getTagById(tagId: string, context: AuthContext): Promise<ICommentTag | null> {
        if (!tagId || !mongoose.Types.ObjectId.isValid(tagId)) {
            return null;
        }

        const tag = await CommentTag.findById(tagId);
        if (!tag) {
            return null;
        }

        // If exam-scoped, check viewer access
        if (tag.scope === TagScope.EXAM && tag.exam) {
            const exam = await ExamRepository.getExamById(
                tag.exam.toString(),
                context.userId,
                context.userRole
            );
            if (!exam) {
                return null;
            }
        }

        return tag;
    }
}

export const commentTagService = new CommentTagService();
export default commentTagService;
