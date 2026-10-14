import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../../lib/db';
import { requireAuth } from '../../../../../../lib/apiAuth';
import studentResultService from '../../../../../../services/StudentResultService';
import IngestionPage from '../../../../../../models/IngestionPage';
import Page from '../../../../../../models/Page';
import { HttpError } from '../../../../../../lib/errors';

export const dynamic = 'force-dynamic';

export async function GET(
    req: NextRequest,
    context: { params: Promise<{ scriptId: string }> }
) {
    const auth = await requireAuth();
    if (!auth.authorized) {
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

        // Fetch pages: check IngestionPage first, fallback to Page
        const ingestionPages = await IngestionPage.find({
            answerScript: script._id,
        })
            .select('_id pageNumber width height')
            .sort({ fileIndex: 1, pageNumber: 1 })
            .lean();

        let pages: Array<{ pageId: string; pageNumber: number; width: number; height: number }> = [];

        if (ingestionPages.length > 0) {
            pages = ingestionPages.map(p => ({
                pageId: p._id.toString(),
                pageNumber: p.pageNumber,
                width: p.width || 800,
                height: p.height || 1100,
            }));
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
                width: 800,
                height: 1100,
            }));
        }

        return NextResponse.json(pages, {
            status: 200,
            headers: {
                'Cache-Control': 'private, no-store',
                'X-Content-Type-Options': 'nosniff',
            },
        });
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
