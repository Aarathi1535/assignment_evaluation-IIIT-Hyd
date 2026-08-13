import ExamRepository from '../repositories/ExamRepository';
import Exam, { IExam, ExamStatus } from '../models/Exam';
import mongoose from 'mongoose';
import { writeAuditLog } from '../lib/audit';
import StudentMapping, { IStudentMapping } from '../models/StudentMapping';
import User, { UserRole, IUser } from '../models/User';
import crypto from 'crypto';
import { HttpError, isDuplicateKeyError } from '../lib/errors';
import { normalizeRollNumber } from '../utils/studentMappingUtils';

export interface AuditContext {
    actingUserId?: string;
    actingUserRole?: string;
    ipAddress?: string;
}

export interface EnrollContext extends AuditContext {
    rollNumbers?: Record<string, string | null | undefined>;
}

class ExamService {
    async createExam(data: Partial<IExam>, context?: AuditContext): Promise<IExam> {
        if (data.course && context?.actingUserId) {
            const CourseRepository = (await import('../repositories/CourseRepository')).default;
            const course = await CourseRepository.getCourseById(
                data.course.toString(),
                context.actingUserId,
                context.actingUserRole
            );
            if (!course) {
                throw new HttpError('Course not found', 404);
            }
        }
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
            if (isDuplicateKeyError(error)) {
                throw new HttpError('Exam already exists', 409);
            }
            throw error;
        }
    }

    async getAllExams(actingUserId?: string, actingUserRole?: string): Promise<IExam[]> {
        const filter: mongoose.QueryFilter<IExam> = {};
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

        // Validate course if moving the exam onto another course
        if (data.course) {
            const CourseRepository = (await import('../repositories/CourseRepository')).default;
            const course = await CourseRepository.getCourseById(
                data.course.toString(),
                actingUserId,
                actingUserRole
            );
            if (!course) {
                throw new HttpError('Course not found', 404);
            }
        }

        // Prevent ownership changes through update APIs
        delete data.createdBy;

        // Validate status transition
        if (data.status !== undefined && data.status !== examBefore.status) {
            const { isValidTransition } = await import('../validations/examValidation');
            if (!isValidTransition(examBefore.status, data.status as ExamStatus)) {
                throw new HttpError(`Invalid status transition from ${examBefore.status} to ${data.status}`, 400);
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

    async enrollStudents(
        examId: string,
        studentIds: string[],
        actingUserId: string,
        actingUserRole: string,
        context?: EnrollContext
    ): Promise<IStudentMapping[] | null> {
        try {
            if (!mongoose.Types.ObjectId.isValid(examId)) {
                throw new HttpError("Invalid Exam ID format", 400);
            }

            const exam = await ExamRepository.getExamById(examId, actingUserId, actingUserRole);
            if (!exam) {
                const existsGlobally = await Exam.exists({ _id: examId, isActive: true });
                if (existsGlobally) {
                    if (context?.actingUserId) {
                        await writeAuditLog({
                            user: context.actingUserId,
                            action: 'STUDENTS_ENROLLED_TO_EXAM',
                            outcome: 'FAILURE',
                            entityId: new mongoose.Types.ObjectId(examId),
                            entityType: 'Exam',
                            details: { reason: 'Ownership check failed', studentIds },
                            ipAddress: context.ipAddress
                        });
                    }
                }
                return null;
            }

            // Validate studentIds exist, are active, and have STUDENT role
            const foundUsers = await User.find({ _id: { $in: studentIds } });
            const foundUsersMap = new Map(foundUsers.map(u => [u._id.toString(), u]));

            for (const sid of studentIds) {
                if (!mongoose.Types.ObjectId.isValid(sid)) {
                    throw new HttpError(`Invalid student ID format: ${sid}`, 400);
                }
                const user = foundUsersMap.get(sid);
                if (!user) {
                    throw new HttpError(`Nonexistent user: ${sid}`, 400);
                }
                if (user.role !== UserRole.STUDENT) {
                    throw new HttpError(`Non-STUDENT user: ${user.name}`, 400);
                }
                if (!user.isActive) {
                    throw new HttpError(`Inactive user: ${user.name}`, 400);
                }
            }

            const uniqueStudentIds = Array.from(new Set(studentIds));

            // Find existing mappings for this exam
            const existingMappings = await StudentMapping.find({ exam: examId, student: { $in: uniqueStudentIds } });
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

            for (const sid of uniqueStudentIds) {
                const rawRoll = context?.rollNumbers?.[sid];
                const normalizedRoll = rawRoll !== undefined ? normalizeRollNumber(rawRoll) : null;

                if (!enrolledStudentIds.has(sid)) {
                    try {
                        const anonymousId = await generateAnonId();
                        const mapping = new StudentMapping({
                            exam: new mongoose.Types.ObjectId(examId),
                            student: new mongoose.Types.ObjectId(sid),
                            anonymousId,
                            rollNumber: normalizedRoll,
                            isVerified: false
                        });
                        await mapping.save();
                        createdMappings.push(mapping);
                    } catch (err: unknown) {
                        if (isDuplicateKeyError(err)) {
                            throw new HttpError('Roll number already exists for this exam', 409);
                        }
                        throw err;
                    }
                } else if (context?.rollNumbers && sid in context.rollNumbers) {
                    try {
                        await StudentMapping.updateOne(
                            { exam: examId, student: sid },
                            { $set: { rollNumber: normalizedRoll } },
                            { runValidators: true }
                        );
                    } catch (err: unknown) {
                        if (isDuplicateKeyError(err)) {
                            throw new HttpError('Roll number already exists for this exam', 409);
                        }
                        throw err;
                    }
                }
            }

            // Store enrolled student roster directly on the Exam document as well atomically
            await Exam.findOneAndUpdate(
                { _id: examId, isActive: true },
                { $addToSet: { enrolledStudents: { $each: uniqueStudentIds.map(sid => new mongoose.Types.ObjectId(sid)) } } },
                { new: true }
            );

            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'STUDENTS_ENROLLED_TO_EXAM',
                    outcome: 'SUCCESS',
                    entityId: exam._id as mongoose.Types.ObjectId,
                    entityType: 'Exam',
                    details: {
                        title: exam.title,
                        course: exam.course,
                        enrolledStudentCount: uniqueStudentIds.length,
                        studentIds: uniqueStudentIds
                    },
                    ipAddress: context.ipAddress
                });
            }

            return await StudentMapping.find({ exam: examId }).populate('student', 'name email role isActive');
        } catch (error) {
            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'STUDENTS_ENROLLED_TO_EXAM',
                    outcome: 'FAILURE',
                    entityId: mongoose.Types.ObjectId.isValid(examId) ? new mongoose.Types.ObjectId(examId) : undefined,
                    entityType: 'Exam',
                    details: {
                        studentIds,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    },
                    ipAddress: context.ipAddress
                });
            }
            throw error;
        }
    }

    async getEnrolledStudents(
        examId: string,
        actingUserId: string,
        actingUserRole: string
    ): Promise<IStudentMapping[] | null> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            return null;
        }

        const exam = await ExamRepository.getExamById(examId, actingUserId, actingUserRole);
        if (!exam) {
            const existsGlobally = await Exam.exists({ _id: examId, isActive: true });
            if (existsGlobally) {
                await writeAuditLog({
                    user: actingUserId,
                    action: 'EXAM_ROSTER_ACCESS_DENIED',
                    outcome: 'FAILURE',
                    entityId: new mongoose.Types.ObjectId(examId),
                    entityType: 'Exam',
                    details: { reason: 'Ownership check failed' }
                });
            }
            return null;
        }

        return await StudentMapping.find({ exam: examId }).populate('student', 'name email role isActive');
    }

    /**
     * Exam-scoped roster lookup by student roll number.
     * Enforces existing owner-scoped exam access pattern.
     */
    async getStudentMappingByRollNumber(
        examId: string,
        rollNumber: string,
        actingUserId: string,
        actingUserRole: string
    ): Promise<IStudentMapping | null> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            return null;
        }

        const normalized = normalizeRollNumber(rollNumber);
        if (!normalized) {
            return null;
        }

        const exam = await ExamRepository.getExamById(examId, actingUserId, actingUserRole);
        if (!exam) {
            const existsGlobally = await Exam.exists({ _id: examId, isActive: true });
            if (existsGlobally) {
                await writeAuditLog({
                    user: actingUserId,
                    action: 'EXAM_ROSTER_ACCESS_DENIED',
                    outcome: 'FAILURE',
                    entityId: new mongoose.Types.ObjectId(examId),
                    entityType: 'Exam',
                    details: { reason: 'Ownership check failed for rollNumber lookup', rollNumber: normalized }
                });
            }
            return null;
        }

        return await StudentMapping.findOne({
            exam: exam._id,
            rollNumber: normalized
        }).populate('student', 'name email role isActive');
    }

    /**
     * Exam-scoped roster lookup supporting lookup by rollNumber, name, or email.
     * Enforces existing owner-scoped exam access pattern.
     */
    async searchExamRoster(
        examId: string,
        query: string,
        actingUserId: string,
        actingUserRole: string
    ): Promise<IStudentMapping[]> {
        if (!mongoose.Types.ObjectId.isValid(examId)) {
            return [];
        }

        const exam = await ExamRepository.getExamById(examId, actingUserId, actingUserRole);
        if (!exam) {
            const existsGlobally = await Exam.exists({ _id: examId, isActive: true });
            if (existsGlobally) {
                await writeAuditLog({
                    user: actingUserId,
                    action: 'EXAM_ROSTER_ACCESS_DENIED',
                    outcome: 'FAILURE',
                    entityId: new mongoose.Types.ObjectId(examId),
                    entityType: 'Exam',
                    details: { reason: 'Ownership check failed for roster search', query }
                });
            }
            return [];
        }

        const trimmedQuery = query.trim();
        if (!trimmedQuery) {
            return [];
        }

        // 1. Try resolving mapping by normalized rollNumber
        const normalizedRoll = normalizeRollNumber(trimmedQuery);
        if (normalizedRoll) {
            const byRoll = await StudentMapping.find({
                exam: exam._id,
                rollNumber: normalizedRoll
            }).populate('student', 'name email role isActive');
            if (byRoll.length > 0) {
                return byRoll;
            }
        }

        // 2. Fetch all mappings for the exam to perform name or email lookup
        const allMappings = await StudentMapping.find({ exam: exam._id }).populate('student', 'name email role isActive');
        
        // Filter mappings where student's name or email contains the query case-insensitively
        const queryLower = trimmedQuery.toLowerCase();
        return allMappings.filter(m => {
            const studentUser = m.student as unknown as (IUser | null);
            if (!studentUser) return false;
            
            const nameMatch = studentUser.name?.toLowerCase().includes(queryLower);
            const emailMatch = studentUser.email?.toLowerCase().includes(queryLower);
            return nameMatch || emailMatch;
        });
    }
}

const examService = new ExamService();
export default examService;

