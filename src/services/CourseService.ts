import CourseRepository from '../repositories/CourseRepository';
import Course, { ICourse } from '../models/Course';
import User, { UserRole } from '../models/User';
import { writeAuditLog } from '../lib/audit';
import mongoose from 'mongoose';
import { HttpError, isDuplicateKeyError } from '../lib/errors';

export interface AuditContext {
    actingUserId?: string;
    ipAddress?: string;
}

class CourseService {
    async createCourse(data: Partial<ICourse>, context?: AuditContext): Promise<ICourse> {
        try {
            if (data.courseCode) {
                const existingCourse = await CourseRepository.getCourseByCode(data.courseCode);
                if (existingCourse) {
                    throw new HttpError("Course code already exists", 409);
                }
            }
            const newCourse = await CourseRepository.createCourse(data);

            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'COURSE_CREATED',
                    outcome: 'SUCCESS',
                    entityId: newCourse._id as mongoose.Types.ObjectId,
                    entityType: 'Course',
                    details: {
                        courseCode: newCourse.courseCode,
                        courseName: newCourse.courseName
                    },
                    ipAddress: context.ipAddress
                });
            }

            return newCourse;
        } catch (error) {
            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'COURSE_CREATED',
                    outcome: 'FAILURE',
                    entityType: 'Course',
                    details: {
                        courseCode: data.courseCode,
                        courseName: data.courseName,
                        error: error instanceof Error ? error.message : 'Unknown error'
                    },
                    ipAddress: context.ipAddress
                });
            }
            if (isDuplicateKeyError(error)) {
                throw new HttpError('Course code already exists', 409);
            }
            throw error;
        }
    }

    async getAllCourses(actingUserId?: string, actingUserRole?: string): Promise<ICourse[]> {
        const filter: mongoose.QueryFilter<ICourse> = {};
        let projection: Record<string, number> | undefined = undefined;
        if (actingUserRole === 'PROFESSOR' && actingUserId) {
            filter.professor = new mongoose.Types.ObjectId(actingUserId);
        } else if (actingUserRole === 'STUDENT' && actingUserId) {
            filter.enrolledStudents = new mongoose.Types.ObjectId(actingUserId);
            projection = { enrolledStudents: 0 };
        } else if (actingUserRole === 'TA' && actingUserId) {
            filter.teachingAssistants = new mongoose.Types.ObjectId(actingUserId);
        }
        return await CourseRepository.getAllCourses(filter, projection);
    }

    async getCourseById(id: string, actingUserId?: string, actingUserRole?: string): Promise<ICourse | null> {
        const course = await CourseRepository.getCourseById(id, actingUserId, actingUserRole);
        if (!course) {
            if (actingUserRole === 'PROFESSOR' && actingUserId) {
                const existsGlobally = await Course.exists({ _id: id, isActive: true });
                if (existsGlobally) {
                    await writeAuditLog({
                        user: actingUserId,
                        action: 'COURSE_ACCESS_DENIED',
                        outcome: 'FAILURE',
                        entityId: new mongoose.Types.ObjectId(id),
                        entityType: 'Course',
                        details: { reason: 'Ownership check failed' }
                    });
                }
            }
            return null;
        }
        return course;
    }

    async updateCourse(
        id: string,
        data: Partial<ICourse>,
        actingUserId: string,
        actingUserRole: string,
        context?: AuditContext
    ): Promise<ICourse | null> {
        const courseBefore = await CourseRepository.getCourseById(id, actingUserId, actingUserRole);
        if (!courseBefore) {
            if (actingUserRole === 'PROFESSOR' && actingUserId) {
                const existsGlobally = await Course.exists({ _id: id, isActive: true });
                if (existsGlobally) {
                    await writeAuditLog({
                        user: actingUserId,
                        action: 'COURSE_UPDATE_DENIED',
                        outcome: 'FAILURE',
                        entityId: new mongoose.Types.ObjectId(id),
                        entityType: 'Course',
                        details: { reason: 'Ownership check failed' },
                        ipAddress: context?.ipAddress
                    });
                }
            }
            return null;
        }

        // Prevent ownership changes through update APIs
        delete data.professor;

        try {
            const updatedCourse = await CourseRepository.updateCourse(id, data, actingUserId, actingUserRole);

            if (updatedCourse && context?.actingUserId) {
                const changedFields: string[] = [];
                if (data.courseCode !== undefined && data.courseCode !== courseBefore.courseCode) {
                    changedFields.push('courseCode');
                }
                if (data.courseName !== undefined && data.courseName !== courseBefore.courseName) {
                    changedFields.push('courseName');
                }
                if (data.semester !== undefined && data.semester !== courseBefore.semester) {
                    changedFields.push('semester');
                }
                if (data.academicYear !== undefined && data.academicYear !== courseBefore.academicYear) {
                    changedFields.push('academicYear');
                }
                if (data.teachingAssistants !== undefined) {
                    changedFields.push('teachingAssistants');
                }
                if (data.isActive !== undefined && data.isActive !== courseBefore.isActive) {
                    changedFields.push('isActive');
                }

                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'COURSE_UPDATED',
                    outcome: 'SUCCESS',
                    entityId: updatedCourse._id as mongoose.Types.ObjectId,
                    entityType: 'Course',
                    details: {
                        courseCode: updatedCourse.courseCode,
                        courseName: updatedCourse.courseName,
                        changedFields
                    },
                    ipAddress: context.ipAddress
                });
            }

            return updatedCourse;
        } catch (error: unknown) {
            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'COURSE_UPDATED',
                    outcome: 'FAILURE',
                    entityId: new mongoose.Types.ObjectId(id),
                    entityType: 'Course',
                    details: {
                        error: error instanceof Error ? error.message : 'Unknown error'
                    },
                    ipAddress: context.ipAddress
                });
            }
            if (isDuplicateKeyError(error)) {
                throw new HttpError('Course code already exists', 409);
            }
            throw error;
        }
    }

    async deleteCourse(
        id: string,
        actingUserId: string,
        actingUserRole: string,
        context?: AuditContext
    ): Promise<ICourse | null> {
        const courseBefore = await CourseRepository.getCourseById(id, actingUserId, actingUserRole);
        if (!courseBefore) {
            if (actingUserRole === 'PROFESSOR' && actingUserId) {
                const existsGlobally = await Course.exists({ _id: id, isActive: true });
                if (existsGlobally) {
                    await writeAuditLog({
                        user: actingUserId,
                        action: 'COURSE_DELETE_DENIED',
                        outcome: 'FAILURE',
                        entityId: new mongoose.Types.ObjectId(id),
                        entityType: 'Course',
                        details: { reason: 'Ownership check failed' },
                        ipAddress: context?.ipAddress
                    });
                }
            }
            return null;
        }

        // Prevent deleting a Course if active Exams still reference it
        const Exam = mongoose.models.Exam || await import('../models/Exam').then(m => m.default);
        const activeExamsCount = await Exam.countDocuments({ course: id, isActive: true });
        if (activeExamsCount > 0) {
            throw new HttpError("Cannot delete course: active exams still reference it", 400);
        }

        try {
            const deletedCourse = await CourseRepository.deleteCourse(id, actingUserId, actingUserRole);

            if (deletedCourse && context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'COURSE_DELETED',
                    outcome: 'SUCCESS',
                    entityId: deletedCourse._id as mongoose.Types.ObjectId,
                    entityType: 'Course',
                    details: {
                        courseCode: deletedCourse.courseCode,
                        courseName: deletedCourse.courseName
                    },
                    ipAddress: context.ipAddress
                });
            }

            return deletedCourse;
        } catch (error) {
            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'COURSE_DELETED',
                    outcome: 'FAILURE',
                    entityId: new mongoose.Types.ObjectId(id),
                    entityType: 'Course',
                    details: {
                        error: error instanceof Error ? error.message : 'Unknown error'
                    },
                    ipAddress: context.ipAddress
                });
            }
            throw error;
        }
    }

    async getCourseByCode(courseCode: string): Promise<ICourse | null> {
        return await Course.findOne({
            courseCode,
            isActive: true
        });
    }

    async enrollStudents(
        courseId: string,
        studentIds: string[],
        actingUserId: string,
        actingUserRole: string,
        context?: AuditContext
    ): Promise<ICourse | null> {
        try {
            if (!mongoose.Types.ObjectId.isValid(courseId)) {
                throw new HttpError("Invalid Course ID format", 400);
            }

            const course = await CourseRepository.getCourseById(courseId, actingUserId, actingUserRole);
            if (!course) {
                const existsGlobally = await Course.exists({ _id: courseId, isActive: true });
                if (existsGlobally) {
                    if (context?.actingUserId) {
                        await writeAuditLog({
                            user: context.actingUserId,
                            action: 'STUDENTS_ENROLLED_TO_COURSE',
                            outcome: 'FAILURE',
                            entityId: new mongoose.Types.ObjectId(courseId),
                            entityType: 'Course',
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

            const updatedCourse = await Course.findOneAndUpdate(
                { _id: courseId, isActive: true },
                { $addToSet: { enrolledStudents: { $each: uniqueStudentIds.map(id => new mongoose.Types.ObjectId(id)) } } },
                { new: true }
            ).populate('enrolledStudents', 'name email role isActive');

            if (!updatedCourse) {
                return null;
            }

            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'STUDENTS_ENROLLED_TO_COURSE',
                    outcome: 'SUCCESS',
                    entityId: updatedCourse._id as mongoose.Types.ObjectId,
                    entityType: 'Course',
                    details: {
                        courseCode: updatedCourse.courseCode,
                        enrolledStudentCount: uniqueStudentIds.length,
                        studentIds: uniqueStudentIds
                    },
                    ipAddress: context.ipAddress
                });
            }

            return updatedCourse;
        } catch (error) {
            if (context?.actingUserId) {
                await writeAuditLog({
                    user: context.actingUserId,
                    action: 'STUDENTS_ENROLLED_TO_COURSE',
                    outcome: 'FAILURE',
                    entityId: mongoose.Types.ObjectId.isValid(courseId) ? new mongoose.Types.ObjectId(courseId) : undefined,
                    entityType: 'Course',
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
}

const courseService = new CourseService();
export default courseService;
