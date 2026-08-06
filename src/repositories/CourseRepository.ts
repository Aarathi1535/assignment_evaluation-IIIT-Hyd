import Course, { ICourse } from '../models/Course';
import mongoose, { QueryFilter } from 'mongoose';

class CourseRepository {
    async createCourse(data: Partial<ICourse>): Promise<ICourse> {
        const course = new Course(data);
        return await course.save();
    }

    async getAllCourses(filter: QueryFilter<ICourse> = {}): Promise<ICourse[]> {
        return await Course.find({ ...filter, isActive: true }).sort({ createdAt: -1 });
    }

    async getCourseById(id: string, actingUserId?: string, actingUserRole?: string): Promise<ICourse | null> {
        const query: QueryFilter<ICourse> = { _id: id, isActive: true };
        if (actingUserRole === 'PROFESSOR' && actingUserId) {
            query.professor = new mongoose.Types.ObjectId(actingUserId);
        }
        return await Course.findOne(query).populate('enrolledStudents', 'name email role isActive');
    }

    async getCourseByCode(courseCode: string): Promise<ICourse | null> {
        return await Course.findOne({ courseCode, isActive: true });
    }


    async updateCourse(id: string, data: Partial<ICourse>, actingUserId?: string, actingUserRole?: string): Promise<ICourse | null> {
        const query: QueryFilter<ICourse> = { _id: id, isActive: true };
        if (actingUserRole === 'PROFESSOR' && actingUserId) {
            query.professor = new mongoose.Types.ObjectId(actingUserId);
        }
        return await Course.findOneAndUpdate(
            query,
            data,
            { new: true }
        );
    }

    async deleteCourse(id: string, actingUserId?: string, actingUserRole?: string): Promise<ICourse | null> {
        const query: QueryFilter<ICourse> = { _id: id, isActive: true };
        if (actingUserRole === 'PROFESSOR' && actingUserId) {
            query.professor = new mongoose.Types.ObjectId(actingUserId);
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
