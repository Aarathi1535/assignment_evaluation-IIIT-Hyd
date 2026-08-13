import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/db';
import ExamService from '../../../../../services/ExamService';
import { requirePermission } from '../../../../../lib/apiAuth';
import { Permission } from '../../../../../constants/permissions';
import { HttpError } from '../../../../../lib/errors';
import { IUser } from '../../../../../models/User';

export async function GET(
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

    const url = new URL(req.url);
    const rollNumberQuery = url.searchParams.get('rollNumber');
    if (rollNumberQuery !== null) {
      const mapping = await ExamService.getStudentMappingByRollNumber(id, rollNumberQuery, auth.user.id, auth.user.role);
      if (!mapping) {
        return NextResponse.json({
          success: false,
          message: 'Student not found in exam roster with given roll number',
          data: null
        }, { status: 404 });
      }

      const studentUser = mapping.student as unknown as (IUser | null);
      const formattedStudent = {
        id: studentUser?._id?.toString() || '',
        name: studentUser?.name || '',
        email: studentUser?.email || '',
        rollNumber: mapping.rollNumber || null
      };

      return NextResponse.json({
        success: true,
        message: 'Exam student retrieved successfully',
        data: formattedStudent
      }, { status: 200 });
    }

    const roster = await ExamService.getEnrolledStudents(id, auth.user.id, auth.user.role);
    if (!roster) {
      return NextResponse.json({
        success: false,
        message: 'Exam not found',
        data: null
      }, { status: 404 });
    }

    const formattedRoster = roster.map((m) => {
      const studentUser = m.student as unknown as (IUser | null);
      return {
        id: studentUser?._id?.toString() || '',
        name: studentUser?.name || '',
        email: studentUser?.email || '',
        rollNumber: m.rollNumber || null
      };
    });

    return NextResponse.json({
      success: true,
      message: 'Exam student roster retrieved successfully',
      data: formattedRoster
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

