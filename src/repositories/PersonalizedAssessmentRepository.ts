import mongoose from 'mongoose';
import PersonalizedQuestion, { IPersonalizedQuestion } from '../models/PersonalizedQuestion';
import PersonalizedAssessmentSchedule, {
    IPersonalizedAssessmentSchedule
} from '../models/PersonalizedAssessmentSchedule';
import PersonalizedStudentAssignment, {
    IPersonalizedStudentAssignment
} from '../models/PersonalizedStudentAssignment';

export class PersonalizedAssessmentRepository {
    // ==========================================
    // Questions
    // ==========================================
    async createQuestion(data: Partial<IPersonalizedQuestion>): Promise<IPersonalizedQuestion> {
        return PersonalizedQuestion.create(data);
    }

    async bulkCreateQuestions(
        questions: Array<Partial<IPersonalizedQuestion>>
    ): Promise<IPersonalizedQuestion[]> {
        return PersonalizedQuestion.insertMany(questions) as unknown as Promise<IPersonalizedQuestion[]>;
    }

    async getQuestionsByCourse(courseId: string | mongoose.Types.ObjectId): Promise<IPersonalizedQuestion[]> {
        if (!courseId || !mongoose.Types.ObjectId.isValid(courseId.toString())) {
            return [];
        }
        return PersonalizedQuestion.find({
            course: new mongoose.Types.ObjectId(courseId.toString()),
            isActive: true
        }).sort({ questionIndex: 1 });
    }

    async countQuestionsByCourse(courseId: string | mongoose.Types.ObjectId): Promise<number> {
        if (!courseId || !mongoose.Types.ObjectId.isValid(courseId.toString())) {
            return 0;
        }
        return PersonalizedQuestion.countDocuments({
            course: new mongoose.Types.ObjectId(courseId.toString()),
            isActive: true
        });
    }

    async getQuestionById(questionId: string | mongoose.Types.ObjectId): Promise<IPersonalizedQuestion | null> {
        if (!questionId || !mongoose.Types.ObjectId.isValid(questionId.toString())) {
            return null;
        }
        return PersonalizedQuestion.findById(questionId);
    }

    // ==========================================
    // Schedules
    // ==========================================
    async createSchedule(
        data: Partial<IPersonalizedAssessmentSchedule>
    ): Promise<IPersonalizedAssessmentSchedule> {
        return PersonalizedAssessmentSchedule.create(data);
    }

    async getSchedulesByProfessor(
        professorId: string | mongoose.Types.ObjectId
    ): Promise<IPersonalizedAssessmentSchedule[]> {
        if (!professorId || !mongoose.Types.ObjectId.isValid(professorId.toString())) {
            return [];
        }
        return PersonalizedAssessmentSchedule.find({
            createdBy: new mongoose.Types.ObjectId(professorId.toString())
        })
            .populate('course', 'courseCode courseName semester academicYear')
            .sort({ createdAt: -1 });
    }

    async getSchedulesByCourse(
        courseId: string | mongoose.Types.ObjectId
    ): Promise<IPersonalizedAssessmentSchedule[]> {
        if (!courseId || !mongoose.Types.ObjectId.isValid(courseId.toString())) {
            return [];
        }
        return PersonalizedAssessmentSchedule.find({
            course: new mongoose.Types.ObjectId(courseId.toString())
        })
            .populate('course', 'courseCode courseName')
            .sort({ createdAt: -1 });
    }

    async getScheduleById(
        scheduleId: string | mongoose.Types.ObjectId
    ): Promise<IPersonalizedAssessmentSchedule | null> {
        if (!scheduleId || !mongoose.Types.ObjectId.isValid(scheduleId.toString())) {
            return null;
        }
        return PersonalizedAssessmentSchedule.findById(scheduleId)
            .populate('course', 'courseCode courseName professor')
            .populate('enrolledStudents', 'name email');
    }

    async getActiveScheduleForStudent(
        studentId: string | mongoose.Types.ObjectId
    ): Promise<IPersonalizedAssessmentSchedule | null> {
        if (!studentId || !mongoose.Types.ObjectId.isValid(studentId.toString())) {
            return null;
        }
        const studentObjId = new mongoose.Types.ObjectId(studentId.toString());
        return PersonalizedAssessmentSchedule.findOne({
            enrolledStudents: studentObjId,
            status: 'ACTIVE'
        })
            .populate('course', 'courseCode courseName')
            .sort({ startDate: -1 });
    }

    async updateSchedule(
        scheduleId: string | mongoose.Types.ObjectId,
        update: Partial<IPersonalizedAssessmentSchedule>
    ): Promise<IPersonalizedAssessmentSchedule | null> {
        if (!scheduleId || !mongoose.Types.ObjectId.isValid(scheduleId.toString())) {
            return null;
        }
        return PersonalizedAssessmentSchedule.findByIdAndUpdate(scheduleId, { $set: update }, { new: true });
    }

    // ==========================================
    // Student Assignments
    // ==========================================
    async insertAssignmentsBatch(
        assignments: Array<Partial<IPersonalizedStudentAssignment>>
    ): Promise<IPersonalizedStudentAssignment[]> {
        return PersonalizedStudentAssignment.insertMany(
            assignments
        ) as unknown as Promise<IPersonalizedStudentAssignment[]>;
    }

    async getAssignmentsByStudentAndSchedule(
        studentId: string | mongoose.Types.ObjectId,
        scheduleId: string | mongoose.Types.ObjectId
    ): Promise<IPersonalizedStudentAssignment[]> {
        if (!studentId || !mongoose.Types.ObjectId.isValid(studentId.toString()) ||
            !scheduleId || !mongoose.Types.ObjectId.isValid(scheduleId.toString())) {
            return [];
        }
        return PersonalizedStudentAssignment.find({
            student: new mongoose.Types.ObjectId(studentId.toString()),
            schedule: new mongoose.Types.ObjectId(scheduleId.toString())
        })
            .populate('question', 'title topic difficulty maxMarks questionPrompt hints')
            .sort({ dayNumber: 1 });
    }

    async getAssignmentForStudentByDate(
        studentId: string | mongoose.Types.ObjectId,
        dateString: string // YYYY-MM-DD
    ): Promise<IPersonalizedStudentAssignment | null> {
        if (!studentId || !mongoose.Types.ObjectId.isValid(studentId.toString())) {
            return null;
        }
        const startOfDay = new Date(`${dateString}T00:00:00.000Z`);
        const endOfDay = new Date(`${dateString}T23:59:59.999Z`);

        return PersonalizedStudentAssignment.findOne({
            student: new mongoose.Types.ObjectId(studentId.toString()),
            scheduledDate: { $gte: startOfDay, $lte: endOfDay }
        })
            .populate('question')
            .populate('schedule');
    }

    async getAssignmentById(
        assignmentId: string | mongoose.Types.ObjectId
    ): Promise<IPersonalizedStudentAssignment | null> {
        if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId.toString())) {
            return null;
        }
        return PersonalizedStudentAssignment.findById(assignmentId)
            .populate('question')
            .populate('schedule');
    }

    async updateAssignment(
        assignmentId: string | mongoose.Types.ObjectId,
        update: Partial<IPersonalizedStudentAssignment>
    ): Promise<IPersonalizedStudentAssignment | null> {
        if (!assignmentId || !mongoose.Types.ObjectId.isValid(assignmentId.toString())) {
            return null;
        }
        return PersonalizedStudentAssignment.findByIdAndUpdate(
            assignmentId,
            { $set: update },
            { new: true }
        )
            .populate('question')
            .populate('schedule');
    }

    async getScheduleProgress(scheduleId: string | mongoose.Types.ObjectId) {
        if (!scheduleId || !mongoose.Types.ObjectId.isValid(scheduleId.toString())) {
            return { stats: [], studentProgress: [] };
        }
        const schedId = new mongoose.Types.ObjectId(scheduleId.toString());

        const stats = await PersonalizedStudentAssignment.aggregate([
            { $match: { schedule: schedId } },
            {
                $group: {
                    _id: '$status',
                    count: { $sum: 1 }
                }
            }
        ]);

        const studentProgress = await PersonalizedStudentAssignment.aggregate([
            { $match: { schedule: schedId } },
            {
                $group: {
                    _id: '$student',
                    totalAssigned: { $sum: 1 },
                    submittedCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'SUBMITTED'] }, 1, 0] }
                    },
                    missedCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'MISSED'] }, 1, 0] }
                    },
                    inProgressCount: {
                        $sum: { $cond: [{ $eq: ['$status', 'IN_PROGRESS'] }, 1, 0] }
                    },
                    totalScore: {
                        $sum: { $ifNull: ['$score', 0] }
                    }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'studentDetails'
                }
            },
            { $unwind: '$studentDetails' },
            {
                $project: {
                    studentId: '$_id',
                    studentName: '$studentDetails.name',
                    studentEmail: '$studentDetails.email',
                    totalAssigned: 1,
                    submittedCount: 1,
                    missedCount: 1,
                    inProgressCount: 1,
                    totalScore: 1,
                    completionPercentage: {
                        $multiply: [{ $divide: ['$submittedCount', '$totalAssigned'] }, 100]
                    }
                }
            },
            { $sort: { studentName: 1 } }
        ]);

        return { stats, studentProgress };
    }
}

const personalizedAssessmentRepository = new PersonalizedAssessmentRepository();
export default personalizedAssessmentRepository;
