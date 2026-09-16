import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '../../../lib/db';
import UserService from '../../../services/UserService';
import { createUserSchema } from '../../../validations/userValidation';
import { requirePermission, requireAuth } from '../../../lib/apiAuth';
import { Permission, UserRole } from '../../../constants/permissions';
import User from '../../../models/User';
import { HttpError } from '../../../lib/errors';

export async function GET(req?: NextRequest) {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth.response;
  }

  const role = auth.user.role?.toUpperCase();
  const isAdmin = role === UserRole.ADMIN;
  const isProfessor = role === UserRole.PROFESSOR;

  if (!isAdmin && !isProfessor) {
    return NextResponse.json({
      success: false,
      message: 'Forbidden',
      data: null
    }, { status: 403 });
  }

  try {
    await connectDB();

    let targetRole: UserRole | null = null;
    if (req?.url) {
      try {
        const url = new URL(req.url);
        const roleParam = url.searchParams.get('role')?.toUpperCase();
        if (roleParam && Object.values(UserRole).includes(roleParam as UserRole)) {
          targetRole = roleParam as UserRole;
        } else if (roleParam) {
          return NextResponse.json({
            success: false,
            message: 'Invalid role parameter',
            data: null
          }, { status: 400 });
        }
      } catch {
        // ignore URL parse errors
      }
    }

    let users;
    if (isAdmin) {
      if (targetRole) {
        users = await User.find({ role: targetRole, isActive: true }).sort({ name: 1 });
      } else {
        users = await UserService.getAllUsers();
      }
    } else {
      // Professor can view active students and active teaching assistants
      if (targetRole === UserRole.STUDENT) {
        users = await User.find({ role: UserRole.STUDENT, isActive: true }).sort({ name: 1 });
      } else if (targetRole === UserRole.TA) {
        users = await User.find({ role: UserRole.TA, isActive: true }).sort({ name: 1 });
      } else if (targetRole) {
        return NextResponse.json({
          success: false,
          message: 'Forbidden',
          data: null
        }, { status: 403 });
      } else {
        users = await User.find({ role: { $in: [UserRole.STUDENT, UserRole.TA] }, isActive: true }).sort({ name: 1 });
      }
    }
    
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
    const status = error instanceof HttpError ? error.statusCode : 500;
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status });
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

    const context = {
      actingUserId: auth.user.id,
      ipAddress: (req as NextRequest & { ip?: string }).ip || req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || undefined,
    };
    const newUser = await UserService.createUser(userData, context);
    const sanitizedUser = newUser.toObject();
    delete sanitizedUser.password;

    return NextResponse.json({
      success: true,
      message: 'User created successfully',
      data: sanitizedUser
    }, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    const status = error instanceof HttpError ? error.statusCode : 500;
    return NextResponse.json({
      success: false,
      message,
      data: null
    }, { status });
  }
}
