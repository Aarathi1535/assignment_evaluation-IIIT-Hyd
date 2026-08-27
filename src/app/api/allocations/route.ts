import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../lib/db';
import { requirePermission } from '../../../lib/apiAuth';
import { Permission } from '../../../constants/permissions';
import { HttpError } from '../../../lib/errors';
import Allocation, { AllocationStatus } from '../../../models/Allocation';
import { Anonymizer } from '../../../lib/anonymizer';

/**
 * GET /api/allocations
 *
 * Retrieves grading allocations belonging to the currently authenticated TA.
 * Supports filters: ?examId=... &status=...
 * Supports sorting: ?sort=oldest | oldest-first | createdAt
 * Defaults to oldest-first sorting by Allocation.createdAt.
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(Permission.VIEW_ASSIGNED_SCRIPTS);
  if (!auth.authorized) {
    return auth.response;
  }

  const { searchParams } = new URL(req.url);
  const examId = searchParams.get('examId');
  const status = searchParams.get('status');
  const sortParam = searchParams.get('sort') || searchParams.get('sortBy');

  // Validate examId if provided
  if (examId && !mongoose.Types.ObjectId.isValid(examId)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid Exam ID format',
      data: null
    }, { status: 400 });
  }

  // Validate status if provided
  if (status && !Object.values(AllocationStatus).includes(status as AllocationStatus)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid status filter value',
      data: null
    }, { status: 400 });
  }

  // Validate sort parameter if provided
  if (sortParam) {
    const validSortValues = ['oldest', 'oldest-first', 'createdAt'];
    if (!validSortValues.includes(sortParam)) {
      return NextResponse.json({
        success: false,
        message: `Invalid sort value: ${sortParam}`,
        data: null
      }, { status: 400 });
    }
  }

  try {
    await connectDB();

    const query: { ta: mongoose.Types.ObjectId; exam?: mongoose.Types.ObjectId; status?: AllocationStatus } = {
      ta: new mongoose.Types.ObjectId(auth.user.id)
    };
    if (examId) {
      query.exam = new mongoose.Types.ObjectId(examId);
    }
    if (status) {
      query.status = status as AllocationStatus;
    }

    // Default sorting is oldest allocation first (createdAt ascending)
    const allocations = await Allocation.find(query)
      .populate('answerScript')
      .sort({ createdAt: 1 })
      .lean();

    // Extract populated answer script documents
    const scripts = allocations.map(a => a.answerScript).filter(Boolean);

    // Bulk serialize using the Anonymizer, passing the viewer context
    const serializedScripts = await Anonymizer.serializeAnswerScripts(
      scripts,
      { id: auth.user.id, role: auth.user.role }
    );

    // Map serialized scripts back to their allocations
    const scriptMap = new Map(
      serializedScripts.map(s => [s._id.toString(), s])
    );

    const result = allocations.map(a => {
      const scriptId = a.answerScript?._id?.toString() || a.answerScript?.toString();
      return {
        _id: a._id.toString(),
        exam: a.exam.toString(),
        status: a.status,
        question: a.question,
        answerScript: scriptMap.get(scriptId) || null
      };
    });

    return NextResponse.json({
      success: true,
      message: 'Allocations retrieved successfully',
      data: result
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
