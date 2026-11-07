import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';
import classroomSessionService from '@/services/ClassroomSessionService';
import { HttpError } from '@/lib/errors';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  if (auth.user.role !== 'PROFESSOR') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Only professors can review submissions',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();
    const resolvedParams = await params;
    const submissionId = resolvedParams.id;

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({
        success: false,
        message: 'Invalid JSON request body',
        data: null
      }, { status: 400 });
    }

    if (typeof body.isCorrect !== 'boolean') {
      return NextResponse.json({
        success: false,
        message: 'Field "isCorrect" (boolean) is required',
        data: null
      }, { status: 400 });
    }

    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role
    };

    const updated = await classroomSessionService.reviewSubmission(
      submissionId,
      body.isCorrect,
      body.note || null,
      context
    );

    return NextResponse.json({
      success: true,
      message: `Submission marked ${body.isCorrect ? 'correct' : 'incorrect'}`,
      data: {
        id: updated._id.toString(),
        isCorrect: updated.isCorrect,
        status: updated.status,
        reviewedAt: updated.reviewedAt?.toISOString() || null
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

