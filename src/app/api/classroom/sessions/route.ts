import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';
import ClassroomSession from '@/models/ClassroomSession';
import classroomSessionService from '@/services/ClassroomSessionService';
import { HttpError } from '@/lib/errors';

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  if (auth.user.role !== 'PROFESSOR') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Only professors can view classroom sessions',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();
    const sessions = await ClassroomSession.find({ createdBy: auth.user.id })
      .populate('currentActivity')
      .sort({ createdAt: -1 })
      .limit(20);

    return NextResponse.json({
      success: true,
      message: 'Sessions retrieved successfully',
      data: sessions
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

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  if (auth.user.role !== 'PROFESSOR') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Only professors can create classroom sessions',
      data: null
    }, { status: 403 });
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

    const { title, questionPrompt, referenceAnswer, timeLimit, courseId } = body;

    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || undefined
    };

    const result = await classroomSessionService.createSessionAndActivity(
      {
        title,
        questionPrompt,
        referenceAnswer,
        timeLimit: typeof timeLimit === 'number' ? timeLimit : 180,
        courseId
      },
      context
    );

    return NextResponse.json({
      success: true,
      message: 'Classroom session and activity created successfully',
      data: result
    }, { status: 201 });
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
