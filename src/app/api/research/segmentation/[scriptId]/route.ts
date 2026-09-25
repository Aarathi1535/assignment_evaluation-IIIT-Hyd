import { NextRequest, NextResponse } from 'next/server';
import { Types as MongooseTypes } from 'mongoose';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';
import answerSegmentationService from '@/services/AnswerSegmentationService';
import AnswerScript from '@/models/AnswerScript';
import ExamRepository from '@/repositories/ExamRepository';
import AllocationService from '@/services/AllocationService';
import { UserRole } from '@/constants/permissions';
import { HttpError } from '@/lib/errors';

async function verifyScriptAccess(scriptId: string, user: { id: string; role: string }) {
    const script = await AnswerScript.findById(scriptId);
    if (!script) {
        throw new HttpError('AnswerScript not found', 404);
    }

    const role = user.role?.toUpperCase();
    if (role === UserRole.PROFESSOR || role === UserRole.ADMIN) {
        const exam = await ExamRepository.getExamById(script.exam.toString(), user.id, user.role);
        if (!exam) {
            throw new HttpError('Forbidden: Access denied to exam for this script', 403);
        }
    } else if (role === UserRole.TA) {
        const allocation = await AllocationService.verifyTaAllocation(script._id, user.id);
        if (!allocation) {
            throw new HttpError('Forbidden: You are not allocated to this answer script', 403);
        }
    } else {
        throw new HttpError('Forbidden: Unauthorized role', 403);
    }

    return script;
}

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    const { scriptId } = await context.params;

    if (!scriptId || !MongooseTypes.ObjectId.isValid(scriptId)) {
        return NextResponse.json(
            { success: false, message: 'Invalid AnswerScript ID format', data: null },
            { status: 400 }
        );
    }

    try {
        await connectDB();
        await verifyScriptAccess(scriptId, auth.user);

        let answers = await answerSegmentationService.getReconstructedAnswers(scriptId);

        // If no reconstructed answers exist yet, trigger reconstruction on-demand
        if (answers.length === 0) {
            answers = await answerSegmentationService.reconstructScript(scriptId, {
                actingUserId: auth.user.id,
                actingUserRole: auth.user.role,
                ipAddress: req.headers.get('x-forwarded-for') || undefined
            });
        }

        return NextResponse.json(
            {
                success: true,
                message: `Retrieved ${answers.length} reconstructed question answers`,
                data: answers
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json(
            {
                success: false,
                message,
                data: null
            },
            { status }
        );
    }
}

export async function POST(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    const { scriptId } = await context.params;

    if (!scriptId || !MongooseTypes.ObjectId.isValid(scriptId)) {
        return NextResponse.json(
            { success: false, message: 'Invalid AnswerScript ID format', data: null },
            { status: 400 }
        );
    }

    try {
        await connectDB();
        await verifyScriptAccess(scriptId, auth.user);

        let body: { regions?: unknown } = {};
        try {
            body = await req.json();
        } catch {
            // body is optional
        }

        const answers = await answerSegmentationService.reconstructScript(scriptId, {
            overrideRegions: Array.isArray(body.regions) ? body.regions : undefined,
            actingUserId: auth.user.id,
            actingUserRole: auth.user.role,
            ipAddress: req.headers.get('x-forwarded-for') || undefined
        });

        return NextResponse.json(
            {
                success: true,
                message: `Successfully executed answer reconstruction for ${answers.length} questions`,
                data: answers
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json(
            {
                success: false,
                message,
                data: null
            },
            { status }
        );
    }
}
