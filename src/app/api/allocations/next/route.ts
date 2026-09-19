import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../lib/db';
import { requirePermission } from '../../../../lib/apiAuth';
import { Permission } from '../../../../constants/permissions';
import { HttpError } from '../../../../lib/errors';
import AllocationService from '../../../../services/AllocationService';

/**
 * GET /api/allocations/next
 *
 * Retrieves the next PENDING or IN_PROGRESS allocation for the authenticated TA for an exam (AE-157).
 * Query parameters:
 * - examId (required): ID of the exam.
 * - currentAllocationId (optional): Current allocation to skip.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(Permission.VIEW_ASSIGNED_SCRIPTS);
  if (!auth.authorized) {
    return auth.response;
  }

  const { searchParams } = new URL(req.url);
  const examId = searchParams.get('examId');
  const currentAllocationId = searchParams.get('currentAllocationId');

  if (!examId || !mongoose.Types.ObjectId.isValid(examId)) {
    return NextResponse.json(
      {
        success: false,
        message: 'Valid Exam ID is required',
        data: null,
      },
      { status: 400 }
    );
  }

  if (currentAllocationId && !mongoose.Types.ObjectId.isValid(currentAllocationId)) {
    return NextResponse.json(
      {
        success: false,
        message: 'Invalid currentAllocationId format',
        data: null,
      },
      { status: 400 }
    );
  }

  try {
    await connectDB();

    const nextAllocation = await AllocationService.getNextAllocation(
      auth.user.id,
      examId,
      currentAllocationId
    );

    return NextResponse.json(
      {
        success: true,
        message: nextAllocation ? 'Next allocation found' : 'No remaining allocations',
        data: nextAllocation,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
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
