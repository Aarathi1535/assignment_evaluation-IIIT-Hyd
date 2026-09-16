import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../lib/db';
import { requireGradingOrAnnotationAccess } from '../../../lib/apiAuth';
import { HttpError } from '../../../lib/errors';
import commentTagService from '../../../services/CommentTagService';
import { createTagSchema } from '../../../validations/tagValidation';
import { TagScope } from '../../../models/CommentTag';

/**
 * GET /api/tags
 *
 * Lists preset comment tags.
 * Query parameters:
 * - exam: string (optional exam ID)
 * - scope: 'GLOBAL' | 'EXAM' (optional)
 *
 * Professors/Admins can see global tags and exam tags for exams they manage.
 * TAs can see global tags and tags for exams they are assigned to.
 */
export async function GET(req: NextRequest) {
  const auth = await requireGradingOrAnnotationAccess();
  if (!auth.authorized) {
    return auth.response;
  }
  const user = auth.user;

  try {
    await connectDB();

    const { searchParams } = new URL(req.url);
    const examId = searchParams.get('exam') || searchParams.get('examId');
    const scopeParam = searchParams.get('scope')?.toUpperCase();
    const scope = scopeParam === 'GLOBAL' ? TagScope.GLOBAL : scopeParam === 'EXAM' ? TagScope.EXAM : null;

    const tags = await commentTagService.listTags({
      examId,
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
 * POST /api/tags
 *
 * Creates a preset comment tag.
 * Only accessible to Professors and Admins.
 */
export async function POST(req: NextRequest) {
  const auth = await requireGradingOrAnnotationAccess();
  if (!auth.authorized) {
    return auth.response;
  }
  const user = auth.user;

  try {
    await connectDB();

    const body = await req.json().catch(() => ({}));

    // Validate request body
    const parseResult = createTagSchema.safeParse(body);
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

    const { label, scope, exam, examId, description } = parseResult.data;
    const ipAddress = req.headers.get('x-forwarded-for') || undefined;

    const newTag = await commentTagService.createTag(
      {
        label,
        scope,
        exam: exam || examId,
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
        message: 'Comment tag created successfully',
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
