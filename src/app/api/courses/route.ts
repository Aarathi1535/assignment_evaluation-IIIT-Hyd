import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../lib/db';
import CourseService from '../../../services/CourseService';
import { createCourseSchema } from '../../../validations/courseValidation';

export async function GET() {
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

    // Convert semester from string to number since ICourse expects a number,
    // and map other fields if TypeScript type casting is required.
    const courseData = {
      ...validationResult.data,
      semester: parseInt(validationResult.data.semester, 10)
    };

    // Cast the object to any to bypass Mongoose's strict ObjectId vs string TS checks if any,
    // or pass it directly.
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
