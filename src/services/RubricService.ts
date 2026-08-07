import RubricRepository from '../repositories/RubricRepository';
import ExamRepository from '../repositories/ExamRepository';
import { IRubric } from '../models/Rubric';
import mongoose from 'mongoose';
import { writeAuditLog } from '../lib/audit';
import { HttpError } from '../lib/errors';

export interface AuditContext {
    actingUserId?: string;
    actingUserRole?: string;
    ipAddress?: string;
}

class RubricService {
    async createRubric(data: Partial<IRubric>, context?: AuditContext): Promise<IRubric> {
        if (!data.exam) {
            throw new HttpError('Exam ID is required', 400);
        }

        if (!context?.actingUserId || !context?.actingUserRole) {
            throw new HttpError('Unauthorized', 401);
        }

        if (context.actingUserRole !== 'ADMIN' && context.actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden', 403);
        }

        // Enforce exam ownership/access
        const exam = await ExamRepository.getExamById(
            data.exam.toString(),
            context.actingUserId,
            context.actingUserRole
        );
        if (!exam) {
            // Deny-by-default
            throw new HttpError('Exam not found or access denied', 404);
        }

        // Check if rubric already exists for this exam
        const existingRubric = await RubricRepository.getRubricByExamId(
            data.exam.toString(),
            context.actingUserId,
            context.actingUserRole
        );
        if (existingRubric) {
            throw new HttpError('Rubric already exists for this exam', 400);
        }

        try {
            const newRubric = await RubricRepository.createRubric(data);

            // Attach rubric to corresponding Exam
            const Exam = mongoose.models.Exam || await import('../models/Exam').then(m => m.default);
            await Exam.findByIdAndUpdate(newRubric.exam, { rubric: newRubric._id });

            await writeAuditLog({
                user: context.actingUserId,
                action: 'RUBRIC_CREATED',
                outcome: 'SUCCESS',
                entityId: newRubric._id as mongoose.Types.ObjectId,
                entityType: 'Rubric',
                details: {
                    examId: newRubric.exam,
                    questionCount: newRubric.questions.length
                },
                ipAddress: context.ipAddress
            });

            return newRubric;
        } catch (error) {
            await writeAuditLog({
                user: context.actingUserId,
                action: 'RUBRIC_CREATED',
                outcome: 'FAILURE',
                entityType: 'Rubric',
                details: {
                    examId: data.exam,
                    error: error instanceof Error ? error.message : 'Unknown error'
                },
                ipAddress: context.ipAddress
            });
            throw error;
        }
    }

    async getRubricById(id: string, actingUserId?: string, actingUserRole?: string): Promise<IRubric | null> {
        return await RubricRepository.getRubricById(id, actingUserId, actingUserRole);
    }

    async getRubricByExamId(examId: string, actingUserId?: string, actingUserRole?: string): Promise<IRubric | null> {
        const exam = await ExamRepository.getExamById(examId, actingUserId, actingUserRole);
        if (!exam) {
            throw new HttpError('Exam not found or access denied', 404);
        }
        return await RubricRepository.getRubricByExamId(examId, actingUserId, actingUserRole);
    }

    async isRubricLocked(id: string): Promise<boolean> {
        return await RubricRepository.isRubricLocked(id);
    }

    async updateRubric(
        id: string,
        data: Partial<IRubric>,
        actingUserId: string,
        actingUserRole: string,
        context?: AuditContext
    ): Promise<IRubric | null> {
        if (actingUserRole !== 'ADMIN' && actingUserRole !== 'PROFESSOR') {
            throw new HttpError('Forbidden', 403);
        }

        // Fetch the current rubric to inspect its exam association and verify ownership
        const rubricBefore = await RubricRepository.getRubricById(id, actingUserId, actingUserRole);
        if (!rubricBefore) {
            throw new HttpError('Rubric not found or access denied', 404);
        }

        // Do not allow changing exam associated with the rubric via update
        delete data.exam;
        // Do not allow changing creator
        delete data.createdBy;

        const isLocked = await RubricRepository.isRubricLocked(id);
        if (isLocked) {
            throw new HttpError('Cannot update rubric: grading has already started for this exam', 400);
        }

        try {
            const updatedRubric = await RubricRepository.updateRubric(id, data, actingUserId, actingUserRole);

            if (updatedRubric && context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'RUBRIC_UPDATED',
                    outcome: 'SUCCESS',
                    entityId: updatedRubric._id as mongoose.Types.ObjectId,
                    entityType: 'Rubric',
                    details: {
                        examId: updatedRubric.exam,
                        questionCount: updatedRubric.questions?.length
                    },
                    ipAddress: context.ipAddress
                });
            }

            return updatedRubric;
        } catch (error) {
            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'RUBRIC_UPDATED',
                    outcome: 'FAILURE',
                    entityId: new mongoose.Types.ObjectId(id),
                    entityType: 'Rubric',
                    details: {
                        error: error instanceof Error ? error.message : 'Unknown error'
                    },
                    ipAddress: context.ipAddress
                });
            }
            throw error;
        }
    }
}

const rubricService = new RubricService();
export default rubricService;
