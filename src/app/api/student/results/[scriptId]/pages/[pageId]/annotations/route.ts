import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../../../lib/db';
import { requireAuth } from '../../../../../../../../lib/apiAuth';
import studentResultService from '../../../../../../../../services/StudentResultService';
import IngestionPage from '../../../../../../../../models/IngestionPage';
import Page from '../../../../../../../../models/Page';
import { HttpError } from '../../../../../../../../lib/errors';
import {
    cloneMarkAnnotation,
    cloneFreehandStroke,
    type SerializedPageAnnotations
} from '../../../../../../../../lib/annotationSerialization';
import type { MarkAnnotation } from '../../../../../../../../lib/stampTool';
import type { FreehandStroke } from '../../../../../../../../lib/penTool';

export const dynamic = 'force-dynamic';

const SECURITY_HEADERS = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
} as const;

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string; pageId: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        auth.response.headers.set('Cache-Control', 'private, no-store');
        auth.response.headers.set('X-Content-Type-Options', 'nosniff');
        return auth.response;
    }

    const { scriptId, pageId } = await context.params;

    if (!pageId || !mongoose.Types.ObjectId.isValid(pageId)) {
        return NextResponse.json(
            { success: false, message: 'Not found' },
            { status: 404, headers: SECURITY_HEADERS }
        );
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
            isDuplicate: { $ne: true },
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
            return NextResponse.json(
                { success: false, message: 'Not found' },
                { status: 404, headers: SECURITY_HEADERS }
            );
        }

        // Strict allowlist projection using cloneMarkAnnotation & cloneFreehandStroke
        // Ensures graderEmail, annotatedBy, and arbitrary stored metadata cannot leak
        const rawAnnotationList = Array.isArray(rawAnnotations?.annotations) ? rawAnnotations.annotations : [];
        const annotations = rawAnnotationList
            .map((a: unknown) => {
                const raw = (a && typeof (a as { toObject?: () => Record<string, unknown> }).toObject === 'function')
                    ? (a as { toObject: () => Record<string, unknown> }).toObject()
                    : (a as Record<string, unknown> || {});
                const type = (raw.type as string) || (raw.tool as string);
                const normalized = {
                    ...raw,
                    type,
                    pageKey: raw.pageKey ?? pageId,
                };
                return cloneMarkAnnotation(normalized as MarkAnnotation);
            })
            .filter((a) => a && ['check', 'cross', 'highlight', 'text'].includes(a.type));

        const rawStrokeList = Array.isArray(rawAnnotations?.strokes) ? rawAnnotations.strokes : [];
        const strokes = rawStrokeList.map((s: unknown) => {
            const raw = (s && typeof (s as { toObject?: () => Record<string, unknown> }).toObject === 'function')
                ? (s as { toObject: () => Record<string, unknown> }).toObject()
                : (s as Record<string, unknown> || {});
            const normalized = {
                ...raw,
                pageKey: raw.pageKey ?? pageId,
            };
            return cloneFreehandStroke(normalized as FreehandStroke);
        });

        return NextResponse.json(
            { annotations, strokes },
            {
                status: 200,
                headers: SECURITY_HEADERS,
            }
        );
    } catch (error: unknown) {
        const status = error instanceof HttpError ? error.statusCode : 404;
        return NextResponse.json(
            { success: false, message: status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : 'Not found' },
            {
                status,
                headers: SECURITY_HEADERS,
            }
        );
    }
}
