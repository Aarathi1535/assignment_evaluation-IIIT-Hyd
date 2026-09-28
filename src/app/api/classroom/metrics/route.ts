import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomAssessmentService from '@/services/ClassroomAssessmentService';
import { requireAuth, requireFeature } from '@/lib/apiAuth';
import { HttpError } from '@/lib/errors';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const featureCheck = requireFeature('CLASSROOM_ASSESSMENT');
  if (!featureCheck.authorized) {
    return featureCheck.response ?? NextResponse.json({ success: false, message: 'Classroom assessment feature is disabled', data: null }, { status: 404 });
  }

  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Only professors or admins can access agreement metrics',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();
    const { searchParams } = new URL(req.url);
    const questionId = searchParams.get('questionId') || undefined;

    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role
    };

    const metrics = await ClassroomAssessmentService.getAgreementMetrics(questionId, context);

    return NextResponse.json({
      success: true,
      message: 'Classroom agreement metrics retrieved successfully',
      data: metrics
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
