import { NextRequest, NextResponse } from 'next/server';
import { Types as MongooseTypes } from 'mongoose';
import { connectDB } from '@/lib/db';
import { requireAuth, requireFeature } from '@/lib/apiAuth';
import answerSegmentationService from '@/services/AnswerSegmentationService';
import { verifyScriptAccess } from '@/app/api/research/segmentation/auth';
import { HttpError } from '@/lib/errors';

export async function PUT(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string; regionId: string }> }
) {
    const featureCheck = requireFeature('ANSWER_SEGMENTATION');
    if (!featureCheck.authorized) {
        return featureCheck.response ?? NextResponse.json({ success: false, message: 'Answer segmentation feature is disabled', data: null }, { status: 404 });
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    const { scriptId, regionId } = await context.params;

    if (!scriptId || !MongooseTypes.ObjectId.isValid(scriptId)) {
        return NextResponse.json(
            { success: false, message: 'Invalid AnswerScript ID format', data: null },
            { status: 400 }
        );
    }

    if (!regionId || !MongooseTypes.ObjectId.isValid(regionId)) {
        return NextResponse.json(
            { success: false, message: 'Invalid Region ID format', data: null },
            { status: 400 }
        );
    }

    try {
        await connectDB();
        await verifyScriptAccess(scriptId, auth.user);

        const body = await req.json();
        const updated = await answerSegmentationService.updateRegion(
            regionId,
            body,
            auth.user.id
        );

        return NextResponse.json(
            {
                success: true,
                message: 'Successfully updated tagged region',
                data: updated
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

export async function DELETE(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string; regionId: string }> }
) {
    const featureCheck = requireFeature('ANSWER_SEGMENTATION');
    if (!featureCheck.authorized) {
        return featureCheck.response ?? NextResponse.json({ success: false, message: 'Answer segmentation feature is disabled', data: null }, { status: 404 });
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    const { scriptId, regionId } = await context.params;

    if (!scriptId || !MongooseTypes.ObjectId.isValid(scriptId)) {
        return NextResponse.json(
            { success: false, message: 'Invalid AnswerScript ID format', data: null },
            { status: 400 }
        );
    }

    if (!regionId || !MongooseTypes.ObjectId.isValid(regionId)) {
        return NextResponse.json(
            { success: false, message: 'Invalid Region ID format', data: null },
            { status: 400 }
        );
    }

    try {
        await connectDB();
        await verifyScriptAccess(scriptId, auth.user);

        const result = await answerSegmentationService.removeRegion(
            regionId,
            auth.user.id
        );

        return NextResponse.json(
            {
                success: true,
                message: 'Successfully removed tagged region',
                data: result
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
