import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      message: 'Self-registration is disabled. Access to Personalized Learning is granted to professors by the administrator on request only.',
      data: null,
    },
    { status: 403 }
  );
}
