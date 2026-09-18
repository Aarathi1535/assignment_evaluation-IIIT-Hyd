import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../lib/db';
import { requireGradingOrAnnotationAccess } from '../../../../lib/apiAuth';
import { HttpError } from '../../../../lib/errors';
import commentTagService from '../../../../services/CommentTagService';
import { updateTagSchema } from '../../../../validations/tagValidation';

/**
 * GET /api/tags/[id]
 *
 * Retrieves a single comment tag by ID.
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

    const tag = await commentTagService.getTagById(id, {
      userId: user.id,
      userRole: user.role,
    });

    if (!tag) {
      return NextResponse.json(
        {
          success: false,
          message: 'Comment tag not found',
          data: null,
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Tag retrieved successfully',
        data: tag,
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
 * PUT /api/tags/[id] or PATCH /api/tags/[id]
 *
 * Updates an existing comment tag.
 * Only accessible to Professors (for their own tags/exams) and Admins.
 */
export async function PUT(
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

    // Validate update body
    const parseResult = updateTagSchema.safeParse(body);
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

    const { label, description } = parseResult.data;
    const ipAddress = req.headers.get('x-forwarded-for') || undefined;

    const updatedTag = await commentTagService.updateTag(
      id,
      { label, description },
      {
        userId: user.id,
        userRole: user.role,
        ipAddress,
      }
    );

    return NextResponse.json(
      {
        success: true,
        message: 'Comment tag updated successfully',
        data: updatedTag,
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

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  return PUT(req, context);
}

/**
 * DELETE /api/tags/[id]
 *
 * Deletes an existing comment tag.
 * Only accessible to Professors (for their own tags/exams) and Admins.
 */
export async function DELETE(
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

    const ipAddress = req.headers.get('x-forwarded-for') || undefined;

    await commentTagService.deleteTag(id, {
      userId: user.id,
      userRole: user.role,
      ipAddress,
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Comment tag deleted successfully',
        data: null,
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
