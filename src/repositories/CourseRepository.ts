import Course, { ICourse } from '../models/Course';

class CourseRepository {
    async createCourse(data: Partial<ICourse>): Promise<ICourse> {
        const course = new Course(data);
        return await course.save();
    }

    async getAllCourses(): Promise<ICourse[]> {
        return await Course.find({ isActive: true }).sort({ createdAt: -1 });
    }

    async getCourseById(id: string): Promise<ICourse | null> {
        return await Course.findOne({ _id: id, isActive: true });
    }

    async getCourseByCode(courseCode: string): Promise<ICourse | null> {
        return await Course.findOne({ courseCode, isActive: true });
    }


    async updateCourse(id: string, data: Partial<ICourse>): Promise<ICourse | null> {
        return await Course.findOneAndUpdate(
            { _id: id, isActive: true },
            data,
            { new: true }
        );
    }

    async deleteCourse(id: string): Promise<ICourse | null> {
        return await Course.findOneAndUpdate(
            { _id: id, isActive: true },
            { isActive: false },
            { new: true }
        );
    }
}

const courseRepository = new CourseRepository();
export default courseRepository;
