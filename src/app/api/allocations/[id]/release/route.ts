import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission, UserRole } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import AllocationService from '../../../../../services/AllocationService';

/**
 * POST /api/allocations/[id]/release
 *
 * Releases an IN_PROGRESS grading allocation back to PENDING.
 * Transitions status IN_PROGRESS -> PENDING atomically.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Check Permission.GRADE_SCRIPT (TAs, Admins)
  const auth = await requirePermission(Permission.GRADE_SCRIPT);
  let user = auth.user;

  if (!auth.authorized) {
    // If not authorized for GRADE_SCRIPT, check ALLOCATE_SCRIPTS (Professors)
    const profAuth = await requirePermission(Permission.ALLOCATE_SCRIPTS);
    if (profAuth.authorized) {
      user = profAuth.user;
    } else {
      return profAuth.response;
    }
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

    // Professors and Admins are backup operators who can release other TAs' allocations.
    const isBackupOperator = user!.role === UserRole.PROFESSOR || user!.role === UserRole.ADMIN;

    const updatedAllocation = await AllocationService.releaseAllocation(
      id,
      user!.id,
      isBackupOperator
    );

    if (!updatedAllocation) {
      return NextResponse.json({
        success: false,
        message: 'Allocation not found or not in progress',
        data: null
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Allocation released successfully',
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
