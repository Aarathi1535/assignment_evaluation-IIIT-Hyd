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

  try {
    await connectDB();

    const history = await AllocationService.getReassignmentHistory(id, {
      id: auth.user.id,
      role: auth.user.role
    });

    return NextResponse.json({
      success: true,
      message: 'Reassignment history retrieved successfully',
      data: {
        examId: id,
        history
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
