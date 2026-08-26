import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import Exam from '../../../../../models/Exam';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import { writeAuditLog } from '../../../../../lib/audit';
import { AllocationService } from '../../../../../services/AllocationService';

/**
 * POST /api/exams/[id]/blind-grading
 *
 * Updates the blind grading configuration setting for a single exam (AE-091).
 * Requires Permission.ALLOCATE_SCRIPTS.
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  // 1. Authorization: enforce Permission.ALLOCATE_SCRIPTS server-side
  const auth = await requirePermission(Permission.ALLOCATE_SCRIPTS);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  // 2. Validate exam ID format
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return NextResponse.json({
      success: false,
      message: 'Invalid Exam ID format',
      data: null
    }, { status: 400 });
  }

  try {
    await connectDB();

    // 3. Input validation
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

    const { blindGrading } = body;

    // Validate that blindGrading is explicitly a boolean value
    if (blindGrading === undefined || typeof blindGrading !== 'boolean') {
      return NextResponse.json({
        success: false,
        message: 'Validation failed: blindGrading must be explicitly a boolean value',
        data: null
      }, { status: 400 });
    }

    // 4. Fetch the exam document
    const exam = await Exam.findById(id);
    if (!exam || !exam.isActive) {
      return NextResponse.json({
        success: false,
        message: 'Exam not found',
        data: null
      }, { status: 404 });
    }

    // 5. Freeze setting: reject change if grading has commenced
    try {
      await AllocationService.checkGradingCommenced(new mongoose.Types.ObjectId(id));
    } catch (err: unknown) {
      const status = err instanceof HttpError ? err.statusCode : 400;
      const message = err instanceof Error ? err.message : 'Cannot modify blind grading setting: grading has already commenced';
      return NextResponse.json({
        success: false,
        message,
        data: null
      }, { status });
    }

    // 6. Avoid unnecessary writes (No-op check)
    const prevValue = !!exam.blindGrading;
    if (prevValue === blindGrading) {
      return NextResponse.json({
        success: true,
        message: `No changes detected: blindGrading setting is already ${blindGrading}`,
        data: {
          examId: id,
          blindGrading,
          changed: false
        }
      }, { status: 200 });
    }

    // 7. Update setting
    exam.blindGrading = blindGrading;
    await exam.save();

    // 8. Audit logging
    const ipAddress = (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined;
    await writeAuditLog({
      user: auth.user.id,
      action: 'EXAM_BLIND_GRADING_TOGGLED',
      outcome: 'SUCCESS',
      entityId: exam._id as mongoose.Types.ObjectId,
      entityType: 'Exam',
      details: {
        examId: id,
        previousValue: prevValue,
        newValue: blindGrading
      },
      ipAddress
    });

    return NextResponse.json({
      success: true,
      message: 'Blind-grading setting updated successfully',
      data: {
        examId: id,
        blindGrading,
        changed: true
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
