import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { Permission, UserRole } from '../../../../../../constants/permissions';
import { requirePermission } from '../../../../../../lib/apiAuth';
import { connectDB } from '../../../../../../lib/db';
import {
    calculateGraderConsistency,
    MIN_GRADER_CONSISTENCY_SAMPLE_SIZE
} from '../../../../../../lib/stats';
import { ExamStatus } from '../../../../../../models/Exam';
import ExamRepository from '../../../../../../repositories/ExamRepository';
import StudentResultService from '../../../../../../services/StudentResultService';

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

        const observations = await StudentResultService.getPublishedExamGradeObservations(exam);
        const graderNames = new Map(observations.map(observation => [
            observation.graderId,
            observation.graderName
        ]));
        const graders = calculateGraderConsistency(observations).map(metric => ({
            ...metric,
            name: graderNames.get(metric.graderId) || 'Unknown TA'
        }));

        return NextResponse.json(
            {
                success: true,
                data: {
                    exam: { id: exam._id.toString(), title: exam.title },
                    metric: {
                        name: 'Mean absolute deviation from comparable question cohort mean',
                        unit: 'percentage_points',
                        direction: 'lower_is_closer_to_cohort_mean',
                        minimumSampleSize: MIN_GRADER_CONSISTENCY_SAMPLE_SIZE,
                        comparisonBasis: 'Final released scores grouped by rubric and question; scores are normalized to percentages.',
                        limitation: 'This is a grading-drift proxy, not formal inter-rater reliability: graders may have different student populations and the system does not retain independent duplicate scores for every script.'
                    },
                    graders
                }
            },
            { status: 200, headers: { 'Cache-Control': 'private, no-store' } }
        );
    } catch (error: unknown) {
        console.error('Failed to calculate TA grading consistency:', error);
        return NextResponse.json(
            { success: false, message: 'Could not calculate TA grading consistency', data: null },
            { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }
}
