import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomAssessmentService from '@/services/ClassroomAssessmentService';
import { requireAuth, requireFeature } from '@/lib/apiAuth';
import { HttpError } from '@/lib/errors';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
    const resolvedParams = await params;
    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role
    };

    const submission = await ClassroomAssessmentService.getSubmissionById(resolvedParams.id, context);

    return NextResponse.json({
      success: true,
      message: 'Submission retrieved successfully',
      data: submission
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
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
      message: 'Forbidden: Only professors or admins can confirm classroom scores',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();
    const resolvedParams = await params;
    const body = await req.json();

    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role
    };

    const updated = await ClassroomAssessmentService.confirmSubmissionScore(
      {
        submissionId: resolvedParams.id,
        confirmedScore: body.confirmedScore,
        feedback: body.feedback,
        criterionScores: body.criterionScores
      },
      context
    );

    return NextResponse.json({
      success: true,
      message: 'Submission score confirmed successfully',
      data: updated
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

export async function POST(
  req: NextRequest,
  params: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  return PATCH(req, params);
}
