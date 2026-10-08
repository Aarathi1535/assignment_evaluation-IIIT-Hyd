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

  if (auth.user.role !== 'PROFESSOR') {
    return NextResponse.json({
      success: false,
      message: 'Forbidden: Only professors can advance classroom questions',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();
    const body = await req.json();
    const currentQuestionId = body.currentQuestionId;

    if (!currentQuestionId) {
      return NextResponse.json({
        success: false,
        message: 'Current question ID is required',
        data: null
      }, { status: 400 });
    }

    const context = {
      actingUserId: auth.user.id,
      actingUserRole: auth.user.role
    };

    const nextQuestion = await ClassroomAssessmentService.nextQuestion(currentQuestionId, context);

    return NextResponse.json({
      success: true,
      message: nextQuestion ? 'Advanced to next question' : 'No more questions in the queue',
      data: nextQuestion
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
