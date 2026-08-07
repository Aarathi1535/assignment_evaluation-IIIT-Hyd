import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../lib/db';
import CourseService from '../../../services/CourseService';
import { createCourseSchema } from '../../../validations/courseValidation';
import { requirePermission } from '../../../lib/apiAuth';
import { Permission } from '../../../constants/permissions';
import { HttpError } from '../../../lib/errors';

export async function GET() {
  const auth = await requirePermission(Permission.VIEW_COURSES);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectDB();
    const courses = await CourseService.getAllCourses(auth.user.id, auth.user.role);
    return NextResponse.json({
      success: true,
      message: 'Courses retrieved successfully',
      data: courses
    }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(Permission.CREATE_COURSE);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectDB();

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({
        success: false,
        message: 'Invalid JSON request body',
        data: null
      }, { status: 400 });
    }

    const validationResult = createCourseSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({
        success: false,
        message: 'Validation failed',
        data: validationResult.error.format()
      }, { status: 400 });
    }

    const courseData = {
      ...validationResult.data,
      semester: parseInt(validationResult.data.semester, 10),
      professor: auth.user.id
    };

    const context = {
      actingUserId: auth.user.id,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined
    };

    const newCourse = await CourseService.createCourse(
      courseData as unknown as Partial<import('@/models/Course').ICourse>,
      context
    );

    return NextResponse.json({
      success: true,
      message: 'Course created successfully',
      data: newCourse
    }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (error instanceof HttpError) {
      return NextResponse.json({
        success: false,
        message,
        data: null
      }, { status: error.statusCode });
    }
    if (message === 'Course code already exists') {
      return NextResponse.json({
        success: false,
        message,
        data: null
      }, { status: 409 });
    }

    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status: 500 });
  }
}
