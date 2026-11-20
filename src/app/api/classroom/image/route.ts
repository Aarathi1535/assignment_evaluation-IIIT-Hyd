import { NextRequest, NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { requireAuth } from '@/lib/apiAuth';
import ClassroomParticipant from '@/models/ClassroomParticipant';
import ClassroomSubmission from '@/models/ClassroomSubmission';
import ClassroomSession from '@/models/ClassroomSession';
import ClassroomQuestion from '@/models/ClassroomQuestion';
import classroomStorageService from '@/services/ClassroomStorageService';
import { connectDB } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const submissionId = searchParams.get('submissionId');
  const rawPath = searchParams.get('path');

  if (!rawPath && !submissionId) {
    return new NextResponse('Missing path or submissionId parameter', { status: 400 });
  }

  // Prevent directory traversal
  const cleanPath = (rawPath || '').replace(/\\/g, '/').replace(/^(\.\.(\/|\\|$))+/, '');
  if (cleanPath.includes('..') || (rawPath && !cleanPath.startsWith('classroom-uploads/'))) {
    return new NextResponse('Invalid or forbidden path', { status: 400 });
  }

  await connectDB();

  // Find the submission to enforce fine-grained access control
  let submission = null;
  if (submissionId && mongoose.Types.ObjectId.isValid(submissionId)) {
    submission = await ClassroomSubmission.findById(submissionId);
  }

  if (!submission && cleanPath) {
    const forwardPath = cleanPath;
    const backwardPath = cleanPath.replace(/\//g, '\\');
    submission = await ClassroomSubmission.findOne({
      $or: [
        { imagePath: forwardPath },
        { imagePath: backwardPath },
        { imagePath: rawPath }
      ]
    });
  }

  if (!submission) {
    return new NextResponse('Image submission not found', { status: 404 });
  }

  // Determine authorized identity
  let isAuthorized = false;

  // 1. Check if authenticated as a Professor owning this session
  const auth = await requireAuth();
  if (auth.authorized && auth.user.role === 'PROFESSOR') {
    let sessionId = submission.session;
    if (!sessionId && submission.question) {
      const q = await ClassroomQuestion.findById(submission.question);
      if (q) sessionId = q.session;
    }

    if (sessionId) {
      const session = await ClassroomSession.findById(sessionId);
      if (session && session.createdBy.toString() === auth.user.id) {
        isAuthorized = true;
      } else {
        return new NextResponse('Forbidden: You do not own the session for this submission image', { status: 403 });
      }
    }
  }

  // 2. Check if authenticated as a Classroom Participant (must be the student who submitted it)
  if (!isAuthorized) {
    const participantToken = req.headers.get('x-participant-token') || searchParams.get('token');
    if (participantToken) {
      const participant = await ClassroomParticipant.findOne({ token: participantToken });
      if (participant) {
        if (participant.participantId === submission.participantId) {
          isAuthorized = true;
        } else {
          return new NextResponse('Forbidden: You can only view your own submission image', { status: 403 });
        }
      }
    }
  }

  if (!isAuthorized) {
    return new NextResponse('Unauthorized to view classroom image', { status: 401 });
  }

  try {
    const targetStoragePath = cleanPath || submission.imagePath || '';
    const { buffer, contentType } = await classroomStorageService.readImage(targetStoragePath);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-transform, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to read image';
    if (message.includes('not found')) {
      return new NextResponse('Image not found', { status: 404 });
    }
    return new NextResponse('Failed to read image', { status: 500 });
  }
}
