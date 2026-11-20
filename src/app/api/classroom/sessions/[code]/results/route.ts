import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomSession from '@/models/ClassroomSession';
import classroomSessionService from '@/services/ClassroomSessionService';
import { HttpError } from '@/lib/errors';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await connectDB();
    const resolvedParams = await params;
    const sessionCode = resolvedParams.code.trim().toUpperCase();

    const session = await ClassroomSession.findOne({ joinCode: sessionCode });
    if (!session || !session.currentActivity) {
      return NextResponse.json({
        success: false,
        message: 'Classroom activity not found',
        data: null
      }, { status: 404 });
    }

    const { requireAuth } = await import('@/lib/apiAuth');
    const auth = await requireAuth();
    if (auth.authorized && auth.user.role === 'PROFESSOR' && session.createdBy.toString() !== auth.user.id) {
      return NextResponse.json({
        success: false,
        message: 'Forbidden: You do not own this classroom session',
        data: null
      }, { status: 403 });
    }

    const results = await classroomSessionService.getPublishedResults(session.currentActivity.toString());
    if (!results) {
      return NextResponse.json({
        success: false,
        message: 'Results have not been published yet for this activity',
        data: null
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      message: 'Published results retrieved successfully',
      data: results
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

