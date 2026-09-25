import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomAssessmentService from '@/services/ClassroomAssessmentService';
import { requireAuth } from '@/lib/apiAuth';
import { HttpError } from '@/lib/errors';

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectDB();
    const { searchParams } = new URL(req.url);
    const questionId = searchParams.get('questionId') || undefined;

    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role
    };

    const submissions = await ClassroomAssessmentService.getStudentSubmissions(
      auth.user.id,
      questionId,
      context
    );

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
