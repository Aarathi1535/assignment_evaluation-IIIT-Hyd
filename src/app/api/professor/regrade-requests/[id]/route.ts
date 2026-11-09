import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { z } from 'zod';
import { UserRole } from '../../../../../constants/permissions';
import { requireAuth } from '../../../../../lib/apiAuth';
import { connectDB } from '../../../../../lib/db';
import { writeAuditLog } from '../../../../../lib/audit';
import Exam from '../../../../../models/Exam';
import Course from '../../../../../models/Course';
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

        const exam = await Exam.findById(regrade.exam).select('_id createdBy totalMarks rubric title course isActive');
        if (!exam || !exam.isActive) {
            return NextResponse.json(
                { success: false, message: 'Regrade request not found', data: null },
                { status: 404 }
            );
        }

        const course = await Course.findById(exam.course).select('professor teachingAssistants isActive');
        if (!course || !course.isActive) {
            return NextResponse.json(
                { success: false, message: 'Regrade request not found', data: null },
                { status: 404 }
            );
        }

        const isCourseProfessor = course.professor.toString() === auth.user.id;
        const isExamOwner = auth.user.role === UserRole.ADMIN ||
            (auth.user.role === UserRole.PROFESSOR && isCourseProfessor);

        const isCourseStaff = isCourseProfessor ||
            course.teachingAssistants.some(ta => ta.toString() === auth.user.id);

        const isAssignedReviewer = regrade.assignedTo?.toString() === auth.user.id;
        if (!isExamOwner && (!isCourseStaff || !isAssignedReviewer)) {
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
            $or: [
                { question: regrade.questionNumber },
                { question: null },
                { question: { $exists: false } }
            ],
            isFinal: true
        }).select('totalScore rubric marksAwarded gradedBy');
        if (!grade) {
            return NextResponse.json(
                { success: false, message: 'The finalized grade for this question was not found', data: null },
                { status: 409 }
            );
        }

        // Requirement 3: Block deciding by original grader unless it's the professor / exam owner
        const isOriginalGrader = Boolean(grade.gradedBy && grade.gradedBy.toString() === auth.user.id);
        if (isOriginalGrader && !isExamOwner) {
            return NextResponse.json(
                { success: false, message: 'Reviewers cannot decide regrade requests for questions they graded', data: null },
                { status: 403 }
            );
        }

        const rubric = await Rubric.findOne({ _id: grade.rubric, exam: exam._id }).select('scoreStep questions');
        const question = rubric?.questions.find(item => item.questionNumber === regrade.questionNumber)
            || (rubric?.questions.length === 1 ? rubric.questions[0] : undefined);
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

        // Setup transaction if capable
        const client = (mongoose.connection as unknown as { client?: { topology?: { description?: { type?: string } } } })?.client;
        const topology = client?.topology;
        const topologyType = (topology?.description?.type as string | undefined) ?? 'Unknown';
        const transactionCapable = [
            'ReplicaSetWithPrimary',
            'ReplicaSetNoPrimary',
            'Sharded',
            'LoadBalanced',
        ].includes(topologyType);

        const session = transactionCapable ? await mongoose.startSession() : null;
        if (session) {
            session.startTransaction();
        }

        try {
            const updateFilter: Record<string, unknown> = {
                _id: regrade._id,
                status: { $in: [RegradeStatus.OPEN, RegradeStatus.REVIEWING] },
                decision: { $exists: false }
            };
            if (!isExamOwner) {
                updateFilter.assignedTo = new mongoose.Types.ObjectId(auth.user.id);
            }

            const updated = await RegradeRequest.findOneAndUpdate(
                updateFilter,
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
                { returnDocument: 'after', runValidators: true, session: session || undefined }
            );
            if (!updated) {
                if (session) await session.abortTransaction();
                return NextResponse.json(
                    { success: false, message: 'This regrade request has already been resolved or reassigned', data: null },
                    { status: 409 }
                );
            }

            let updatedGrade: typeof grade | null = null;
            if (approvedScore !== undefined && approvedScore !== grade.totalScore) {
                updatedGrade = await Grade.findOneAndUpdate(
                    { _id: grade._id, isFinal: true, totalScore: grade.totalScore },
                    { $set: { marksAwarded: updatedMarks, totalScore: approvedScore } },
                    { returnDocument: 'after', runValidators: true, session: session || undefined }
                );
                if (!updatedGrade) {
                    if (session) {
                        await session.abortTransaction();
                    } else {
                        await RegradeRequest.updateOne(
                            { _id: updated._id, status: RegradeStatus.RESOLVED, 'decision.decidedAt': decidedAt },
                            {
                                $set: { status: priorStatus, isOpen: true },
                                $unset: { decision: 1, handledBy: 1, resolutionNotes: 1 }
                            }
                        );
                    }
                    return NextResponse.json(
                        { success: false, message: 'The grade changed during review; reload and try again', data: null },
                        { status: 409 }
                    );
                }
            }

            const auditDetails: Record<string, unknown> = {
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
            };
            if (isOriginalGrader && isExamOwner) {
                auditDetails.note = 'Original grader is exam professor; self-review permitted for course owner';
            }

            const audited = await writeAuditLog({
                user: auth.user.id,
                action: 'REGRADE_DECIDED',
                outcome: 'SUCCESS',
                entityId: regrade._id,
                entityType: 'RegradeRequest',
                ipAddress: request.headers.get('x-forwarded-for') || undefined,
                details: auditDetails,
                session: session || undefined
            });

            if (!audited) {
                if (session) {
                    await session.abortTransaction();
                } else {
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
                }
                return NextResponse.json(
                    { success: false, message: 'Could not record the decision audit event', data: null },
                    { status: 500 }
                );
            }

            if (session) {
                await session.commitTransaction();
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
        } catch (innerError) {
            if (session) {
                try {
                    await session.abortTransaction();
                } catch {
                    // Ignore abort error
                }
            }
            throw innerError;
        } finally {
            if (session) {
                session.endSession();
            }
        }
    } catch (error: unknown) {
        console.error('Failed to record regrade decision:', error);
        return NextResponse.json(
            { success: false, message: 'Could not record the regrade decision', data: null },
            { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }
}
