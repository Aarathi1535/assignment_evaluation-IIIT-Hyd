import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../../lib/db';
import { requireGradingOrAnnotationAccess } from '../../../../../../../lib/apiAuth';
import { UserRole } from '../../../../../../../constants/permissions';
import BatchRepository from '../../../../../../../repositories/BatchRepository';
import IngestionPage from '../../../../../../../models/IngestionPage';
import AllocationService from '../../../../../../../services/AllocationService';
import DerivedStorageService, { DerivedStorageConfigurationError } from '../../../../../../../services/DerivedStorageService';
import { logGraderTiming } from '../../../../../../../lib/graderPerformance';

function isMissingDerivedPageError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const storageError = error as { code?: number | string; statusCode?: number };
  return storageError.code === 404 || storageError.code === '404' ||
    storageError.statusCode === 404 || storageError.code === 'ENOENT';
}

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

/**
 * GET /api/ingest/[id]/pages/[pageId]/image
 *
 * Serves the full-resolution derived/scanned page image for an ingestion page
 * to be rendered within the answer-sheet canvas.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; pageId: string }> }
) {
  const requestStartedAt = performance.now();
  const auth = await requireGradingOrAnnotationAccess();
  if (!auth.authorized) {
    return auth.response;
  }

  const { id, pageId } = await context.params;
  const batchId = id;

  if (!batchId || !pageId) {
    return NextResponse.json(
      {
        success: false,
        message: 'Invalid parameters',
        data: null,
      },
      { status: 404 }
    );
  }

  if (!mongoose.Types.ObjectId.isValid(pageId)) {
    return NextResponse.json(
      {
        success: false,
        message: 'Invalid page ID format',
        data: null,
      },
      { status: 404 }
    );
  }

  try {
    await connectDB();

    // 1. Resolve Ingestion Page
    const page = await IngestionPage.findById(pageId);
    if (!page) {
      return NextResponse.json(
        {
          success: false,
          message: 'Page not found',
          data: null,
        },
        { status: 404 }
      );
    }

    // 2. Verify page belongs to the batch
    if (page.batchId !== batchId) {
      return NextResponse.json(
        {
          success: false,
          message: 'Page does not belong to the requested batch',
          data: null,
        },
        { status: 404 }
      );
    }

    // 3. Verify authorized access to the batch
    const userRole = auth.user.role?.toUpperCase();
    const isProfessor = userRole === UserRole.PROFESSOR;
    const isAdmin = userRole === UserRole.ADMIN;
    const isProfessorOrAdmin = isProfessor || isAdmin;

    let batch = null;
    if (isProfessor) {
      batch = await BatchRepository.getBatchById(batchId, auth.user.id, auth.user.role);
      if (!batch) {
        const internalBatch = await BatchRepository.getBatchByBatchIdInternal(batchId);
        if (internalBatch?.exam) {
          const ExamRepository = (await import('../../../../../../../repositories/ExamRepository')).default;
          const exam = await ExamRepository.getExamById(internalBatch.exam.toString(), auth.user.id, auth.user.role);
          if (exam) {
            batch = internalBatch;
          }
        }
      }
    } else {
      batch = await BatchRepository.getBatchByBatchIdInternal(batchId);
    }

    if (!batch) {
      return NextResponse.json(
        {
          success: false,
          message: 'Batch not found or access denied',
          data: null,
        },
        { status: 404 }
      );
    }

    // 4. For TA users, enforce allocation-scoped authorization (AE-123 security fix)
    if (!isProfessorOrAdmin) {
      if (!page.answerScript) {
        return NextResponse.json(
          {
            success: false,
            message: 'Page not found',
            data: null,
          },
          { status: 404 }
        );
      }

      const allocation = await AllocationService.verifyTaAllocation(
        page.answerScript,
        auth.user.id
      );

      if (!allocation) {
        return NextResponse.json(
          {
            success: false,
            message: 'Page not found',
            data: null,
          },
          { status: 404 }
        );
      }
    }

    // 4. Verify storageKey is available
    if (!page.storageKey) {
      return NextResponse.json(
        {
          success: false,
          message: 'Page image key is missing or not processed yet',
          data: null,
        },
        { status: 404 }
      );
    }

    // 5. Open the stored page image after checking metadata so missing assets can
    // still be returned as a controlled API error before the response starts.
    try {
      const storageOpenStartedAt = performance.now();
      let opened: Awaited<ReturnType<typeof DerivedStorageService.openDerivedPage>>;
      try {
        opened = await DerivedStorageService.openDerivedPage(page.storageKey);
      } catch (error) {
        if (!isMissingDerivedPageError(error)) throw error;
        return NextResponse.json(
          { success: false, message: 'Page image file not found in derived storage', data: null },
          { status: 404 }
        );
      }
      const { stream, size } = opened;
      logGraderTiming('page-object-opened', storageOpenStartedAt, { sizeBytes: size });
      logGraderTiming('page-image-api-ready', requestStartedAt, { status: 200 });

      // Determine proper Content-Type
      let contentType = 'image/png';
      const keyLower = page.storageKey.toLowerCase();
      if (keyLower.endsWith('.jpg') || keyLower.endsWith('.jpeg')) {
        contentType = 'image/jpeg';
      } else if (keyLower.endsWith('.webp')) {
        contentType = 'image/webp';
      } else if (keyLower.endsWith('.gif')) {
        contentType = 'image/gif';
      }

      return new NextResponse(toWebReadableStream(stream), {
        headers: {
          'Content-Type': contentType,
          'Content-Length': size.toString(),
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch (readError) {
      if (readError instanceof DerivedStorageConfigurationError) {
        return NextResponse.json(
          {
            success: false,
            message: readError.message,
            data: null,
          },
          { status: 500 }
        );
      }
      console.error(`Failed to read page image file for page ${pageId}:`, readError);
      return NextResponse.json(
        {
          success: false,
          message: 'Failed to read page image from derived storage',
          data: null,
        },
        { status: 500 }
      );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json(
      {
        success: false,
        message,
        data: null,
      },
      { status: 500 }
    );
  }
}
