import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../lib/db';
import { requirePermission } from '../../../../lib/apiAuth';
import { Permission } from '../../../../constants/permissions';
import { HttpError } from '../../../../lib/errors';
import Allocation from '../../../../models/Allocation';
import ExamRepository from '../../../../repositories/ExamRepository';
import AllocationService from '../../../../services/AllocationService';

export async function DELETE(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.ALLOCATE_SCRIPTS);
  if (!auth.authorized) return auth.response;

  const { id } = await context.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({ success: false, message: 'Invalid Allocation ID format', data: null }, { status: 400 });
  }

  try {
    await connectDB();
    const allocation = await Allocation.findById(id).select('exam').lean();
    if (!allocation) {
      return NextResponse.json({ success: false, message: 'Allocation not found', data: null }, { status: 404 });
    }

    const exam = await ExamRepository.getExamById(
      allocation.exam.toString(),
      auth.user.id,
      auth.user.role
    );
    if (!exam) {
      return NextResponse.json({ success: false, message: 'Allocation not found', data: null }, { status: 404 });
    }

    const removed = await AllocationService.removePendingAllocation(id, auth.user.id);
    return NextResponse.json({
      success: true,
      message: 'Pending allocation removed successfully',
      data: {
        _id: removed._id.toString(),
        exam: removed.exam.toString(),
        ta: removed.ta.toString(),
        answerScript: removed.answerScript.toString(),
        question: removed.question
      }
    }, {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' }
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    const status = error instanceof HttpError ? error.statusCode : 500;
    return NextResponse.json({ success: false, message, data: null }, { status });
  }
}
