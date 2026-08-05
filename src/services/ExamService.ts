import ExamRepository from '../repositories/ExamRepository';
import { IExam, ExamStatus } from '../models/Exam';
import mongoose from 'mongoose';
import { writeAuditLog } from '../lib/audit';
import StudentMapping, { IStudentMapping } from '../models/StudentMapping';
import User, { UserRole } from '../models/User';
import crypto from 'crypto';

export interface AuditContext {
    actingUserId?: string;
    ipAddress?: string;
}

class ExamService {
    async createExam(data: Partial<IExam>, context?: AuditContext): Promise<IExam> {
        try {
            // Force status to DRAFT on exam creation
            data.status = ExamStatus.DRAFT;
            const newExam = await ExamRepository.createExam(data);

            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'EXAM_CREATED',
                    outcome: 'SUCCESS',
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
        } catch (error) {
            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'EXAM_CREATED',
                    outcome: 'FAILURE',
                    entityType: 'Exam',
                    details: {
                        title: data.title,
                        course: data.course,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    },
                    ipAddress: context.ipAddress
                });
            }
            throw error;
        }
    }

    async getAllExams(actingUserId?: string, actingUserRole?: string): Promise<IExam[]> {
        const filter: mongoose.FilterQuery<IExam> = {};
        if (actingUserRole === 'PROFESSOR' && actingUserId) {
            filter.createdBy = new mongoose.Types.ObjectId(actingUserId);
        } else if (actingUserRole === 'STUDENT' && actingUserId) {
            filter.isActive = true;
            filter.status = ExamStatus.PUBLISHED;

            // Student mapping check
            const studentMappings = await StudentMapping.find({ student: actingUserId });
            const enrolledExamIds = studentMappings.map(m => m.exam);

            // Course enrollment check
            const Course = mongoose.models.Course || await import('../models/Course').then(m => m.default);
            const enrolledCourses = await Course.find({ enrolledStudents: new mongoose.Types.ObjectId(actingUserId), isActive: true });
            const enrolledCourseIds = enrolledCourses.map(c => c._id);

            filter.$or = [
                { _id: { $in: enrolledExamIds } },
                { course: { $in: enrolledCourseIds } }
            ];
        } else if (actingUserRole === 'TA' && actingUserId) {
            const Course = mongoose.models.Course || await import('../models/Course').then(m => m.default);
            const assignedCourses = await Course.find({ teachingAssistants: new mongoose.Types.ObjectId(actingUserId), isActive: true });
            const assignedCourseIds = assignedCourses.map(c => c._id);

            filter.course = { $in: assignedCourseIds };
        }
        return await ExamRepository.getAllExams(filter);
    }

    async getExamById(id: string, actingUserId?: string, actingUserRole?: string): Promise<IExam | null> {
        const exam = await ExamRepository.getExamById(id, actingUserId, actingUserRole);
        if (!exam) {
            if (actingUserRole === 'PROFESSOR' && actingUserId) {
                const Exam = mongoose.models.Exam || await import('../models/Exam').then(m => m.default);
                const existsGlobally = await Exam.exists({ _id: id, isActive: true });
                if (existsGlobally) {
                    await writeAuditLog({
                        user: actingUserId,
                        action: 'EXAM_ACCESS_DENIED',
                        outcome: 'FAILURE',
                        entityId: new mongoose.Types.ObjectId(id),
                        entityType: 'Exam',
                        details: { reason: 'Ownership check failed' }
                    });
                }
            }
            return null;
        }

        // Student draft and enrollment verification
        if (actingUserRole === 'STUDENT' && actingUserId) {
            if (exam.status !== ExamStatus.PUBLISHED) {
                return null;
            }

            const isMapped = await StudentMapping.exists({ exam: id, student: actingUserId });
            if (!isMapped) {
                const Course = mongoose.models.Course || await import('../models/Course').then(m => m.default);
                const isCourseEnrolled = await Course.exists({ _id: exam.course, enrolledStudents: actingUserId, isActive: true });
                if (!isCourseEnrolled) {
                    return null;
                }
            }
        }

        return exam;
    }

    async updateExam(
        id: string,
        data: Partial<IExam>,
        actingUserId: string,
        actingUserRole: string,
        context?: AuditContext
    ): Promise<IExam | null> {
        const examBefore = await ExamRepository.getExamById(id, actingUserId, actingUserRole);
        if (!examBefore) {
            if (actingUserRole === 'PROFESSOR' && actingUserId) {
                const Exam = mongoose.models.Exam || await import('../models/Exam').then(m => m.default);
                const existsGlobally = await Exam.exists({ _id: id, isActive: true });
                if (existsGlobally) {
                    await writeAuditLog({
                        user: actingUserId,
                        action: 'EXAM_UPDATE_DENIED',
                        outcome: 'FAILURE',
                        entityId: new mongoose.Types.ObjectId(id),
                        entityType: 'Exam',
                        details: { reason: 'Ownership check failed' },
                        ipAddress: context?.ipAddress
                    });
                }
            }
            return null;
        }

        // Prevent ownership changes through update APIs
        delete data.createdBy;

        // Validate status transition
        if (data.status !== undefined && data.status !== examBefore.status) {
            const { isValidTransition } = await import('../validations/examValidation');
            if (!isValidTransition(examBefore.status, data.status as ExamStatus)) {
                throw new Error(`Invalid status transition from ${examBefore.status} to ${data.status}`);
            }
        }

        try {
            const updatedExam = await ExamRepository.updateExam(id, data, actingUserId, actingUserRole);

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
                    outcome: 'SUCCESS',
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
        } catch (error) {
            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'EXAM_UPDATED',
                    outcome: 'FAILURE',
                    entityId: new mongoose.Types.ObjectId(id),
                    entityType: 'Exam',
                    details: {
                        error: error instanceof Error ? error.message : 'Unknown error'
                    },
                    ipAddress: context.ipAddress
                });
            }
            throw error;
        }
    }

    async deleteExam(
        id: string,
        actingUserId: string,
        actingUserRole: string,
        context?: AuditContext
    ): Promise<IExam | null> {
        const examBefore = await ExamRepository.getExamById(id, actingUserId, actingUserRole);
        if (!examBefore) {
            if (actingUserRole === 'PROFESSOR' && actingUserId) {
                const Exam = mongoose.models.Exam || await import('../models/Exam').then(m => m.default);
                const existsGlobally = await Exam.exists({ _id: id, isActive: true });
                if (existsGlobally) {
                    await writeAuditLog({
                        user: actingUserId,
                        action: 'EXAM_DELETE_DENIED',
                        outcome: 'FAILURE',
                        entityId: new mongoose.Types.ObjectId(id),
                        entityType: 'Exam',
                        details: { reason: 'Ownership check failed' },
                        ipAddress: context?.ipAddress
                    });
                }
            }
            return null;
        }

        try {
            const deletedExam = await ExamRepository.deleteExam(id, actingUserId, actingUserRole);

            if (deletedExam && context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'EXAM_DELETED',
                    outcome: 'SUCCESS',
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
        } catch (error) {
            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'EXAM_DELETED',
                    outcome: 'FAILURE',
                    entityId: new mongoose.Types.ObjectId(id),
                    entityType: 'Exam',
                    details: {
                        error: error instanceof Error ? error.message : 'Unknown error'
                    },
                    ipAddress: context.ipAddress
                });
            }
            throw error;
        }
    }

    async enrollStudents(examId: string, studentIds: string[], context?: AuditContext): Promise<IStudentMapping[] | null> {
        const exam = await ExamRepository.getExamById(examId);
        if (!exam) {
            return null;
        }

        // Validate studentIds exist and have STUDENT role
        const students = await User.find({ _id: { $in: studentIds }, role: UserRole.STUDENT, isActive: true });
        if (students.length !== studentIds.length) {
            throw new Error("One or more user IDs do not exist or are not active students");
        }

        // Find existing mappings for this exam
        const existingMappings = await StudentMapping.find({ exam: examId, student: { $in: studentIds } });
        const enrolledStudentIds = new Set(existingMappings.map(m => m.student.toString()));

        const createdMappings: IStudentMapping[] = [];

        // Helper to generate a unique anonymousId for the exam
        const generateAnonId = async (): Promise<string> => {
            while (true) {
                const anonId = `ANON-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
                const exists = await StudentMapping.findOne({ exam: examId, anonymousId: anonId });
                if (!exists) return anonId;
            }
        };

        for (const sid of studentIds) {
            if (!enrolledStudentIds.has(sid)) {
                const anonymousId = await generateAnonId();
                const mapping = new StudentMapping({
                    exam: new mongoose.Types.ObjectId(examId),
                    student: new mongoose.Types.ObjectId(sid),
                    anonymousId,
                    isVerified: false
                });
                await mapping.save();
                createdMappings.push(mapping);
            }
        }

        if (createdMappings.length > 0 && context?.actingUserId) {
            await writeAuditLog({
                user: context.actingUserId,
                action: 'EXAM_ENROLLED',
                entityId: exam._id as mongoose.Types.ObjectId,
                entityType: 'Exam',
                details: {
                    title: exam.title,
                    course: exam.course,
                    enrolledStudentCount: createdMappings.length,
                    studentIds: createdMappings.map(m => m.student.toString())
                },
                ipAddress: context.ipAddress
            });
        }

        return await StudentMapping.find({ exam: examId }).populate('student', 'name email role');
    }

    async getEnrolledStudents(examId: string): Promise<IStudentMapping[]> {
        return await StudentMapping.find({ exam: examId }).populate('student', 'name email role');
    }
}

const examService = new ExamService();
export default examService;
