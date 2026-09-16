import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission, UserRole } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import AllocationService from '../../../../../services/AllocationService';

/**
 * POST /api/allocations/[id]/complete
 *
 * Marks an IN_PROGRESS grading allocation as COMPLETED (AE-8B).
 * Sets completedAt and transitions status IN_PROGRESS -> COMPLETED atomically.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Check Permission.GRADE_SCRIPT (TAs, Admins)
  const auth = await requirePermission(Permission.GRADE_SCRIPT);
  let user = auth.user;

  if (!auth.authorized) {
    // Fallback: Check ALLOCATE_SCRIPTS (Professors)
    const profAuth = await requirePermission(Permission.ALLOCATE_SCRIPTS);
    if (profAuth.authorized) {
      user = profAuth.user;
    } else {
      return auth.response;
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

    const updatedAllocation = await AllocationService.markCompleted(
      id,
      {
        id: user!.id,
        role: user!.role as UserRole
      }
    );

    return NextResponse.json({
      success: true,
      message: 'Allocation completed successfully',
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
