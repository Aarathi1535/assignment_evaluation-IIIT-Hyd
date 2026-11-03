import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomSession from '@/models/ClassroomSession';
import ClassroomSubmission from '@/models/ClassroomSubmission';
import classroomSessionService from '@/services/ClassroomSessionService';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { HttpError } from '@/lib/errors';

export async function GET(
  req: NextRequest,
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
        message: 'Active activity not found',
        data: null
      }, { status: 404 });
    }

    const participantToken = req.headers.get('x-participant-token');
    let participantId: string | null = null;
    let studentUserId: string | null = null;

    if (participantToken) {
      const participant = await classroomSessionService.getParticipantByToken(participantToken);
      if (participant) {
        participantId = participant.participantId;
        if (participant.userId) {
          studentUserId = participant.userId.toString();
        }
      }
    }

    if (!participantId) {
      try {
        const nextSession = await getServerSession(authOptions);
        if (nextSession?.user?.id) {
          studentUserId = nextSession.user.id;
          participantId = `user_${studentUserId}`;
        }
      } catch {
        // Continue
      }
    }

    if (!participantId && !studentUserId) {
      return NextResponse.json({
        success: false,
        message: 'Participant token or login required',
        data: null
      }, { status: 401 });
    }

    const query: Record<string, unknown> = {
      question: session.currentActivity
    };

    if (participantId && studentUserId) {
      query.$or = [{ participantId }, { student: studentUserId }];
    } else if (participantId) {
      query.participantId = participantId;
    } else {
      query.student = studentUserId;
    }

    const submission = await ClassroomSubmission.findOne(query);

    return NextResponse.json({
      success: true,
      message: 'Submission status retrieved',
      data: submission ? {
        id: submission._id.toString(),
        studentName: submission.studentName,
        imagePath: submission.imagePath,
        status: submission.status,
        isCorrect: submission.isCorrect,
        submittedAt: submission.submittedAt.toISOString(),
        reviewedAt: submission.reviewedAt ? submission.reviewedAt.toISOString() : null
      } : null
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

