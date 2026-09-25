import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '@/lib/apiAuth';

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  const { searchParams } = new URL(req.url);
  const imagePath = searchParams.get('path');

  if (!imagePath) {
    return new NextResponse('Missing path parameter', { status: 400 });
  }

  // Prevent directory traversal
  const normalized = path.normalize(imagePath).replace(/^(\.\.(\/|\\|$))+/, '');
  if (normalized.includes('..')) {
    return new NextResponse('Invalid path', { status: 400 });
  }

  const fullPath = path.join(process.cwd(), 'data', normalized);

  if (!fs.existsSync(fullPath)) {
    return new NextResponse('Image not found', { status: 404 });
  }

  try {
    const buffer = await fs.promises.readFile(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

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
