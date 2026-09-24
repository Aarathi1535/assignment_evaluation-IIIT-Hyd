import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../../lib/db';
import { requireGradingOrAnnotationAccess } from '../../../../../../lib/apiAuth';
import { HttpError } from '../../../../../../lib/errors';
import gradingService from '../../../../../../services/GradingService';

/**
 * POST /api/exams/[id]/submissions/bulk
 *
 * Bulk-submits and finalizes eligible allocations for an exam (AE-169).
 * Supports:
 * - preview mode (preview: true) for dry-run counts and breakdowns.
 * - confirmed execution (confirmed: true).
 * - optional allocationIds subset.
 * - batch cap / limit control.
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
    const { allocationIds, preview, confirmed, limit } = body || {};
    const ipAddress = req.headers.get('x-forwarded-for') || undefined;

    const result = await gradingService.bulkSubmit({
      examId: id,
      userId: user.id,
      userRole: user.role,
      allocationIds,
      preview: Boolean(preview),
      confirmed: Boolean(confirmed),
      limit: typeof limit === 'number' ? limit : undefined,
      ipAddress,
    });

    return NextResponse.json(
      {
        success: true,
        message: preview
          ? 'Bulk submission preview computed successfully'
          : 'Bulk submission completed successfully',
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
