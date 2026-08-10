import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../lib/db';
import RubricService from '../../../../services/RubricService';
import { updateRubricSchema } from '../../../../validations/rubricValidation';
import { requirePermission } from '../../../../lib/apiAuth';
import { Permission } from '../../../../constants/permissions';
import { HttpError } from '../../../../lib/errors';
import { IRubric } from '../../../../models/Rubric';

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
    const rubric = await RubricService.getRubricById(id, auth.user.id, auth.user.role);
    if (!rubric) {
      return NextResponse.json({
        success: false,
        message: 'Rubric not found',
        data: null
      }, { status: 404 });
    }

    const isLocked = await RubricService.isRubricLocked(rubric._id.toString());
    return NextResponse.json({
      success: true,
      message: 'Rubric retrieved successfully',
      data: {
        ...rubric.toObject(),
        isLocked
      }
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

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.EDIT_RUBRIC);
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

    const validationResult = updateRubricSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({
        success: false,
        message: 'Validation failed',
        data: validationResult.error.format()
      }, { status: 400 });
    }

    const auditContext = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined
    };

    const updatedRubric = await RubricService.updateRubric(id, validationResult.data as unknown as Partial<IRubric>, auth.user.id, auth.user.role, auditContext);
    if (!updatedRubric) {
      return NextResponse.json({
        success: false,
        message: 'Rubric not found',
        data: null
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Rubric updated successfully',
      data: updatedRubric
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
