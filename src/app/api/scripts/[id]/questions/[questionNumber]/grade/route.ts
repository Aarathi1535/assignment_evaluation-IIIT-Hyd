import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../../../lib/db';
import { requireGradingOrAnnotationAccess } from '../../../../../../../lib/apiAuth';
import { HttpError } from '../../../../../../../lib/errors';
import gradingService from '../../../../../../../services/GradingService';

/**
 * POST /api/scripts/[id]/questions/[questionNumber]/grade
 *
 * Persists or updates a question-level grade for a specific question (AE-145).
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; questionNumber: string }> }
) {
  // 1. Authenticate and enforce grading / annotation permissions
  const auth = await requireGradingOrAnnotationAccess();
  if (!auth.authorized) {
    return auth.response;
  }
  const user = auth.user;

  const { id, questionNumber } = await context.params;

  try {
    await connectDB();

    const body = await req.json().catch(() => ({}));
    const { marksAwarded, feedback, clientTotalScore } = body;

    const ipAddress = req.headers.get('x-forwarded-for') || undefined;

    const savedGrade = await gradingService.saveGrade({
      scriptId: id,
      question: Number(questionNumber),
      marksAwarded: Array.isArray(marksAwarded) ? marksAwarded : [],
      feedback,
      userId: user.id,
      userRole: user.role,
      ipAddress,
      clientTotalScore,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Grade saved successfully',
        data: savedGrade,
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

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string; questionNumber: string }> }
) {
  return POST(req, context);
}
