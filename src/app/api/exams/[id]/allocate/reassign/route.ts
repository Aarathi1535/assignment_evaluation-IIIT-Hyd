import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../lib/db';
import { requirePermission } from '../../../../../../lib/apiAuth';
import { Permission } from '../../../../../../constants/permissions';
import { HttpError } from '../../../../../../lib/errors';
import AllocationService from '../../../../../../services/AllocationService';
import ExamRepository from '../../../../../../repositories/ExamRepository';
import Allocation from '../../../../../../models/Allocation';

/**
 * PUT /api/exams/[id]/allocate/reassign
 *
 * Manual allocation reassignment (AE-088).
 * Reassigns one allocation row to another eligible TA on the course.
 */
export async function PUT(
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

    // Parse options from request body
    let allocationId: string;
    let targetTaId: string;

    try {
      const body = await req.json();
      if (!body) {
        return NextResponse.json({
          success: false,
          message: 'Request body is required',
          data: null
        }, { status: 400 });
      }
      allocationId = body.allocationId;
      targetTaId = body.targetTaId;
    } catch {
      return NextResponse.json({
        success: false,
        message: 'Invalid JSON payload or empty request body',
        data: null
      }, { status: 400 });
    }

    if (!allocationId) {
      return NextResponse.json({
        success: false,
        message: 'Allocation ID is required',
        data: null
      }, { status: 400 });
    }

    if (!targetTaId) {
      return NextResponse.json({
        success: false,
        message: 'Target TA ID is required',
        data: null
      }, { status: 400 });
    }

    const allocation = await Allocation.findById(allocationId).select('exam').lean();
    if (allocation && allocation.exam.toString() !== id) {
      return NextResponse.json({
        success: false,
        message: 'Allocation does not belong to the specified exam',
        data: null
      }, { status: 400 });
    }
    const exam = await ExamRepository.getExamById(id, auth.user.id, auth.user.role);
    if (!exam) {
      return NextResponse.json({ success: false, message: 'Exam not found', data: null }, { status: 404 });
    }

    const actingUserId = auth.user?.id || '';

    const updatedAllocation = await AllocationService.reassignAllocation(
      id,
      allocationId,
      targetTaId,
      actingUserId
    );

    return NextResponse.json({
      success: true,
      message: 'Allocation reassigned successfully',
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
