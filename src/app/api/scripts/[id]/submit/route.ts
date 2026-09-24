import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import { requireGradingOrAnnotationAccess } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';
import gradingService from '../../../../../services/GradingService';

/**
 * POST /api/scripts/[id]/submit
 *
 * Submits and locks a graded answer script (AE-166).
 * Enforces:
 * - Only allocated TAs or authorized Professors/Admins can submit.
 * - Rejects unallocated TAs and Students (403 Forbidden).
 * - Verifies all required/allocated questions have valid saved grades.
 * - Finalizes all relevant Grade documents (isFinal = true).
 * - Transitions TA allocation to COMPLETED with completedAt timestamp.
 * - Server-side locks the script for the TA.
 * - Safe & idempotent handling for already-submitted scripts.
 * - Authoritative audit logging (SCRIPT_SUBMITTED).
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
    const questionParam = body?.question !== undefined ? Number(body.question) : undefined;
    const ipAddress = req.headers.get('x-forwarded-for') || undefined;

    const result = await gradingService.submitScript({
      scriptId: id,
      userId: user.id,
      userRole: user.role,
      question: questionParam,
      ipAddress,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Script submitted and locked successfully',
        data: result,
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
