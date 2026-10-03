import { NextResponse } from 'next/server';
import { requireFeature, requirePermission } from '@/lib/apiAuth';
import { connectDB } from '@/lib/db';
import { Permission, UserRole } from '@/constants/permissions';
import { HttpError } from '@/lib/errors';
import ExamService from '@/services/ExamService';
import AnswerScript from '@/models/AnswerScript';
import HandwritingComparisonModel from '@/models/HandwritingComparison';
import { ComparisonMatchState } from '@/models/HandwritingConsistency';

interface PopulatedValue {
    _id: { toString(): string };
    name?: string;
    email?: string;
    title?: string;
}

/** Return recent persisted analyses from exams the current Professor can access. */
export async function GET(): Promise<NextResponse> {
    const featureCheck = requireFeature('HANDWRITING_CONSISTENCY');
    if (!featureCheck.authorized) return featureCheck.response;
    const auth = await requirePermission(Permission.VIEW_COURSES);
    if (!auth.authorized) return auth.response;
    const role = auth.user.role?.toUpperCase();
    if (role !== UserRole.PROFESSOR && role !== UserRole.ADMIN) {
        return NextResponse.json({ success: false, message: 'Professor access is required', data: null }, { status: 403 });
    }

    try {
        await connectDB();
        const exams = await ExamService.getAllExams(auth.user.id, role);
        if (exams.length === 0) return NextResponse.json({ success: true, data: [] });
        const scripts = await AnswerScript.find({
            exam: { $in: exams.map(exam => exam._id) },
            isActive: true,
            student: { $ne: null },
            identificationStatus: 'IDENTIFIED'
        })
            .sort({ updatedAt: -1 })
            .limit(100)
            .populate('student', 'name email')
            .populate('exam', 'title');

        const scriptIds = scripts.map(script => script._id);
        const comparisons = await HandwritingComparisonModel.find({ answerScriptId: { $in: scriptIds } })
            .sort({ comparedAt: -1 });
        const latestByScript = new Map<string, typeof comparisons>();
        for (const comparison of comparisons) {
            const key = comparison.answerScriptId?.toString();
            if (!key) continue;
            const items = latestByScript.get(key) || [];
            items.push(comparison);
            latestByScript.set(key, items);
        }

        const data = scripts.flatMap(script => {
            const student = script.student as unknown as PopulatedValue | null;
            const exam = script.exam as unknown as PopulatedValue | null;
            const analysis = latestByScript.get(script._id.toString()) || [];
            if (analysis.length === 0) return [];
            const hasReview = analysis.some(item => item.status === ComparisonMatchState.REVIEW_REQUIRED);
            const currentProfileComparison = analysis.find(item => Boolean(item.profile));
            const status = hasReview
                ? 'REVIEW_REQUIRED'
                : currentProfileComparison
                    ? currentProfileComparison.status
                    : analysis[0].status === ComparisonMatchState.MATCH
                        ? 'BASELINE_BUILDING'
                        : analysis[0].status;
            const updatedAt = analysis[0].comparedAt || script.updatedAt;
            return [{
                answerScriptId: script._id.toString(),
                student: student ? { name: student.name || '', email: student.email || '' } : null,
                examTitle: exam?.title || 'Exam',
                submission: script.filename || `AS-${script._id.toString().slice(-6).toUpperCase()}`,
                date: updatedAt.toISOString(),
                status
            }];
        });

        return NextResponse.json({ success: true, data });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Could not load handwriting analysis history';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json({ success: false, message, data: null }, { status });
    }
}
