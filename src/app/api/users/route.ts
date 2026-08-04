import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../lib/db';
import UserService from '../../../services/UserService';
import { createUserSchema } from '../../../validations/userValidation';
import { requirePermission } from '../../../lib/apiAuth';
import { Permission, UserRole } from '../../../constants/permissions';

export async function GET() {
  const auth = await requirePermission(Permission.MANAGE_USERS);
  if (!auth.authorized) {
    return auth.response;
  }

  try {
    await connectDB();
    const users = await UserService.getAllUsers();
    
    // Sanitize user objects by removing password field before returning
    const sanitizedUsers = users.map(user => {
      const u = user.toObject();
      delete u.password;
      return u;
    });

    return NextResponse.json({
      success: true,
      message: 'Users retrieved successfully',
      data: sanitizedUsers
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

export async function POST(req: NextRequest) {
  const auth = await requirePermission(Permission.MANAGE_USERS);
  if (!auth.authorized) {
    return auth.response;
  }

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

    const validationResult = createUserSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json({
        success: false,
        message: 'Validation failed',
        data: validationResult.error.format()
      }, { status: 400 });
    }

    // Cast validationResult.data.role to UserRole
    const userData = {
      ...validationResult.data,
      role: validationResult.data.role as UserRole
    };

    const newUser = await UserService.createUser(userData);
    const sanitizedUser = newUser.toObject();
    delete sanitizedUser.password;

    return NextResponse.json({
      success: true,
      message: 'User created successfully',
      data: sanitizedUser
    }, { status: 201 });
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
