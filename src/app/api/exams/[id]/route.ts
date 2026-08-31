import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../lib/db';
import ExamService from '../../../../services/ExamService';
import { updateExamSchema } from '../../../../validations/examValidation';
import { requirePermission } from '../../../../lib/apiAuth';
import { Permission } from '../../../../constants/permissions';
import { HttpError } from '../../../../lib/errors';

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.EDIT_EXAM);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid ID format',
      data: null
    }, { status: 400 });
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

    const validationResult = updateExamSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({
        success: false,
        message: 'Validation failed',
        data: validationResult.error.format()
      }, { status: 400 });
    }

    const examData = { ...validationResult.data } as Record<string, unknown>;
    if (validationResult.data.examDate !== undefined) {
      examData.examDate = new Date(validationResult.data.examDate);
    }
    if (validationResult.data.gradingDeadline !== undefined) {
      examData.gradingDeadline = validationResult.data.gradingDeadline ? new Date(validationResult.data.gradingDeadline) : null;
    }

    const auditContext = {
      actingUserId: auth.user.id,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined
    };

    const updatedExam = await ExamService.updateExam(id, examData, auth.user.id, auth.user.role, auditContext);
    if (!updatedExam) {
      return NextResponse.json({
        success: false,
        message: 'Exam not found',
        data: null
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Exam updated successfully',
      data: updatedExam
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    const status = error instanceof HttpError ? error.statusCode : 500;
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status });
  }
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.DELETE_EXAM);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid ID format',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();

    const auditContext = {
      actingUserId: auth.user.id,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined
    };

    const deletedExam = await ExamService.deleteExam(id, auth.user.id, auth.user.role, auditContext);
    if (!deletedExam) {
      return NextResponse.json({
        success: false,
        message: 'Exam not found',
        data: null
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Exam deleted successfully',
      data: deletedExam
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    const status = error instanceof HttpError ? error.statusCode : 500;
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status });
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

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid ID format',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();
    const exam = await ExamService.getExamById(id, auth.user.id, auth.user.role);
    if (!exam) {
      return NextResponse.json({
        success: false,
        message: 'Exam not found',
        data: null
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Exam retrieved successfully',
      data: exam
    }, { status: 200 });

  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    const status = error instanceof HttpError ? error.statusCode : 500;
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status });
  }
}
