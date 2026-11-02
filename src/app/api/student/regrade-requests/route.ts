import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { z } from 'zod';
import { Permission } from '../../../../constants/permissions';
import { connectDB } from '../../../../lib/db';
import { HttpError, isDuplicateKeyError } from '../../../../lib/errors';
import { requirePermission } from '../../../../lib/apiAuth';
import Exam from '../../../../models/Exam';
import Grade from '../../../../models/Grade';
import RegradeRequest, { IRegradeRequest } from '../../../../models/RegradeRequest';
import Rubric from '../../../../models/Rubric';
import StudentResultService from '../../../../services/StudentResultService';
import { isRegradeWindowOpen } from '../../../../utils/regradeWindow';

export const dynamic = 'force-dynamic';

const createRequestSchema = z.object({
    scriptId: z.string().refine(mongoose.Types.ObjectId.isValid, 'Invalid script ID'),
    questionNumber: z.number().int().positive(),
    reason: z.string().trim().min(10).max(2000)
}).strict();

function toStudentRequest(
    request: Pick<IRegradeRequest, '_id' | 'exam' | 'questionNumber' | 'reason' | 'status' | 'createdAt' | 'updatedAt'>,
    examTitle: string
) {
    return {
        id: request._id.toString(),
        examId: request.exam.toString(),
        examTitle,
        questionNumber: request.questionNumber,
        reason: request.reason,
        status: request.status.toLowerCase(),
        createdAt: request.createdAt,
        updatedAt: request.updatedAt
    };
}

function errorResponse(error: unknown) {
    const status = error instanceof HttpError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json(
        { success: false, message, data: null },
        { status, headers: { 'Cache-Control': 'private, no-store' } }
    );
}

export async function GET() {
    const auth = await requirePermission(Permission.REQUEST_REGRADE);
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        await connectDB();
        const student = await StudentResultService.validateStudentAccess(
            auth.user.id,
            auth.user.role
        );
        const requests = await RegradeRequest.find({ student: student._id })
            .sort({ createdAt: -1 })
            .lean();
        const exams = await Exam.find({
            _id: { $in: requests.map(request => request.exam) }
        }).select('title').lean();
        const examTitles = new Map(exams.map(exam => [exam._id.toString(), exam.title]));

        return NextResponse.json({
            success: true,
            data: requests.map(request => toStudentRequest(
                request as Pick<IRegradeRequest, '_id' | 'exam' | 'questionNumber' | 'reason' | 'status' | 'createdAt' | 'updatedAt'>,
                examTitles.get(request.exam.toString()) || ''
            ))
        }, { status: 200, headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error: unknown) {
        return errorResponse(error);
    }
}

export async function POST(req: NextRequest) {
    const auth = await requirePermission(Permission.REQUEST_REGRADE);
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return NextResponse.json(
                { success: false, message: 'Invalid JSON request body', data: null },
                { status: 400 }
            );
        }

        const parsed = createRequestSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { success: false, message: 'Validation failed', data: parsed.error.issues.map(issue => issue.message) },
                { status: 400 }
            );
        }

        await connectDB();
        const { student, script, exam } = await StudentResultService.verifyStudentScriptAccess(
            parsed.data.scriptId,
            auth.user.id,
            auth.user.role
        );

        if (!isRegradeWindowOpen(exam)) {
            throw new HttpError('Regrade window is closed', 403);
        }

        const finalGrade = await Grade.findOne({
            answerScript: script._id,
            isFinal: true
        }).select('rubric');
        const rubric = finalGrade
            ? await Rubric.findOne({ _id: finalGrade.rubric, exam: exam._id }).select('questions')
            : null;
        if (!rubric?.questions.some(question => question.questionNumber === parsed.data.questionNumber)) {
            throw new HttpError('Question is not part of this exam', 400);
        }

        const duplicate = await RegradeRequest.exists({
            student: student._id,
            exam: exam._id,
            questionNumber: parsed.data.questionNumber,
            isOpen: true
        });
        if (duplicate) {
            throw new HttpError('An open regrade request already exists for this question', 409);
        }

        const request = await RegradeRequest.create({
            exam: exam._id,
            answerScript: script._id,
            questionNumber: parsed.data.questionNumber,
            student: student._id,
            reason: parsed.data.reason
        });

        return NextResponse.json({
            success: true,
            data: toStudentRequest(request, exam.title)
        }, { status: 201, headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error: unknown) {
        if (isDuplicateKeyError(error)) {
            return NextResponse.json(
                { success: false, message: 'An open regrade request already exists for this question', data: null },
                { status: 409, headers: { 'Cache-Control': 'private, no-store' } }
            );
        }
        return errorResponse(error);
    }
}
