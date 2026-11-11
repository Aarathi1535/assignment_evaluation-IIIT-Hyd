import ExamRepository, { shapeExamForStudent } from '../repositories/ExamRepository';
import Exam, { IExam, ExamStatus } from '../models/Exam';
import mongoose from 'mongoose';
import { writeAuditLog } from '../lib/audit';
import StudentMapping, { IStudentMapping } from '../models/StudentMapping';
import AnswerScript from '../models/AnswerScript';
import User, { UserRole, IUser } from '../models/User';
import crypto from 'crypto';
import { HttpError, isDuplicateKeyError } from '../lib/errors';
import { isTransactionCapable } from '../lib/db';
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
        if (data.gradingDeadline && data.examDate) {
            if (new Date(data.gradingDeadline).getTime() < new Date(data.examDate).getTime()) {
                throw new HttpError('Grading deadline cannot be before exam date', 400);
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
            const enrolledExamIds = new Set(studentMappings.map(m => m.exam.toString()));
            const assignedScriptExamIds = await AnswerScript.distinct('exam', {
                student: new mongoose.Types.ObjectId(actingUserId),
                isActive: true
            });
            for (const examId of assignedScriptExamIds) {
                enrolledExamIds.add(examId.toString());
            }

            // Course enrollment check
            const Course = mongoose.models.Course || await import('../models/Course').then(m => m.default);
            const enrolledCourses = await Course.find({ enrolledStudents: new mongoose.Types.ObjectId(actingUserId), isActive: true });
            const enrolledCourseIds = enrolledCourses.map(c => c._id);

            filter.$or = [
                { _id: { $in: Array.from(enrolledExamIds, id => new mongoose.Types.ObjectId(id)) } },
                { course: { $in: enrolledCourseIds } }
            ];
        } else if (actingUserRole === 'TA' && actingUserId) {
            const Course = mongoose.models.Course || await import('../models/Course').then(m => m.default);
            const assignedCourses = await Course.find({ teachingAssistants: new mongoose.Types.ObjectId(actingUserId), isActive: true });
            const assignedCourseIds = assignedCourses.map(c => c._id);

            filter.course = { $in: assignedCourseIds };
        }
        const exams = await ExamRepository.getAllExams(filter);
        if (actingUserRole === 'STUDENT') {
            return exams.map(shapeExamForStudent) as unknown as IExam[];
        }
        return exams;
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

            const [isMapped, hasAssignedScript] = await Promise.all([
                StudentMapping.exists({ exam: id, student: actingUserId }),
                AnswerScript.exists({
                    exam: id,
                    student: actingUserId,
                    isActive: true
                })
            ]);
            if (!isMapped && !hasAssignedScript) {
                const Course = mongoose.models.Course || await import('../models/Course').then(m => m.default);
                const isCourseEnrolled = await Course.exists({ _id: exam.course, enrolledStudents: actingUserId, isActive: true });
                if (!isCourseEnrolled) {
                    return null;
                }
            }

            return shapeExamForStudent(exam) as unknown as IExam;
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
                if (examBefore.status === ExamStatus.PUBLISHED && (data.status === ExamStatus.REVIEW_PENDING || String(data.status).toUpperCase() === 'REVIEW_PENDING')) {
                    throw new HttpError(
                        'Invalid status transition: Direct status update to REVIEW_PENDING from PUBLISHED is not allowed. Use POST /api/exams/[id]/unpublish to unpublish exam results.',
                        400
                    );
                }
                throw new HttpError(`Invalid status transition from ${examBefore.status} to ${data.status}`, 400);
            }

            if (data.status === ExamStatus.PUBLISHED || String(data.status).toUpperCase() === 'PUBLISHED') {
                return await this.publishExam(id, actingUserId, actingUserRole, context);
            }
        }

        // Validate gradingDeadline rules (freeze rule on grading commencement and chronology against examDate)
        if (data.gradingDeadline !== undefined) {
            const { AllocationService } = await import('./AllocationService');
            try {
                await AllocationService.checkGradingCommenced(new mongoose.Types.ObjectId(id));
            } catch {
                throw new HttpError('Cannot update grading deadline: grading has already commenced for this exam', 400);
            }

            if (data.gradingDeadline !== null) {
                const effectiveExamDate = data.examDate !== undefined ? new Date(data.examDate) : new Date(examBefore.examDate);
                if (new Date(data.gradingDeadline).getTime() < effectiveExamDate.getTime()) {
                    throw new HttpError('Grading deadline cannot be before exam date', 400);
                }
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
                if (data.omrTemplate !== undefined) {
                    changedFields.push('omrTemplate');
                }
                if (data.gradingDeadline !== undefined) {
                    changedFields.push('gradingDeadline');
                }
                if (data.studentDownloadPolicy !== undefined && data.studentDownloadPolicy !== examBefore.studentDownloadPolicy) {
                    changedFields.push('studentDownloadPolicy');
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
        context?: EnrollContext,
        replaceRoster = false
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
                        enrolledStudentIds.add(sid);
                    } catch (err: unknown) {
                        if (isDuplicateKeyError(err)) {
                            const concurrentMapping = await StudentMapping.findOne({ exam: examId, student: sid });
                            if (!concurrentMapping) {
                                throw new HttpError('Roll number already exists for this exam', 409);
                            }
                            enrolledStudentIds.add(sid);
                            if (context?.rollNumbers && sid in context.rollNumbers) {
                                await StudentMapping.updateOne(
                                    { exam: examId, student: sid },
                                    { $set: { rollNumber: normalizedRoll } },
                                    { runValidators: true }
                                );
                            }
                        } else {
                            throw err;
                        }
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

            if (replaceRoster) {
                await StudentMapping.deleteMany({
                    exam: examId,
                    student: { $nin: uniqueStudentIds.map(sid => new mongoose.Types.ObjectId(sid)) }
                });
            }

            // Remove the legacy mirror; StudentMapping is the sole exam-roster source.
            await Exam.collection.updateOne(
                { _id: new mongoose.Types.ObjectId(examId), isActive: true },
                { $unset: { enrolledStudents: '' } }
            );

            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: replaceRoster ? 'EXAM_ROSTER_REPLACED' : 'STUDENTS_ENROLLED_TO_EXAM',
                    outcome: 'SUCCESS',
                    entityId: exam._id as mongoose.Types.ObjectId,
                    entityType: 'Exam',
                    details: {
                        title: exam.title,
                        course: exam.course,
                        enrolledStudentCount: replaceRoster
                            ? uniqueStudentIds.length
                            : (await StudentMapping.countDocuments({ exam: examId })),
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
                    action: replaceRoster ? 'EXAM_ROSTER_REPLACED' : 'STUDENTS_ENROLLED_TO_EXAM',
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

    async getPublishPreview(
        id: string,
        actingUserId: string,
        actingUserRole: string
    ): Promise<{
        totalEnrolled: number;
        readyToRelease: number;
        notReady: number;
        openFlags: number;
        warnings: string[];
    }> {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new HttpError('Invalid ID format', 400);
        }

        const exam = await ExamRepository.getExamById(id, actingUserId, actingUserRole);
        if (!exam) {
            throw new HttpError('Exam not found', 404);
        }

        const StudentMapping = mongoose.models.StudentMapping || (await import('../models/StudentMapping')).default;
        const AnswerScript = mongoose.models.AnswerScript || (await import('../models/AnswerScript')).default;
        const Grade = mongoose.models.Grade || (await import('../models/Grade')).default;
        const ScriptFlagModule = await import('../models/ScriptFlag');
        const ScriptFlag = mongoose.models.ScriptFlag || ScriptFlagModule.default;

        const totalEnrolled = await StudentMapping.countDocuments({ exam: exam._id });
        const openFlags = await ScriptFlag.countDocuments({
            exam: exam._id,
            status: ScriptFlagModule.FlagStatus.OPEN
        });

        const scripts = await AnswerScript.find({ exam: exam._id, isActive: true });
        const scriptIds = scripts.map((s: { _id: unknown }) => s._id);

        const scriptsWithOpenFlags = await ScriptFlag.distinct('answerScript', {
            exam: exam._id,
            status: ScriptFlagModule.FlagStatus.OPEN
        });
        const openFlagScriptIdSet = new Set(scriptsWithOpenFlags.map((sid: unknown) => String(sid)));

        const finalGrades = await Grade.find({
            answerScript: { $in: scriptIds },
            isFinal: true
        });
        const finalGradeScriptIdSet = new Set(finalGrades.map((g: { answerScript: unknown }) => String(g.answerScript)));

        let readyToRelease = 0;
        let notReady = 0;

        for (const script of scripts) {
            const sId = String(script._id);
            const hasFinalGrade = finalGradeScriptIdSet.has(sId);
            const hasOpenFlag = openFlagScriptIdSet.has(sId);

            if (hasFinalGrade && !hasOpenFlag) {
                readyToRelease++;
            } else {
                notReady++;
            }
        }

        if (totalEnrolled > scripts.length) {
            notReady += (totalEnrolled - scripts.length);
        }

        const warnings: string[] = [];
        if (openFlags > 0) {
            warnings.push(`${openFlags} open flag(s) must be resolved or escalated before publication.`);
        }
        if (notReady > 0) {
            warnings.push(`${notReady} student(s) do not have final grades and will receive NOT_AVAILABLE status.`);
        }

        return {
            totalEnrolled,
            readyToRelease,
            notReady,
            openFlags,
            warnings
        };
    }

    async publishExam(
        id: string,
        actingUserId: string,
        actingUserRole: string,
        context?: { ipAddress?: string }
    ): Promise<IExam> {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new HttpError('Invalid ID format', 400);
        }

        const examBefore = await ExamRepository.getExamById(id, actingUserId, actingUserRole);
        if (!examBefore) {
            throw new HttpError('Exam not found', 404);
        }

        if (!examBefore.isActive) {
            throw new HttpError('Cannot publish inactive exam', 400);
        }

        // Idempotent: If already published, re-run notification dispatch (idempotent step) and return
        if (examBefore.status === ExamStatus.PUBLISHED) {
            try {
                await this.notifyStudentsOnExamPublish(examBefore);
            } catch (notifyErr) {
                console.error('Failed to dispatch student publication notifications on retry:', notifyErr);
            }
            return examBefore;
        }

        // Status check: only REVIEW_PENDING exams can be published
        if (examBefore.status !== ExamStatus.REVIEW_PENDING) {
            throw new HttpError(
                `Cannot publish exam in status '${examBefore.status}'. Only exams in 'REVIEW_PENDING' status can be published.`,
                409
            );
        }

        // AE-164: Check for OPEN flags that block publication
        const ScriptFlagModule = await import('../models/ScriptFlag');
        const ScriptFlag = mongoose.models.ScriptFlag || ScriptFlagModule.default;
        const openFlagCount = await ScriptFlag.countDocuments({
            exam: new mongoose.Types.ObjectId(id),
            status: ScriptFlagModule.FlagStatus.OPEN
        });
        if (openFlagCount > 0) {
            throw new HttpError(
                `Cannot publish exam: There are ${openFlagCount} open flag(s) that must be resolved or escalated first`,
                400
            );
        }

        const publishedAt = new Date();
        const publishedBy = new mongoose.Types.ObjectId(actingUserId);

        const transactionCapable = isTransactionCapable();
        const session = transactionCapable ? await mongoose.startSession() : null;
        if (session) {
            session.startTransaction();
        }

        try {
            // Atomic update: only transitions if status is currently REVIEW_PENDING
            const updatedExam = await Exam.findOneAndUpdate(
                {
                    _id: new mongoose.Types.ObjectId(id),
                    isActive: true,
                    status: ExamStatus.REVIEW_PENDING
                },
                {
                    $set: {
                        status: ExamStatus.PUBLISHED,
                        publishedBy,
                        publishedAt,
                        unpublishedBy: null,
                        unpublishedAt: null
                    }
                },
                { returnDocument: 'after', session: session || undefined }
            );

            if (!updatedExam) {
                const current = await Exam.findById(id);
                if (current && current.status === ExamStatus.PUBLISHED) {
                    if (session) await session.abortTransaction();
                    try {
                        await this.notifyStudentsOnExamPublish(current);
                    } catch (notifyErr) {
                        console.error('Failed to dispatch student publication notifications on retry:', notifyErr);
                    }
                    return current;
                }
                throw new HttpError(
                    `Cannot publish exam in status '${current?.status || 'UNKNOWN'}'. Only exams in 'REVIEW_PENDING' status can be published.`,
                    409
                );
            }

            const auditSuccess = await writeAuditLog({
                user: new mongoose.Types.ObjectId(actingUserId),
                action: 'EXAM_PUBLISHED',
                outcome: 'SUCCESS',
                entityId: updatedExam._id as mongoose.Types.ObjectId,
                entityType: 'Exam',
                details: {
                    title: updatedExam.title,
                    course: updatedExam.course,
                    publishedBy,
                    publishedAt
                },
                ipAddress: context?.ipAddress,
                session: session || undefined
            });

            if (!auditSuccess) {
                throw new HttpError('Failed to record audit log for exam publication', 500);
            }

            if (session) {
                await session.commitTransaction();
            }

            // AE-192: Dispatch student publication notifications non-blockingly
            try {
                await this.notifyStudentsOnExamPublish(updatedExam);
            } catch (notifyErr) {
                console.error('Failed to dispatch student publication notifications:', notifyErr);
                // Publication status must not be affected by notification failure
            }

            return updatedExam;
        } catch (error) {
            if (session) {
                try {
                    await session.abortTransaction();
                } catch {
                    // Ignore abort error
                }
            } else {
                // Fail-closed compensation if standalone
                await Exam.findByIdAndUpdate(id, {
                    $set: {
                        status: ExamStatus.REVIEW_PENDING,
                        publishedBy: null,
                        publishedAt: null
                    }
                });
            }
            throw error;
        } finally {
            if (session) {
                session.endSession();
            }
        }
    }
    /**
     * Dispatches publication notifications to all eligible students (AE-192).
     *
     * Hardened according to mentor review:
     * 1. Release rule: ONLY students whose script has a finalized grade AND no OPEN flags are notified.
     *    Students with no script, an unfinalized grade, or an open flag receive NOT_AVAILABLE results
     *    and must NOT be notified.
     * 2. Checks feature flag isStudentResultsEnabled(): if disabled, skips notifying immediately.
     * 3. Prevents duplicate notifications on retry via partial unique index on { exam, recipient, type }
     *    and atomic upsert ($setOnInsert).
     * 4. Dispatches stub emails concurrently via Promise.allSettled and logs studentId (not email).
     * 5. Non-blocking: failures must never roll back publication status.
     */
    async notifyStudentsOnExamPublish(exam: IExam): Promise<{ notifiedCount: number; skippedCount: number }> {
        // 1. Check feature flag
        const { isStudentResultsEnabled } = await import('../config/env');
        if (!isStudentResultsEnabled()) {
            return { notifiedCount: 0, skippedCount: 0 };
        }

        // 2. Identify active scripts for this exam
        const AnswerScript = mongoose.models.AnswerScript || (await import('../models/AnswerScript')).default;
        const Grade = mongoose.models.Grade || (await import('../models/Grade')).default;
        const ScriptFlagModule = await import('../models/ScriptFlag');
        const ScriptFlag = mongoose.models.ScriptFlag || ScriptFlagModule.default;

        const scripts = await AnswerScript.find({ exam: exam._id, isActive: true });
        if (scripts.length === 0) {
            return { notifiedCount: 0, skippedCount: 0 };
        }

        const scriptIds = scripts.map((s: { _id: unknown }) => s._id);

        // Find scripts that have open flags
        const scriptsWithOpenFlags = await ScriptFlag.distinct('answerScript', {
            answerScript: { $in: scriptIds },
            status: ScriptFlagModule.FlagStatus.OPEN
        });
        const openFlagScriptIdSet = new Set(scriptsWithOpenFlags.map((sid: unknown) => String(sid)));

        // Find scripts that have finalized grades
        const finalGrades = await Grade.find({
            answerScript: { $in: scriptIds },
            isFinal: true
        });
        const finalGradeScriptIdSet = new Set(finalGrades.map((g: { answerScript: unknown }) => String(g.answerScript)));

        // Only students whose script is final and has no open flags
        const candidateStudentIdSet = new Set<string>();
        for (const script of scripts) {
            const sId = String(script._id);
            if (finalGradeScriptIdSet.has(sId) && !openFlagScriptIdSet.has(sId)) {
                if (script.student) {
                    candidateStudentIdSet.add(script.student.toString());
                }
            }
        }

        if (candidateStudentIdSet.size === 0) {
            return { notifiedCount: 0, skippedCount: 0 };
        }

        // 3. Filter only eligible active student users
        const candidateObjectIds = Array.from(candidateStudentIdSet).map(id => new mongoose.Types.ObjectId(id));
        const eligibleStudents = await User.find({
            _id: { $in: candidateObjectIds },
            role: UserRole.STUDENT,
            isActive: true
        });

        if (eligibleStudents.length === 0) {
            return { notifiedCount: 0, skippedCount: 0 };
        }

        // 4. Find already notified students to report skipped count
        const Notification = (await import('../models/Notification')).default;
        const { NotificationType } = await import('../models/Notification');
        const existingNotifications = await Notification.find({
            exam: exam._id,
            type: NotificationType.PUBLISH
        });
        const alreadyNotifiedSet = new Set(existingNotifications.map(n => n.recipient.toString()));

        const studentsToNotify = eligibleStudents.filter(s => !alreadyNotifiedSet.has(s._id.toString()));
        const skippedCount = eligibleStudents.length - studentsToNotify.length;

        if (studentsToNotify.length === 0) {
            return { notifiedCount: 0, skippedCount };
        }

        // 5. Render notification template
        const { renderPublishTemplate } = await import('../templates/notificationTemplates');
        const rendered = renderPublishTemplate({
            exam: exam._id,
            examTitle: exam.title,
            publishedAt: exam.publishedAt || new Date()
        });

        // 6. Upsert in-app notifications concurrently
        const notifyPromises = studentsToNotify.map(async (student) => {
            return Notification.updateOne(
                {
                    exam: exam._id,
                    recipient: student._id,
                    type: NotificationType.PUBLISH
                },
                {
                    $setOnInsert: {
                        exam: exam._id,
                        recipient: student._id,
                        type: NotificationType.PUBLISH,
                        title: rendered.title,
                        message: rendered.message,
                        read: false
                    }
                },
                { upsert: true }
            );
        });

        await Promise.allSettled(notifyPromises);

        // 7. Dispatch stub email notifications concurrently via emailAdapter
        const { emailAdapter } = await import('../lib/emailAdapter');
        const emailPromises = studentsToNotify.map(async (student) => {
            if (student.email) {
                try {
                    await emailAdapter.sendMail({
                        to: student.email,
                        subject: rendered.title,
                        text: `${rendered.message}\nYou can view your evaluated script and feedback in the student portal.`
                    });
                } catch (emailErr) {
                    console.error(`Failed to send publication email stub to student ${student._id}:`, emailErr);
                }
            }
        });

        await Promise.allSettled(emailPromises);

        return { notifiedCount: studentsToNotify.length, skippedCount };
    }
    /**
     * Unpublishes a published exam, reverting status to REVIEW_PENDING with full audit trail (AE-193).
     *
     * State and access implications:
     * - Status reverts from PUBLISHED to REVIEW_PENDING.
     * - Students immediately lose access to all result views, downloads, annotations, and API endpoints (returning 404).
     * - Open regrade requests remain open in the database but are hidden/inaccessible to students while unpublished.
     * - Note on local exports: PDFs previously downloaded by students cannot be recalled from their local drives;
     *   unpublishing immediately prevents any further downloads, images, or export requests.
     * - Recorded actor and timestamp (unpublishedBy, unpublishedAt) are audited with fail-closed guarantees.
     * - On non-PUBLISHED statuses: returns 409 Conflict (or idempotent return if already REVIEW_PENDING).
     */
    async unpublishExam(
        id: string,
        actingUserId: string,
        actingUserRole: string,
        context?: { ipAddress?: string }
    ): Promise<IExam> {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new HttpError('Invalid ID format', 400);
        }

        const examBefore = await ExamRepository.getExamById(id, actingUserId, actingUserRole);
        if (!examBefore) {
            throw new HttpError('Exam not found', 404);
        }

        if (!examBefore.isActive) {
            throw new HttpError('Cannot unpublish inactive exam', 400);
        }

        // Idempotent: If already in REVIEW_PENDING, return without duplicate side effects
        if (examBefore.status === ExamStatus.REVIEW_PENDING) {
            return examBefore;
        }

        // Status check: only PUBLISHED exams can be unpublished
        if (examBefore.status !== ExamStatus.PUBLISHED) {
            throw new HttpError(
                `Cannot unpublish exam in status '${examBefore.status}'. Only exams in 'PUBLISHED' status can be unpublished.`,
                409
            );
        }

        const unpublishedAt = new Date();
        const unpublishedBy = new mongoose.Types.ObjectId(actingUserId);

        const transactionCapable = isTransactionCapable();
        const session = transactionCapable ? await mongoose.startSession() : null;
        if (session) {
            session.startTransaction();
        }

        try {
            const updatedExam = await Exam.findOneAndUpdate(
                {
                    _id: new mongoose.Types.ObjectId(id),
                    isActive: true,
                    status: ExamStatus.PUBLISHED
                },
                {
                    $set: {
                        status: ExamStatus.REVIEW_PENDING,
                        unpublishedBy,
                        unpublishedAt
                    }
                },
                { returnDocument: 'after', session: session || undefined }
            );

            if (!updatedExam) {
                const current = await Exam.findById(id);
                if (current && current.status === ExamStatus.REVIEW_PENDING) {
                    if (session) await session.abortTransaction();
                    return current;
                }
                throw new HttpError(
                    `Cannot unpublish exam in status '${current?.status || 'UNKNOWN'}'. Only exams in 'PUBLISHED' status can be unpublished.`,
                    409
                );
            }

            const auditSuccess = await writeAuditLog({
                user: unpublishedBy,
                action: 'EXAM_UNPUBLISHED',
                outcome: 'SUCCESS',
                entityId: updatedExam._id as mongoose.Types.ObjectId,
                entityType: 'Exam',
                details: {
                    title: updatedExam.title,
                    course: updatedExam.course,
                    publishedBy: updatedExam.publishedBy,
                    publishedAt: updatedExam.publishedAt,
                    unpublishedBy,
                    unpublishedAt
                },
                ipAddress: context?.ipAddress,
                session: session || undefined
            });

            if (!auditSuccess) {
                throw new HttpError('Failed to record audit log for exam unpublication', 500);
            }

            if (session) {
                await session.commitTransaction();
            }

            return updatedExam;
        } catch (error) {
            if (session) {
                try {
                    await session.abortTransaction();
                } catch {
                    // Ignore abort error
                }
            } else {
                // Fail-closed compensation if standalone
                await Exam.findByIdAndUpdate(id, {
                    $set: {
                        status: ExamStatus.PUBLISHED,
                        unpublishedBy: null,
                        unpublishedAt: null
                    }
                });
            }
            throw error;
        }
    }
    async updateRegradeWindow(
        id: string,
        opensAt: Date | null,
        closesAt: Date | null,
        actingUserId: string,
        actingUserRole: string,
        context?: { ipAddress?: string }
    ): Promise<IExam> {
        if (!mongoose.Types.ObjectId.isValid(id)) {
            throw new HttpError('Invalid ID format', 400);
        }
        if (!['PROFESSOR', 'ADMIN'].includes(actingUserRole.toUpperCase())) {
            throw new HttpError('Forbidden', 403);
        }
        if ((opensAt === null) !== (closesAt === null)) {
            throw new HttpError('Both regrade window timestamps must be set or cleared together', 400);
        }
        if (opensAt && Number.isNaN(opensAt.getTime())) {
            throw new HttpError('Invalid regrade window opening timestamp', 400);
        }
        if (closesAt && Number.isNaN(closesAt.getTime())) {
            throw new HttpError('Invalid regrade window closing timestamp', 400);
        }
        if (opensAt && closesAt && opensAt.getTime() >= closesAt.getTime()) {
            throw new HttpError('Regrade window opening time must be before its closing time', 400);
        }

        const examBefore = await ExamRepository.getExamById(id, actingUserId, actingUserRole);
        if (!examBefore) {
            throw new HttpError('Exam not found', 404);
        }

        const updatedExam = await Exam.findOneAndUpdate(
            { _id: examBefore._id, isActive: true },
            { $set: { regradeWindowOpensAt: opensAt, regradeWindowClosesAt: closesAt } },
            { returnDocument: 'after' }
        );
        if (!updatedExam) {
            throw new HttpError('Exam not found', 404);
        }

        const auditSuccess = await writeAuditLog({
            user: new mongoose.Types.ObjectId(actingUserId),
            action: 'EXAM_REGRADE_WINDOW_UPDATED',
            outcome: 'SUCCESS',
            entityId: updatedExam._id as mongoose.Types.ObjectId,
            entityType: 'Exam',
            details: {
                previousOpensAt: examBefore.regradeWindowOpensAt,
                previousClosesAt: examBefore.regradeWindowClosesAt,
                opensAt,
                closesAt
            },
            ipAddress: context?.ipAddress
        });

        if (!auditSuccess) {
            // Fail-closed compensation: revert back to previous timestamps
            await Exam.findByIdAndUpdate(id, {
                $set: {
                    regradeWindowOpensAt: examBefore.regradeWindowOpensAt,
                    regradeWindowClosesAt: examBefore.regradeWindowClosesAt
                }
            });
            throw new HttpError('Failed to record audit log for regrade window update', 500);
        }

        return updatedExam;
    }
}

const examService = new ExamService();
export default examService;
