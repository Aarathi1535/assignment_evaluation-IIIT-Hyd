import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({
    success: true,
    message: 'Classroom logout successful',
    data: null,
  });

  response.cookies.delete('classroom_token');
  return response;
}

