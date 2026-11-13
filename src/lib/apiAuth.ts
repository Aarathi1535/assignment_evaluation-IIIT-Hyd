import { getServerSession } from 'next-auth';
import { NextResponse } from 'next/server';
import mongoose from 'mongoose';
import { authOptions } from './auth';
import { hasPermission, Permission, UserRole } from '../constants/permissions';
import type { IExam } from '../models/Exam';
import type { ICourse } from '../models/Course';

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

export interface CanManageExamResult {
  canManage: boolean;
  exam: IExam | null;
  course: ICourse | null;
  errorStatus: 200 | 400 | 401 | 403 | 404;
  errorMessage: string;
}

/**
 * AE-219 Canonical exam management access policy:
 * Admin, or the current active professor of the exam's active course.
 * Both exam and course must be active (isActive: true).
 */
export async function canManageExam(
  user: { id: string; role: string } | null | undefined,
  examOrId: string | mongoose.Types.ObjectId | IExam | null | undefined
): Promise<CanManageExamResult> {
  if (!user) {
    return { canManage: false, exam: null, course: null, errorStatus: 401, errorMessage: 'Unauthorized' };
  }

  if (!examOrId) {
    return { canManage: false, exam: null, course: null, errorStatus: 400, errorMessage: 'Invalid exam ID' };
  }

  const Exam = mongoose.models.Exam || (await import('../models/Exam')).default;
  const Course = mongoose.models.Course || (await import('../models/Course')).default;

  let exam: IExam | null = null;
  if (typeof examOrId === 'string' || examOrId instanceof mongoose.Types.ObjectId) {
    if (!mongoose.Types.ObjectId.isValid(examOrId.toString())) {
      return { canManage: false, exam: null, course: null, errorStatus: 400, errorMessage: 'Invalid exam ID' };
    }
    exam = await Exam.findById(examOrId);
  } else {
    exam = examOrId;
  }

  if (!exam || !exam.isActive) {
    return { canManage: false, exam: null, course: null, errorStatus: 404, errorMessage: 'Exam not found' };
  }

  const course: ICourse | null = await Course.findById(exam.course);
  if (!course || !course.isActive) {
    return { canManage: false, exam: null, course: null, errorStatus: 404, errorMessage: 'Course not found or inactive' };
  }

  const role = user.role?.toUpperCase();
  if (role === UserRole.ADMIN) {
    return { canManage: true, exam, course, errorStatus: 200, errorMessage: '' };
  }

  // Role is PROFESSOR: user must be the assigned professor of the course
  if (role === UserRole.PROFESSOR) {
    const profRef = course.professor as { _id?: mongoose.Types.ObjectId } | mongoose.Types.ObjectId;
    const courseProfId = profRef && '_id' in profRef && profRef._id ? profRef._id.toString() : profRef?.toString();
    if (courseProfId !== user.id) {
      return {
        canManage: false,
        exam,
        course,
        errorStatus: 404,
        errorMessage: 'Exam not found'
      };
    }

    return { canManage: true, exam, course, errorStatus: 200, errorMessage: '' };
  }

  return {
    canManage: false,
    exam,
    course,
    errorStatus: 403,
    errorMessage: 'Forbidden: Role cannot manage this exam'
  };
}
