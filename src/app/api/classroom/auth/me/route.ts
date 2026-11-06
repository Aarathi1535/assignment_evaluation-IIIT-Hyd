import { NextRequest, NextResponse } from 'next/server';
import { getClassroomUser } from '@/lib/classroomAuth';

export async function GET(req: NextRequest) {
  const user = await getClassroomUser(req);
  if (!user) {
    return NextResponse.json(
      { success: false, message: 'Not authenticated in Classroom Activity', data: null },
      { status: 401 }
    );
  }

  return NextResponse.json({
    success: true,
    message: 'Current classroom user retrieved',
    data: user,
  });
}
