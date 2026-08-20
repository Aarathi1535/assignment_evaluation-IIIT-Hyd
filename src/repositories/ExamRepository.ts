import Exam, { IExam, ExamStatus } from '../models/Exam';
import mongoose, { QueryFilter } from 'mongoose';
import { SYSTEM_ROLE } from '../constants/permissions';

class ExamRepository {
    async createExam(data: Partial<IExam>): Promise<IExam> {
        const exam = new Exam(data);
        return await exam.save();
    }

    async getAllExams(filter: QueryFilter<IExam> = {}): Promise<IExam[]> {
        return await Exam.find({ ...filter, isActive: true }).sort({ createdAt: -1 });
    }

    private async buildExamQuery(id: string, actingUserId?: string, actingUserRole?: string): Promise<QueryFilter<IExam> | null> {
        if (!actingUserId || !actingUserRole) {
            return null;
        }

        const query: QueryFilter<IExam> = { _id: id, isActive: true };

        if (actingUserRole === 'ADMIN' || actingUserRole === SYSTEM_ROLE) {
            return query;
        }

        if (actingUserRole === 'PROFESSOR') {
            if (!mongoose.Types.ObjectId.isValid(actingUserId)) {
                return null;
            }
            query.createdBy = new mongoose.Types.ObjectId(actingUserId);
            return query;
        }

        if (actingUserRole === 'STUDENT') {
            query.status = ExamStatus.PUBLISHED;

            const Course = mongoose.models.Course || await import('../models/Course').then(m => m.default);
            const enrolledCourses = await Course.find({ enrolledStudents: new mongoose.Types.ObjectId(actingUserId), isActive: true });
            const enrolledCourseIds = enrolledCourses.map(c => c._id);

            const StudentMapping = mongoose.models.StudentMapping || await import('../models/StudentMapping').then(m => m.default);
            const studentMappings = await StudentMapping.find({ student: actingUserId });
            const enrolledExamIds = studentMappings.map(m => m.exam);

            query.$or = [
                { enrolledStudents: new mongoose.Types.ObjectId(actingUserId) },
                { _id: { $in: enrolledExamIds } },
                { course: { $in: enrolledCourseIds } }
            ];
            return query;
        }

        if (actingUserRole === 'TA') {
            const Course = mongoose.models.Course || await import('../models/Course').then(m => m.default);
            const assignedCourses = await Course.find({ teachingAssistants: new mongoose.Types.ObjectId(actingUserId), isActive: true });
            const assignedCourseIds = assignedCourses.map(c => c._id);

            query.course = { $in: assignedCourseIds };
            return query;
        }

        return null;
    }

    async getExamById(id: string, actingUserId?: string, actingUserRole?: string): Promise<IExam | null> {
        const query = await this.buildExamQuery(id, actingUserId, actingUserRole);
        if (!query) {
            return null;
        }
        return await Exam.findOne(query);
    }

    async updateExam(id: string, data: Partial<IExam>, actingUserId?: string, actingUserRole?: string): Promise<IExam | null> {
        const query = await this.buildExamQuery(id, actingUserId, actingUserRole);
        if (!query) {
            return null;
        }
        return await Exam.findOneAndUpdate(
            query,
            data,
            { new: true, runValidators: true }
        );
    }

    async deleteExam(id: string, actingUserId?: string, actingUserRole?: string): Promise<IExam | null> {
        const query = await this.buildExamQuery(id, actingUserId, actingUserRole);
        if (!query) {
            return null;
        }
        return await Exam.findOneAndUpdate(
            query,
            { isActive: false },
            { new: true }
        );
    }

    /**
     * Atomically updates ingestion approval state on an exam.
     * Enforces the same ownership/scope rules as updateExam.
     */
    async updateIngestionApproval(
        id: string,
        data: Partial<Pick<IExam, 'ingestionApprovalStatus' | 'approvedBy' | 'approvedAt'>>,
        actingUserId?: string,
        actingUserRole?: string
    ): Promise<IExam | null> {
        const query = await this.buildExamQuery(id, actingUserId, actingUserRole);
        if (!query) {
            return null;
        }
        return await Exam.findOneAndUpdate(
            query,
            { $set: data },
            { new: true, runValidators: true }
        );
    }
}

const examRepository = new ExamRepository();
export default examRepository;