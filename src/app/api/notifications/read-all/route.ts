import { NextResponse } from 'next/server';
import { connectDB } from '../../../../lib/db';
import { requireAuth } from '../../../../lib/apiAuth';
import { HttpError } from '../../../../lib/errors';
import NotificationService from '../../../../services/NotificationService';

/**
 * PATCH /api/notifications/read-all
 *
 * Marks all unread notifications as read for the authenticated user.
 */
export async function PATCH() {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectDB();

    const result = await NotificationService.markAllAsRead(auth.user.id);

    return NextResponse.json({
      success: true,
      message: 'All notifications marked as read',
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
