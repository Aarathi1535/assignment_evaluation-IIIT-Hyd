import Exam, { IExam } from '../models/Exam';

class ExamRepository {
    async createExam(data: Partial<IExam>): Promise<IExam> {
        const exam = new Exam(data);
        return await exam.save();
    }

    async getAllExams(): Promise<IExam[]> {
        return await Exam.find({ isActive: true }).sort({ createdAt: -1 });
    }

    async getExamById(id: string): Promise<IExam | null> {
        return await Exam.findOne({ _id: id, isActive: true });
    }

    async updateExam(id: string, data: Partial<IExam>): Promise<IExam | null> {
        return await Exam.findOneAndUpdate(
            { _id: id, isActive: true },
            data,
            { new: true, runValidators: true }
        );
    }

    async deleteExam(id: string): Promise<IExam | null> {
        return await Exam.findOneAndUpdate(
            { _id: id, isActive: true },
            { isActive: false },
            { new: true }
        );
    }
}

const examRepository = new ExamRepository();
export default examRepository;
