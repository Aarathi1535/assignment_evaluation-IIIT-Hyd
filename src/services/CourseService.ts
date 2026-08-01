import CourseRepository from '../repositories/CourseRepository';
import Course, { ICourse } from '../models/Course';

class CourseService {
    async createCourse(data: Partial<ICourse>): Promise<ICourse> {
        if (data.courseCode) {
            const existingCourse = await CourseRepository.getCourseByCode(data.courseCode);
            if (existingCourse) {
                throw new Error("Course code already exists");
            }
        }
        return await CourseRepository.createCourse(data);
    }

    async getAllCourses(): Promise<ICourse[]> {
        return await CourseRepository.getAllCourses();
    }

    async getCourseById(id: string): Promise<ICourse | null> {
        return await CourseRepository.getCourseById(id);
    }

    async updateCourse(id: string, data: Partial<ICourse>): Promise<ICourse | null> {
        return await CourseRepository.updateCourse(id, data);
    }

    async deleteCourse(id: string): Promise<ICourse | null> {
        return await CourseRepository.deleteCourse(id);
    }

    async getCourseByCode(courseCode: string): Promise<ICourse | null> {
        return await Course.findOne({
            courseCode,
            isActive: true
        });
    }
}

export default new CourseService();
