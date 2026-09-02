import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requireAuth } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';
import NotificationService from '../../../../../services/NotificationService';

/**
 * PATCH /api/notifications/[id]/read
 *
 * Marks a specific notification as read for the authenticated user.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // Notifications are scoped to the authenticated user; ownership is enforced
  // by recipient filtering, so role-specific permission checks are not required.
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid Notification ID format',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();

    const updatedNotification = await NotificationService.markAsRead(id, auth.user.id);

    return NextResponse.json({
      success: true,
      message: 'Notification marked as read',
      data: updatedNotification
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
