import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import { requireGradingOrAnnotationAccess } from '../../../../../lib/apiAuth';
import { HttpError } from '../../../../../lib/errors';
import Exam, { ExamStatus } from '../../../../../models/Exam';
import { writeAuditLog } from '../../../../../lib/audit';
import ProgressEventService from '../../../../../services/ProgressEventService';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireGradingOrAnnotationAccess();
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

    const exam = await Exam.findById(id);
    if (!exam || !exam.isActive) {
      return NextResponse.json({
        success: false,
        message: 'Exam not found or inactive',
        data: null
      }, { status: 404 });
    }

    const previousStatus = exam.status;
    exam.status = ExamStatus.REVIEW_PENDING;
    await exam.save();

    // Audit log
    await writeAuditLog({
      action: 'EXAM_UPDATED',
      user: auth.user.id,
      details: {
        examId: exam._id,
        courseId: exam.course,
        previousStatus,
        newStatus: ExamStatus.REVIEW_PENDING,
        action: 'ENABLE_REVIEW_PENDING',
        updatedByRole: auth.user.role,
      },
      ipAddress: req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
    });

    // Trigger live progress update
    try {
      await ProgressEventService.dispatchProgressEvent(id, auth.user.id);
    } catch {
      // Non-blocking
    }

    return NextResponse.json({
      success: true,
      message: 'Exam status updated to REVIEW_PENDING successfully. Ready for professor review.',
      data: {
        _id: exam._id,
        title: exam.title,
        status: exam.status,
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
