import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import ExamService from '../../../../../services/ExamService';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.EDIT_EXAM);
  if (!auth.authorized) {
    return auth.response;
  }

  // Only allow PROFESSOR or ADMIN roles
  if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
  }

  const { id } = await context.params;

  try {
    await connectDB();

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({
        success: false,
        message: 'Invalid JSON body',
        data: null
      }, { status: 400 });
    }

    const { studentIds } = body;
    if (!studentIds || !Array.isArray(studentIds)) {
      return NextResponse.json({
        success: false,
        message: 'studentIds is required and must be an array',
        data: null
      }, { status: 400 });
    }

    try {
      const roster = await ExamService.enrollStudents(id, studentIds, {
        actingUserId: auth.user.id,
        ipAddress: req.headers.get('x-forwarded-for') || undefined
      });

      if (!roster) {
        return NextResponse.json({
          success: false,
          message: 'Exam not found',
          data: null
        }, { status: 404 });
      }

      return NextResponse.json({
        success: true,
        message: 'Students enrolled to exam successfully',
        data: roster
      }, { status: 200 });

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred during enrollment';
      return NextResponse.json({
        success: false,
        message,
        data: null
      }, { status: 400 });
    }

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status: 500 });
  }
}
