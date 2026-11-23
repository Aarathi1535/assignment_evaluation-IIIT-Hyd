import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectDB } from '@/lib/db';
import User from '@/models/User';
import PersonalizedUser from '@/models/PersonalizedUser';
import { signPersonalizedToken } from '@/lib/personalizedAuth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    await connectDB();

    const body = await req.json().catch(() => ({}));
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: 'Email and password are required', data: null },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();

    // Check institutional User collection first
    let user: any = await User.findOne({ email: trimmedEmail });
    let isIndependentUser = false;

    if (!user) {
      // Check independent PersonalizedUser collection
      user = await PersonalizedUser.findOne({ email: trimmedEmail });
      if (user) {
        isIndependentUser = true;
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

    // Access control: Professors require admin approval for Personalized Learning
    if (role === 'PROFESSOR' && !user.personalizedAccess) {
      return NextResponse.json(
        {
          success: false,
          code: 'PERSONALIZED_ACCESS_DENIED',
          message: 'Access to Personalized Learning has not been granted by administrator. Access is available on request only.',
          requestStatus: user.personalizedRequestStatus || 'NONE',
          data: null,
        },
        { status: 403 }
      );
    }

    const tokenPayload = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
      section: user.section || null,
    };

    const token = signPersonalizedToken(tokenPayload);

    const response = NextResponse.json(
      {
        success: true,
        message: 'Personalized login successful',
        data: {
          user: tokenPayload,
          token,
        },
      },
      { status: 200 }
    );

    response.cookies.set('personalized_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 3600,
    });

    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Personalized login failed';
    return NextResponse.json({ success: false, message, data: null }, { status: 500 });
  }
}
