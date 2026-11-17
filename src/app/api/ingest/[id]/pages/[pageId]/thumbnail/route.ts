import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../../lib/db';
import { requireGradingOrAnnotationAccess, canManageExam } from '../../../../../../../lib/apiAuth';
import { UserRole } from '../../../../../../../constants/permissions';
import BatchRepository from '../../../../../../../repositories/BatchRepository';
import IngestionPage from '../../../../../../../models/IngestionPage';
import AllocationService from '../../../../../../../services/AllocationService';
import DerivedStorageService from '../../../../../../../services/DerivedStorageService';

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
    const userRole = auth.user.role?.toUpperCase();
    const isProfessor = userRole === UserRole.PROFESSOR;
    const isAdmin = userRole === UserRole.ADMIN;
    const isProfessorOrAdmin = isProfessor || isAdmin;

    const batch = await BatchRepository.getBatchByBatchIdInternal(batchId);
    if (!batch) {
      return NextResponse.json({
        success: false,
        message: 'Batch not found or access denied',
        data: null
      }, { status: 404 });
    }

    let examId = batch.exam;
    if (!examId && page.answerScript) {
      const AnswerScript = mongoose.models.AnswerScript || (await import('../../../../../../../models/AnswerScript')).default;
      const script = await AnswerScript.findById(page.answerScript).select('exam');
      if (script?.exam) {
        examId = script.exam;
      }
    }

    if (examId) {
      const manage = await canManageExam(auth.user, examId);
      if (isProfessorOrAdmin) {
        if (!manage.canManage) {
          return NextResponse.json({
            success: false,
            message: 'Batch not found or access denied',
            data: null
          }, { status: 404 });
        }
      } else {
        if (!manage.exam || !manage.course) {
          return NextResponse.json({
            success: false,
            message: 'Batch not found or access denied',
            data: null
          }, { status: 404 });
        }
      }
    } else if (isProfessor) {
      if (batch.uploadedBy && batch.uploadedBy.toString() !== auth.user.id) {
        return NextResponse.json({
          success: false,
          message: 'Batch not found or access denied',
          data: null
        }, { status: 404 });
      }
    }

    // 4. For TA users, enforce allocation-scoped authorization
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

    // 5. Verify thumbnail is available
    if (!page.thumbnailKey) {
      return NextResponse.json({
        success: false,
        message: 'Thumbnail key is missing or not generated yet',
        data: null
      }, { status: 404 });
    }

    const etag = `"${crypto.createHash('md5').update(page.updatedAt.toISOString()).digest('hex')}"`;
    const ifNoneMatch = req.headers.get('if-none-match');

    if (ifNoneMatch && ifNoneMatch.includes(etag)) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          'ETag': etag,
          'Cache-Control': 'private, no-store',
        },
      });
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
          'ETag': etag,
          'Cache-Control': 'private, no-store',
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
