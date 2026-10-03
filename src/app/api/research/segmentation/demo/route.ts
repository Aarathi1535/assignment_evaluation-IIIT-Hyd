import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth, requireFeature } from '@/lib/apiAuth';
import answerSegmentationService from '@/services/AnswerSegmentationService';
import { HttpError } from '@/lib/errors';

export async function POST() {
    const featureCheck = requireFeature('ANSWER_SEGMENTATION');
    if (!featureCheck.authorized) {
        return featureCheck.response ?? NextResponse.json(
            { success: false, message: 'Answer segmentation feature is disabled', data: null },
            { status: 404 }
        );
    }

    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    try {
        await connectDB();
        const data = await answerSegmentationService.loadDemoScript(auth.user.id, auth.user.role);
        return NextResponse.json(
            {
                success: true,
                message: 'Demo answer script loaded successfully',
                data
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
