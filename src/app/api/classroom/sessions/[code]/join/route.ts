import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import classroomSessionService from '@/services/ClassroomSessionService';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { HttpError } from '@/lib/errors';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await connectDB();
    const resolvedParams = await params;
    const code = resolvedParams.code.trim().toUpperCase();

    if (!/^[A-Z0-9]{6}$/.test(code)) {
      return NextResponse.json({
        success: false,
        message: 'Invalid join code format. Must be 6 alphanumeric characters',
        data: null
      }, { status: 400 });
    }

    let body: { name?: string; token?: string } = {};
    try {
      body = await req.json();
    } catch {
      // Body may be empty if student just scans
    }

    const participantToken = req.headers.get('x-participant-token') || body.token;

    // Classroom joining is purely lightweight: no Assignment Evaluation account is required
    let optionalUserId: string | undefined;
    let participantName = body.name?.trim();

    try {
      const nextSession = await getServerSession(authOptions);
      if (nextSession?.user?.id) {
        optionalUserId = nextSession.user.id;
        if (!participantName) {
          participantName = nextSession.user.name || nextSession.user.email || 'Student';
        }
      }
    } catch {
      // Non-blocking: student account is purely optional
    }

    if (!participantName && !participantToken) {
      return NextResponse.json({
        success: false,
        message: 'Name or roll number is required to join classroom session',
        data: null
      }, { status: 400 });
    }

    const joinResult = await classroomSessionService.joinSession(
      code,
      participantName || 'Student',
      optionalUserId,
      participantToken || undefined
    );

    return NextResponse.json({
      success: true,
      message: 'Joined classroom session successfully',
      data: joinResult
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

