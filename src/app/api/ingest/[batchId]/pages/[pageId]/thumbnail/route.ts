import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../../lib/db';
import { requirePermission } from '../../../../../../../lib/apiAuth';
import { Permission } from '../../../../../../../constants/permissions';
import BatchRepository from '../../../../../../../repositories/BatchRepository';
import IngestionPage from '../../../../../../../models/IngestionPage';
import DerivedStorageService from '../../../../../../../services/DerivedStorageService';

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ batchId: string; pageId: string }> }
) {
  const auth = await requirePermission(Permission.EDIT_EXAM);
  if (!auth.authorized) {
    return auth.response;
  }

  const { batchId, pageId } = await context.params;

  if (!batchId || !pageId) {
    return NextResponse.json({
      success: false,
      message: 'Invalid parameters',
      data: null
    }, { status: 404 });
  }

  if (!mongoose.Types.ObjectId.isValid(pageId)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid page ID format',
      data: null
    }, { status: 404 });
  }

  try {
    await connectDB();

    // 1. Resolve Ingestion Page
    const page = await IngestionPage.findById(pageId);
    if (!page) {
      return NextResponse.json({
        success: false,
        message: 'Page not found',
        data: null
      }, { status: 404 });
    }

    // 2. Verify page belongs to the batch
    if (page.batchId !== batchId) {
      return NextResponse.json({
        success: false,
        message: 'Page does not belong to the requested batch',
        data: null
      }, { status: 404 });
    }

    // 3. Verify authorized access to the batch
    const batch = await BatchRepository.getBatchById(batchId, auth.user.id, auth.user.role);
    if (!batch) {
      return NextResponse.json({
        success: false,
        message: 'Batch not found or access denied',
        data: null
      }, { status: 404 });
    }

    // 4. Verify thumbnail is available
    if (!page.thumbnailKey) {
      return NextResponse.json({
        success: false,
        message: 'Thumbnail key is missing or not generated yet',
        data: null
      }, { status: 404 });
    }

    // 5. Read the thumbnail file from derived storage
    try {
      const buffer = await DerivedStorageService.readDerivedPage(page.thumbnailKey);

      // Determine proper Content-Type
      let contentType = 'image/jpeg';
      const keyLower = page.thumbnailKey.toLowerCase();
      if (keyLower.endsWith('.png')) {
        contentType = 'image/png';
      } else if (keyLower.endsWith('.webp')) {
        contentType = 'image/webp';
      } else if (keyLower.endsWith('.gif')) {
        contentType = 'image/gif';
      }

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type': contentType,
          'Content-Length': buffer.length.toString(),
        }
      });

    } catch (readError) {
      console.error(`Failed to read thumbnail file for page ${pageId}:`, readError);
      return NextResponse.json({
        success: false,
        message: 'Thumbnail file not found on disk',
        data: null
      }, { status: 404 });
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status: 500 });
  }
}
