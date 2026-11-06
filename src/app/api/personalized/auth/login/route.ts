import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectPersonalizedDB } from '@/lib/personalizedDb';
import PersonalizedUser from '@/models/PersonalizedUser';
import { signPersonalizedToken } from '@/lib/personalizedAuth';

export async function POST(req: NextRequest) {
  try {
    await connectPersonalizedDB();
    const body = await req.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: 'Email and password are required', data: null },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();
    const user = await PersonalizedUser.findOne({ email: trimmedEmail });
    if (!user) {
      return NextResponse.json(
        { success: false, message: 'Invalid email or password', data: null },
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

    const tokenPayload = {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
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

