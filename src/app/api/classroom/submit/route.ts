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

  if (auth.user.role === 'ADMIN') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Classroom Assessment is not available for Admin accounts',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();

    const contentType = req.headers.get('content-type') || '';
    let questionId: string | null = null;
    let selectedOption: number | null = null;
    let textResponse: string | null = null;
    let fileBuffer: Buffer | undefined = undefined;
    let originalFilename: string | undefined = undefined;
    let mimeType: string | undefined = undefined;

    if (contentType.includes('application/json')) {
      const body = await req.json();
      questionId = body.questionId;
      if (typeof body.selectedOption === 'number') {
        selectedOption = body.selectedOption;
      }
      if (typeof body.textResponse === 'string') {
        textResponse = body.textResponse;
      }
    } else if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      questionId = formData.get('questionId') as string | null;
      const opt = formData.get('selectedOption');
      if (opt !== null && opt !== undefined) {
        selectedOption = parseInt(opt.toString(), 10);
      }
      textResponse = (formData.get('textResponse') as string | null) || null;

      const file = formData.get('file') as File | null;
      if (file && file.size > 0) {
        const arrayBuffer = await file.arrayBuffer();
        fileBuffer = Buffer.from(new Uint8Array(arrayBuffer));
        originalFilename = file.name || 'answer.png';
        mimeType = file.type || 'image/png';
      }
    } else {
      // Fallback: try json
      try {
        const body = await req.json();
        questionId = body.questionId;
        if (typeof body.selectedOption === 'number') {
          selectedOption = body.selectedOption;
        }
        if (typeof body.textResponse === 'string') {
          textResponse = body.textResponse;
        }
      } catch {
        return NextResponse.json({
          success: false,
          message: 'Unsupported content-type. Expected application/json or multipart/form-data',
          data: null
        }, { status: 400 });
      }
    }

    if (!questionId || !questionId.trim()) {
      return NextResponse.json({
        success: false,
        message: 'Question ID is required',
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
        selectedOption,
        textResponse,
        fileBuffer,
        originalFilename,
        mimeType
      },
      context
    );

    return NextResponse.json({
      success: true,
      message: 'Classroom answer submitted successfully',
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
