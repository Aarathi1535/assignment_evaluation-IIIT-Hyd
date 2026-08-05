import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../../lib/db';
import UserService from '../../../../services/UserService';
import { updateUserSchema } from '../../../../validations/userValidation';
import { requirePermission } from '../../../../lib/apiAuth';
import { Permission, UserRole } from '../../../../constants/permissions';

export async function PUT(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.MANAGE_USERS);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  try {
    await connectDB();

    let body;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({
        success: false,
        message: 'Invalid JSON request body',
        data: null
      }, { status: 400 });
    }

    const validationResult = updateUserSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({
        success: false,
        message: 'Validation failed',
        data: validationResult.error.format()
      }, { status: 400 });
    }

    // Cast the validationResult.data.role to UserRole if it is provided
    const userData = {
      ...validationResult.data,
      role: validationResult.data.role ? (validationResult.data.role as UserRole) : undefined
    };

    const context = {
      actingUserId: auth.user.id,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
    };
    const updatedUser = await UserService.updateUser(id, userData, context);
    if (!updatedUser) {
      return NextResponse.json({
        success: false,
        message: 'User not found',
        data: null
      }, { status: 404 });
    }

    const sanitizedUser = updatedUser.toObject();
    delete sanitizedUser.password;

    return NextResponse.json({
      success: true,
      message: 'User updated successfully',
      data: sanitizedUser
    }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message === 'Email already exists') {
      return NextResponse.json({
        success: false,
        message,
        data: null
      }, { status: 400 });
    }

    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requirePermission(Permission.MANAGE_USERS);
  if (!auth.authorized) {
    return auth.response;
  }

  const { id } = await context.params;

  try {
    await connectDB();
    const context = {
      actingUserId: auth.user.id,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
    };
    const deactivatedUser = await UserService.deactivateUser(id, context);
    if (!deactivatedUser) {
      return NextResponse.json({
        success: false,
        message: 'User not found',
        data: null
      }, { status: 404 });
    }

    const sanitizedUser = deactivatedUser.toObject();
    delete sanitizedUser.password;

    return NextResponse.json({
      success: true,
      message: 'User deactivated successfully',
      data: sanitizedUser
    }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status: 500 });
  }
}
