import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';
import ClassroomSession from '@/models/ClassroomSession';
import classroomSessionService from '@/services/ClassroomSessionService';
import { HttpError } from '@/lib/errors';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  if (auth.user.role !== 'PROFESSOR') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Only professors can view classroom submissions',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();
    const resolvedParams = await params;
    const sessionCode = resolvedParams.code.trim().toUpperCase();

    const session = await ClassroomSession.findOne({ joinCode: sessionCode });
    if (!session || !session.currentActivity) {
      return NextResponse.json({
        success: false,
        message: 'Active activity not found for this session',
        data: null
      }, { status: 404 });
    }

    if (session.createdBy.toString() !== auth.user.id) {
      return NextResponse.json({
        success: false,
        message: 'Forbidden: You do not own this classroom session',
        data: null
      }, { status: 403 });
    }

    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role
    };

    const submissions = await classroomSessionService.getActivitySubmissions(
      session.currentActivity.toString(),
      context
    );

    return NextResponse.json({
      success: true,
      message: 'Submissions retrieved successfully',
      data: submissions
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

