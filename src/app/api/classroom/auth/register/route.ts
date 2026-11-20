import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { connectClassroomDB } from '@/lib/classroomDb';
import ClassroomUser from '@/models/ClassroomUser';
import { signClassroomToken } from '@/lib/classroomAuth';

export async function POST(req: NextRequest) {
  try {
    await connectClassroomDB();
    const body = await req.json();
    const { name, email, password, role, department } = body;

    if (!name || !email || !password) {
      return NextResponse.json(
        { success: false, message: 'Name, email, and password are required', data: null },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();
    const existing = await ClassroomUser.findOne({ email: trimmedEmail });
    if (existing) {
      return NextResponse.json(
        { success: false, message: 'Classroom user with this email already exists', data: null },
        { status: 409 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const assignedRole = role === 'STUDENT' ? 'STUDENT' : role === 'TA' ? 'TA' : 'PROFESSOR';

    const newUser = await ClassroomUser.create({
      name: name.trim(),
      email: trimmedEmail,
      password: hashedPassword,
      role: assignedRole,
      department: department?.trim() || '',
    });

    const tokenPayload = {
      id: newUser._id.toString(),
      email: newUser.email,
      name: newUser.name,
      role: newUser.role,
    };

    const token = signClassroomToken(tokenPayload);

    const response = NextResponse.json(
      {
        success: true,
        message: 'Classroom user registered successfully',
        data: {
          user: tokenPayload,
          token,
        },
      },
      { status: 201 }
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
    const message = error instanceof Error ? error.message : 'Classroom registration failed';
    return NextResponse.json({ success: false, message, data: null }, { status: 500 });
  }
}

