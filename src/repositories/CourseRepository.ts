import Course, { ICourse } from '../models/Course';
import mongoose, { QueryFilter } from 'mongoose';

class CourseRepository {
    async createCourse(data: Partial<ICourse>): Promise<ICourse> {
        const course = new Course(data);
        return await course.save();
    }

    async getAllCourses(filter: QueryFilter<ICourse> = {}, projection?: Record<string, number>): Promise<ICourse[]> {
        return await Course.find({ ...filter, isActive: true }, projection).sort({ createdAt: -1 });
    }

    private buildCourseQuery(id: string, actingUserId?: string, actingUserRole?: string): QueryFilter<ICourse> | null {
        if (!actingUserId || !actingUserRole) {
            return null;
        }
        const query: QueryFilter<ICourse> = { _id: id, isActive: true };
        if (actingUserRole === 'ADMIN') {
            return query;
        }
        if (actingUserRole === 'PROFESSOR') {
            query.professor = new mongoose.Types.ObjectId(actingUserId);
            return query;
        }
        if (actingUserRole === 'STUDENT') {
            query.enrolledStudents = new mongoose.Types.ObjectId(actingUserId);
            return query;
        }
        if (actingUserRole === 'TA') {
            query.teachingAssistants = new mongoose.Types.ObjectId(actingUserId);
            return query;
        }
        return null;
    }

    async getCourseById(id: string, actingUserId?: string, actingUserRole?: string): Promise<ICourse | null> {
        const query = this.buildCourseQuery(id, actingUserId, actingUserRole);
        if (!query) {
            return null;
        }
        if (actingUserRole === 'STUDENT') {
            return await Course.findOne(query).select('-enrolledStudents');
        }
        return await Course.findOne(query).populate('enrolledStudents', 'name email role isActive');
    }

    async getCourseByCode(courseCode: string): Promise<ICourse | null> {
        return await Course.findOne({ courseCode, isActive: true });
    }

    async updateCourse(id: string, data: Partial<ICourse>, actingUserId?: string, actingUserRole?: string): Promise<ICourse | null> {
        const query = this.buildCourseQuery(id, actingUserId, actingUserRole);
        if (!query) {
            return null;
        }
        return await Course.findOneAndUpdate(
            query,
            data,
            { new: true }
        );
    }

    async deleteCourse(id: string, actingUserId?: string, actingUserRole?: string): Promise<ICourse | null> {
        const query = this.buildCourseQuery(id, actingUserId, actingUserRole);
        if (!query) {
            return null;
        }
        return await Course.findOneAndUpdate(
            query,
            { isActive: false },
            { new: true }
        );
    }
}

const courseRepository = new CourseRepository();
export default courseRepository;
