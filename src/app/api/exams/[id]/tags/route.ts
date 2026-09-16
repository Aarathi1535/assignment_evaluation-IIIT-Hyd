import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import { requireGradingOrAnnotationAccess } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';
import commentTagService from '../../../../../services/CommentTagService';
import { TagScope } from '../../../../../models/CommentTag';
import { createTagSchema } from '../../../../../validations/tagValidation';

/**
 * GET /api/exams/[id]/tags
 *
 * Lists global tags and exam-specific tags for this exam.
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

    const { searchParams } = new URL(req.url);
    const scopeParam = searchParams.get('scope')?.toUpperCase();
    const scope = scopeParam === 'GLOBAL' ? TagScope.GLOBAL : scopeParam === 'EXAM' ? TagScope.EXAM : null;

    const tags = await commentTagService.listTags({
      examId: id,
      scope,
      userId: user.id,
      userRole: user.role,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Tags retrieved successfully',
        data: tags,
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
 * POST /api/exams/[id]/tags
 *
 * Creates a preset tag scoped to this exam.
 */
export async function POST(
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

    const body = await req.json().catch(() => ({}));
    const payload = { ...body, scope: body.scope || TagScope.EXAM, exam: id };

    const parseResult = createTagSchema.safeParse(payload);
    if (!parseResult.success) {
      return NextResponse.json(
        {
          success: false,
          message: parseResult.error.issues[0]?.message || 'Validation error',
          errors: parseResult.error.issues,
          data: null,
        },
        { status: 400 }
      );
    }

    const { label, scope, description } = parseResult.data;
    const ipAddress = req.headers.get('x-forwarded-for') || undefined;

    const newTag = await commentTagService.createTag(
      {
        label,
        scope,
        exam: id,
        description,
      },
      {
        userId: user.id,
        userRole: user.role,
        ipAddress,
      }
    );

    return NextResponse.json(
      {
        success: true,
        message: 'Comment tag created successfully for this exam',
        data: newTag,
      },
      { status: 201 }
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
