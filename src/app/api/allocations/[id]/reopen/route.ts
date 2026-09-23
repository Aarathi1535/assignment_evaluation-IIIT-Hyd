import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission, UserRole } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import AllocationService from '../../../../../services/AllocationService';

/**
 * POST /api/allocations/[id]/reopen
 *
 * Reopens a completed grading allocation (AE-167).
 * - Enforces exam ownership RBAC (Exam-owning professor or ADMIN).
 * - Requires a non-empty reopen reason.
 * - Atomically resets Grade.isFinal to false, Allocation.status to IN_PROGRESS,
 *   clears completedAt, preserves pre-reopen grade snapshots in AuditLog,
 *   and creates a notification for the allocated TA.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.ALLOCATE_SCRIPTS);
  if (!auth.authorized) {
    return auth.response;
  }

  const user = auth.user!;
  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json(
      {
        success: false,
        message: 'Invalid ID format',
        data: null,
      },
      { status: 400 }
    );
  }

  try {
    await connectDB();

    const body = await req.json().catch(() => ({}));
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

    if (!reason) {
      return NextResponse.json(
        {
          success: false,
          message: 'Reopen reason is required.',
          data: null,
        },
        { status: 400 }
      );
    }

    const ipAddress = req.headers.get('x-forwarded-for') || undefined;

    const result = await AllocationService.reopenAllocation({
      allocationId: id,
      userId: user.id,
      userRole: user.role as UserRole,
      reason,
      ipAddress,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Allocation reopened successfully',
        data: result,
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
