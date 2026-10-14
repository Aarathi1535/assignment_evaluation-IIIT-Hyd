import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../../../lib/db';
import { requireAuth } from '../../../../../../../../lib/apiAuth';
import studentResultService from '../../../../../../../../services/StudentResultService';
import DerivedStorageService from '../../../../../../../../services/DerivedStorageService';
import IngestionPage from '../../../../../../../../models/IngestionPage';
import Page from '../../../../../../../../models/Page';
import { HttpError } from '../../../../../../../../lib/errors';

export const dynamic = 'force-dynamic';

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

        // Find page belonging strictly to this answer script
        const pageIdObj = new mongoose.Types.ObjectId(pageId);
        let storageKey: string | undefined;

        const ingestionPage = await IngestionPage.findOne({
            _id: pageIdObj,
            answerScript: script._id,
        }).select('storageKey');

        if (ingestionPage && ingestionPage.storageKey) {
            storageKey = ingestionPage.storageKey;
        } else {
            const standardPage = await Page.findOne({
                _id: pageIdObj,
                answerScript: script._id,
                isActive: true,
            }).select('imagePath');

            if (standardPage && standardPage.imagePath) {
                storageKey = standardPage.imagePath;
            }
        }

        if (!storageKey) {
            return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
        }

        // Open derived page image stream safely without signed URLs or redirects
        let opened: { stream: NodeJS.ReadableStream & AsyncIterable<Uint8Array | string>; size: number };
        try {
            opened = await DerivedStorageService.openDerivedPage(storageKey);
        } catch {
            return NextResponse.json({ success: false, message: 'Not found' }, { status: 404 });
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
                headers: {
                    'Cache-Control': 'private, no-store',
                    'X-Content-Type-Options': 'nosniff',
                },
            }
        );
    }
}
