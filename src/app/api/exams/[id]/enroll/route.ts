import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import ExamService from '../../../../../services/ExamService';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { enrollStudentsSchema } from '../../../../../validations/examValidation';
import { HttpError } from '../../../../../lib/errors';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.EDIT_EXAM);
  if (!auth.authorized) {
    return auth.response;
  }

  // Only allow PROFESSOR or ADMIN roles
  if (auth.user.role !== 'PROFESSOR' && auth.user.role !== 'ADMIN') {
    return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
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
        message: 'Invalid JSON body',
        data: null
      }, { status: 400 });
    }

    const validationResult = enrollStudentsSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({
        success: false,
        message: 'Validation failed',
        data: validationResult.error.format()
      }, { status: 400 });
    }

    const { studentIds } = validationResult.data;

    const roster = await ExamService.enrollStudents(id, studentIds, auth.user.id, auth.user.role, {
      actingUserId: auth.user.id,
      ipAddress: req.headers.get('x-forwarded-for') || undefined
    });

    if (!roster) {
      return NextResponse.json({
        success: false,
        message: 'Exam not found',
        data: null
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      message: 'Students enrolled to exam successfully',
      data: roster
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

