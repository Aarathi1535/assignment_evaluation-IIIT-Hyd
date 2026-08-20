import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import IngestionApprovalService from '../../../../../services/IngestionApprovalService';

/**
 * POST /api/exams/[id]/verify-assembly
 *
 * Integrity verification endpoint for AE-075.
 * Verifies the current ingestion assembly against the stored cryptographic seal.
 * Requires APPROVE_INGESTION permission.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.APPROVE_INGESTION);
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

    const result = await IngestionApprovalService.verifyAssembly(id, {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role,
      ipAddress:
        (req as NextRequest & { ip?: string }).ip ||
        req.headers.get('x-forwarded-for') ||
        req.headers.get('x-real-ip') ||
        undefined
    });

    return NextResponse.json({
      success: true,
      message: 'Assembly verification completed',
      data: result
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
