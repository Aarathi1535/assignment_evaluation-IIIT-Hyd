import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../../../lib/db';
import { requireAuth } from '../../../../../../../../lib/apiAuth';
import studentResultService from '../../../../../../../../services/StudentResultService';
import DerivedStorageService from '../../../../../../../../services/DerivedStorageService';
import IngestionPage from '../../../../../../../../models/IngestionPage';
import { HttpError } from '../../../../../../../../lib/errors';

export const dynamic = 'force-dynamic';

const SECURITY_HEADERS = {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
} as const;

function toWebReadableStream(
  stream: NodeJS.ReadableStream & AsyncIterable<Uint8Array | string>
): ReadableStream<Uint8Array> {
  const iterator = stream[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const chunk = await iterator.next();
      if (chunk.done) {
        controller.close();
      } else {
        const bytes =
          typeof chunk.value === 'string'
            ? new TextEncoder().encode(chunk.value)
            : new Uint8Array(chunk.value);
        controller.enqueue(bytes);
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

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

        // Find page belonging strictly to this answer script and skip duplicates
        const pageIdObj = new mongoose.Types.ObjectId(pageId);
        const ingestionPage = await IngestionPage.findOne({
            _id: pageIdObj,
            answerScript: script._id,
            isDuplicate: { $ne: true },
        }).select('storageKey');

        if (!ingestionPage || !ingestionPage.storageKey) {
            return NextResponse.json(
                { success: false, message: 'Not found' },
                { status: 404, headers: SECURITY_HEADERS }
            );
        }

        const storageKey = ingestionPage.storageKey;

        // Open derived page image stream safely without signed URLs or redirects
        let opened: { stream: NodeJS.ReadableStream & AsyncIterable<Uint8Array | string>; size: number };
        try {
            opened = await DerivedStorageService.openDerivedPage(storageKey);
        } catch {
            return NextResponse.json(
                { success: false, message: 'Not found' },
                { status: 404, headers: SECURITY_HEADERS }
            );
        }

        const { stream, size } = opened;

        // Content-Type resolution
        let contentType = 'image/png';
        const keyLower = storageKey.toLowerCase();
        if (keyLower.endsWith('.jpg') || keyLower.endsWith('.jpeg')) {
            contentType = 'image/jpeg';
        } else if (keyLower.endsWith('.webp')) {
            contentType = 'image/webp';
        } else if (keyLower.endsWith('.gif')) {
            contentType = 'image/gif';
        }

        return new NextResponse(toWebReadableStream(stream), {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Length': size.toString(),
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
                headers: SECURITY_HEADERS,
            }
        );
    }
}
