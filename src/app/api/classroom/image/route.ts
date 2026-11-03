import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '@/lib/apiAuth';
import ClassroomParticipant from '@/models/ClassroomParticipant';
import { connectDB } from '@/lib/db';

export async function GET(req: NextRequest) {
  // Support both professor/student NextAuth sessions AND classroom participant tokens
  const auth = await requireAuth();
  let isAuthorized = auth.authorized;

  if (!isAuthorized) {
    const participantToken = req.headers.get('x-participant-token') || req.nextUrl.searchParams.get('token');
    if (participantToken) {
      await connectDB();
      const participant = await ClassroomParticipant.findOne({ token: participantToken });
      if (participant) {
        isAuthorized = true;
      }
    }
  }

  if (!isAuthorized) {
    return new NextResponse('Unauthorized to view classroom image', { status: 401 });
  }

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

  const fullPath = path.join(process.cwd(), 'data', normalized);

  if (!fs.existsSync(fullPath)) {
    return new NextResponse('Image not found', { status: 404 });
  }

  try {
    const buffer = await fs.promises.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : ext === '.heic' ? 'image/heic' : 'image/jpeg';

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new NextResponse('Failed to read image', { status: 500 });
  }
}
