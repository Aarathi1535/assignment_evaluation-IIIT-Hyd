import { NextRequest, NextResponse } from 'next/server';
import { Types as MongooseTypes } from 'mongoose';
import { connectDB } from '@/lib/db';
import { requireAuth, requireFeature } from '@/lib/apiAuth';
import answerSegmentationService from '@/services/AnswerSegmentationService';
import { verifyScriptAccess } from '@/app/api/research/segmentation/auth';
import { HttpError } from '@/lib/errors';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string; questionNumber: string }> }
) {
    const featureCheck = requireFeature('ANSWER_SEGMENTATION');
    if (!featureCheck.authorized) {
        return featureCheck.response ?? NextResponse.json({ success: false, message: 'Answer segmentation feature is disabled', data: null }, { status: 404 });
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    const { scriptId, questionNumber: qParam } = await context.params;

    if (!scriptId || !MongooseTypes.ObjectId.isValid(scriptId)) {
        return NextResponse.json(
            { success: false, message: 'Invalid AnswerScript ID format', data: null },
            { status: 400 }
        );
    }

    const questionNumber = parseInt(qParam, 10);
    if (isNaN(questionNumber) || questionNumber < 1) {
        return NextResponse.json(
            { success: false, message: 'Invalid questionNumber parameter', data: null },
            { status: 400 }
        );
    }

    try {
        await connectDB();
        await verifyScriptAccess(scriptId, auth.user);

        let answer = await answerSegmentationService.getReconstructedAnswerForQuestion(
            scriptId,
            questionNumber
        );

        if (!answer) {
            // Trigger reconstruction on-demand
            await answerSegmentationService.reconstructScript(scriptId, {
                actingUserId: auth.user.id,
                actingUserRole: auth.user.role,
                ipAddress: req.headers.get('x-forwarded-for') || undefined
            });
            answer = await answerSegmentationService.getReconstructedAnswerForQuestion(
                scriptId,
                questionNumber
            );
        }

        if (!answer) {
            return NextResponse.json(
                { success: false, message: `Question ${questionNumber} not found in reconstructed answers`, data: null },
                { status: 404 }
            );
        }

        return NextResponse.json(
            {
                success: true,
                message: `Reconstructed answer for Question ${questionNumber} retrieved`,
                data: answer
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

export async function PATCH(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string; questionNumber: string }> }
) {
    const featureCheck = requireFeature('ANSWER_SEGMENTATION');
    if (!featureCheck.authorized) {
        return featureCheck.response ?? NextResponse.json({ success: false, message: 'Answer segmentation feature is disabled', data: null }, { status: 404 });
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    const { scriptId, questionNumber: qParam } = await context.params;

    if (!scriptId || !MongooseTypes.ObjectId.isValid(scriptId)) {
        return NextResponse.json(
            { success: false, message: 'Invalid AnswerScript ID format', data: null },
            { status: 400 }
        );
    }

    const questionNumber = parseInt(qParam, 10);
    if (isNaN(questionNumber) || questionNumber < 1) {
        return NextResponse.json(
            { success: false, message: 'Invalid questionNumber parameter', data: null },
            { status: 400 }
        );
    }

    try {
        await connectDB();
        await verifyScriptAccess(scriptId, auth.user);

        let body: { notes?: string } = {};
        try {
            body = await req.json();
        } catch {
            // body is optional
        }

        const updated = await answerSegmentationService.verifyReconstructedAnswer(
            scriptId,
            questionNumber,
            auth.user.id,
            body.notes
        );

        return NextResponse.json(
            {
                success: true,
                message: `Reconstructed answer for Question ${questionNumber} marked as verified`,
                data: updated
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

export async function PUT(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string; questionNumber: string }> }
) {
    const featureCheck = requireFeature('ANSWER_SEGMENTATION');
    if (!featureCheck.authorized) {
        return featureCheck.response ?? NextResponse.json({ success: false, message: 'Answer segmentation feature is disabled', data: null }, { status: 404 });
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    const { scriptId, questionNumber: qParam } = await context.params;

    if (!scriptId || !MongooseTypes.ObjectId.isValid(scriptId)) {
        return NextResponse.json(
            { success: false, message: 'Invalid AnswerScript ID format', data: null },
            { status: 400 }
        );
    }

    const questionNumber = parseInt(qParam, 10);
    if (isNaN(questionNumber) || questionNumber < 1) {
        return NextResponse.json(
            { success: false, message: 'Invalid questionNumber parameter', data: null },
            { status: 400 }
        );
    }

    try {
        await connectDB();
        await verifyScriptAccess(scriptId, auth.user);

        const body = await req.json();
        const regions = Array.isArray(body.regions) ? body.regions : [];

        const updatedAnswer = await answerSegmentationService.saveQuestionRegions(
            scriptId,
            questionNumber,
            regions,
            auth.user.id,
            body.subQuestion
        );

        return NextResponse.json(
            {
                success: true,
                message: `Successfully saved ${regions.length} regions for Question ${questionNumber}`,
                data: updatedAnswer
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
