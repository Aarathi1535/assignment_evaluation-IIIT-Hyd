import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requireGradingOrAnnotationAccess } from '../../../../../lib/apiAuth';
import { UserRole } from '../../../../../constants/permissions';
import AnswerScript from '../../../../../models/AnswerScript';
import IngestionPage from '../../../../../models/IngestionPage';
import Page from '../../../../../models/Page';
import ExamRepository from '../../../../../repositories/ExamRepository';
import AllocationService from '../../../../../services/AllocationService';
import { HttpError } from '../../../../../lib/errors';

/**
 * GET /api/scripts/[id]/pages
 *
 * Retrieves the ordered answer-sheet pages for a specific answer script.
 * Enforces strict authorization:
 * - Professors/Admins: Verified access to the script's parent Exam.
 * - TAs: Verified allocation to the AnswerScript via AllocationService.verifyTaAllocation.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 1. Authenticate and enforce grading / annotation permissions
  const auth = await requireGradingOrAnnotationAccess();
  if (!auth.authorized) {
    return auth.response;
  }
  const user = auth.user;

  const { id } = await context.params;

  if (!id || !mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json(
      {
        success: false,
        message: 'Invalid AnswerScript ID format',
        data: null,
      },
      { status: 400 }
    );
  }

  try {
    await connectDB();

    // 2. Retrieve AnswerScript and verify active status
    const script = await AnswerScript.findOne({ _id: id, isActive: true });
    if (!script) {
      return NextResponse.json(
        {
          success: false,
          message: 'AnswerScript not found',
          data: null,
        },
        { status: 404 }
      );
    }

    // 3. Enforce access control
    const userRole = user.role?.toUpperCase();
    const isProfessorOrAdmin =
      userRole === UserRole.PROFESSOR || userRole === UserRole.ADMIN;

    if (isProfessorOrAdmin) {
      const exam = await ExamRepository.getExamById(
        script.exam.toString(),
        user.id,
        user.role
      );
      if (!exam) {
        return NextResponse.json(
          {
            success: false,
            message: 'Forbidden: Access denied to the exam for this answer script',
            data: null,
          },
          { status: 403 }
        );
      }
    } else {
      const allocation = await AllocationService.verifyTaAllocation(
        script._id,
        user.id
      );
      if (!allocation) {
        return NextResponse.json(
          {
            success: false,
            message: 'Forbidden: You are not allocated to grade this answer script',
            data: null,
          },
          { status: 403 }
        );
      }
    }

    // 4. Retrieve pages for this answer script
    let formattedPages: Array<{
      _id: string;
      id: string;
      pageNumber: number;
      fileIndex?: number;
      imageUrl: string;
      thumbnailUrl?: string | null;
      width?: number;
      height?: number;
      nearBlank?: boolean;
      isDuplicate?: boolean;
      isCoverPage?: boolean;
    }> = [];

    const ingestionPages = await IngestionPage.find({
      answerScript: script._id,
    }).sort({ fileIndex: 1, pageNumber: 1 });

    if (ingestionPages.length > 0) {
      formattedPages = ingestionPages.map((p) => ({
        _id: p._id.toString(),
        id: p._id.toString(),
        pageNumber: p.pageNumber,
        fileIndex: p.fileIndex,
        imageUrl: `/api/ingest/${p.batchId}/pages/${p._id}/image`,
        thumbnailUrl: p.thumbnailKey
          ? `/api/ingest/${p.batchId}/pages/${p._id}/thumbnail`
          : null,
        width: p.width,
        height: p.height,
        nearBlank: p.nearBlank || false,
        isDuplicate: p.isDuplicate || false,
        isCoverPage: p.isCoverPage || false,
      }));
    } else {
      // Fallback to Page collection if available
      const standardPages = await Page.find({
        answerScript: script._id,
        isActive: true,
      }).sort({ pageNumber: 1 });

      formattedPages = standardPages.map((p) => ({
        _id: p._id.toString(),
        id: p._id.toString(),
        pageNumber: p.pageNumber,
        imageUrl: p.imagePath,
        thumbnailUrl: null,
      }));
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Pages retrieved successfully',
        data: formattedPages,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'An unexpected error occurred';
    const status = error instanceof HttpError ? error.statusCode : 500;
    return NextResponse.json(
      {
        success: false,
        message,
        data: null,
      },
      { status }
    );
  }
}
