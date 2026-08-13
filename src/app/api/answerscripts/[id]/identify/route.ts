import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import AnswerScript from '../../../../../models/AnswerScript';
import User, { UserRole } from '../../../../../models/User';
import StudentMapping from '../../../../../models/StudentMapping';
import ExamRepository from '../../../../../repositories/ExamRepository';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError, isDuplicateKeyError } from '../../../../../lib/errors';
import { writeAuditLog } from '../../../../../lib/audit';

export async function POST(
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
      message: 'Invalid AnswerScript ID format',
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

    const { studentId } = body || {};
    if (!studentId) {
      return NextResponse.json({
        success: false,
        message: 'studentId is required',
        data: null
      }, { status: 400 });
    }

    if (!mongoose.Types.ObjectId.isValid(studentId)) {
      return NextResponse.json({
        success: false,
        message: 'Invalid studentId format',
        data: null
      }, { status: 400 });
    }

    // 1. Retrieve the AnswerScript first
    const script = await AnswerScript.findOne({ _id: id, isActive: true });
    if (!script) {
      return NextResponse.json({
        success: false,
        message: 'AnswerScript not found',
        data: null
      }, { status: 404 });
    }

    // 2. Verify access to its exam using owner-scoped repository
    const exam = await ExamRepository.getExamById(script.exam.toString(), auth.user.id, auth.user.role);
    if (!exam) {
      return NextResponse.json({
        success: false,
        message: 'Exam not found',
        data: null
      }, { status: 404 });
    }

    // 3. Verify student exists and has Student role
    const studentUser = await User.findOne({ _id: studentId, isActive: true });
    if (!studentUser) {
      return NextResponse.json({
        success: false,
        message: 'Student user not found',
        data: null
      }, { status: 400 });
    }

    if (studentUser.role !== UserRole.STUDENT) {
      return NextResponse.json({
        success: false,
        message: 'Selected user is not a student',
        data: null
      }, { status: 400 });
    }

    // 4. Verify student belongs to the exam roster
    const isMapped = await StudentMapping.exists({ exam: script.exam, student: studentId });
    if (!isMapped) {
      return NextResponse.json({
        success: false,
        message: 'Student is not enrolled in this exam roster',
        data: null
      }, { status: 400 });
    }

    // 5. Duplicate handling: check if another script is already identified for this (exam, student)
    const duplicate = await AnswerScript.findOne({
      exam: script.exam,
      student: studentId,
      isActive: true,
      _id: { $ne: script._id }
    });

    if (duplicate) {
      return NextResponse.json({
        success: false,
        message: 'Another script is already identified for this student in the same exam',
        data: null
      }, { status: 409 });
    }

    const previousStudentId = script.student ? script.student.toString() : null;

    // 6. Perform atomic update
    try {
      const updated = await AnswerScript.findOneAndUpdate(
        { _id: script._id, isActive: true },
        {
          $set: {
            student: new mongoose.Types.ObjectId(studentId),
            candidateStudentId: studentId.toString(),
            identificationSource: 'OPERATOR',
            identificationStatus: 'IDENTIFIED',
            needsManualId: false,
            manualIdReason: null
          }
        },
        { new: true, runValidators: true }
      );

      // Record successful manual identification in the audit log
      await writeAuditLog({
        user: auth.user.id,
        action: 'ANSWERSCRIPT_IDENTIFIED',
        outcome: 'SUCCESS',
        entityId: script._id,
        entityType: 'AnswerScript',
        details: {
          examId: script.exam.toString(),
          previousStudentId,
          newStudentId: studentId.toString(),
          identificationSource: 'OPERATOR',
          reason: 'Manual identification correction/override'
        },
        ipAddress: req.headers.get('x-forwarded-for') || undefined
      });

      return NextResponse.json({
        success: true,
        message: 'AnswerScript manual identification successful',
        data: updated
      }, { status: 200 });
    } catch (err: unknown) {
      if (isDuplicateKeyError(err)) {
        return NextResponse.json({
          success: false,
          message: 'Another script is already identified for this student in the same exam',
          data: null
        }, { status: 409 });
      }
      throw err;
    }

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
