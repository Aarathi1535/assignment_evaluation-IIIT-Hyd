import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../lib/db';
import RubricService from '../../../services/RubricService';
import { createRubricSchema } from '../../../validations/rubricValidation';
import { requirePermission } from '../../../lib/apiAuth';
import { Permission } from '../../../constants/permissions';
import { HttpError } from '../../../lib/errors';
import { IRubric } from '../../../models/Rubric';

export async function GET(req: NextRequest) {
  const auth = await requirePermission(Permission.VIEW_COURSES);
  if (!auth.authorized) {
    return auth.response;
  }

  const { searchParams } = new URL(req.url);
  const examId = searchParams.get('exam');

  if (!examId) {
    return NextResponse.json({
      success: false,
      message: 'Exam ID is required',
      data: null
    }, { status: 400 });
  }

  if (!mongoose.Types.ObjectId.isValid(examId)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid Exam ID format',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();
    const rubric = await RubricService.getRubricByExamId(examId, auth.user.id, auth.user.role);
    if (!rubric) {
      return NextResponse.json({
        success: true,
        message: 'No rubric found for this exam',
        data: null
      }, { status: 200 });
    }

    return NextResponse.json({
      success: true,
      message: 'Rubric retrieved successfully',
      data: rubric
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
  const auth = await requirePermission(Permission.CREATE_RUBRIC);
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

    const validationResult = createRubricSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({
        success: false,
        message: 'Validation failed',
        data: validationResult.error.format()
      }, { status: 400 });
    }

    const rubricData = {
      ...validationResult.data,
      createdBy: auth.user.id
    };

    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined
    };

    const newRubric = await RubricService.createRubric(rubricData as unknown as Partial<IRubric>, context);

    return NextResponse.json({
      success: true,
      message: 'Rubric created successfully',
      data: newRubric
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
