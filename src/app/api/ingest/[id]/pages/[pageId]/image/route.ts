import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../../lib/db';
import { requireGradingOrAnnotationAccess } from '../../../../../../../lib/apiAuth';
import { UserRole } from '../../../../../../../constants/permissions';
import BatchRepository from '../../../../../../../repositories/BatchRepository';
import IngestionPage from '../../../../../../../models/IngestionPage';
import AllocationService from '../../../../../../../services/AllocationService';
import DerivedStorageService from '../../../../../../../services/DerivedStorageService';

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

    const batch = isProfessor
      ? await BatchRepository.getBatchById(batchId, auth.user.id, auth.user.role)
      : await BatchRepository.getBatchByBatchIdInternal(batchId);

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

    // 5. Read the full-resolution page image file from derived storage
    try {
      const buffer = await DerivedStorageService.readDerivedPage(page.storageKey);

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

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': contentType,
          'Content-Length': buffer.length.toString(),
        },
      });
    } catch (readError) {
      console.error(`Failed to read page image file for page ${pageId}:`, readError);
      return NextResponse.json(
        {
          success: false,
          message: 'Page image file not found on disk',
          data: null,
        },
        { status: 404 }
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
