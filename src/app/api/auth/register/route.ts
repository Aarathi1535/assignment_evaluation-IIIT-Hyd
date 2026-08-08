import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/db';
import AuthService from '@/services/AuthService';
import { registerSchema } from '@/validations/authValidation';
import { HttpError } from '@/lib/errors';

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

    const validationResult = registerSchema.safeParse(body);
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

    const ipAddress = (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined;
    const user = await AuthService.register(validationResult.data, ipAddress);

    return NextResponse.json(
      {
        success: true,
        message: 'User registered successfully',
        data: user
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    if (error instanceof HttpError) {
      return NextResponse.json(
        {
          success: false,
          message: error.message
        },
        { status: error.statusCode }
      );
    }

    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error'
      },
      { status: 500 }
    );
  }
}
