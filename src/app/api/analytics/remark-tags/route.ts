import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';
import { UserRole } from '@/constants/permissions';
import { HttpError } from '@/lib/errors';
import remarkAnalyticsService from '@/services/RemarkAnalyticsService';

/**
 * GET /api/analytics/remark-tags
 *
 * Reports usage counts for preset comment tags across graded submissions
 * belonging exclusively to the authenticated professor's exams (AE-149).
 *
 * Query Params:
 * - exam: string (optional) - Target Exam ObjectId to filter analytics for a single exam.
 */
export async function GET(req: NextRequest) {
  // 1. Authenticate user
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }
  const user = auth.user;

  // 2. Enforce Professor-only access
  const userRole = user.role?.toUpperCase();
  if (userRole !== UserRole.PROFESSOR) {
    return NextResponse.json(
      {
        success: false,
        message: 'Forbidden: Only professors can access remark tag analytics.',
        data: null,
      },
      { status: 403 }
    );
  }

  // 3. Extract optional exam filter
  const { searchParams } = new URL(req.url);
  const examId = searchParams.get('exam') || searchParams.get('examId') || undefined;

  try {
    await connectDB();

    const data = await remarkAnalyticsService.getTagUsageAnalytics({
      professorId: user.id,
      examId,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Remark tag analytics retrieved successfully',
        data,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    const status = error instanceof HttpError ? error.statusCode : 500;
    return NextResponse.json(
      {
        success: false,
        message,
        data: null,
      },
      { status }
    );
  }
}
