import { NextRequest, NextResponse } from 'next/server';
import { Types as MongooseTypes } from 'mongoose';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';
import answerSegmentationService from '@/services/AnswerSegmentationService';
import { verifyScriptAccess } from '@/app/api/research/segmentation/auth';
import { HttpError } from '@/lib/errors';

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

        const url = new URL(req.url);
        const qParam = url.searchParams.get('questionNumber');
        const questionNumber = qParam ? parseInt(qParam, 10) : undefined;

        const regions = await answerSegmentationService.getTaggedRegions(scriptId, questionNumber);

        return NextResponse.json(
            {
                success: true,
                message: `Retrieved ${regions.length} tagged regions`,
                data: regions
            },
            { status: 200 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json(
            { success: false, message, data: null },
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

        const body = await req.json();

        if (!body || typeof body !== 'object') {
            return NextResponse.json(
                { success: false, message: 'Request body must be an object', data: null },
                { status: 400 }
            );
        }

        const result = await answerSegmentationService.tagRegion(
            scriptId,
            body,
            auth.user.id
        );

        return NextResponse.json(
            {
                success: true,
                message: `Successfully tagged region on page ${body.pageNumber} for question ${body.questionNumber}`,
                data: result
            },
            { status: 201 }
        );
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'An unexpected error occurred';
        const status = error instanceof HttpError ? error.statusCode : 500;
        return NextResponse.json(
            { success: false, message, data: null },
            { status }
        );
    }
}
