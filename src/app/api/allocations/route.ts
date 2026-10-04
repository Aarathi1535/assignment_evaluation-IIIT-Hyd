import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../lib/db';
import { requirePermission } from '../../../lib/apiAuth';
import { Permission } from '../../../constants/permissions';
import { HttpError } from '../../../lib/errors';
import Allocation, { AllocationStatus } from '../../../models/Allocation';
import Notification from '../../../models/Notification';
import User from '../../../models/User';
import { Anonymizer } from '../../../lib/anonymizer';

export const dynamic = 'force-dynamic';

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
  console.info('[TA ALLOCATION DEBUG]', JSON.stringify({
    authenticatedUserId: auth.user.id,
    authenticatedEmail: auth.user.email,
    authenticatedRole: auth.user.role,
    requestedExamId: examId
  }));

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

  const pageStr = searchParams.get('page');
  const limitStr = searchParams.get('limit');

  let page = 1;
  let limit = 20; // Safe default limit
  const maxLimit = 100;

  if (pageStr !== null) {
    const isPositiveInteger = /^[1-9]\d*$/.test(pageStr);
    if (!isPositiveInteger) {
      return NextResponse.json({
        success: false,
        message: 'Invalid page parameter. It must be a positive integer.',
        data: null
      }, { status: 400 });
    }
    page = parseInt(pageStr, 10);
  }

  if (limitStr !== null) {
    const isPositiveInteger = /^[1-9]\d*$/.test(limitStr);
    if (!isPositiveInteger) {
      return NextResponse.json({
        success: false,
        message: 'Invalid limit parameter. It must be a positive integer.',
        data: null
      }, { status: 400 });
    }
    limit = Math.min(parseInt(limitStr, 10), maxLimit);
  }

  try {
    await connectDB();
    const authenticatedUser = await User.findById(auth.user.id)
      .select('_id email name role isActive')
      .lean();
    console.info('[TA ALLOCATION DEBUG]', JSON.stringify({
      authenticatedUserDocument: authenticatedUser ? {
        userId: authenticatedUser._id.toString(),
        email: authenticatedUser.email,
        name: authenticatedUser.name,
        role: authenticatedUser.role,
        isActive: authenticatedUser.isActive
      } : null
    }));

    const statusQuery: { ta: mongoose.Types.ObjectId; exam?: mongoose.Types.ObjectId } = {
      ta: new mongoose.Types.ObjectId(auth.user.id)
    };
    if (examId) {
      statusQuery.exam = new mongoose.Types.ObjectId(examId);
    }
    const query: typeof statusQuery & { status?: AllocationStatus } = { ...statusQuery };
    if (status) {
      query.status = status as AllocationStatus;
    }
    console.info('[TA ALLOCATION DEBUG]', JSON.stringify({ mongoQuery: query }));

    // Count the total matching allocations
    const [total, pending, inProgress, completed, assignedExamIds] = await Promise.all([
      Allocation.countDocuments(query),
      Allocation.countDocuments({ ...statusQuery, status: AllocationStatus.PENDING }),
      Allocation.countDocuments({ ...statusQuery, status: AllocationStatus.IN_PROGRESS }),
      Allocation.countDocuments({ ...statusQuery, status: AllocationStatus.COMPLETED }),
      Allocation.distinct('exam', statusQuery)
    ]);
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1 && totalPages > 0;

    const skip = (page - 1) * limit;

    // Default sorting is oldest allocation first, sorting deterministically (createdAt ascending, _id ascending)
    const allocations = await Allocation.find(query)
      .sort({ createdAt: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .populate('answerScript')
      .lean();
    console.info('[TA ALLOCATION DEBUG]', JSON.stringify({
      matchingAllocationCount: total,
      returnedAllocationCount: allocations.length,
      allocations: allocations.map(allocation => ({
        allocationId: allocation._id.toString(),
        ta: allocation.ta.toString(),
        exam: allocation.exam.toString(),
        rawAnswerScriptId: allocation.answerScript?._id?.toString() || allocation.answerScript?.toString() || null,
        populatedAnswerScriptId: allocation.answerScript?._id?.toString() || null,
        status: allocation.status
      }))
    }));

    // Extract populated answer script documents
    const scripts = allocations.map(a => a.answerScript).filter(Boolean);

    // Bulk serialize using the Anonymizer, passing the viewer context
    let serializedScripts;
    try {
      serializedScripts = await Anonymizer.serializeAnswerScripts(
        scripts,
        { id: auth.user.id, role: auth.user.role }
      );
    } catch (error) {
      console.error('[TA ALLOCATION DEBUG] AnswerScript serialization failed', JSON.stringify({
        authenticatedUserId: auth.user.id,
        allocationIds: allocations.map(allocation => allocation._id.toString()),
        error: error instanceof Error ? error.message : 'Unknown serialization error'
      }));
      throw error;
    }

    // Map serialized scripts back to their allocations
    const scriptMap = new Map(
      serializedScripts.map(s => [s._id.toString(), s])
    );
    console.info('[TA ALLOCATION DEBUG]', JSON.stringify({
      serializedAnswerScriptIds: serializedScripts.map(script => script._id.toString()),
      scriptMapKeys: Array.from(scriptMap.keys())
    }));

    const result = allocations.map(a => {
      const scriptId = a.answerScript?._id?.toString() || a.answerScript?.toString();
      const serializedScript = scriptMap.get(scriptId);
      console.info('[TA ALLOCATION DEBUG]', JSON.stringify({
        allocationId: a._id.toString(),
        rawAnswerScriptId: a.answerScript?._id?.toString() || a.answerScript?.toString() || null,
        populatedAnswerScriptId: a.answerScript?._id?.toString() || null,
        serializedAnswerScriptId: serializedScript?._id?.toString() || null
      }));
      return {
        _id: a._id.toString(),
        exam: a.exam.toString(),
        status: a.status,
        question: a.question,
        answerScript: serializedScript || null
      };
    });

    const unreadNotificationCount = await Notification.countDocuments({
      recipient: new mongoose.Types.ObjectId(auth.user.id),
      read: false
    });

    return NextResponse.json({
      success: true,
      message: 'Allocations retrieved successfully',
      data: {
        allocations: result,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage,
          hasPreviousPage
        },
        stats: {
          pending,
          inProgress,
          completed,
          assignedExams: assignedExamIds.length
        },
        unreadNotificationCount
      }
    }, {
      status: 200,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' }
    });

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
