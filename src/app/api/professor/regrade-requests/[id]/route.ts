import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { z } from 'zod';
import { UserRole } from '../../../../../constants/permissions';
import { requireAuth } from '../../../../../lib/apiAuth';
import { connectDB } from '../../../../../lib/db';
import { writeAuditLog } from '../../../../../lib/audit';
import Course from '../../../../../models/Course';
import Exam from '../../../../../models/Exam';
import Grade from '../../../../../models/Grade';
import RegradeRequest, { RegradeDecisionOutcome, RegradeStatus } from '../../../../../models/RegradeRequest';
import Rubric from '../../../../../models/Rubric';
import NotificationService from '../../../../../services/NotificationService';
import { NotificationType } from '../../../../../models/Notification';
import { renderNotificationTemplate } from '../../../../../templates/notificationTemplates';

function reviseCriterionMarks(
    marks: Array<{ criterionName: string; score: number; feedback?: string }>,
    criteria: Array<{ criterionName: string; points: number }>,
    targetScore: number,
    scoreStep: number
) {
    const existing = new Map(marks.map(mark => [mark.criterionName, mark]));
    const revised = criteria.map(criterion => {
        const mark = existing.get(criterion.criterionName);
        return {
            criterionName: criterion.criterionName,
            units: Math.round((mark?.score || 0) / scoreStep),
            maxUnits: Math.floor(criterion.points / scoreStep + 1e-8),
            feedback: mark?.feedback || ''
        };
    });
    let remaining = Math.round(targetScore / scoreStep) -
        revised.reduce((total, mark) => total + mark.units, 0);

    for (const mark of revised) {
        const adjustment = remaining > 0
            ? Math.min(remaining, mark.maxUnits - mark.units)
            : -Math.min(-remaining, mark.units);
        mark.units += adjustment;
        remaining -= adjustment;
        if (remaining === 0) break;
    }

    if (remaining !== 0) return null;
    return revised.map(mark => ({
        criterionName: mark.criterionName,
        score: Math.round(mark.units * scoreStep * 1e8) / 1e8,
        ...(mark.feedback ? { feedback: mark.feedback } : {})
    }));
}

const decisionSchema = z.object({
    outcome: z.nativeEnum(RegradeDecisionOutcome),
    reason: z.string().trim().min(1).max(2000),
    revisedScore: z.number().finite().nonnegative().optional()
}).strict();

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    if (![UserRole.PROFESSOR, UserRole.ADMIN, UserRole.TA].includes(auth.user.role)) {
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
            '_id exam answerScript questionNumber student status decision assignedTo'
        );
        if (!regrade) {
            return NextResponse.json(
                { success: false, message: 'Regrade request not found', data: null },
                { status: 404 }
            );
        }

        const isAssignedReviewer = regrade.assignedTo?.toString() === auth.user.id;
        if (auth.user.role === UserRole.TA && !isAssignedReviewer) {
            return NextResponse.json(
                { success: false, message: 'Regrade request not found', data: null },
                { status: 404 }
            );
        }
        let exam = null;
        if (auth.user.role === UserRole.ADMIN || isAssignedReviewer) {
            exam = await Exam.findById(regrade.exam).select('_id createdBy course totalMarks rubric title');
        } else if (auth.user.role === UserRole.PROFESSOR) {
            const profCourses = await Course.find({
                professor: new mongoose.Types.ObjectId(auth.user.id),
                isActive: true
            }).select('_id').lean();
            const profCourseIds = profCourses.map(c => c._id);
            exam = await Exam.findOne({
                _id: regrade.exam,
                $or: [
                    { createdBy: new mongoose.Types.ObjectId(auth.user.id) },
                    { course: { $in: profCourseIds } }
                ]
            }).select('_id createdBy course totalMarks rubric title');
        }
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
        }).select('totalScore rubric marksAwarded');
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
        const approvedScore = outcome === RegradeDecisionOutcome.APPROVED
            ? revisedScore ?? grade.totalScore
            : undefined;
        const updatedMarks = approvedScore !== undefined && approvedScore !== grade.totalScore
            ? reviseCriterionMarks(grade.marksAwarded, question.criteria, approvedScore, rubric.scoreStep)
            : grade.marksAwarded;
        if (updatedMarks === null) {
            return NextResponse.json(
                { success: false, message: 'Revised score cannot be represented by the rubric criteria', data: null },
                { status: 400 }
            );
        }

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
                            ? { revisedScore: approvedScore, gradeAppliedAt: decidedAt }
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

        let updatedGrade: typeof grade | null = null;
        if (approvedScore !== undefined && approvedScore !== grade.totalScore) {
            updatedGrade = await Grade.findOneAndUpdate(
                { _id: grade._id, isFinal: true, totalScore: grade.totalScore },
                { $set: { marksAwarded: updatedMarks, totalScore: approvedScore } },
                { returnDocument: 'after', runValidators: true }
            );
            if (!updatedGrade) {
                await RegradeRequest.updateOne(
                    { _id: updated._id, status: RegradeStatus.RESOLVED, 'decision.decidedAt': decidedAt },
                    {
                        $set: { status: priorStatus, isOpen: true },
                        $unset: { decision: 1, handledBy: 1, resolutionNotes: 1 }
                    }
                );
                return NextResponse.json(
                    { success: false, message: 'The grade changed during review; reload and try again', data: null },
                    { status: 409 }
                );
            }
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
                revisedScore: approvedScore ?? null,
                originalMarks: grade.marksAwarded.map(mark => ({ criterionName: mark.criterionName, score: mark.score })),
                revisedMarks: outcome === RegradeDecisionOutcome.APPROVED
                    ? updatedMarks.map(mark => ({ criterionName: mark.criterionName, score: mark.score }))
                    : null
            }
        });
        if (!audited) {
            if (updatedGrade) {
                const gradeRollback = await Grade.updateOne(
                    { _id: updatedGrade._id, totalScore: approvedScore, updatedAt: updatedGrade.updatedAt },
                    { $set: { marksAwarded: grade.marksAwarded, totalScore: grade.totalScore } }
                );
                if (gradeRollback.modifiedCount !== 1) {
                    console.error('Failed to roll back unaudited grade change', { requestId: id });
                }
            }
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

        let notificationDelivery: 'SENT' | 'FAILED' = 'SENT';
        try {
            const notification = renderNotificationTemplate(NotificationType.REGRADE, {
                examTitle: exam.title,
                question: regrade.questionNumber,
                outcome,
                score: approvedScore
            });
            await NotificationService.createNotifications([{
                recipient: regrade.student,
                type: notification.type,
                title: notification.title,
                message: notification.message,
                exam: exam._id,
                answerScript: regrade.answerScript,
                question: regrade.questionNumber
            }]);
        } catch (notificationError) {
            notificationDelivery = 'FAILED';
            console.error('Regrade decision saved, but student notification delivery failed:', notificationError);
        }

        return NextResponse.json({
            success: true,
            data: {
                id: updated._id.toString(),
                status: updated.status,
                decision: updated.decision,
                notificationDelivery
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
