import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import { requireAuth, requireFeature } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';
import { handwritingEvaluationService } from '../../../../../services/handwriting/HandwritingEvaluationService';
import { UserRole } from '../../../../../constants/permissions';

/**
 * GET /api/research/handwriting/evaluation
 *
 * Runs or retrieves the empirical False-Positive Rate benchmark evaluation.
 * Accessible to Admin, Professor, and TA roles.
 */
export async function GET(req: NextRequest) {
    const feature = requireFeature('HANDWRITING_CONSISTENCY');
    if (!feature.authorized) {
        return feature.response;
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }
    const currentUser = auth.user;

    const isStaff = [UserRole.ADMIN, UserRole.PROFESSOR, UserRole.TA].includes(currentUser.role);
    if (!isStaff) {
        return NextResponse.json(
            { success: false, message: 'Forbidden: only instructors and researchers may view evaluation metrics', data: null },
            { status: 403 }
        );
    }

    const { searchParams } = new URL(req.url);
    const studentIdsParam = searchParams.get('studentIds');
    const studentIds = studentIdsParam ? studentIdsParam.split(',').map(s => s.trim()).filter(Boolean) : [];

    try {
        await connectDB();

        const metrics = await handwritingEvaluationService.evaluateRegisteredCorpus(
            studentIds,
            { userId: currentUser.id, role: currentUser.role }
        );

        return NextResponse.json(
            {
                success: true,
                message: 'Empirical handwriting consistency evaluation completed',
                data: metrics
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json({ success: false, message, data: null }, { status });
    }
}

/**
 * POST /api/research/handwriting/evaluation
 *
 * Evaluates custom student groups or custom labeled sample datasets.
 */
export async function POST(req: NextRequest) {
    const feature = requireFeature('HANDWRITING_CONSISTENCY');
    if (!feature.authorized) {
        return feature.response;
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }
    const currentUser = auth.user;

    const isStaff = [UserRole.ADMIN, UserRole.PROFESSOR, UserRole.TA].includes(currentUser.role);
    if (!isStaff) {
        return NextResponse.json(
            { success: false, message: 'Forbidden: only instructors and researchers may trigger evaluation benchmarks', data: null },
            { status: 403 }
        );
    }

    try {
        const body = await req.json();
        const { studentIds, dataset } = body;

        await connectDB();

        if (dataset && Array.isArray(dataset)) {
            const { metrics, pairwiseResults } = await handwritingEvaluationService.evaluateDataset(dataset);
            return NextResponse.json(
                {
                    success: true,
                    message: 'Dataset evaluation completed',
                    data: { metrics, totalPairwiseComparisons: pairwiseResults.length }
                },
                { status: 200 }
            );
        }

        const idsToEvaluate = Array.isArray(studentIds) ? studentIds : [];
        const metrics = await handwritingEvaluationService.evaluateRegisteredCorpus(
            idsToEvaluate,
            { userId: currentUser.id, role: currentUser.role }
        );

        return NextResponse.json(
            {
                success: true,
                message: 'Registered corpus evaluation completed',
                data: metrics
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json({ success: false, message, data: null }, { status });
    }
}
