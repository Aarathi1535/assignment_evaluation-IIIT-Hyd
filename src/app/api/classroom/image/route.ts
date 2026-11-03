import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { requireAuth } from '@/lib/apiAuth';
import ClassroomParticipant from '@/models/ClassroomParticipant';
import ClassroomSubmission from '@/models/ClassroomSubmission';
import ClassroomSession from '@/models/ClassroomSession';
import classroomStorageService from '@/services/ClassroomStorageService';
import { connectDB } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const imagePath = searchParams.get('path');

  if (!imagePath) {
    return new NextResponse('Missing path parameter', { status: 400 });
  }

  // Prevent directory traversal
  const normalized = path.normalize(imagePath).replace(/^(\.\.(\/|\\|$))+/, '');
  if (normalized.includes('..') || !normalized.startsWith('classroom-uploads')) {
    return new NextResponse('Invalid or forbidden path', { status: 400 });
  }

  await connectDB();

  // Find the submission associated with this image to enforce fine-grained access control
  const submission = await ClassroomSubmission.findOne({ imagePath: normalized });
  if (!submission) {
    return new NextResponse('Image submission not found', { status: 404 });
  }

  // Determine authorized identity
  let isAuthorized = false;

  // 1. Check if authenticated as a Professor owning this session
  const auth = await requireAuth();
  if (auth.authorized) {
    if (auth.user.role === 'PROFESSOR') {
      const session = await ClassroomSession.findById(submission.session);
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
    const { buffer, contentType } = await classroomStorageService.readImage(normalized);

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, no-transform, max-age=300',
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
