import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import AuthService from '@/services/AuthService';
import { z } from 'zod';

const resetSchema = z.object({
  email: z.string().trim().email({ message: 'Invalid email address' }),
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

    const validationResult = resetSchema.safeParse(body);
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

    const { email } = validationResult.data;
    const token = await AuthService.generateResetToken(email);

    if (token) {
      // Construct the reset password URL using request's origin
      const origin = new URL(req.url).origin;
      const resetLink = `${origin}/reset-password?token=${token}`;
      console.log(`[Email Stub] Password reset link for ${email}: ${resetLink}`);
    }

    // Always return generic success response to prevent user enumeration
    return NextResponse.json(
      {
        success: true,
        message: 'If that email address exists in our database, we will send you an email to reset your password.'
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
