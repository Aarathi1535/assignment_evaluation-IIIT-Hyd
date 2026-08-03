import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import AuthService from '@/services/AuthService';
import { z } from 'zod';

const resetPasswordSchema = z.object({
  token: z.string().min(1, { message: 'Token is required' }),
  newPassword: z.string().min(8, { message: 'Password must be at least 8 characters long' }),
});

export async function POST(req: NextRequest) {
  try {
    await connectDB();

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid JSON request body'
        },
        { status: 400 }
      );
    }

    const validationResult = resetPasswordSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          success: false,
          message: 'Validation failed',
          errors: validationResult.error.format()
        },
        { status: 400 }
      );
    }

    const { token, newPassword } = validationResult.data;

    try {
      await AuthService.resetPassword(token, newPassword);
    } catch {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid or expired token'
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Your password has been reset successfully.'
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error'
      },
      { status: 500 }
    );
  }
}
