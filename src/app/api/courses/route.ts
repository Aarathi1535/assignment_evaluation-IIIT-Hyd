import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../lib/db';
import CourseService from '../../../services/CourseService';
import { createCourseSchema } from '../../../validations/courseValidation';
import { requirePermission } from '../../../lib/apiAuth';
import { Permission } from '../../../constants/permissions';

export async function GET() {
  const auth = await requirePermission(Permission.VIEW_COURSES);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectDB();
    const courses = await CourseService.getAllCourses();
    return NextResponse.json({
      success: true,
      message: 'Courses retrieved successfully',
      data: courses
    }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      message: error.message || 'An unexpected error occurred',
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
      semester: parseInt(validationResult.data.semester, 10)
    };

    const newCourse = await CourseService.createCourse(courseData as any);

    return NextResponse.json({
      success: true,
      message: 'Course created successfully',
      data: newCourse
    }, { status: 201 });
  } catch (error: any) {
    if (error.message === 'Course code already exists') {
      return NextResponse.json({
        success: false,
        message: error.message,
        data: null
      }, { status: 400 });
    }

    return NextResponse.json({
      success: false,
      message: error.message || 'An unexpected error occurred',
      data: null
    }, { status: 500 });
  }
}
