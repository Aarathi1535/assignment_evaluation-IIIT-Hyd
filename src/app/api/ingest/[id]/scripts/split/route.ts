import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../../lib/db';
import { requirePermission } from '../../../../../../lib/apiAuth';
import { Permission } from '../../../../../../constants/permissions';
import { HttpError } from '../../../../../../lib/errors';
import CorrectionService from '../../../../../../services/CorrectionService';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.EDIT_EXAM);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;
  const batchId = id;

  if (!batchId) {
    return NextResponse.json({
      success: false,
      message: 'Invalid batchId',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({
        success: false,
        message: 'Invalid JSON request body',
        data: null
      }, { status: 400 });
    }

    const { scriptId, version, groups } = body || {};
    if (!scriptId || !groups) {
      return NextResponse.json({
        success: false,
        message: 'scriptId and groups are required',
        data: null
      }, { status: 400 });
    }

    const result = await CorrectionService.splitScript(
      batchId,
      scriptId,
      version,
      groups,
      {
        actingUserId: auth.user.id,
        actingUserRole: auth.user.role,
        ipAddress: req.headers.get('x-forwarded-for') || undefined
      }
    );

    return NextResponse.json({
      success: true,
      message: 'Script split successfully',
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
