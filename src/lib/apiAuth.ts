import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import { authOptions } from './auth';
import { hasPermission, Permission, UserRole } from '../constants/permissions';

export type AuthResult =
  | {
      authorized: true;
      response: null;
      user: {
        id: string;
        email: string;
        name: string;
        role: UserRole;
      };
    }
  | {
      authorized: false;
      response: NextResponse;
      user: null | {
        id: string;
        email: string;
        name: string;
        role: UserRole;
      };
    };

/**
 * Reusable helper to retrieve the authenticated user from the NextAuth session.
 */
export async function getSessionUser() {
  const session = await getServerSession(authOptions);
  return session?.user || null;
}

/**
 * Helper to enforce authentication.
 * Returns the user if authenticated, or a 401 Unauthorized response if not.
 */
export async function requireAuth(): Promise<AuthResult> {
  const user = await getSessionUser();
  if (!user) {
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, message: 'Unauthorized', data: null },
        { status: 401 }
      ),
      user: null,
    };
  }
  return {
    authorized: true,
    response: null,
    user: {
      id: user.id,
      email: user.email || '',
      name: user.name || '',
      role: user.role as UserRole,
    },
  };
}

/**
 * Helper to enforce that the authenticated user possesses a specific permission.
 * Returns the user if authorized, or a 401 (if unauthenticated) or 403 (if missing permission) response.
 */
export async function requirePermission(permission: Permission): Promise<AuthResult> {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth;
  }

  const user = auth.user!;
  const role = user.role?.toUpperCase() as UserRole;

  if (!hasPermission(role, permission)) {
    const { writeAuditLog } = await import('./audit');
    await writeAuditLog({
      user: user.id,
      action: 'AUTHORIZATION_FAILURE',
      outcome: 'FAILURE',
      details: {
        attemptedPermission: permission,
        role
      }
    });
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, message: 'Forbidden', data: null },
        { status: 403 }
      ),
      user,
    };
  }

  return {
    authorized: true,
    response: null,
    user,
  };
}

/**
 * Standard permissions cascade allowing grading, annotation persistence,
 * and page image rendering for TA, Professor, and Admin roles.
 */
export const GRADING_OR_CANVAS_PERMISSIONS: Permission[] = [
  Permission.GRADE_SCRIPT,
  Permission.SAVE_MARKS_FEEDBACK,
  Permission.EDIT_EXAM,
  Permission.VIEW_ALL_SUBMISSIONS,
];

/**
 * Helper to enforce that the authenticated user possesses at least one of the specified permissions.
 * Returns the user if authorized, or a 401 (if unauthenticated) or 403 (if missing all permissions) response.
 */
export async function requireAnyPermission(permissions: Permission[]): Promise<AuthResult> {
  const auth = await requireAuth();
  if (!auth.authorized) {
    return auth;
  }

  const user = auth.user!;
  const role = user.role?.toUpperCase() as UserRole;

  const hasAny = permissions.some((permission) => hasPermission(role, permission));

  if (!hasAny) {
    const { writeAuditLog } = await import('./audit');
    await writeAuditLog({
      user: user.id,
      action: 'AUTHORIZATION_FAILURE',
      outcome: 'FAILURE',
      details: {
        attemptedPermissions: permissions,
        role,
      },
    });
    return {
      authorized: false,
      response: NextResponse.json(
        { success: false, message: 'Forbidden', data: null },
        { status: 403 }
      ),
      user,
    };
  }

  return {
    authorized: true,
    response: null,
    user,
  };
}

/**
 * Helper to enforce grading and canvas annotation permissions:
 * - GRADE_SCRIPT
 * - SAVE_MARKS_FEEDBACK
 * - EDIT_EXAM
 * - VIEW_ALL_SUBMISSIONS
 */
export async function requireGradingOrAnnotationAccess(): Promise<AuthResult> {
  return requireAnyPermission(GRADING_OR_CANVAS_PERMISSIONS);
}
