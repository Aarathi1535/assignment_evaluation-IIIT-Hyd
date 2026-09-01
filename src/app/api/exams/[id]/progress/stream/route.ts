import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../lib/db';
import { requirePermission } from '../../../../../../lib/apiAuth';
import { Permission } from '../../../../../../constants/permissions';
import { HttpError } from '../../../../../../lib/errors';
import Exam from '../../../../../../models/Exam';
import AllocationService from '../../../../../../services/AllocationService';
import ProgressEventService, { LIVE_UPDATES_UNAVAILABLE_MESSAGE } from '../../../../../../services/ProgressEventService';

export const dynamic = 'force-dynamic';

/**
 * GET /api/exams/[id]/progress/stream
 *
 * Server-Sent Events (SSE) route handler for real-time grading progress updates.
 * - Authorized using Permission.ALLOCATE_SCRIPTS (Professors and Admins).
 * - Delivers initial progress snapshot immediately upon connection.
 * - Streams live per-TA progress events when allocations are marked COMPLETED.
 * - Cross-container synchronization is backed by MongoDB Change Streams.
 * - Notifies clients via 'live_updates_unavailable' event when running in degraded fallback mode.
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.ALLOCATE_SCRIPTS);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid ID format',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();

    const examExists = await Exam.exists({ _id: new mongoose.Types.ObjectId(id), isActive: true });
    if (!examExists) {
      return NextResponse.json({
        success: false,
        message: 'Exam not found',
        data: null
      }, { status: 404 });
    }

    const encoder = new TextEncoder();
    let unsubscribeProgress: (() => void) | null = null;
    let unsubscribeUnavailable: (() => void) | null = null;
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
          // Push initial progress snapshot immediately upon connection
          const initialProgress = await AllocationService.getProgress(id);
          safeEnqueue(`event: initial\ndata: ${JSON.stringify(initialProgress)}\n\n`);

          // If already operating in degraded mode, notify client immediately
          if (ProgressEventService.isDegradedMode()) {
            safeEnqueue(`event: live_updates_unavailable\ndata: ${JSON.stringify({ message: LIVE_UPDATES_UNAVAILABLE_MESSAGE })}\n\n`);
          }

          // Subscribe to live progress update events for this exam
          unsubscribeProgress = ProgressEventService.subscribe(id, (event) => {
            safeEnqueue(`event: progress\ndata: ${JSON.stringify(event)}\n\n`);
          });

          // Subscribe to degraded/unavailable notifications
          unsubscribeUnavailable = ProgressEventService.subscribeLiveUpdatesUnavailable((event) => {
            safeEnqueue(`event: live_updates_unavailable\ndata: ${JSON.stringify(event)}\n\n`);
          });
        } catch {
          isClosed = true;
          try {
            controller.close();
          } catch {
            // Ignore close on already closed stream
          }
        }
      },
      cancel() {
        isClosed = true;
        if (unsubscribeProgress) {
          unsubscribeProgress();
          unsubscribeProgress = null;
        }
        if (unsubscribeUnavailable) {
          unsubscribeUnavailable();
          unsubscribeUnavailable = null;
        }
      }
    });

    // Listen to client abort signal to release subscriptions
    req.signal?.addEventListener('abort', () => {
      if (unsubscribeProgress) {
        unsubscribeProgress();
        unsubscribeProgress = null;
      }
      if (unsubscribeUnavailable) {
        unsubscribeUnavailable();
        unsubscribeUnavailable = null;
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
