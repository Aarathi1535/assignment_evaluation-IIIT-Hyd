import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import { requirePermission } from '@/lib/apiAuth';
import { Permission } from '@/constants/permissions';
import { HttpError } from '@/lib/errors';
import AllocationService from '@/services/AllocationService';

/**
 * GET /api/professor/activity
 *
 * Retrieves the most recent grading-related activities for the professor dashboard from AuditLog (AE-116).
 * Protected by Permission.ALLOCATE_SCRIPTS (Professors and Admins).
 */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(Permission.ALLOCATE_SCRIPTS);
  if (!auth.authorized) {
    return auth.response;
  }

  const { searchParams } = new URL(req.url);
  const limitStr = searchParams.get('limit');
  const examId = searchParams.get('examId');

  let limit = 10; // Default limit for dashboard activity feed
  const maxLimit = 100;

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

  if (examId !== null && examId !== undefined && examId !== '') {
    if (!mongoose.Types.ObjectId.isValid(examId)) {
      return NextResponse.json({
        success: false,
        message: 'Invalid Exam ID format',
        data: null
      }, { status: 400 });
    }
  }

  try {
    await connectDB();

    const result = await AllocationService.getActivityFeed(
      {
        id: auth.user.id,
        role: auth.user.role
      },
      {
        limit,
        examId: examId || undefined
      }
    );

    return NextResponse.json({
      success: true,
      message: 'Activity feed retrieved successfully',
      data: {
        activities: result.activities,
        total: result.total
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
