import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomSession from '@/models/ClassroomSession';
import ClassroomQuestion from '@/models/ClassroomQuestion';
import ClassroomEventService, { ClassroomRealtimeEvent } from '@/services/ClassroomEventService';
import { HttpError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/classroom/sessions/[code]/stream
 *
 * Server-Sent Events (SSE) stream for live classroom activity sessions.
 * Sends initial snapshot and pushes live updates for participants, submissions, timer, and published results.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await connectDB();
    const resolvedParams = await params;
    const sessionCode = resolvedParams.code.trim().toUpperCase();

    const session = await ClassroomSession.findOne({ joinCode: sessionCode });
    if (!session) {
      return NextResponse.json({
        success: false,
        message: 'Classroom session not found',
        data: null
      }, { status: 404 });
    }

    const sessionIdStr = session._id.toString();
    const encoder = new TextEncoder();
    let unsubscribe: (() => void) | null = null;
    let heartbeatInterval: NodeJS.Timeout | null = null;
    let isClosed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const safeEnqueue = (data: string) => {
          if (isClosed) return;
          try {
            controller.enqueue(encoder.encode(data));
          } catch {
            isClosed = true;
          }
        };

        try {
          // Send initial session snapshot
          const initialActivity = session.currentActivity
            ? await ClassroomQuestion.findById(session.currentActivity)
            : null;

          const snapshot = {
            sessionId: sessionIdStr,
            joinCode: session.joinCode,
            participantCount: session.participantCount || 0,
            activity: initialActivity ? {
              id: initialActivity._id.toString(),
              title: initialActivity.title,
              questionPrompt: initialActivity.questionPrompt,
              timeLimit: initialActivity.timeLimit || 0,
              expiresAt: initialActivity.expiresAt ? initialActivity.expiresAt.toISOString() : null,
              totalSubmissions: initialActivity.totalSubmissions || 0,
              correctCount: initialActivity.correctCount || 0,
              incorrectCount: initialActivity.incorrectCount || 0,
              status: initialActivity.status,
              isPublished: !!initialActivity.isPublished,
              referenceAnswer: initialActivity.isPublished ? (initialActivity.referenceAnswer || initialActivity.correctAnswerText) : null
            } : null
          };

          safeEnqueue(`event: initial\ndata: ${JSON.stringify(snapshot)}\n\n`);

          // Subscribe to real-time events for this session
          unsubscribe = ClassroomEventService.subscribe((event: ClassroomRealtimeEvent) => {
            // Filter events for this session
            if (event.sessionId && event.sessionId !== sessionIdStr) {
              return;
            }

            safeEnqueue(`event: classroom_event\ndata: ${JSON.stringify({
              type: event.type,
              questionId: event.questionId,
              sessionId: sessionIdStr,
              payload: event.payload,
              timestamp: event.timestamp
            })}\n\n`);
          });

          // Periodic keepalive every 15 seconds
          heartbeatInterval = setInterval(() => {
            safeEnqueue(`: keepalive\n\n`);
          }, 15000);
        } catch {
          isClosed = true;
          try {
            controller.close();
          } catch {
            // Ignore close error
          }
        }
      },
      cancel() {
        isClosed = true;
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
      }
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
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

