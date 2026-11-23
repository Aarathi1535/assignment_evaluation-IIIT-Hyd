import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectDB } from '@/lib/db';
import User from '@/models/User';
import ClassroomUser from '@/models/ClassroomUser';
import { signClassroomToken } from '@/lib/classroomAuth';

export async function POST(req: NextRequest) {
  try {
    await connectDB();
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: 'Email and password are required', data: null },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Check institutional platform User collection first
    let user = await User.findOne({ email: trimmedEmail });
    let isIndependentClassroomUser = false;

    if (!user) {
      // Check independent ClassroomUser if exists
      const cu = await ClassroomUser.findOne({ email: trimmedEmail });
      if (cu) {
        user = cu as any;
        isIndependentClassroomUser = true;
      }
    }

    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Invalid email or password', data: null },
        { status: 401 }
      );
    }

    if (user.isActive === false) {
      return NextResponse.json(
        { success: false, message: 'Account is deactivated', code: 'ACCOUNT_DISABLED', data: null },
        { status: 401 }
      );
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return NextResponse.json(
        { success: false, message: 'Invalid email or password', data: null },
        { status: 401 }
      );
    }

    const role = (user.role || '').toUpperCase();
    if (role !== 'PROFESSOR' && role !== 'ADMIN') {
      return NextResponse.json(
        { success: false, message: 'Classroom portal login is restricted to faculty professors and administrators', data: null },
        { status: 403 }
      );
    }

    // Classroom Activity access gate: Admin grants access on request only
    const hasClassroomAccess = role === 'ADMIN' || Boolean(user.classroomAccess);
    if (!hasClassroomAccess) {
      return NextResponse.json(
        {
          success: false,
          code: 'CLASSROOM_ACCESS_DENIED',
          message: 'Classroom Activity access has not been granted by administrator. Access is available on request only.',
          requestStatus: user.classroomRequestStatus || 'NONE',
          data: null,
        },
        { status: 403 }
      );
    }

    const tokenPayload = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: (user.role as any) || 'PROFESSOR',
    };

    const token = signClassroomToken(tokenPayload);

    const response = NextResponse.json(
      {
        success: true,
        message: 'Classroom login successful',
        data: {
          user: tokenPayload,
          classroomUser: tokenPayload,
          token,
        },
      },
      { status: 200 }
    );

    response.cookies.set('classroom_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 3600,
    });

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Classroom login failed';
    return NextResponse.json({ success: false, message, data: null }, { status: 500 });
  }
}
