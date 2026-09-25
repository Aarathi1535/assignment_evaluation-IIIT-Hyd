import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../../../lib/db';
import { requireGradingOrAnnotationAccess } from '../../../../../../../lib/apiAuth';
import { HttpError } from '../../../../../../../lib/errors';
import annotationPersistenceService from '../../../../../../../services/AnnotationPersistenceService';

/**
 * GET /api/scripts/[id]/pages/[p]/annotations
 *
 * Retrieves saved vector annotations for a specific answer script page from Page.annotations (single source of truth).
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string; p: string }> }
) {
  // 1. Authenticate and enforce grading / exam permissions
  const auth = await requireGradingOrAnnotationAccess();
  if (!auth.authorized) {
    return auth.response;
  }
  const user = auth.user;

  const { id, p } = await context.params;

  try {
    await connectDB();

    const { searchParams } = new URL(req.url);
    const questionParam = searchParams.get('question') || searchParams.get('q');
    const question = questionParam && !isNaN(Number(questionParam)) ? Number(questionParam) : undefined;

    const result = await annotationPersistenceService.getPageAnnotations({
      scriptId: id,
      pageIdentifier: p,
      userId: user.id,
      userRole: user.role,
      question,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Annotations loaded successfully',
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
  const auth = await requireGradingOrAnnotationAccess();
  if (!auth.authorized) {
    return auth.response;
  }
  const user = auth.user;

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

    const { searchParams } = new URL(req.url);
    const questionParam = searchParams.get('question') || searchParams.get('q');
    let question = questionParam && !isNaN(Number(questionParam)) ? Number(questionParam) : undefined;
    if (question === undefined && body && typeof body === 'object' && typeof (body as Record<string, unknown>).question === 'number') {
      question = (body as Record<string, unknown>).question as number;
    }

    const bodyObj = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
    const ifUnmodifiedSince = req.headers.get('if-unmodified-since');
    const expectedUpdatedAt =
      (bodyObj?.expectedUpdatedAt as string | number | undefined) ||
      (bodyObj?.baseUpdatedAt as string | number | undefined) ||
      ifUnmodifiedSince ||
      searchParams.get('expectedUpdatedAt') ||
      searchParams.get('baseUpdatedAt') ||
      undefined;

    const force = Boolean(bodyObj?.force || searchParams.get('force') === 'true');

    const ipAddress = req.headers.get('x-forwarded-for') || undefined;

    const result = await annotationPersistenceService.savePageAnnotations({
      scriptId: id,
      pageIdentifier: p,
      payload: body,
      userId: user.id,
      userRole: user.role,
      question,
      ipAddress,
      expectedUpdatedAt,
      force,
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
    const isConflict = status === 409;
    return NextResponse.json(
      {
        success: false,
        conflict: isConflict,
        message,
        data: null,
      },
      { status }
    );
  }
}
