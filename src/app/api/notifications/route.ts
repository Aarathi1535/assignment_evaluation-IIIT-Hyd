import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../lib/db';
import { requireAuth } from '../../../lib/apiAuth';
import { HttpError } from '../../../lib/errors';
import NotificationService from '../../../services/NotificationService';

/**
 * GET /api/notifications
 *
 * Retrieves notifications for the currently authenticated user.
 * Supports query parameters:
 *  - page: positive integer (default: 1)
 *  - limit: positive integer (default: 20, max: 100)
 *  - unreadOnly: 'true' | 'false' (default: false)
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  const { searchParams } = new URL(req.url);
  const pageStr = searchParams.get('page');
  const limitStr = searchParams.get('limit');
  const unreadOnly = searchParams.get('unreadOnly') === 'true';

  let page = 1;
  let limit = 20;

  if (pageStr !== null) {
    const isPositiveInteger = /^[1-9]\d*$/.test(pageStr);
    if (!isPositiveInteger) {
      return NextResponse.json({
        success: false,
        message: 'Invalid page parameter. It must be a positive integer.',
        data: null
      }, { status: 400 });
    }
    page = parseInt(pageStr, 10);
  }

  if (limitStr !== null) {
    const isPositiveInteger = /^[1-9]\d*$/.test(limitStr);
    if (!isPositiveInteger) {
      return NextResponse.json({
        success: false,
        message: 'Invalid limit parameter. It must be a positive integer.',
        data: null
      }, { status: 400 });
    }
    limit = Math.min(parseInt(limitStr, 10), 100);
  }

  try {
    await connectDB();

    const result = await NotificationService.getUserNotifications(auth.user.id, {
      page,
      limit,
      unreadOnly
    });

    return NextResponse.json({
      success: true,
      message: 'Notifications retrieved successfully',
      data: result
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
