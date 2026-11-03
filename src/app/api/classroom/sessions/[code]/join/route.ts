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

    let body: { name?: string } = {};
    try {
      body = await req.json();
    } catch {
      // Body may be empty if student just scans
    }

    // Check if user is logged into the platform as a student
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
      // Non-blocking if session auth is not available
    }

    if (!participantName) {
      return NextResponse.json({
        success: false,
        message: 'Name or roll number is required to join classroom session',
        data: null
      }, { status: 400 });
    }

    const joinResult = await classroomSessionService.joinSession(
      code,
      participantName,
      optionalUserId
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

