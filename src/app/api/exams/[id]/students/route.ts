import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../../lib/db';
import ExamService from '../../../../../services/ExamService';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';

export async function GET(
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

    const roster = await ExamService.getEnrolledStudents(id, auth.user.id, auth.user.role);
    if (!roster) {
      return NextResponse.json({
        success: false,
        message: 'Exam not found',
        data: null
      }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const formattedRoster = roster.map((m: any) => ({
      id: m.student?._id?.toString() || m.student?.id?.toString() || '',
      name: m.student?.name || '',
      email: m.student?.email || ''
    }));

    return NextResponse.json({
      success: true,
      message: 'Exam student roster retrieved successfully',
      data: formattedRoster
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status: 500 });
  }
}

