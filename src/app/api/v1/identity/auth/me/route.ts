import { NextRequest, NextResponse } from 'next/server';
import { authenticatePlatformToken } from '@cvit/auth';
import { connectIdentityDB } from '@/lib/identityDb';
import IdentityUser from '@/models/identity/IdentityUser';
import CourseEnrollment from '@/models/identity/CourseEnrollment';

export async function GET(req: NextRequest) {
  const auth = authenticatePlatformToken(req);
  if (!auth.authorized) {
    return auth.response!;
  }

  try {
    await connectIdentityDB();
    const user = await IdentityUser.findById(auth.claims!.sub).select('-password');
    if (!user || !user.isActive) {
      return NextResponse.json(
        {
          type: 'https://errors.iiit.ac.in/auth/user-not-found',
          title: 'Not Found',
          status: 404,
          detail: 'User profile not found or account is deactivated.',
        },
        { status: 404 }
      );
    }

    const enrollments = await CourseEnrollment.find({
      platformUserId: user._id,
      status: 'ACTIVE',
    });

    return NextResponse.json({
      success: true,
      data: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department,
        rollNumber: user.rollNumber,
        enrollments: enrollments.map((e) => ({
          courseCode: e.courseCode,
          courseName: e.courseName,
          semester: e.semester,
          role: e.role,
        })),
        createdAt: user.createdAt,
      },
    });
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
