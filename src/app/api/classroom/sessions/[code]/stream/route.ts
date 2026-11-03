import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomSession from '@/models/ClassroomSession';
import ClassroomQuestion from '@/models/ClassroomQuestion';
import ClassroomParticipant from '@/models/ClassroomParticipant';
import ClassroomEventService, { ClassroomRealtimeEvent } from '@/services/ClassroomEventService';
import { requireAuth } from '@/lib/apiAuth';
import { HttpError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/classroom/sessions/[code]/stream
 *
 * Authenticated Server-Sent Events (SSE) stream for live classroom activity sessions.
 * Sends initial snapshot and pushes live updates for participants, submissions, timer, and published results.
 * Enforces role-based event payload filtering (student vs professor).
 */
export async function GET(
  req: NextRequest,
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

    // 1. Authenticate caller
    let clientRole: 'PROFESSOR_OWNER' | 'PARTICIPANT' | null = null;
    let participantId: string | null = null;

    // Check professor auth
    const auth = await requireAuth();
    if (auth.authorized && auth.user.role === 'PROFESSOR') {
      if (session.createdBy.toString() === auth.user.id) {
        clientRole = 'PROFESSOR_OWNER';
      }
    }

    // Check participant token if not professor
    if (!clientRole) {
      const searchParams = req.nextUrl.searchParams;
      const participantToken = req.headers.get('x-participant-token') || searchParams.get('token');

      if (participantToken) {
        const participant = await ClassroomParticipant.findOne({
          token: participantToken,
          session: session._id
        });
        if (participant) {
          clientRole = 'PARTICIPANT';
          participantId = participant.participantId;
        }
      }
    }

    if (!clientRole) {
      return NextResponse.json({
        success: false,
        message: 'Unauthorized: Valid professor session or participant token required to access classroom stream',
        data: null
      }, { status: 401 });
    }

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
          // Fetch active activity and handle timer expiration
          const initialActivity = session.currentActivity
            ? await ClassroomQuestion.findById(session.currentActivity)
            : null;

          if (initialActivity && initialActivity.status === 'ACTIVE' && initialActivity.expiresAt) {
            if (new Date() > initialActivity.expiresAt) {
              initialActivity.status = 'CLOSED';
              initialActivity.isActive = false;
              initialActivity.closedAt = initialActivity.expiresAt;
              await initialActivity.save();

              ClassroomEventService.notifyQuestionClosed(
                initialActivity._id.toString(),
                {
                  closedAt: initialActivity.closedAt.toISOString(),
                  totalSubmissions: initialActivity.totalSubmissions || 0
                },
                sessionIdStr
              );
            }
          }

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
              // Only expose reference answer if published
              referenceAnswer: initialActivity.isPublished
                ? (initialActivity.referenceAnswer || initialActivity.correctAnswerText)
                : null
            } : null
          };

          safeEnqueue(`event: initial\ndata: ${JSON.stringify(snapshot)}\n\n`);

          // Subscribe to real-time events for this session
          unsubscribe = ClassroomEventService.subscribe((event: ClassroomRealtimeEvent) => {
            if (event.sessionId && event.sessionId !== sessionIdStr) {
              return;
            }

            // Sanitize event payload based on audience role
            let eventPayload = event.payload;

            if (clientRole === 'PARTICIPANT') {
              if (event.type === 'SUBMISSION_RECEIVED' && event.payload) {
                const p = event.payload as Record<string, unknown>;
                eventPayload = {
                  totalSubmissions: p.totalSubmissions,
                  isMySubmission: p.participantId === participantId
                };
              } else if (event.type === 'SESSION_JOINED' && event.payload) {
                const p = event.payload as Record<string, unknown>;
                eventPayload = {
                  participantCount: p.participantCount
                };
              }
            }

            safeEnqueue(`event: classroom_event\ndata: ${JSON.stringify({
              type: event.type,
              questionId: event.questionId,
              sessionId: sessionIdStr,
              payload: eventPayload,
              timestamp: event.timestamp
            })}\n\n`);
          });

          // Periodic keepalive every 15 seconds to prevent gateway timeout
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
