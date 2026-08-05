import ExamRepository from '../repositories/ExamRepository';
import { IExam } from '../models/Exam';
import mongoose from 'mongoose';
import { writeAuditLog } from '../lib/audit';

export interface AuditContext {
    actingUserId?: string;
    ipAddress?: string;
}

class ExamService {
    async createExam(data: Partial<IExam>, context?: AuditContext): Promise<IExam> {
        const newExam = await ExamRepository.createExam(data);

        if (context?.actingUserId) {
            await writeAuditLog({
                user: context.actingUserId,
                action: 'EXAM_CREATED',
                entityId: newExam._id as mongoose.Types.ObjectId,
                entityType: 'Exam',
                details: {
                    title: newExam.title,
                    course: newExam.course,
                    examDate: newExam.examDate,
                    totalMarks: newExam.totalMarks,
                    numberOfQuestions: newExam.numberOfQuestions
                },
                ipAddress: context.ipAddress
            });
        }

        return newExam;
    }

    async getAllExams(): Promise<IExam[]> {
        return await ExamRepository.getAllExams();
    }

    async getExamById(id: string): Promise<IExam | null> {
        return await ExamRepository.getExamById(id);
    }

    async updateExam(id: string, data: Partial<IExam>, context?: AuditContext): Promise<IExam | null> {
        const examBefore = await ExamRepository.getExamById(id);
        if (!examBefore) {
            return null;
        }

        const updatedExam = await ExamRepository.updateExam(id, data);

        if (updatedExam && context?.actingUserId) {
            const changedFields: string[] = [];
            if (data.title !== undefined && data.title !== examBefore.title) {
                changedFields.push('title');
            }
            if (data.course !== undefined && data.course.toString() !== examBefore.course.toString()) {
                changedFields.push('course');
            }
            if (data.examDate !== undefined && new Date(data.examDate).getTime() !== new Date(examBefore.examDate).getTime()) {
                changedFields.push('examDate');
            }
            if (data.totalMarks !== undefined && data.totalMarks !== examBefore.totalMarks) {
                changedFields.push('totalMarks');
            }
            if (data.status !== undefined && data.status !== examBefore.status) {
                changedFields.push('status');
            }
            if (data.numberOfQuestions !== undefined && data.numberOfQuestions !== examBefore.numberOfQuestions) {
                changedFields.push('numberOfQuestions');
            }
            if (data.isActive !== undefined && data.isActive !== examBefore.isActive) {
                changedFields.push('isActive');
            }

            await writeAuditLog({
                user: context.actingUserId,
                action: 'EXAM_UPDATED',
                entityId: updatedExam._id as mongoose.Types.ObjectId,
                entityType: 'Exam',
                details: {
                    title: updatedExam.title,
                    course: updatedExam.course,
                    changedFields
                },
                ipAddress: context.ipAddress
            });
        }

        return updatedExam;
    }

    async deleteExam(id: string, context?: AuditContext): Promise<IExam | null> {
        const examBefore = await ExamRepository.getExamById(id);
        if (!examBefore) {
            return null;
        }

        const deletedExam = await ExamRepository.deleteExam(id);

        if (deletedExam && context?.actingUserId) {
            await writeAuditLog({
                user: context.actingUserId,
                action: 'EXAM_DELETED',
                entityId: deletedExam._id as mongoose.Types.ObjectId,
                entityType: 'Exam',
                details: {
                    title: deletedExam.title,
                    course: deletedExam.course
                },
                ipAddress: context.ipAddress
            });
        }

        return deletedExam;
    }
}

const examService = new ExamService();
export default examService;
