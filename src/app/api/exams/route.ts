import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../lib/db';
import ExamService from '../../../services/ExamService';
import { createExamSchema } from '../../../validations/examValidation';
import { requirePermission } from '../../../lib/apiAuth';
import { Permission } from '../../../constants/permissions';

export async function GET() {
  const auth = await requirePermission(Permission.VIEW_COURSES);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectDB();
    const exams = await ExamService.getAllExams();
    return NextResponse.json({
      success: true,
      message: 'Exams retrieved successfully',
      data: exams
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
  const auth = await requirePermission(Permission.CREATE_EXAM);
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

    const validationResult = createExamSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({
        success: false,
        message: 'Validation failed',
        data: validationResult.error.format()
      }, { status: 400 });
    }

    const examData = {
      ...validationResult.data,
      examDate: new Date(validationResult.data.examDate)
    };

    const context = {
      actingUserId: auth.user.id,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined
    };

    const newExam = await ExamService.createExam(examData as unknown as Partial<import('@/models/Exam').IExam>, context);

    return NextResponse.json({
      success: true,
      message: 'Exam created successfully',
      data: newExam
    }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status: 500 });
  }
}
