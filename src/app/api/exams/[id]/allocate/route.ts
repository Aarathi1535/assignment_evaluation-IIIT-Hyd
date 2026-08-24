import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import IngestionApprovalService from '../../../../../services/IngestionApprovalService';
import AllocationService from '../../../../../services/AllocationService';
import { AllocationRule } from '../../../../../models/Allocation';

/**
 * POST /api/exams/[id]/allocate
 *
 * Grading/allocation gate for AE-074.
 * Enforces that ingestion must be APPROVED before any grading or allocation
 * can begin for the exam. Returns 403 if not approved.
 *
 * Validates request payload and triggers re-run prepare contract (AE-082).
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

    // Parse options from request body if available
    let rule: AllocationRule | undefined;
    try {
      const body = await req.json();
      if (body && body.rule) {
        rule = body.rule;
      }
    } catch {
      // Body may be empty or not JSON, ignore
    }

    // Validate the rule if it was provided
    if (rule && !Object.values(AllocationRule).includes(rule)) {
      return NextResponse.json({
        success: false,
        message: `Invalid allocation rule: ${rule}`,
        data: null
      }, { status: 400 });
    }

    // Run the allocation re-run contract / check
    await AllocationService.prepareForAllocation(id);

    return NextResponse.json({
      success: true,
      message: 'Allocation prepared successfully. Re-run contract verified.',
      data: { examId: id, rule }
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

