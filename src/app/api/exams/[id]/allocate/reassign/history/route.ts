import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../../lib/db';
import { requirePermission } from '../../../../../../../lib/apiAuth';
import { Permission } from '../../../../../../../constants/permissions';
import { HttpError } from '../../../../../../../lib/errors';
import AllocationService from '../../../../../../../services/AllocationService';

/**
 * GET /api/exams/[id]/allocate/reassign/history
 *
 * Retrieves chronological allocation reassignment history for an exam from existing AuditLog records (AE-113).
 * Requires Permission.ALLOCATE_SCRIPTS (Professors and Admins).
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.ALLOCATE_SCRIPTS);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid Exam ID format',
      data: null
    }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const pageStr = searchParams.get('page');
  const limitStr = searchParams.get('limit');

  let page = 1;
  let limit = 20; // Default limit matching repository convention
  const maxLimit = 100;

  if (pageStr !== null) {
    const isPositiveInteger = /^[1-9]\d*$/.test(pageStr);
    if (!isPositiveInteger) {
      return NextResponse.json({
        success: false,
        message: 'Invalid page parameter. It must be a positive integer.',
        data: null
      }, { status: 400 });
    }
    page = parseInt(pageStr, 10);
  }

  if (limitStr !== null) {
    const isPositiveInteger = /^[1-9]\d*$/.test(limitStr);
    if (!isPositiveInteger) {
      return NextResponse.json({
        success: false,
        message: 'Invalid limit parameter. It must be a positive integer.',
        data: null
      }, { status: 400 });
    }
    limit = Math.min(parseInt(limitStr, 10), maxLimit);
  }

  try {
    await connectDB();

    const result = await AllocationService.getReassignmentHistory(
      id,
      {
        id: auth.user.id,
        role: auth.user.role
      },
      {
        page,
        limit
      }
    );

    return NextResponse.json({
      success: true,
      message: 'Reassignment history retrieved successfully',
      data: {
        examId: id,
        history: result.history,
        pagination: result.pagination
      }
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    const status = error instanceof HttpError ? error.statusCode : 500;
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status });
  }
}
