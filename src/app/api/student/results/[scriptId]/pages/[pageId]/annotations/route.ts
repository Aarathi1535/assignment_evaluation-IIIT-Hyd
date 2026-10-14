import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../../../lib/db';
import { requireAuth } from '../../../../../../../../lib/apiAuth';
import studentResultService from '../../../../../../../../services/StudentResultService';
import IngestionPage from '../../../../../../../../models/IngestionPage';
import Page from '../../../../../../../../models/Page';
import { HttpError } from '../../../../../../../../lib/errors';
import type { SerializedPageAnnotations } from '../../../../../../../../lib/annotationSerialization';

export const dynamic = 'force-dynamic';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string; pageId: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        return auth.response;
    }

    const { scriptId, pageId } = await context.params;

    if (!pageId || !mongoose.Types.ObjectId.isValid(pageId)) {
        return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
    }

    try {
        await connectDB();
        const { script } = await studentResultService.verifyStudentScriptAccess(
            scriptId,
            auth.user.id,
            auth.user.role
        );

        const pageIdObj = new mongoose.Types.ObjectId(pageId);
        let rawAnnotations: SerializedPageAnnotations | null = null;
        let foundPage = false;

        const ingestionPage = await IngestionPage.findOne({
            _id: pageIdObj,
            answerScript: script._id,
        }).select('metadata.annotations');

        if (ingestionPage) {
            foundPage = true;
            rawAnnotations = (ingestionPage.metadata?.annotations as SerializedPageAnnotations) || null;
        } else {
            const standardPage = await Page.findOne({
                _id: pageIdObj,
                answerScript: script._id,
                isActive: true,
            }).select('annotations');

            if (standardPage) {
                foundPage = true;
                rawAnnotations = (standardPage.annotations as SerializedPageAnnotations) || null;
            }
        }

        if (!foundPage) {
            return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
        }

        // Clean & sanitize annotations and strokes:
        // Strip annotatedBy, timestamps, and internal grader metadata
        const annotations = (rawAnnotations?.annotations || []).map((a: unknown) => {
            const raw = a as Record<string, unknown>;
            const clean = typeof (raw as { toObject?: () => Record<string, unknown> })?.toObject === 'function'
                ? (raw as { toObject: () => Record<string, unknown> }).toObject()
                : { ...raw };
            delete clean.annotatedBy;
            delete clean.createdAt;
            delete clean.updatedAt;
            return clean;
        });

        const strokes = (rawAnnotations?.strokes || []).map((s: unknown) => {
            const raw = s as Record<string, unknown>;
            const clean = typeof (raw as { toObject?: () => Record<string, unknown> })?.toObject === 'function'
                ? (raw as { toObject: () => Record<string, unknown> }).toObject()
                : { ...raw };
            delete clean.annotatedBy;
            delete clean.createdAt;
            delete clean.updatedAt;
            return clean;
        });

        return NextResponse.json(
            { annotations, strokes },
            {
                status: 200,
                headers: {
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff',
                },
            }
        );
    } catch (error: unknown) {
        const status = error instanceof HttpError ? error.statusCode : 404;
        return NextResponse.json(
            { success: false, message: status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Not found' },
            {
                status,
                headers: {
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff',
                },
            }
        );
    }
}
