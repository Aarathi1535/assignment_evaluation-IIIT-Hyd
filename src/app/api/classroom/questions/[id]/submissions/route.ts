import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomAssessmentService from '@/services/ClassroomAssessmentService';
import { requireAuth } from '@/lib/apiAuth';
import { HttpError } from '@/lib/errors';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Only professors or admins can view all submissions for a question',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();
    const resolvedParams = await params;
    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role
    };

    const submissions = await ClassroomAssessmentService.getQuestionSubmissions(resolvedParams.id, context);

    return NextResponse.json({
      success: true,
      message: 'Submissions retrieved successfully',
      data: submissions
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
