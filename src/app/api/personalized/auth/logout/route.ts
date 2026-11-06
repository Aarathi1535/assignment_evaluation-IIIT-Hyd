import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({
    success: true,
    message: 'Personalized logout successful',
    data: null,
  });

  response.cookies.delete('personalized_token');
  return response;
}

