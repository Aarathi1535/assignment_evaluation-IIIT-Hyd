import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { connectClassroomDB } from './classroomDb';
import { ClassroomUserRole } from '../models/ClassroomUser';

export interface ClassroomAuthTokenPayload {
  id: string;
  email: string;
  name: string;
  role: ClassroomUserRole;
  exp: number;
}

const SECRET = process.env.CLASSROOM_AUTH_SECRET || process.env.NEXTAUTH_SECRET || 'classroom-activity-independent-secret-key-salt-32chars';

export function signClassroomToken(payload: Omit<ClassroomAuthTokenPayload, 'exp'>, expiresInSeconds = 7 * 24 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const fullPayload: ClassroomAuthTokenPayload = { ...payload, exp };
  const data = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');
  const signature = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
  return `${data}.${signature}`;
}

export function verifyClassroomToken(token: string): ClassroomAuthTokenPayload | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [data, signature] = parts;
    const expectedSignature = crypto.createHmac('sha256', SECRET).update(data).digest('base64url');
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as ClassroomAuthTokenPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}

export async function getClassroomUser(req?: NextRequest) {
  // 1. Check x-classroom-token header
  let token = req?.headers.get('x-classroom-token') || null;

  // 2. Check Authorization Bearer header
  if (!token && req) {
    const authHeader = req.headers.get('authorization');
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
  }

  // 3. Check cookies
  if (!token && req) {
    token = req.cookies.get('classroom_token')?.value || null;
  }

  if (token) {
    const decoded = verifyClassroomToken(token);
    if (decoded) {
      return decoded;
    }
  }

  // Fallback to NextAuth session in unified development environment
  try {
    const session = await getServerSession(authOptions);
    if (session?.user) {
      return {
        id: session.user.id,
        email: session.user.email || '',
        name: session.user.name || '',
        role: (session.user.role as ClassroomUserRole) || 'PROFESSOR',
        exp: Math.floor(Date.now() / 1000) + 86400,
      };
    }
  } catch {
    // Non-blocking
  }

  return null;
}

export async function requireClassroomAuth(req?: NextRequest) {
  await connectClassroomDB();
  const user = await getClassroomUser(req);
  if (!user) {
    return {
      authorized: false as const,
      user: null,
      response: NextResponse.json(
        { success: false, message: 'Classroom authentication required', data: null },
        { status: 401 }
      ),
    };
  }

  return {
    authorized: true as const,
    user,
    response: null,
  };
}

export async function requireClassroomProfessor(req?: NextRequest) {
  const auth = await requireClassroomAuth(req);
  if (!auth.authorized) {
    return auth;
  }

  if (auth.user.role !== 'PROFESSOR') {
    return {
      authorized: false as const,
      user: auth.user,
      response: NextResponse.json(
        { success: false, message: 'Forbidden: Only professors can perform this action in Classroom Activity', data: null },
        { status: 403 }
      ),
    };
  }

  return auth;
}
