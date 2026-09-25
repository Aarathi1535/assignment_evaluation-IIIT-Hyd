import mongoose, { QueryFilter } from 'mongoose';
import ClassroomQuestion, { IClassroomQuestion } from '../models/ClassroomQuestion';
import ClassroomSubmission, { IClassroomSubmission } from '../models/ClassroomSubmission';

class ClassroomAssessmentRepository {
    async createQuestion(data: Partial<IClassroomQuestion>): Promise<IClassroomQuestion> {
        const question = new ClassroomQuestion(data);
        return await question.save();
    }

    async getQuestions(filter: QueryFilter<IClassroomQuestion> = {}): Promise<IClassroomQuestion[]> {
        return await ClassroomQuestion.find(filter).sort({ createdAt: -1 });
    }

    async getQuestionById(id: string): Promise<IClassroomQuestion | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        return await ClassroomQuestion.findById(id);
    }

    async getActiveQuestion(): Promise<IClassroomQuestion | null> {
        return await ClassroomQuestion.findOne({ isActive: true, status: 'ACTIVE' }).sort({ updatedAt: -1 });
    }

    async updateQuestion(id: string, data: Partial<IClassroomQuestion>): Promise<IClassroomQuestion | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        return await ClassroomQuestion.findByIdAndUpdate(
            id,
            { $set: data },
            { new: true, runValidators: true }
        );
    }

    async setActiveQuestion(id: string): Promise<IClassroomQuestion | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        // First deactivate all questions
        await ClassroomQuestion.updateMany({ _id: { $ne: id } }, { $set: { isActive: false } });
        // Then activate the target question
        return await ClassroomQuestion.findByIdAndUpdate(
            id,
            { $set: { isActive: true, status: 'ACTIVE' } },
            { new: true }
        );
    }

    async deactivateQuestion(id: string): Promise<IClassroomQuestion | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        return await ClassroomQuestion.findByIdAndUpdate(
            id,
            { $set: { isActive: false, status: 'CLOSED' } },
            { new: true }
        );
    }

    async createSubmission(data: Partial<IClassroomSubmission>): Promise<IClassroomSubmission> {
        const submission = new ClassroomSubmission(data);
        return await submission.save();
    }

    async getSubmissionById(id: string): Promise<IClassroomSubmission | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        return await ClassroomSubmission.findById(id).populate('question student', 'title name email');
    }

    async getExistingSubmission(questionId: string, studentId: string): Promise<IClassroomSubmission | null> {
        if (!mongoose.Types.ObjectId.isValid(questionId) || !mongoose.Types.ObjectId.isValid(studentId)) return null;
        return await ClassroomSubmission.findOne({
            question: new mongoose.Types.ObjectId(questionId),
            student: new mongoose.Types.ObjectId(studentId)
        });
    }

    async getSubmissionsByQuestion(questionId: string): Promise<IClassroomSubmission[]> {
        if (!mongoose.Types.ObjectId.isValid(questionId)) return [];
        return await ClassroomSubmission.find({ question: new mongoose.Types.ObjectId(questionId) })
            .populate('student', 'name email')
            .sort({ createdAt: -1 });
    }

    async getSubmissionsByStudent(studentId: string, questionId?: string): Promise<IClassroomSubmission[]> {
        if (!mongoose.Types.ObjectId.isValid(studentId)) return [];
        const filter: QueryFilter<IClassroomSubmission> = { student: new mongoose.Types.ObjectId(studentId) };
        if (questionId && mongoose.Types.ObjectId.isValid(questionId)) {
            filter.question = new mongoose.Types.ObjectId(questionId);
        }
        return await ClassroomSubmission.find(filter)
            .populate('question', 'title questionPrompt maxMarks')
            .sort({ createdAt: -1 });
    }

    async updateSubmission(id: string, data: Partial<IClassroomSubmission>): Promise<IClassroomSubmission | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        return await ClassroomSubmission.findByIdAndUpdate(
            id,
            { $set: data },
            { new: true }
        );
    }
}

const classroomAssessmentRepository = new ClassroomAssessmentRepository();
export default classroomAssessmentRepository;
