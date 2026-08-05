import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../lib/db';
import CourseService from '../../../../services/CourseService';
import { updateCourseSchema } from '../../../../validations/courseValidation';
import { requirePermission } from '../../../../lib/apiAuth';
import { Permission } from '../../../../constants/permissions';

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.EDIT_COURSE);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

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

    const validationResult = updateCourseSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({
        success: false,
        message: 'Validation failed',
        data: validationResult.error.format()
      }, { status: 400 });
    }

    const updateData = { ...validationResult.data } as Record<string, unknown>;
    if (validationResult.data.semester !== undefined) {
      updateData.semester = parseInt(validationResult.data.semester, 10);
    }

    const auditContext = {
      actingUserId: auth.user.id,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined
    };

    const updatedCourse = await CourseService.updateCourse(id, updateData, auth.user.id, auth.user.role, auditContext);
    if (!updatedCourse) {
      return NextResponse.json({
        success: false,
        message: 'Course not found',
        data: null
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Course updated successfully',
      data: updatedCourse
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not allowed') || message.includes('Cannot delete') || message.includes('active exams')) {
      return NextResponse.json({
        success: false,
        message,
        data: null
      }, { status: 400 });
    }
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.DELETE_COURSE);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  try {
    await connectDB();

    const auditContext = {
      actingUserId: auth.user.id,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined
    };

    const deletedCourse = await CourseService.deleteCourse(id, auth.user.id, auth.user.role, auditContext);
    if (!deletedCourse) {
      return NextResponse.json({
        success: false,
        message: 'Course not found',
        data: null
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Course deleted successfully',
      data: deletedCourse
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('Cannot delete') || message.includes('active exams') || message.includes('not allowed')) {
      return NextResponse.json({
        success: false,
        message,
        data: null
      }, { status: 400 });
    }
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.VIEW_COURSES);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  try {
    await connectDB();
    const course = await CourseService.getCourseById(id, auth.user.id, auth.user.role);
    if (!course) {
      return NextResponse.json({
        success: false,
        message: 'Course not found',
        data: null
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Course retrieved successfully',
      data: course
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
