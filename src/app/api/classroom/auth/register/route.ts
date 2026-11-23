import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  // Public self-registration is strictly disabled.
  // Classroom Activity access is granted by the administrator on request only.
  return NextResponse.json(
    {
      success: false,
      message: 'Self-registration is disabled. Access to Classroom Activity is granted to professors by the administrator on request only.',
      data: null,
    },
    { status: 403 }
  );
}

