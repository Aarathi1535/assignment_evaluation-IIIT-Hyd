import AnswerScript, { IAnswerScript } from '@/models/AnswerScript';
import ExamRepository from '@/repositories/ExamRepository';
import AllocationService from '@/services/AllocationService';
import Exam from '@/models/Exam';
import Course from '@/models/Course';
import { UserRole } from '@/constants/permissions';
import { HttpError } from '@/lib/errors';

export async function verifyScriptAccess(
    scriptId: string,
    user: { id: string; role: string }
): Promise<IAnswerScript> {
    const script = await AnswerScript.findById(scriptId);
    if (!script) {
        throw new HttpError('AnswerScript not found', 404);
    }

    const role = user.role?.toUpperCase();
    if (role === UserRole.PROFESSOR || role === UserRole.ADMIN) {
        const exam = await ExamRepository.getExamById(script.exam.toString(), user.id, user.role);
        if (!exam) {
            throw new HttpError('Forbidden: Access denied to exam for this script', 403);
        }
    } else if (role === UserRole.TA) {
        const allocation = await AllocationService.verifyTaAllocation(script._id, user.id);
        if (!allocation) {
            const exam = await Exam.findById(script.exam);
            const course = exam
                ? await Course.findOne({ _id: exam.course, teachingAssistants: user.id })
                : null;
            if (!course) {
                throw new HttpError('Forbidden: You are not allocated to this answer script', 403);
            }
        }
    } else {
        throw new HttpError('Forbidden: Unauthorized role', 403);
    }

    return script;
}
