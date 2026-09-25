import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomAssessmentService from '@/services/ClassroomAssessmentService';
import { createClassroomQuestionSchema } from '@/validations/classroomValidation';
import { requireAuth } from '@/lib/apiAuth';
import { HttpError } from '@/lib/errors';

export async function GET() {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectDB();
    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role
    };

    const questions = await ClassroomAssessmentService.getQuestions(context);
    return NextResponse.json({
      success: true,
      message: 'Classroom questions retrieved successfully',
      data: questions
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

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Only professors or admins can create classroom questions',
      data: null
    }, { status: 403 });
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

    const validationResult = createClassroomQuestionSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({
        success: false,
        message: 'Validation failed',
        data: validationResult.error.format()
      }, { status: 400 });
    }

    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || undefined
    };

    const newQuestion = await ClassroomAssessmentService.createQuestion(validationResult.data, context);

    return NextResponse.json({
      success: true,
      message: 'Classroom question created successfully',
      data: newQuestion
    }, { status: 201 });
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
