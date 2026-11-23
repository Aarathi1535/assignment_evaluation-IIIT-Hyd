import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '@/lib/db';
import { requirePermission } from '@/lib/apiAuth';
import { Permission } from '@/constants/permissions';
import User from '@/models/User';
import { writeAuditLog } from '@/lib/audit';

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.MANAGE_USERS);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json(
      { success: false, message: 'Invalid user ID format', data: null },
      { status: 400 }
    );
  }

  try {
    await connectDB();
    const body = await req.json().catch(() => ({}));
    const access = Boolean(body.access !== undefined ? body.access : body.granted);

    const user = await User.findById(id);
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'User not found', data: null },
        { status: 404 }
      );
    }

    const previousAccess = user.personalizedAccess || false;
    user.personalizedAccess = access;
    user.personalizedRequestStatus = access ? 'APPROVED' : 'REJECTED';
    await user.save();

    const ipAddress =
      req.headers.get('x-forwarded-for') ||
      req.headers.get('x-real-ip') ||
      undefined;

    await writeAuditLog({
      action: 'USER_UPDATED',
      user: auth.user.id,
      entityId: user._id.toString(),
      entityType: 'User',
      details: {
        targetUserId: user._id.toString(),
        targetEmail: user.email,
        targetRole: user.role,
        previousAccess,
        newAccess: access,
        feature: 'PERSONALIZED_LEARNING',
      },
      ipAddress,
    }).catch(() => {
      // Non-blocking
    });

    const sanitized = user.toObject() as unknown as Record<string, unknown>;
    delete sanitized.password;

    return NextResponse.json(
      {
        success: true,
        message: access
          ? `Personalized learning access granted to ${user.name}`
          : `Personalized learning access revoked from ${user.name}`,
        data: sanitized,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to update personalized access';
    return NextResponse.json({ success: false, message, data: null }, { status: 500 });
  }
}
