import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomSession from '@/models/ClassroomSession';
import ClassroomQuestion from '@/models/ClassroomQuestion';
import { HttpError } from '@/lib/errors';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await connectDB();
    const resolvedParams = await params;
    const code = resolvedParams.code.trim().toUpperCase();

    const session = await ClassroomSession.findOne({ joinCode: code });
    if (!session) {
      return NextResponse.json({
        success: false,
        message: 'Classroom session not found',
        data: null
      }, { status: 404 });
    }

    let activeActivity = null;
    if (session.currentActivity) {
      const act = await ClassroomQuestion.findById(session.currentActivity);
      if (act) {
        if (act.status === 'ACTIVE' && act.expiresAt && new Date() > act.expiresAt) {
          act.status = 'CLOSED';
          act.isActive = false;
          act.closedAt = act.expiresAt;
          await act.save();
        }

        activeActivity = {
          id: act._id.toString(),
          title: act.title,
          questionPrompt: act.questionPrompt,
          timeLimit: act.timeLimit || 0,
          expiresAt: act.expiresAt ? act.expiresAt.toISOString() : null,
          totalSubmissions: act.totalSubmissions || 0,
          correctCount: act.correctCount || 0,
          incorrectCount: act.incorrectCount || 0,
          status: act.status,
          isPublished: !!act.isPublished,
          // Only show reference answer if published
          referenceAnswer: act.isPublished ? (act.referenceAnswer || act.correctAnswerText || null) : null
        };
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Session retrieved successfully',
      data: {
        session: {
          id: session._id.toString(),
          title: session.title,
          joinCode: session.joinCode,
          status: session.status,
          participantCount: session.participantCount || 0,
          qrCodeSvg: session.qrCodeSvg
        },
        activeActivity
      }
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

