import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requireAnyPermission } from '../../../../../lib/apiAuth';
import { Permission, UserRole } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import Allocation from '../../../../../models/Allocation';
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
  const auth = await requireAnyPermission([
    Permission.GRADE_SCRIPT,
    Permission.ALLOCATE_SCRIPTS,
  ]);

  if (!auth.authorized) {
    return auth.response;
  }

  const user = auth.user!;
  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid ID format',
      data: null,
    }, { status: 400 });
  }

  try {
    await connectDB();

    const allocation = await Allocation.findById(id);
    if (!allocation) {
      return NextResponse.json({
        success: false,
        message: 'Allocation not found',
        data: null,
      }, { status: 404 });
    }

    const isBackupOperator =
      user.role === UserRole.PROFESSOR || user.role === UserRole.ADMIN;
    if (!isBackupOperator && allocation.ta.toString() !== user.id) {
      return NextResponse.json({
        success: false,
        message: 'Forbidden: This allocation belongs to another TA',
        data: null,
      }, { status: 403 });
    }

    const isReady = await AllocationService.isCompletionReady(allocation);
    if (!isReady) {
      return NextResponse.json({
        success: false,
        message: 'Cannot complete allocation: all allocated questions must have finalized grades.',
        data: null,
      }, { status: 409 });
    }

    const updatedAllocation = await AllocationService.markCompleted(
      id,
      {
        id: user.id,
        role: user.role as UserRole,
      }
    );

    const nextAllocation = await AllocationService.getNextAllocation(
      user.id,
      allocation.exam,
      id
    );

    const allocObj = updatedAllocation && typeof (updatedAllocation as unknown as { toObject?: () => Record<string, unknown> }).toObject === 'function'
      ? (updatedAllocation as unknown as { toObject: () => Record<string, unknown> }).toObject()
      : updatedAllocation;

    return NextResponse.json({
      success: true,
      message: 'Allocation completed successfully',
      data: {
        ...allocObj,
        allocationCompleted: true,
        nextAllocation,
      },
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    const status = error instanceof HttpError ? error.statusCode : 500;
    return NextResponse.json({
      success: false,
      message,
      data: null,
    }, { status });
  }
}
