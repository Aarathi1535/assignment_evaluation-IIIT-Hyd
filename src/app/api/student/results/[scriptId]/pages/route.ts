import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../../lib/db';
import { requireAuth } from '../../../../../../lib/apiAuth';
import studentResultService from '../../../../../../services/StudentResultService';
import IngestionPage from '../../../../../../models/IngestionPage';
import Page from '../../../../../../models/Page';
import { HttpError } from '../../../../../../lib/errors';

export const dynamic = 'force-dynamic';

const SECURITY_HEADERS = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
} as const;

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
        auth.response.headers.set('Cache-Control', 'private, no-store');
        auth.response.headers.set('X-Content-Type-Options', 'nosniff');
        return auth.response;
    }

    const { scriptId } = await context.params;

    try {
        await connectDB();
        const { script } = await studentResultService.verifyStudentScriptAccess(
            scriptId,
            auth.user.id,
            auth.user.role
        );

        // Fetch pages: check IngestionPage first (skipping duplicates), fallback to Page
        const ingestionPages = await IngestionPage.find({
            answerScript: script._id,
            isDuplicate: { $ne: true },
        })
            .select('_id pageNumber width height metadata')
            .sort({ fileIndex: 1, pageNumber: 1 })
            .lean();

        let pages: Array<{ pageId: string; pageNumber: number; width?: number; height?: number }> = [];

        if (ingestionPages.length > 0) {
            pages = ingestionPages.map(p => {
                const width = typeof p.width === 'number' && p.width > 0
                    ? p.width
                    : (typeof (p.metadata as Record<string, unknown>)?.width === 'number' && Number((p.metadata as Record<string, unknown>).width) > 0
                        ? Number((p.metadata as Record<string, unknown>).width)
                        : undefined);
                const height = typeof p.height === 'number' && p.height > 0
                    ? p.height
                    : (typeof (p.metadata as Record<string, unknown>)?.height === 'number' && Number((p.metadata as Record<string, unknown>).height) > 0
                        ? Number((p.metadata as Record<string, unknown>).height)
                        : undefined);
                const item: { pageId: string; pageNumber: number; width?: number; height?: number } = {
                    pageId: p._id.toString(),
                    pageNumber: p.pageNumber,
                };
                if (width !== undefined) item.width = width;
                if (height !== undefined) item.height = height;
                return item;
            });
        } else {
            const standardPages = await Page.find({
                answerScript: script._id,
                isActive: true,
            })
                .select('_id pageNumber')
                .sort({ pageNumber: 1 })
                .lean();

            pages = standardPages.map(p => ({
                pageId: p._id.toString(),
                pageNumber: p.pageNumber,
            }));
        }

        return NextResponse.json(pages, {
            status: 200,
            headers: SECURITY_HEADERS,
        });
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
