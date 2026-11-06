import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import { requireAuth } from '@/lib/apiAuth';
import ClassroomAssessmentService from '@/services/ClassroomAssessmentService';
import ClassroomEventService, { ClassroomRealtimeEvent } from '@/services/ClassroomEventService';
import { HttpError } from '@/lib/errors';

export const dynamic = 'force-dynamic';

/**
 * GET /api/classroom/stream
 *
 * Realtime Server-Sent Events (SSE) stream for interactive classroom sessions.
 * Pushes active question state, live response counts, close/reveal state changes.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  if (auth.user.role === 'ADMIN') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Classroom Assessment is not available for Admin accounts',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();

    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role
    };

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
          // Push initial snapshot of active question state
          const initialQuestion = await ClassroomAssessmentService.getActiveQuestion(context);
          safeEnqueue(`event: initial\ndata: ${JSON.stringify({ activeQuestion: initialQuestion })}\n\n`);

          // Subscribe to live classroom updates
          unsubscribe = ClassroomEventService.subscribe(async (event: ClassroomRealtimeEvent) => {
            try {
              // Fetch fresh state for this user context to guarantee proper role sanitization
              const freshActive = await ClassroomAssessmentService.getActiveQuestion(context);
              safeEnqueue(`event: classroom_update\ndata: ${JSON.stringify({
                eventType: event.type,
                questionId: event.questionId,
                activeQuestion: freshActive,
                payload: event.payload
              })}\n\n`);
            } catch {
              // Fallback to forwarding raw event
              safeEnqueue(`event: classroom_update\ndata: ${JSON.stringify(event)}\n\n`);
            }
          });

          // Periodic keepalive comment every 15 seconds
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

    req.signal?.addEventListener('abort', () => {
      isClosed = true;
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
      }
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      }
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
