import { NextRequest, NextResponse } from 'next/server';
import { connectIdentityDB } from '@/lib/identityDb';
import IdentityUser from '@/models/identity/IdentityUser';

export async function POST(req: NextRequest) {
  try {
    await connectIdentityDB();
    const body = await req.json();
    const { name, email, password, role, department, rollNumber, adminInviteCode } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/validation/missing-field',
          title: 'Validation Error',
          status: 400,
          detail: 'Name is required.',
        },
        { status: 400 }
      );
    }

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/validation/invalid-email',
          title: 'Validation Error',
          status: 400,
          detail: 'A valid email address is required.',
        },
        { status: 400 }
      );
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      return NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/validation/weak-password',
          title: 'Validation Error',
          status: 400,
          detail: 'Password must be at least 8 characters long.',
        },
        { status: 400 }
      );
    }

    // Role elevation prevention: public registration strictly defaults to STUDENT
    let assignedRole: 'STUDENT' | 'TA' | 'PROFESSOR' | 'ADMIN' = 'STUDENT';
    const requestedRole = (role || 'STUDENT').toUpperCase();

    if (requestedRole === 'PROFESSOR' || requestedRole === 'TA' || requestedRole === 'ADMIN') {
      const validAdminCode = process.env.ADMIN_INVITE_CODE || 'iiit-faculty-invite-2026';
      if (!adminInviteCode || adminInviteCode !== validAdminCode) {
        return NextResponse.json(
          {
            type: 'https://errors.iiit.ac.in/auth/role-elevation-denied',
            title: 'Forbidden',
            status: 403,
            detail: `Administrative invite code is required to register with role '${requestedRole}'.`,
          },
          { status: 403 }
        );
      }
      assignedRole = requestedRole;
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await IdentityUser.findOne({ email: normalizedEmail });
    if (existing) {
      return NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/auth/duplicate-user',
          title: 'Conflict',
          status: 409,
          detail: 'A user with this email address already exists.',
        },
        { status: 409 }
      );
    }

    const newUser = await IdentityUser.create({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role: assignedRole,
      department: department?.trim(),
      rollNumber: rollNumber?.trim(),
      isActive: true,
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          id: newUser._id.toString(),
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          department: newUser.department,
          rollNumber: newUser.rollNumber,
          createdAt: newUser.createdAt,
        },
      },
      { status: 201 }
    );
  } catch (err: unknown) {
    return NextResponse.json(
      {
        type: 'https://errors.iiit.ac.in/internal-error',
        title: 'Internal Server Error',
        status: 500,
        detail: (err as Error).message,
      },
      { status: 500 }
    );
  }
}
