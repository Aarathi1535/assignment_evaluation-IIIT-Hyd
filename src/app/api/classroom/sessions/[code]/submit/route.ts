import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import classroomSessionService from '@/services/ClassroomSessionService';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { HttpError } from '@/lib/errors';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    await connectDB();
    const resolvedParams = await params;
    const sessionCode = resolvedParams.code.trim().toUpperCase();

    // Check participant authentication
    const participantToken = req.headers.get('x-participant-token');
    let participantId: string | null = null;
    let studentName: string | null = null;
    let studentUserId: string | undefined = undefined;

    if (participantToken) {
      const participant = await classroomSessionService.getParticipantByToken(participantToken);
      if (participant) {
        participantId = participant.participantId;
        studentName = participant.name;
        if (participant.userId) {
          studentUserId = participant.userId.toString();
        }
      }
    }

    // Fallback: check logged-in NextAuth session
    if (!participantId) {
      try {
        const nextSession = await getServerSession(authOptions);
        if (nextSession?.user?.id) {
          studentUserId = nextSession.user.id;
          participantId = `user_${studentUserId}`;
          studentName = nextSession.user.name || nextSession.user.email || 'Student';
        }
      } catch {
        // Continue
      }
    }

    const contentType = req.headers.get('content-type') || '';
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({
        success: false,
        message: 'Expected multipart/form-data with handwritten image file',
        data: null
      }, { status: 400 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const formParticipantId = formData.get('participantId') as string | null;
    const formStudentName = formData.get('studentName') as string | null;

    if (formParticipantId && !participantId) {
      participantId = formParticipantId;
    }
    if (formStudentName && (!studentName || studentName === 'Student')) {
      studentName = formStudentName;
    }

    if (!participantId || !studentName) {
      return NextResponse.json({
        success: false,
        message: 'Unauthorized: Classroom participant token or identity is required',
        data: null
      }, { status: 401 });
    }

    if (!file || file.size === 0) {
      return NextResponse.json({
        success: false,
        message: 'Image file is required',
        data: null
      }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(new Uint8Array(arrayBuffer));

    const submission = await classroomSessionService.submitHandwrittenAnswer({
      sessionCode,
      participantId,
      studentName,
      studentUserId,
      fileBuffer,
      originalFilename: file.name || 'handwritten-answer.jpg',
      mimeType: file.type || 'image/jpeg'
    });

    return NextResponse.json({
      success: true,
      message: 'Handwritten answer submitted successfully',
      data: {
        id: submission._id.toString(),
        participantId: submission.participantId,
        studentName: submission.studentName,
        submittedAt: submission.submittedAt.toISOString(),
        imagePath: submission.imagePath,
        status: submission.status
      }
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
