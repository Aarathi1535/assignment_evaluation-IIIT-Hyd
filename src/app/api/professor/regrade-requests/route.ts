import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { UserRole } from '../../../../constants/permissions';
import { connectDB } from '../../../../lib/db';
import { requirePermission } from '../../../../lib/apiAuth';
import { Permission } from '../../../../constants/permissions';
import Exam from '../../../../models/Exam';
import Grade from '../../../../models/Grade';
import RegradeRequest, { RegradeStatus } from '../../../../models/RegradeRequest';
import Rubric from '../../../../models/Rubric';
import User from '../../../../models/User';

export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
    const auth = await requirePermission(Permission.VIEW_ALL_SUBMISSIONS);
    if (!auth.authorized) {
        return auth.response;
    }

    if (auth.user.role !== UserRole.PROFESSOR && auth.user.role !== UserRole.ADMIN) {
        return NextResponse.json(
            { success: false, message: 'Forbidden', data: null },
            { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }

    const search = request.nextUrl.searchParams;
    const page = Number(search.get('page') || 1);
    const limit = Number(search.get('limit') || 20);
    const rawStatus = search.get('status')?.toUpperCase();
    const examId = search.get('examId');

    if (!Number.isInteger(page) || page < 1 ||
        !Number.isInteger(limit) || limit < 1 ||
        (rawStatus && !Object.values(RegradeStatus).includes(rawStatus as RegradeStatus)) ||
        (examId && !mongoose.Types.ObjectId.isValid(examId))) {
        return NextResponse.json(
            { success: false, message: 'Invalid query parameters', data: null },
            { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }

    try {
        await connectDB();

        const ownedExams = await Exam.find(
            auth.user.role === UserRole.ADMIN
                ? (examId ? { _id: examId } : {})
                : { createdBy: auth.user.id, ...(examId ? { _id: examId } : {}) }
        ).select('_id title rubric').lean();
        const examIds = ownedExams.map(exam => exam._id);

        if (examId && examIds.length === 0) {
            return NextResponse.json(
                { success: false, message: 'Exam not found', data: null },
                { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
            );
        }

        const query = {
            exam: { $in: examIds },
            ...(rawStatus ? { status: rawStatus as RegradeStatus } : {})
        };
        const safeLimit = Math.min(limit, MAX_PAGE_SIZE);
        const [requests, total] = await Promise.all([
            RegradeRequest.find(query)
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * safeLimit)
                .limit(safeLimit)
                .select('_id exam answerScript questionNumber student reason status createdAt updatedAt')
                .lean(),
            RegradeRequest.countDocuments(query)
        ]);

        const scriptIds = [...new Set(requests.map(item => item.answerScript.toString()))];
        const studentIds = [...new Set(requests.map(item => item.student.toString()))];
        const [students, grades, rubrics] = await Promise.all([
            User.find({ _id: { $in: studentIds } }).select('_id name email').lean(),
            Grade.find({
                answerScript: { $in: scriptIds },
                isFinal: true
            }).select('answerScript question totalScore marksAwarded feedback rubric').lean(),
            Rubric.find({
                _id: {
                    $in: ownedExams
                        .map(exam => exam.rubric)
                        .filter((rubric): rubric is mongoose.Types.ObjectId => rubric !== undefined && rubric !== null)
                }
            })
                .select('exam questions')
                .lean()
        ]);

        const examById = new Map(ownedExams.map(exam => [exam._id.toString(), exam]));
        const studentById = new Map(students.map(student => [student._id.toString(), student]));
        const rubricByExam = new Map(rubrics.map(rubric => [rubric.exam.toString(), rubric]));

        const data = requests.map(item => {
            const exam = examById.get(item.exam.toString());
            const grade = grades.find(candidate =>
                candidate.answerScript.toString() === item.answerScript.toString() &&
                candidate.question === item.questionNumber
            );
            const rubric = grade
                ? rubrics.find(candidate => candidate._id.toString() === grade.rubric.toString())
                : rubricByExam.get(item.exam.toString());
            const question = rubric?.questions.find(candidate => candidate.questionNumber === item.questionNumber);
            const student = studentById.get(item.student.toString());

            return {
                id: item._id.toString(),
                exam: { id: item.exam.toString(), title: exam?.title || 'Exam' },
                answerScriptId: item.answerScript.toString(),
                questionNumber: item.questionNumber,
                student: {
                    id: item.student.toString(),
                    name: student?.name || 'Unknown student',
                    email: student?.email || ''
                },
                reason: item.reason,
                status: item.status,
                createdAt: item.createdAt,
                updatedAt: item.updatedAt,
                evaluation: grade ? {
                    score: grade.totalScore,
                    maxMarks: question?.maxMarks ?? null,
                    feedback: grade.feedback || '',
                    criteria: grade.marksAwarded.map(criterion => ({
                        name: criterion.criterionName,
                        score: criterion.score,
                        feedback: criterion.feedback || ''
                    }))
                } : null
            };
        });

        return NextResponse.json(
            { success: true, data: { requests: data, page, limit: safeLimit, total, totalPages: Math.ceil(total / safeLimit) } },
            { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
        );
    } catch (error: unknown) {
        console.error('Failed to load professor regrade requests:', error);
        return NextResponse.json(
            { success: false, message: 'Could not load regrade requests', data: null },
            { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }
}
