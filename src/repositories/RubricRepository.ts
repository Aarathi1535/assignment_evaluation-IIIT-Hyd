import Rubric, { IRubric } from '../models/Rubric';
import Grade from '../models/Grade';
import ExamRepository from './ExamRepository';
import { HttpError } from '../lib/errors';

class RubricRepository {
    async createRubric(data: Partial<IRubric>): Promise<IRubric> {
        const rubric = new Rubric(data);
        return await rubric.save();
    }

    async getRubricById(id: string, actingUserId?: string, actingUserRole?: string): Promise<IRubric | null> {
        const rubric = await Rubric.findOne({ _id: id, isActive: true });
        if (!rubric) {
            return null;
        }

        // Ownership / Authorization check via associated Exam
        const exam = await ExamRepository.getExamById(rubric.exam.toString(), actingUserId, actingUserRole);
        if (!exam) {
            return null;
        }

        return rubric;
    }

    async getRubricByExamId(examId: string, actingUserId?: string, actingUserRole?: string): Promise<IRubric | null> {
        // Ownership / Authorization check via associated Exam
        const exam = await ExamRepository.getExamById(examId, actingUserId, actingUserRole);
        if (!exam) {
            return null;
        }

        return await Rubric.findOne({ exam: examId, isActive: true });
    }

    async isRubricLocked(id: string): Promise<boolean> {
        const gradeExists = await Grade.exists({ rubric: id });
        return !!gradeExists;
    }

    async updateRubric(id: string, data: Partial<IRubric>, actingUserId?: string, actingUserRole?: string): Promise<IRubric | null> {
        if (!actingUserId || !actingUserRole) {
            return null;
        }

        const rubric = await Rubric.findOne({ _id: id, isActive: true });
        if (!rubric) {
            return null;
        }

        if (actingUserRole !== 'ADMIN' && actingUserRole !== 'PROFESSOR') {
            return null;
        }

        const exam = await ExamRepository.getExamById(rubric.exam.toString(), actingUserId, actingUserRole);
        if (!exam) {
            return null;
        }

        if (await this.isRubricLocked(id)) {
            throw new HttpError('Cannot update rubric: grading has already started for this exam', 400);
        }

        return await Rubric.findOneAndUpdate(
            { _id: id, isActive: true },
            {
                $set: data,
                $inc: { version: 1 }
            },
            { new: true, runValidators: true }
        );
    }
}

const rubricRepository = new RubricRepository();
export default rubricRepository;
