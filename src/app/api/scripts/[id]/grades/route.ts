import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import { requireGradingOrAnnotationAccess } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';
import gradingService from '../../../../../services/GradingService';

/**
 * POST /api/scripts/[id]/grades
 *
 * Persists or updates a question-level grade for the given AnswerScript (AE-145).
 * Enforces:
 * - RBAC & Allocation access control.
 * - Active Rubric verification.
 * - Server-authoritative criterion validation and totalScore calculation.
 * - Allocation lifecycle claiming (PENDING -> IN_PROGRESS on first save).
 * - Audit logging.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 1. Authenticate and enforce grading / annotation permissions
  const auth = await requireGradingOrAnnotationAccess();
  if (!auth.authorized) {
    return auth.response;
  }
  const user = auth.user;

  const { id } = await context.params;

  try {
    await connectDB();

    const body = await req.json().catch(() => ({}));
    const { question, marksAwarded, feedback, tagIds, clientTotalScore } = body;

    const ipAddress = req.headers.get('x-forwarded-for') || undefined;

    const savedGrade = await gradingService.saveGrade({
      scriptId: id,
      question: Number(question),
      marksAwarded: Array.isArray(marksAwarded) ? marksAwarded : [],
      feedback,
      tagIds,
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
  context: { params: Promise<{ id: string }> }
) {
  return POST(req, context);
}

/**
 * GET /api/scripts/[id]/grades
 *
 * Retrieves all saved question grades for the given AnswerScript (AE-148).
 * Enforces:
 * - RBAC & Allocation access control.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireGradingOrAnnotationAccess();
  if (!auth.authorized) {
    return auth.response;
  }
  const user = auth.user;

  const { id } = await context.params;

  try {
    await connectDB();

    const grades = await gradingService.getGradesForScript(id, user.id, user.role);

    return NextResponse.json(
      {
        success: true,
        message: 'Grades retrieved successfully',
        data: grades,
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

