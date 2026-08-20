import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import IngestionApprovalService from '../../../../../services/IngestionApprovalService';

/**
 * POST /api/exams/[id]/allocate
 *
 * Grading/allocation gate for AE-074.
 * Enforces that ingestion must be APPROVED before any grading or allocation
 * can begin for the exam. Returns 403 if not approved.
 *
 * Full allocation business logic will be added in a later ticket (AE-075+).
 * This endpoint establishes the gate required by the ticket specification.
 */
export async function POST(
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
      message: 'Invalid ID format',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();

    // AE-074 gate: exam ingestion must be APPROVED before grading/allocation
    await IngestionApprovalService.requireApproved(id);

    // Placeholder: full allocation logic will be implemented in a future ticket.
    // This endpoint currently validates the gate and returns a success response
    // indicating the exam is cleared for allocation.
    return NextResponse.json({
      success: true,
      message: 'Exam ingestion is approved. Allocation can proceed.',
      data: { examId: id }
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
