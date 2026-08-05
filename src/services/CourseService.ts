import CourseRepository from '../repositories/CourseRepository';
import Course, { ICourse } from '../models/Course';
import { writeAuditLog } from '../lib/audit';
import mongoose from 'mongoose';

export interface AuditContext {
    actingUserId?: string;
    ipAddress?: string;
}

class CourseService {
    async createCourse(data: Partial<ICourse>, context?: AuditContext): Promise<ICourse> {
        if (data.courseCode) {
            const existingCourse = await CourseRepository.getCourseByCode(data.courseCode);
            if (existingCourse) {
                throw new Error("Course code already exists");
            }
        }
        const newCourse = await CourseRepository.createCourse(data);

        if (context?.actingUserId) {
            await writeAuditLog({
                user: context.actingUserId,
                action: 'COURSE_CREATED',
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
    }

    async getAllCourses(): Promise<ICourse[]> {
        return await CourseRepository.getAllCourses();
    }

    async getCourseById(id: string): Promise<ICourse | null> {
        return await CourseRepository.getCourseById(id);
    }

    async updateCourse(id: string, data: Partial<ICourse>, context?: AuditContext): Promise<ICourse | null> {
        const courseBefore = await CourseRepository.getCourseById(id);
        if (!courseBefore) {
            return null;
        }

        const updatedCourse = await CourseRepository.updateCourse(id, data);

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
            if (data.professor !== undefined && data.professor.toString() !== courseBefore.professor.toString()) {
                changedFields.push('professor');
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
    }

    async deleteCourse(id: string, context?: AuditContext): Promise<ICourse | null> {
        const courseBefore = await CourseRepository.getCourseById(id);
        if (!courseBefore) {
            return null;
        }

        const deletedCourse = await CourseRepository.deleteCourse(id);

        if (deletedCourse && context?.actingUserId) {
            await writeAuditLog({
                user: context.actingUserId,
                action: 'COURSE_DELETED',
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
    }

    async getCourseByCode(courseCode: string): Promise<ICourse | null> {
        return await Course.findOne({
            courseCode,
            isActive: true
        });
    }
}

const courseService = new CourseService();
export default courseService;
