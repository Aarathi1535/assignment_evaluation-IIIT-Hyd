import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectPersonalizedDB } from '@/lib/personalizedDb';
import PersonalizedUser from '@/models/PersonalizedUser';
import { signPersonalizedToken } from '@/lib/personalizedAuth';

export async function POST(req: NextRequest) {
  try {
    await connectPersonalizedDB();
    const body = await req.json();
    const { name, email, password, role, targetTopics, skillLevel } = body;

    if (!name || !email || !password) {
      return NextResponse.json(
        { success: false, message: 'Name, email, and password are required', data: null },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();
    const existing = await PersonalizedUser.findOne({ email: trimmedEmail });
    if (existing) {
      return NextResponse.json(
        { success: false, message: 'Personalized learning user with this email already exists', data: null },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const assignedRole = role === 'PROFESSOR' ? 'PROFESSOR' : 'STUDENT';

    const newUser = await PersonalizedUser.create({
      name: name.trim(),
      email: trimmedEmail,
      password: hashedPassword,
      role: assignedRole,
      targetTopics: Array.isArray(targetTopics) ? targetTopics : [],
      skillLevel: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].includes(skillLevel) ? skillLevel : 'INTERMEDIATE',
    });

    const tokenPayload = {
      id: newUser._id.toString(),
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
    };

    const token = signPersonalizedToken(tokenPayload);

    const response = NextResponse.json(
      {
        success: true,
        message: 'Personalized user registered successfully',
        data: {
          user: tokenPayload,
          token,
        },
      },
      { status: 201 }
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
    const message = error instanceof Error ? error.message : 'Personalized registration failed';
    return NextResponse.json({ success: false, message, data: null }, { status: 500 });
  }
}

