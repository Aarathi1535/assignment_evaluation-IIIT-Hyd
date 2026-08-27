import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import AllocationService from '../../../../../services/AllocationService';

/**
 * POST /api/allocations/[id]/claim
 *
 * Claims a PENDING grading allocation for the authenticated TA.
 * Transitions status PENDING -> IN_PROGRESS atomically.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.GRADE_SCRIPT);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid ID format',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();

    const updatedAllocation = await AllocationService.claimAllocation(
      id,
      auth.user.id
    );

    return NextResponse.json({
      success: true,
      message: 'Allocation claimed successfully',
      data: updatedAllocation
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
