import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomAssessmentService from '@/services/ClassroomAssessmentService';
import { requireAuth } from '@/lib/apiAuth';
import { HttpError } from '@/lib/errors';
import { updateClassroomQuestionSchema } from '@/validations/classroomValidation';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  if (auth.user.role === 'ADMIN') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Classroom Assessment is not available for Admin accounts',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();
    const resolvedParams = await params;
    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role
    };

    const question = await ClassroomAssessmentService.getQuestionById(resolvedParams.id, context);

    return NextResponse.json({
      success: true,
      message: 'Question retrieved successfully',
      data: question
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  if (auth.user.role === 'ADMIN') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Classroom Assessment is not available for Admin accounts',
      data: null
    }, { status: 403 });
  }

  if (auth.user.role !== 'PROFESSOR') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Only professors can modify classroom questions',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();
    const resolvedParams = await params;

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

    const validationResult = updateClassroomQuestionSchema.safeParse(body);
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

    let updated;
    const { action, status, isActive, ...otherFields } = validationResult.data;

    // Handle action or status transitions
    if (action === 'activate' || status === 'ACTIVE') {
      updated = await ClassroomAssessmentService.setQuestionStatus(resolvedParams.id, 'ACTIVE', context);
    } else if (action === 'reveal' || status === 'REVEALED') {
      updated = await ClassroomAssessmentService.setQuestionStatus(resolvedParams.id, 'REVEALED', context);
    } else if (action === 'close' || status === 'CLOSED') {
      updated = await ClassroomAssessmentService.setQuestionStatus(resolvedParams.id, 'CLOSED', context);
    } else if (action === 'deactivate' || status === 'DRAFT') {
      updated = await ClassroomAssessmentService.setQuestionStatus(resolvedParams.id, 'DRAFT', context);
    } else if (typeof isActive === 'boolean') {
      updated = await ClassroomAssessmentService.setQuestionStatus(resolvedParams.id, isActive ? 'ACTIVE' : 'DRAFT', context);
    } else {
      const repo = (await import('@/repositories/ClassroomAssessmentRepository')).default;
      updated = await repo.updateQuestion(resolvedParams.id, otherFields);
    }

    return NextResponse.json({
      success: true,
      message: 'Question updated successfully',
      data: updated
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
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  if (auth.user.role !== 'PROFESSOR') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Only professors can delete classroom questions',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();
    const resolvedParams = await params;
    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role
    };

    const deleted = await ClassroomAssessmentService.deleteQuestion(resolvedParams.id, context);
    if (!deleted) {
      return NextResponse.json({
        success: false,
        message: 'Question not found or could not be deleted',
        data: null
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Question deleted successfully',
      data: null
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
