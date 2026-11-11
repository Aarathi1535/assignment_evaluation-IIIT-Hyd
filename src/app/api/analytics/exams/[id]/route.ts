import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { Permission, UserRole } from '../../../../../constants/permissions';
import { requirePermission } from '../../../../../lib/apiAuth';
import { connectDB } from '../../../../../lib/db';
import {
    calculateDescriptiveStatistics,
    calculateQuestionPerformance,
    calculateScoreDistribution
} from '../../../../../lib/stats';
import { ExamStatus } from '../../../../../models/Exam';
import Rubric from '../../../../../models/Rubric';
import ExamRepository from '../../../../../repositories/ExamRepository';
import StudentResultService from '../../../../../services/StudentResultService';

export const dynamic = 'force-dynamic';

export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission(Permission.VIEW_ALL_SUBMISSIONS);
    if (!auth.authorized) {
        return auth.response;
    }
    if (auth.user.role !== UserRole.ADMIN && auth.user.role !== UserRole.PROFESSOR) {
        return NextResponse.json(
            { success: false, message: 'Forbidden', data: null },
            { status: 403, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }

    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json(
            { success: false, message: 'Invalid exam ID', data: null },
            { status: 400, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }

    try {
        await connectDB();
        const exam = await ExamRepository.getExamById(id, auth.user.id, auth.user.role);
        if (!exam) {
            return NextResponse.json(
                { success: false, message: 'Exam not found', data: null },
                { status: 404, headers: { 'Cache-Control': 'private, no-store' } }
            );
        }
        if (!exam.isActive || exam.status !== ExamStatus.PUBLISHED) {
            return NextResponse.json(
                { success: false, message: 'Analytics are available only for published exams', data: null },
                { status: 409, headers: { 'Cache-Control': 'private, no-store' } }
            );
        }

        const releasedScores = await StudentResultService.getPublishedExamScores(exam);
        const statistics = calculateDescriptiveStatistics(releasedScores.map(result => result.score));
        const questionScores = await StudentResultService.getPublishedExamQuestionScores(
            exam,
            releasedScores.map(result => result.scriptId)
        );

        let examMaxMarks = exam.totalMarks;
        if (exam.rubric) {
            const rubric = await Rubric.findById(exam.rubric).lean();
            if (rubric && Array.isArray(rubric.questions)) {
                const rubricTotal = rubric.questions.reduce(
                    (sum: number, q: { maxMarks?: number }) => sum + (Number(q.maxMarks) || 0),
                    0
                );
                if (rubricTotal > 0) {
                    examMaxMarks = rubricTotal;
                }
            }
        }

        return NextResponse.json(
            {
                success: true,
                data: {
                    exam: {
                        id: exam._id.toString(),
                        title: exam.title,
                        maxMarks: examMaxMarks
                    },
                    classStatistics: {
                        count: statistics.count,
                        mean: statistics.mean,
                        median: statistics.median,
                        standardDeviation: statistics.standardDeviation,
                        standardDeviationMethod: 'population'
                    },
                    scoreDistribution: calculateScoreDistribution(releasedScores),
                    questionStatistics: calculateQuestionPerformance(
                        questionScores.questions,
                        questionScores.observations
                    ),
                    questionMetric: {
                        scoreNormalization: 'Each final score is divided by the question maximum from the rubric version used for that grade.',
                        spread: 'Population standard deviation of normalized scores, in percentage points.',
                        difficultyFormula: 'Difficulty index = 100 - mean score percentage; higher values indicate a harder question.'
                    }
                }
            },
            { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
        );
    } catch (error: unknown) {
        console.error('Failed to calculate exam analytics:', error);
        return NextResponse.json(
            { success: false, message: 'Could not calculate exam analytics', data: null },
            { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }
}
