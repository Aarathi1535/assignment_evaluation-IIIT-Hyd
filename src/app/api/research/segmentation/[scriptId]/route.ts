import { NextRequest, NextResponse } from 'next/server';
import { Types as MongooseTypes } from 'mongoose';
import { connectDB } from '@/lib/db';
import { requireAuth, requireFeature } from '@/lib/apiAuth';
import answerSegmentationService from '@/services/AnswerSegmentationService';
import { verifyScriptAccess } from '@/app/api/research/segmentation/auth';
import { HttpError } from '@/lib/errors';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string }> }
) {
    const featureCheck = requireFeature('ANSWER_SEGMENTATION');
    if (!featureCheck.authorized) {
        return featureCheck.response ?? NextResponse.json({ success: false, message: 'Answer segmentation feature is disabled', data: null }, { status: 404 });
    }

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
    const featureCheck = requireFeature('ANSWER_SEGMENTATION');
    if (!featureCheck.authorized) {
        return featureCheck.response ?? NextResponse.json({ success: false, message: 'Answer segmentation feature is disabled', data: null }, { status: 404 });
    }

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
