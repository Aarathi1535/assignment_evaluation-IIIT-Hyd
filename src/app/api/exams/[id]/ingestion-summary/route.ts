import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import IngestionApprovalService from '../../../../../services/IngestionApprovalService';

/**
 * GET /api/exams/[id]/ingestion-summary
 *
 * Ingestion review dashboard counts and scripts list endpoint for AE-076.
 * Returns aggregation counts and matching script lists.
 * Requires VIEW_COURSES permission and enforces scope constraints.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.VIEW_COURSES);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid ID format',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();

    const auditContext = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role,
      ipAddress:
        (req as NextRequest & { ip?: string }).ip ||
        req.headers.get('x-forwarded-for') ||
        req.headers.get('x-real-ip') ||
        undefined
    };

    // 1. Fetch aggregate dashboard counts (server-side MongoDB aggregation)
    const counts = await IngestionApprovalService.getReviewDashboardSummary(id, auditContext);

    // 2. Fetch scripts if a category filter is requested for drill-down
    const url = new URL(req.url);
    const categoryParam = url.searchParams.get('category');
    
    let scripts: Record<string, unknown>[] | null = null;
    if (categoryParam) {
      if (!['total', 'unmatched', 'blank', 'duplicate', 'conflict'].includes(categoryParam)) {
        return NextResponse.json({
          success: false,
          message: 'Invalid category filter. Must be total, unmatched, blank, duplicate, or conflict.',
          data: null
        }, { status: 400 });
      }

      scripts = await IngestionApprovalService.getReviewDashboardScripts(
        id,
        categoryParam as 'total' | 'unmatched' | 'blank' | 'duplicate' | 'conflict',
        auditContext
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Ingestion summary retrieved successfully',
      data: {
        counts,
        scripts
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
