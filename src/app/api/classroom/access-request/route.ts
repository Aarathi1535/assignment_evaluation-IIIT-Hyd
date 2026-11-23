import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import User from '@/models/User';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    await connectDB();

    let email = '';
    const session = await getServerSession(authOptions);
    if (session?.user?.email) {
      email = session.user.email.trim().toLowerCase();
    } else {
      const body = await req.json().catch(() => ({}));
      if (body.email) {
        email = String(body.email).trim().toLowerCase();
      }
    }

    if (!email) {
      return NextResponse.json(
        { success: false, message: 'Email is required to request classroom access', data: null },
        { status: 400 }
      );
    }

    const user = await User.findOne({ email });
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'User account not found', data: null },
        { status: 404 }
      );
    }

    if (user.role !== 'PROFESSOR' && user.role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, message: 'Classroom activity access requests are only available for faculty / professors', data: null },
        { status: 403 }
      );
    }

    if (user.classroomAccess) {
      return NextResponse.json(
        { success: true, message: 'You already have access to Classroom Activity', data: { status: 'APPROVED' } },
        { status: 200 }
      );
    }

    user.classroomRequestStatus = 'REQUESTED';
    user.classroomRequestedAt = new Date();
    await user.save();

    return NextResponse.json(
      {
        success: true,
        message: 'Classroom access request submitted successfully. The administrator will review your request.',
        data: {
          email: user.email,
          status: 'REQUESTED',
          requestedAt: user.classroomRequestedAt,
        },
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to submit classroom access request';
    return NextResponse.json({ success: false, message, data: null }, { status: 500 });
  }
}
