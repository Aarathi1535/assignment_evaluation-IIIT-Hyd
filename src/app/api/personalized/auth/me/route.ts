import { NextRequest, NextResponse } from 'next/server';
import { getPersonalizedUser } from '@/lib/personalizedAuth';

export async function GET(req: NextRequest) {
  const user = await getPersonalizedUser(req);
  if (!user) {
    return NextResponse.json(
      { success: false, message: 'Not authenticated in Personalized Learning', data: null },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Current personalized user retrieved',
    data: user,
  });
}
