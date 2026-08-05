import Exam, { IExam } from '../models/Exam';
import mongoose, { FilterQuery } from 'mongoose';

class ExamRepository {
    async createExam(data: Partial<IExam>): Promise<IExam> {
        const exam = new Exam(data);
        return await exam.save();
    }

    async getAllExams(filter: FilterQuery<IExam> = {}): Promise<IExam[]> {
        return await Exam.find({ ...filter, isActive: true }).sort({ createdAt: -1 });
    }

    async getExamById(id: string, actingUserId?: string, actingUserRole?: string): Promise<IExam | null> {
        const query: FilterQuery<IExam> = { _id: id, isActive: true };
        if (actingUserRole === 'PROFESSOR' && actingUserId) {
            query.createdBy = new mongoose.Types.ObjectId(actingUserId);
        }
        return await Exam.findOne(query);
    }

    async updateExam(id: string, data: Partial<IExam>, actingUserId?: string, actingUserRole?: string): Promise<IExam | null> {
        const query: FilterQuery<IExam> = { _id: id, isActive: true };
        if (actingUserRole === 'PROFESSOR' && actingUserId) {
            query.createdBy = new mongoose.Types.ObjectId(actingUserId);
        }
        return await Exam.findOneAndUpdate(
            query,
            data,
            { new: true, runValidators: true }
        );
    }

    async deleteExam(id: string, actingUserId?: string, actingUserRole?: string): Promise<IExam | null> {
        const query: FilterQuery<IExam> = { _id: id, isActive: true };
        if (actingUserRole === 'PROFESSOR' && actingUserId) {
            query.createdBy = new mongoose.Types.ObjectId(actingUserId);
        }
        return await Exam.findOneAndUpdate(
            query,
            { isActive: false },
            { new: true }
        );
    }
}

const examRepository = new ExamRepository();
export default examRepository;
