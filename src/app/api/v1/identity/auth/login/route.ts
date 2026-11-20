import { NextRequest, NextResponse } from 'next/server';
import { connectIdentityDB } from '@/lib/identityDb';
import IdentityUser from '@/models/identity/IdentityUser';
import CourseEnrollment from '@/models/identity/CourseEnrollment';
import { signPlatformToken, ServiceAudience } from '@cvit/auth';

export async function POST(req: NextRequest) {
  try {
    await connectIdentityDB();
    const body = await req.json();
    const { email, password, audience } = body;

    if (!email || !password) {
      return NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/validation/missing-credentials',
          title: 'Validation Error',
          status: 400,
          detail: 'Email and password are required.',
        },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const user = await IdentityUser.findOne({ email: normalizedEmail });

    if (!user) {
      return NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/auth/invalid-credentials',
          title: 'Unauthorized',
          status: 401,
          detail: 'Invalid email or password.',
        },
        { status: 401 }
      );
    }

    if (!user.isActive) {
      return NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/auth/account-deactivated',
          title: 'Unauthorized',
          status: 401,
          detail: 'Account is deactivated. Please contact the administrator.',
        },
        { status: 401 }
      );
    }

    // Check account lockout
    if (user.lockoutUntil && user.lockoutUntil.getTime() > Date.now()) {
      return NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/auth/account-locked',
          title: 'Too Many Requests',
          status: 429,
          detail: 'Account temporarily locked due to excessive failed attempts. Please try again later.',
        },
        { status: 429 }
      );
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= 5) {
        user.lockoutUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min lockout
      }
      await user.save();

      return NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/auth/invalid-credentials',
          title: 'Unauthorized',
          status: 401,
          detail: 'Invalid email or password.',
        },
        { status: 401 }
      );
    }

    // Reset failed attempts and update last login
    user.failedLoginAttempts = 0;
    user.lockoutUntil = undefined;
    user.lastLoginAt = new Date();
    await user.save();

    // Fetch user enrolled course codes
    const enrollments = await CourseEnrollment.find({
      platformUserId: user._id,
      status: 'ACTIVE',
    }).select('courseCode');

    const courseCodes = enrollments.map((e) => e.courseCode);

    const targetAudience: ServiceAudience =
      (audience as ServiceAudience) || 'evaluation-service';

    const token = signPlatformToken({
      sub: user._id.toString(),
      role: user.role,
      email: user.email,
      name: user.name,
      audience: targetAudience,
      courseIds: courseCodes,
      expiresInSeconds: 900, // 15 minutes
    });

    const response = NextResponse.json({
      success: true,
      data: {
        token,
        tokenType: 'Bearer',
        expiresIn: 900,
        user: {
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          department: user.department,
          rollNumber: user.rollNumber,
          courses: courseCodes,
        },
      },
    });

    response.cookies.set('platform_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 900,
    });

    return response;
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
