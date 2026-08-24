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

    // Parse options from request body
    let rule: AllocationRule;
    let taIds: string[] | undefined;
    let seed: unknown;
    try {
      const body = await req.json();
      if (!body) {
        return NextResponse.json({
          success: false,
          message: 'Request body is required',
          data: null
        }, { status: 400 });
      }
      rule = body.rule;
      taIds = body.taIds;
      seed = body.seed;
    } catch {
      return NextResponse.json({
        success: false,
        message: 'Invalid JSON payload or empty request body',
        data: null
      }, { status: 400 });
    }

    if (!rule) {
      return NextResponse.json({
        success: false,
        message: 'Allocation rule is required',
        data: null
      }, { status: 400 });
    }

    // Validate the rule
    if (!Object.values(AllocationRule).includes(rule)) {
      return NextResponse.json({
        success: false,
        message: `Invalid allocation rule: ${rule}`,
        data: null
      }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resultData: any = { examId: id, rule };

    if (!taIds || !Array.isArray(taIds) || taIds.length === 0) {
      return NextResponse.json({
        success: false,
        message: `At least one selected TA must be provided for ${rule.toLowerCase()} allocation`,
        data: null
      }, { status: 400 });
    }

    // Check if user is authenticated (should be, as checked by requirePermission)
    const actingUserId = auth.user?.id || '';

    if (rule === AllocationRule.EQUAL) {
      const createdAllocations = await AllocationService.allocateEqual(id, taIds, actingUserId);
      resultData = createdAllocations;
    } else if (rule === AllocationRule.QUESTION) {
      const createdAllocations = await AllocationService.allocateByQuestion(id, taIds, actingUserId);
      resultData = createdAllocations;
    } else {
      // rule === AllocationRule.RANDOM
      if (
        seed === undefined ||
        seed === null ||
        typeof seed !== 'number' ||
        !Number.isFinite(seed) ||
        !Number.isInteger(seed)
      ) {
        return NextResponse.json({
          success: false,
          message: 'Invalid seed: seed must be a finite integer number',
          data: null
        }, { status: 400 });
      }
      const createdAllocations = await AllocationService.allocateRandom(id, taIds, actingUserId, seed);
      resultData = createdAllocations;
    }

    return NextResponse.json({
      success: true,
      message: 'Allocation completed successfully',
      data: resultData
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

