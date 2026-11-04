import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Permission, UserRole } from '../../../../../constants/permissions';
import { requirePermission } from '../../../../../lib/apiAuth';
import { connectDB } from '../../../../../lib/db';
import { writeAuditLog } from '../../../../../lib/audit';
import Exam from '../../../../../models/Exam';
import Grade from '../../../../../models/Grade';
import RegradeRequest, { RegradeDecisionOutcome, RegradeStatus } from '../../../../../models/RegradeRequest';
import Rubric from '../../../../../models/Rubric';

const decisionSchema = z.object({
    outcome: z.nativeEnum(RegradeDecisionOutcome),
    reason: z.string().trim().min(1).max(2000),
    revisedScore: z.number().finite().nonnegative().optional()
}).strict();

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission(Permission.VIEW_ALL_SUBMISSIONS);
    if (!auth.authorized) {
        return auth.response;
    }

    if (auth.user.role !== UserRole.PROFESSOR && auth.user.role !== UserRole.ADMIN) {
        return NextResponse.json(
            { success: false, message: 'Forbidden', data: null },
            { status: 403 }
        );
    }

    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json(
            { success: false, message: 'Invalid regrade request ID', data: null },
            { status: 400 }
        );
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json(
            { success: false, message: 'Invalid JSON request body', data: null },
            { status: 400 }
        );
    }
    const parsed = decisionSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json(
            { success: false, message: 'A valid decision and reason are required', data: null },
            { status: 400 }
        );
    }

    try {
        await connectDB();
        const regrade = await RegradeRequest.findById(id).select(
            '_id exam answerScript questionNumber student status decision'
        );
        if (!regrade) {
            return NextResponse.json(
                { success: false, message: 'Regrade request not found', data: null },
                { status: 404 }
            );
        }

        const exam = auth.user.role === UserRole.ADMIN
            ? await Exam.findById(regrade.exam).select('_id createdBy totalMarks rubric')
            : await Exam.findOne({ _id: regrade.exam, createdBy: auth.user.id })
                .select('_id createdBy totalMarks rubric');
        if (!exam) {
            return NextResponse.json(
                { success: false, message: 'Regrade request not found', data: null },
                { status: 404 }
            );
        }
        if (regrade.status === RegradeStatus.RESOLVED || regrade.decision) {
            return NextResponse.json(
                { success: false, message: 'This regrade request has already been resolved', data: null },
                { status: 409 }
            );
        }

        const grade = await Grade.findOne({
            answerScript: regrade.answerScript,
            question: regrade.questionNumber,
            isFinal: true
        }).select('totalScore rubric');
        if (!grade) {
            return NextResponse.json(
                { success: false, message: 'The finalized grade for this question was not found', data: null },
                { status: 409 }
            );
        }
        const rubric = await Rubric.findOne({ _id: grade.rubric, exam: exam._id }).select('scoreStep questions');
        const question = rubric?.questions.find(item => item.questionNumber === regrade.questionNumber);
        if (!rubric || !question || !Number.isFinite(rubric.scoreStep) || rubric.scoreStep <= 0) {
            return NextResponse.json(
                { success: false, message: 'The question rubric is unavailable', data: null },
                { status: 409 }
            );
        }

        const { outcome, reason, revisedScore } = parsed.data;
        if (outcome === RegradeDecisionOutcome.REJECTED && revisedScore !== undefined) {
            return NextResponse.json(
                { success: false, message: 'A rejected request cannot include a revised score', data: null },
                { status: 400 }
            );
        }
        if (revisedScore !== undefined) {
            const maximumScore = Math.min(question.maxMarks, exam.totalMarks);
            const scoreSteps = revisedScore / rubric.scoreStep;
            if (revisedScore > maximumScore || Math.abs(scoreSteps - Math.round(scoreSteps)) > 1e-8) {
                return NextResponse.json(
                    { success: false, message: `Revised score must be within 0–${maximumScore} and follow ${rubric.scoreStep}-mark increments`, data: null },
                    { status: 400 }
                );
            }
        }

        const decidedAt = new Date();
        const priorStatus = regrade.status;
        const updated = await RegradeRequest.findOneAndUpdate(
            {
                _id: regrade._id,
                status: { $in: [RegradeStatus.OPEN, RegradeStatus.REVIEWING] },
                decision: { $exists: false }
            },
            {
                $set: {
                    status: RegradeStatus.RESOLVED,
                    isOpen: false,
                    handledBy: new mongoose.Types.ObjectId(auth.user.id),
                    resolutionNotes: reason,
                    decision: {
                        outcome,
                        reason,
                        reviewer: new mongoose.Types.ObjectId(auth.user.id),
                        decidedAt,
                        originalScore: grade.totalScore,
                        ...(outcome === RegradeDecisionOutcome.APPROVED
                            ? { revisedScore: revisedScore ?? grade.totalScore }
                            : {})
                    }
                }
            },
            { returnDocument: 'after', runValidators: true }
        );
        if (!updated) {
            return NextResponse.json(
                { success: false, message: 'This regrade request has already been resolved', data: null },
                { status: 409 }
            );
        }

        const audited = await writeAuditLog({
            user: auth.user.id,
            action: 'REGRADE_DECIDED',
            outcome: 'SUCCESS',
            entityId: regrade._id,
            entityType: 'RegradeRequest',
            ipAddress: request.headers.get('x-forwarded-for') || undefined,
            details: {
                examId: exam._id.toString(),
                studentId: regrade.student.toString(),
                questionNumber: regrade.questionNumber,
                outcome,
                reason,
                originalScore: grade.totalScore,
                revisedScore: outcome === RegradeDecisionOutcome.APPROVED
                    ? revisedScore ?? grade.totalScore
                    : null
            }
        });
        if (!audited) {
            const rollback = await RegradeRequest.updateOne(
                {
                    _id: updated._id,
                    status: RegradeStatus.RESOLVED,
                    'decision.reviewer': auth.user.id,
                    'decision.decidedAt': decidedAt
                },
                {
                    $set: { status: priorStatus, isOpen: true },
                    $unset: { decision: 1, handledBy: 1, resolutionNotes: 1 }
                }
            );
            if (rollback.modifiedCount !== 1) {
                console.error('Failed to roll back unaudited regrade decision', { requestId: id });
            }
            return NextResponse.json(
                { success: false, message: 'Could not record the decision audit event', data: null },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            data: {
                id: updated._id.toString(),
                status: updated.status,
                decision: updated.decision
            }
        }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error: unknown) {
        console.error('Failed to record regrade decision:', error);
        return NextResponse.json(
            { success: false, message: 'Could not record the regrade decision', data: null },
            { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }
}
