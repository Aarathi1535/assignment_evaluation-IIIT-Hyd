import { NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomAssessmentService from '@/services/ClassroomAssessmentService';
import { requireAuth, requireFeature } from '@/lib/apiAuth';
import { HttpError } from '@/lib/errors';

export async function GET() {
  const featureCheck = requireFeature('CLASSROOM_ASSESSMENT');
  if (!featureCheck.authorized) {
    return featureCheck.response ?? NextResponse.json({ success: false, message: 'Classroom assessment feature is disabled', data: null }, { status: 404 });
  }

  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectDB();
    const activeQuestion = await ClassroomAssessmentService.getActiveQuestion();

    return NextResponse.json({
      success: true,
      message: activeQuestion ? 'Active classroom question retrieved' : 'No active question currently',
      data: activeQuestion
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
