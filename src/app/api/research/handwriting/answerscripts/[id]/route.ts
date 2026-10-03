import mongoose from 'mongoose';
import { NextRequest, NextResponse } from 'next/server';
import { UserRole } from '../../../../../../constants/permissions';
import { requireAuth, requireFeature } from '../../../../../../lib/apiAuth';
import { connectDB } from '../../../../../../lib/db';
import { HttpError } from '../../../../../../lib/errors';
import AnswerScript from '../../../../../../models/AnswerScript';
import Exam from '../../../../../../models/Exam';
import { ComparisonMatchState } from '../../../../../../models/HandwritingConsistency';
import answerSheetHandwritingIntegrationService from '../../../../../../services/handwriting/AnswerSheetHandwritingIntegrationService';
import ScriptFlagService from '../../../../../../services/ScriptFlagService';
import HandwritingComparisonModel from '../../../../../../models/HandwritingComparison';
import HandwritingProfileModel from '../../../../../../models/HandwritingProfile';
import ExamRepository from '../../../../../../repositories/ExamRepository';
import ScriptFlag, { FlagReason } from '../../../../../../models/ScriptFlag';

/** Load persisted analysis evidence for an authorized AnswerScript. */
export async function GET(
    _request: NextRequest,
    context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
    const featureCheck = requireFeature('HANDWRITING_CONSISTENCY');
    if (!featureCheck.authorized) return featureCheck.response;
    const auth = await requireAuth();
    if (!auth.authorized) return auth.response;
    const role = auth.user.role?.toUpperCase();
    if (role !== UserRole.PROFESSOR && role !== UserRole.ADMIN) {
        return NextResponse.json({ success: false, message: 'Professor access is required', data: null }, { status: 403 });
    }
    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json({ success: false, message: 'Invalid AnswerScript ID format', data: null }, { status: 400 });
    }
    try {
        await connectDB();
        const script = await AnswerScript.findOne({ _id: id, isActive: true }).select('exam student metadata');
        if (!script) throw new HttpError('AnswerScript not found', 404);
        if (!(await ExamRepository.getExamById(script.exam.toString(), auth.user.id, role))) {
            throw new HttpError('Forbidden: You do not have access to this AnswerScript exam', 403);
        }
        const stored = (script.metadata as Record<string, unknown> | undefined)?.handwritingAnalysis as Record<string, unknown> | undefined;
        if (stored) {
            const flag = await ScriptFlag.findOne({ answerScript: script._id, reason: FlagReason.HANDWRITING_DISCREPANCY }).sort({ createdAt: -1 });
            return NextResponse.json({ success: true, data: { ...stored, flagId: flag?._id.toString() ?? null } });
        }
        const comparisons = await HandwritingComparisonModel.find({ answerScriptId: script._id }).sort({ pageNumber: 1, comparedAt: -1 });
        if (comparisons.length === 0) throw new HttpError('No persisted handwriting analysis was found', 404);
        const profile = script.student
            ? await HandwritingProfileModel.findOne({ student: script.student, isCurrent: true }).sort({ profileVersion: -1 })
            : null;
        const flag = await ScriptFlag.findOne({ answerScript: script._id, reason: FlagReason.HANDWRITING_DISCREPANCY }).sort({ createdAt: -1 });
        const latestByPage = new Map<number, typeof comparisons[number]>();
        for (const comparison of comparisons) {
            if (comparison.pageNumber !== undefined && !latestByPage.has(comparison.pageNumber)) latestByPage.set(comparison.pageNumber, comparison);
        }
        const evidence = [...latestByPage.values()];
        const reviewRequired = evidence.some(item => item.status === ComparisonMatchState.REVIEW_REQUIRED);
        const outcome = reviewRequired ? 'REVIEW_REQUIRED'
            : evidence.every(item => item.status === ComparisonMatchState.INSUFFICIENT_SAMPLE) ? 'INSUFFICIENT_SAMPLE'
                : evidence.some(item => item.profile) ? 'PROFILE_COMPARISON'
                    : evidence.some(item => item.status === ComparisonMatchState.MATCH) ? 'BASELINE_BUILDING' : 'INCONCLUSIVE';
        return NextResponse.json({ success: true, data: {
            answerScriptId: id, outcome, pagesProcessed: evidence.length,
            profileSampleCount: profile?.sampleCount ?? 0, profileStatus: profile?.status,
            reviewRequired, flagId: flag?._id.toString() ?? null,
            comparisons: evidence.map(item => ({ pageNumber: item.pageNumber, status: item.status, distance: item.distance,
                confidence: item.confidence, featureDeviations: item.featureDeviations, anomalyFactors: item.anomalyFactors }))
        } });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Could not load persisted handwriting analysis';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json({ success: false, message, data: null }, { status });
    }
}

/** Analyze an identified real AnswerScript using its stored page images. */
export async function POST(
    _request: NextRequest,
    context: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
    const featureCheck = requireFeature('HANDWRITING_CONSISTENCY');
    if (!featureCheck.authorized) return featureCheck.response;

    const auth = await requireAuth();
    if (!auth.authorized) return auth.response;
    const role = auth.user.role?.toUpperCase();
    if (role !== UserRole.PROFESSOR && role !== UserRole.ADMIN) {
        return NextResponse.json(
            { success: false, message: 'Only Professors and Admins may analyze handwriting', data: null },
            { status: 403 }
        );
    }

    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json({ success: false, message: 'Invalid AnswerScript ID format', data: null }, { status: 400 });
    }

    try {
        await connectDB();
        const script = await AnswerScript.findOne({ _id: id, isActive: true }).select('exam');
        if (!script) throw new HttpError('AnswerScript not found', 404);
        if (role === UserRole.PROFESSOR && !(await Exam.exists({ _id: script.exam, createdBy: auth.user.id }))) {
            throw new HttpError('Forbidden: You do not own this AnswerScript exam', 403);
        }

        const authContext = { userId: auth.user.id, role };
        const analysis = await answerSheetHandwritingIntegrationService.analyzeAnswerScriptInternalConsistency(id, authContext);
        const comparisons = analysis.comparisons;
        const discrepancies = comparisons.filter(item => item.status === ComparisonMatchState.REVIEW_REQUIRED);
        let flagId: string | null = null;
        if (discrepancies.length > 0) {
            const evidence = discrepancies.map(item =>
                `page ${item.pageNumber ?? '?'}: distance ${item.distance.toFixed(4)}, confidence ${item.confidence.toFixed(4)}${item.anomalyFactors.length ? `; ${item.anomalyFactors.join(', ')}` : ''}${item.featureDeviations.length ? `; deviations ${item.featureDeviations.slice(0, 4).map(value => `${value.feature} ${value.normalizedDeviation.toFixed(2)}σ`).join(', ')}` : ''}`
            ).join(' | ');
            const flagNote = `Handwriting discrepancy detected within this AnswerScript. Professor review recommended. Full-page signals: ${evidence}. This is not proof of authorship or misconduct.`.slice(0, 2000);
            const flag = await ScriptFlagService.createHandwritingDiscrepancyFlag({
                scriptId: id,
                userId: auth.user.id,
                userRole: role,
                note: flagNote,
                ipAddress: _request.headers.get('x-forwarded-for') || undefined
            });
            flagId = flag._id.toString();
        }

        const comparisonsData = comparisons.map(item => ({
            pageNumber: item.pageNumber,
            status: item.status,
            distance: item.distance,
            confidence: item.confidence,
            featureDeviations: item.featureDeviations,
            anomalyFactors: item.anomalyFactors
        }));
        const persistedAnalysis = {
            answerScriptId: id,
            studentId: analysis.studentId,
            outcome: analysis.outcome,
            pagesProcessed: analysis.pagesProcessed,
            comparisons: comparisonsData,
            reviewRequired: discrepancies.length > 0,
            flagId,
            analyzedAt: new Date().toISOString()
        };
        await AnswerScript.updateOne(
            { _id: id, isActive: true },
            { $set: { 'metadata.handwritingAnalysis': persistedAnalysis } }
        );

        return NextResponse.json({
            success: true,
            message: analysis.outcome === 'DISCREPANCY_DETECTED'
                ? 'Handwriting discrepancy detected. Professor review recommended.'
                : analysis.outcome === 'INCONCLUSIVE'
                    ? 'Inconclusive: not enough usable handwriting evidence to assess this answer sheet.'
                    : 'No significant handwriting discrepancy detected.',
            data: persistedAnalysis
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json({ success: false, message, data: null }, { status });
    }
}
