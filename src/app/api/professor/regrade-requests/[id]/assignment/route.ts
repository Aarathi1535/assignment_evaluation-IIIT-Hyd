import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Permission, UserRole } from '../../../../../../constants/permissions';
import { requirePermission } from '../../../../../../lib/apiAuth';
import { writeAuditLog } from '../../../../../../lib/audit';
import { connectDB } from '../../../../../../lib/db';
import Course from '../../../../../../models/Course';
import Exam from '../../../../../../models/Exam';
import Grade from '../../../../../../models/Grade';
import RegradeRequest, { RegradeStatus } from '../../../../../../models/RegradeRequest';
import User, { type IUser } from '../../../../../../models/User';

const assignmentSchema = z.object({
    reviewerId: z.string().refine(value => value === '' || mongoose.Types.ObjectId.isValid(value))
}).strict();

export async function PATCH(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const auth = await requirePermission(Permission.VIEW_ALL_SUBMISSIONS);
    if (!auth.authorized) return auth.response;
    if (auth.user.role !== UserRole.PROFESSOR && auth.user.role !== UserRole.ADMIN) {
        return NextResponse.json({ success: false, message: 'Forbidden', data: null }, { status: 403 });
    }

    const { id } = await context.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return NextResponse.json({ success: false, message: 'Invalid regrade request ID', data: null }, { status: 400 });
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ success: false, message: 'Invalid JSON request body', data: null }, { status: 400 });
    }
    const parsed = assignmentSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ success: false, message: 'A valid reviewer ID is required', data: null }, { status: 400 });
    }

    try {
        await connectDB();
        const regrade = await RegradeRequest.findById(id).select(
            '_id exam answerScript questionNumber status assignedTo assignedBy assignedAt'
        );
        if (!regrade) {
            return NextResponse.json({ success: false, message: 'Regrade request not found', data: null }, { status: 404 });
        }
        if (regrade.status === RegradeStatus.RESOLVED) {
            return NextResponse.json({ success: false, message: 'Resolved requests cannot be assigned', data: null }, { status: 409 });
        }

        const exam = auth.user.role === UserRole.ADMIN
            ? await Exam.findById(regrade.exam).select('_id createdBy course')
            : await Exam.findOne({ _id: regrade.exam, createdBy: auth.user.id }).select('_id createdBy course');
        if (!exam) {
            return NextResponse.json({ success: false, message: 'Regrade request not found', data: null }, { status: 404 });
        }

        const reviewerId = parsed.data.reviewerId || null;
        const previousAssignee = regrade.assignedTo?.toString() || null;
        if (reviewerId === previousAssignee) {
            return NextResponse.json({
                success: true,
                data: { id: regrade._id.toString(), assignedTo: previousAssignee }
            }, { status: 200 });
        }

        let reviewer: IUser | null = null;
        let isOriginalGrader = false;
        let isExamProfessor = false;
        if (reviewerId) {
            const [course, candidate, grade] = await Promise.all([
                Course.findById(exam.course).select('professor teachingAssistants'),
                User.findOne({
                    _id: reviewerId,
                    isActive: true,
                    role: { $in: [UserRole.TA, UserRole.PROFESSOR] }
                }).select('_id role isActive name email'),
                Grade.findOne({
                    answerScript: regrade.answerScript,
                    $or: [
                        { question: regrade.questionNumber },
                        { question: null },
                        { question: { $exists: false } }
                    ],
                    isFinal: true
                }).select('gradedBy')
            ]);
            const isCourseTa = Boolean(course?.teachingAssistants.some(ta => ta.equals(reviewerId)));
            isExamProfessor = Boolean(candidate?.role === UserRole.PROFESSOR &&
                candidate._id.equals(exam.createdBy) &&
                course?.professor.equals(exam.createdBy));
            const isAuthorizedTa = candidate?.role === UserRole.TA && isCourseTa;
            if (!candidate || (!isAuthorizedTa && !isExamProfessor)) {
                return NextResponse.json(
                    { success: false, message: 'Reviewer must be an active TA assigned to the course or the exam owner', data: null },
                    { status: 400 }
                );
            }

            isOriginalGrader = Boolean(grade?.gradedBy && grade.gradedBy.toString() === reviewerId);
            if (isOriginalGrader && !isExamProfessor) {
                return NextResponse.json(
                    { success: false, message: 'Reviewer cannot be the original grader for this question', data: null },
                    { status: 400 }
                );
            }

            reviewer = candidate;
        }

        const assignedAt = new Date();
        const assignee = reviewer?._id ?? null;
        const assignedBy = new mongoose.Types.ObjectId(auth.user.id);
        const updated = await RegradeRequest.findOneAndUpdate(
            {
                _id: regrade._id,
                status: { $in: [RegradeStatus.OPEN, RegradeStatus.REVIEWING] },
                assignedTo: previousAssignee ? new mongoose.Types.ObjectId(previousAssignee) : null
            },
            {
                $set: { assignedTo: assignee, assignedBy, assignedAt },
                $push: { assignmentHistory: { assignee, assignedBy, assignedAt } }
            },
            { returnDocument: 'after', runValidators: true }
        );
        if (!updated) {
            return NextResponse.json(
                { success: false, message: 'Assignment changed during this request; reload and try again', data: null },
                { status: 409 }
            );
        }

        const audited = await writeAuditLog({
            user: auth.user.id,
            action: 'REGRADE_REVIEWER_ASSIGNED',
            outcome: 'SUCCESS',
            entityId: regrade._id,
            entityType: 'RegradeRequest',
            ipAddress: request.headers.get('x-forwarded-for') || undefined,
            details: {
                examId: exam._id.toString(),
                previousAssignee,
                assignedTo: reviewerId,
                reviewerName: reviewer?.name || null,
                ...(isOriginalGrader && isExamProfessor ? { note: 'Assigned reviewer is original grader and exam professor' } : {})
            }
        });
        if (!audited) {
            const rollback = await RegradeRequest.updateOne(
                {
                    _id: updated._id,
                    assignedAt,
                    assignedBy,
                    assignedTo: assignee
                },
                {
                    $set: {
                        assignedTo: previousAssignee ? new mongoose.Types.ObjectId(previousAssignee) : null,
                        assignedBy: regrade.assignedBy || null,
                        assignedAt: regrade.assignedAt || null
                    },
                    $pull: { assignmentHistory: { assignedAt } }
                }
            );
            if (rollback.modifiedCount !== 1) {
                console.error('Failed to roll back unaudited reviewer assignment', { requestId: id });
            }
            return NextResponse.json(
                { success: false, message: 'Could not record assignment audit event', data: null },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            data: {
                id: updated._id.toString(),
                assignedTo: reviewer ? {
                    id: reviewer._id.toString(),
                    name: reviewer.name,
                    email: reviewer.email
                } : null,
                assignedAt
            }
        }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error: unknown) {
        console.error('Failed to assign regrade reviewer:', error);
        return NextResponse.json(
            { success: false, message: 'Could not assign the regrade request', data: null },
            { status: 500, headers: { 'Cache-Control': 'private, no-store' } }
        );
    }
}
