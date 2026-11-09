import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { UserRole } from '../../../../constants/permissions';
import { connectDB } from '../../../../lib/db';
import { requireAuth } from '../../../../lib/apiAuth';
import Course from '../../../../models/Course';
import Exam from '../../../../models/Exam';
import Grade from '../../../../models/Grade';
import RegradeRequest, { RegradeStatus } from '../../../../models/RegradeRequest';
import Rubric from '../../../../models/Rubric';
import User from '../../../../models/User';

export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 50;

export async function GET(request: NextRequest) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    if (![UserRole.PROFESSOR, UserRole.ADMIN, UserRole.TA].includes(auth.user.role)) {
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

        let ownedExamIds: mongoose.Types.ObjectId[] = [];
        if (auth.user.role === UserRole.ADMIN) {
            const ownedExams = await Exam.find(examId ? { _id: examId } : {}).select('_id').lean();
            ownedExamIds = ownedExams.map(exam => exam._id);
        } else if (auth.user.role === UserRole.PROFESSOR) {
            const profCourses = await Course.find({
                professor: new mongoose.Types.ObjectId(auth.user.id),
                isActive: true
            }).select('_id').lean();
            const profCourseIds = profCourses.map(c => c._id);
            const ownedExams = await Exam.find({
                course: { $in: profCourseIds },
                ...(examId ? { _id: examId } : {})
            }).select('_id').lean();
            ownedExamIds = ownedExams.map(exam => exam._id);
        }
        const baseFilter = examId ? { exam: new mongoose.Types.ObjectId(examId) } : {};
        const accessFilter = auth.user.role === UserRole.ADMIN
            ? baseFilter
            : auth.user.role === UserRole.TA
                ? { ...baseFilter, assignedTo: new mongoose.Types.ObjectId(auth.user.id) }
                : {
                    ...baseFilter,
                    $or: [
                        { exam: { $in: ownedExamIds } },
                        { assignedTo: new mongoose.Types.ObjectId(auth.user.id) }
                    ]
                };
        const query = {
            ...accessFilter,
            ...(rawStatus ? { status: rawStatus as RegradeStatus } : {})
        };
        const safeLimit = Math.min(limit, MAX_PAGE_SIZE);
        const [requests, total] = await Promise.all([
            RegradeRequest.find(query)
                .sort({ createdAt: -1, _id: -1 })
                .skip((page - 1) * safeLimit)
                .limit(safeLimit)
                .select('_id exam answerScript questionNumber student reason status createdAt updatedAt decision assignedTo')
                .lean(),
            RegradeRequest.countDocuments(query)
        ]);

        const scriptIds = [...new Set(requests.map(item => item.answerScript.toString()))];
        const studentIds = [...new Set(requests.map(item => item.student.toString()))];
        const examIds = [...new Set(requests.map(item => item.exam.toString()))];
        const [students, grades, exams] = await Promise.all([
            User.find({ _id: { $in: studentIds } }).select('_id name email').lean(),
            Grade.find({
                answerScript: { $in: scriptIds },
                isFinal: true
            }).select('answerScript question totalScore marksAwarded feedback rubric').lean(),
            Exam.find({ _id: { $in: examIds } }).select('_id title rubric createdBy course').lean()
        ]);
        if (examId && requests.length === 0 && ownedExamIds.length === 0) {
            return NextResponse.json(
                { success: false, message: 'Exam not found', data: null },
                { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
            );
        }

        const rubricIds = [
            ...new Set(exams.map(exam => exam.rubric?.toString()).filter((value): value is string => Boolean(value))),
            ...new Set(grades.map(grade => grade.rubric.toString()))
        ];
        const [rubrics, courses] = await Promise.all([
            Rubric.find({ _id: { $in: rubricIds } }).select('exam questions').lean(),
            Course.find({ _id: { $in: exams.map(exam => exam.course) } })
                .select('_id professor teachingAssistants').lean()
        ]);

        const examById = new Map(exams.map(exam => [exam._id.toString(), exam]));
        const studentById = new Map(students.map(student => [student._id.toString(), student]));
        const rubricByExam = new Map(rubrics.map(rubric => [rubric.exam.toString(), rubric]));
        const candidateIds = [...new Set(courses.flatMap(course => [
            course.professor.toString(),
            ...course.teachingAssistants.map(ta => ta.toString())
        ]))];
        const candidates = await User.find({
            _id: { $in: candidateIds },
            isActive: true,
            role: { $in: [UserRole.TA, UserRole.PROFESSOR] }
        }).select('_id name email role').lean();
        const candidateById = new Map(candidates.map(candidate => [candidate._id.toString(), candidate]));
        const courseById = new Map(courses.map(course => [course._id.toString(), course]));

        const data = requests.map(item => {
            const exam = examById.get(item.exam.toString());
            const grade = grades.find(candidate =>
                candidate.answerScript.toString() === item.answerScript.toString() &&
                (candidate.question === item.questionNumber || candidate.question === null || candidate.question === undefined)
            );
            const rubric = grade
                ? rubrics.find(candidate => candidate._id.toString() === grade.rubric.toString())
                : rubricByExam.get(item.exam.toString());
            const question = rubric?.questions.find(candidate => candidate.questionNumber === item.questionNumber)
                || (rubric?.questions.length === 1 ? rubric.questions[0] : undefined);
            const student = studentById.get(item.student.toString());
            const course = exam ? courseById.get(exam.course.toString()) : undefined;
            const isExamOwner = auth.user.role === UserRole.ADMIN ||
                (auth.user.role === UserRole.PROFESSOR && course?.professor.toString() === auth.user.id);
            const assignedTo = item.assignedTo ? candidateById.get(item.assignedTo.toString()) : undefined;
            const reviewers = (course && isExamOwner)
                ? [...new Set([
                    course.professor.toString(),
                    ...course.teachingAssistants.map(ta => ta.toString())
                ])].map(candidateId => candidateById.get(candidateId))
                    .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
                : [];

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
                assignedTo: assignedTo ? {
                    id: assignedTo._id.toString(),
                    name: assignedTo.name,
                    email: assignedTo.email
                } : null,
                canManageAssignment: isExamOwner,
                reviewers,
                decision: item.decision ? {
                    outcome: item.decision.outcome,
                    reason: item.decision.reason,
                    originalScore: item.decision.originalScore,
                    revisedScore: item.decision.revisedScore,
                    decidedAt: item.decision.decidedAt
                } : null,
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
