import mongoose, { QueryFilter } from 'mongoose';
import ClassroomQuestion, { IClassroomQuestion } from '../models/ClassroomQuestion';
import ClassroomSubmission, { IClassroomSubmission } from '../models/ClassroomSubmission';

export interface ClassroomOptionResult {
    optionIndex: number;
    optionText: string;
    count: number;
    percentage: number;
    isCorrect?: boolean;
}

export interface ClassroomStudentResponseHistory {
    submissionId: string;
    studentName: string;
    studentEmail?: string;
    selectedOption?: number | null;
    selectedOptionText?: string | null;
    textResponse?: string | null;
    isCorrect?: boolean | null;
    submittedAt: Date | string;
}

export interface ClassroomAggregatedResults {
    questionId: string;
    totalResponses: number;
    options: ClassroomOptionResult[];
    textResponses?: Array<{ text: string; submittedAt: Date }>;
    correctOptionIndex?: number | null;
    explanation?: string;
    isRevealed: boolean;
    status: string;
    responseHistory?: ClassroomStudentResponseHistory[];
}

class ClassroomAssessmentRepository {
    async createQuestion(data: Partial<IClassroomQuestion>): Promise<IClassroomQuestion> {
        const question = new ClassroomQuestion(data);
        return await question.save();
    }

    async getQuestions(filter: QueryFilter<IClassroomQuestion> = {}): Promise<IClassroomQuestion[]> {
        return await ClassroomQuestion.find({
            ...filter,
            type: { $in: ['MULTIPLE_CHOICE', 'SHORT_ANSWER', 'POLL'] }
        }).sort({ order: 1, createdAt: 1 });
    }

    async getQuestionById(id: string): Promise<IClassroomQuestion | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        return await ClassroomQuestion.findById(id);
    }

    async getActiveQuestion(): Promise<IClassroomQuestion | null> {
        return await ClassroomQuestion.findOne({
            isActive: true,
            type: { $in: ['MULTIPLE_CHOICE', 'SHORT_ANSWER', 'POLL'] }
        }).sort({ updatedAt: -1 });
    }

    async updateQuestion(id: string, data: Partial<IClassroomQuestion>): Promise<IClassroomQuestion | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        return await ClassroomQuestion.findByIdAndUpdate(
            id,
            { $set: data },
            { returnDocument: 'after', runValidators: true }
        );
    }

    async setActiveQuestion(id: string): Promise<IClassroomQuestion | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        // First deactivate all other questions
        await ClassroomQuestion.updateMany(
            { _id: { $ne: new mongoose.Types.ObjectId(id) }, isActive: true },
            { $set: { isActive: false, status: 'CLOSED' } }
        );
        // Activate target question
        return await ClassroomQuestion.findByIdAndUpdate(
            id,
            {
                $set: {
                    isActive: true,
                    status: 'ACTIVE',
                    isRevealed: false,
                    activatedAt: new Date()
                }
            },
            { returnDocument: 'after' }
        );
    }

    async closeQuestion(id: string): Promise<IClassroomQuestion | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        return await ClassroomQuestion.findByIdAndUpdate(
            id,
            { $set: { status: 'CLOSED', closedAt: new Date() } },
            { returnDocument: 'after' }
        );
    }

    async revealQuestion(id: string): Promise<IClassroomQuestion | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        return await ClassroomQuestion.findByIdAndUpdate(
            id,
            { $set: { status: 'REVEALED', isRevealed: true, revealedAt: new Date() } },
            { returnDocument: 'after' }
        );
    }

    async deactivateQuestion(id: string): Promise<IClassroomQuestion | null> {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        return await ClassroomQuestion.findByIdAndUpdate(
            id,
            { $set: { isActive: false, status: 'CLOSED' } },
            { returnDocument: 'after' }
        );
    }

    async deleteQuestion(id: string): Promise<boolean> {
        if (!mongoose.Types.ObjectId.isValid(id)) return false;
        await ClassroomSubmission.deleteMany({ question: new mongoose.Types.ObjectId(id) });
        const res = await ClassroomQuestion.findByIdAndDelete(id);
        return !!res;
    }

    async getNextQuestion(currentQuestionId: string, createdBy: string): Promise<IClassroomQuestion | null> {
        const current = await this.getQuestionById(currentQuestionId);
        if (!current) return null;

        // Find next question by order or creation time
        const next = await ClassroomQuestion.findOne({
            createdBy: new mongoose.Types.ObjectId(createdBy),
            _id: { $ne: current._id },
            type: { $in: ['MULTIPLE_CHOICE', 'SHORT_ANSWER', 'POLL'] },
            $or: [
                { order: { $gt: current.order } },
                { order: current.order, createdAt: { $gt: current.createdAt } }
            ]
        }).sort({ order: 1, createdAt: 1 });

        return next;
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
            .populate('question', 'title questionPrompt options correctOptionIndex maxMarks')
            .sort({ createdAt: -1 });
    }

    async getAggregatedResults(questionId: string): Promise<ClassroomAggregatedResults | null> {
        const question = await this.getQuestionById(questionId);
        if (!question) return null;

        const submissions = await ClassroomSubmission.find({ question: question._id })
            .populate('student', 'name email')
            .sort({ submittedAt: -1, createdAt: -1 });
        const totalResponses = submissions.length;

        const optionCounts: Record<number, number> = {};
        const textResponses: Array<{ text: string; submittedAt: Date }> = [];
        const responseHistory: ClassroomStudentResponseHistory[] = [];

        for (const sub of submissions) {
            if (typeof sub.selectedOption === 'number' && sub.selectedOption >= 0) {
                optionCounts[sub.selectedOption] = (optionCounts[sub.selectedOption] || 0) + 1;
            }
            if (sub.textResponse) {
                textResponses.push({
                    text: sub.textResponse,
                    submittedAt: sub.submittedAt
                });
            }

            const studentObj = sub.student as unknown as { name?: string; email?: string } | null;
            const studentName = studentObj?.name || 'Anonymous Student';
            const studentEmail = studentObj?.email || undefined;
            const selectedOptionText = typeof sub.selectedOption === 'number' && question.options
                ? question.options[sub.selectedOption] || null
                : null;

            responseHistory.push({
                submissionId: sub._id.toString(),
                studentName,
                studentEmail,
                selectedOption: sub.selectedOption,
                selectedOptionText,
                textResponse: sub.textResponse || null,
                isCorrect: typeof sub.isCorrect === 'boolean' ? sub.isCorrect : null,
                submittedAt: sub.submittedAt || sub.createdAt
            });
        }

        const optionsResult: ClassroomOptionResult[] = (question.options || []).map((optText, idx) => {
            const count = optionCounts[idx] || 0;
            const percentage = totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0;
            return {
                optionIndex: idx,
                optionText: optText,
                count,
                percentage,
                isCorrect: question.correctOptionIndex === idx
            };
        });

        return {
            questionId: question._id.toString(),
            totalResponses,
            options: optionsResult,
            textResponses: question.type === 'SHORT_ANSWER' ? textResponses : undefined,
            correctOptionIndex: question.correctOptionIndex,
            explanation: question.explanation,
            isRevealed: question.isRevealed || question.status === 'REVEALED',
            status: question.status,
            responseHistory
        };
    }
}

const classroomAssessmentRepository = new ClassroomAssessmentRepository();
export default classroomAssessmentRepository;
