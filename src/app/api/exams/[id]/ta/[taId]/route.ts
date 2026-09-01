import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../lib/db';
import { requirePermission } from '../../../../../../lib/apiAuth';
import { Permission } from '../../../../../../constants/permissions';
import { HttpError } from '../../../../../../lib/errors';
import AllocationService from '../../../../../../services/AllocationService';

/**
 * GET /api/exams/[id]/ta/[taId]
 *
 * Professor-facing TA drill-down endpoint for AE-108.
 * Returns assigned scripts, grading statuses, and actual grading duration (completedAt - claimedAt)
 * for a specific TA within an exam.
 * Enforces Permission.ALLOCATE_SCRIPTS authorization.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; taId: string }> }
) {
  const auth = await requirePermission(Permission.ALLOCATE_SCRIPTS);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id, taId } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid Exam ID format',
      data: null
    }, { status: 400 });
  }

  if (!mongoose.Types.ObjectId.isValid(taId)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid TA ID format',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();

    const workloadData = await AllocationService.getTaAllocationsForExam(id, taId);

    return NextResponse.json({
      success: true,
      message: 'TA workload retrieved successfully',
      data: workloadData
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
