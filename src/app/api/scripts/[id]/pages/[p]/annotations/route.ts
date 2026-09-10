import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../../../lib/db';
import { requirePermission } from '../../../../../../../lib/apiAuth';
import { Permission } from '../../../../../../../constants/permissions';
import { HttpError } from '../../../../../../../lib/errors';
import annotationPersistenceService from '../../../../../../../services/AnnotationPersistenceService';

/**
 * PUT /api/scripts/[id]/pages/[p]/annotations
 *
 * Saves and deterministically replaces vector annotations for a specific answer script page.
 */
export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string; p: string }> }
) {
  // 1. Authenticate and enforce grading / exam permissions
  const auth = await requirePermission(Permission.GRADE_SCRIPT);
  let user = auth.user;

  if (!auth.authorized) {
    const profAuth = await requirePermission(Permission.SAVE_MARKS_FEEDBACK);
    if (profAuth.authorized) {
      user = profAuth.user;
    } else {
      const examAuth = await requirePermission(Permission.EDIT_EXAM);
      if (examAuth.authorized) {
        user = examAuth.user;
      } else {
        return auth.response;
      }
    }
  }

  const { id, p } = await context.params;

  try {
    await connectDB();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid JSON request body',
          data: null,
        },
        { status: 400 }
      );
    }

    const ipAddress = req.headers.get('x-forwarded-for') || undefined;

    const result = await annotationPersistenceService.savePageAnnotations({
      scriptId: id,
      pageIdentifier: p,
      payload: body,
      userId: user!.id,
      userRole: user!.role,
      ipAddress,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Annotations saved successfully',
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
