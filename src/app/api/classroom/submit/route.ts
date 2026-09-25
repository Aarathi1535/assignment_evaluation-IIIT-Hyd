import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import ClassroomAssessmentService from '@/services/ClassroomAssessmentService';
import { requireAuth } from '@/lib/apiAuth';
import { HttpError } from '@/lib/errors';

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectDB();

    const formData = await req.formData();
    const questionId = formData.get('questionId') as string | null;
    const file = formData.get('file') as File | null;

    if (!questionId || !questionId.trim()) {
      return NextResponse.json({
        success: false,
        message: 'Question ID is required',
        data: null
      }, { status: 400 });
    }

    if (!file) {
      return NextResponse.json({
        success: false,
        message: 'Answer image file is required',
        data: null
      }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(new Uint8Array(arrayBuffer));

    if (fileBuffer.length === 0) {
      return NextResponse.json({
        success: false,
        message: 'Uploaded file is empty',
        data: null
      }, { status: 400 });
    }

    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || undefined
    };

    const submission = await ClassroomAssessmentService.submitAnswer(
      {
        questionId: questionId.trim(),
        studentId: auth.user.id,
        fileBuffer,
        originalFilename: file.name || 'answer.png',
        mimeType: file.type || 'image/png'
      },
      context
    );

    return NextResponse.json({
      success: true,
      message: 'Classroom answer evaluated successfully',
      data: submission
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
